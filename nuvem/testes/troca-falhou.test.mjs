// 0023: a troca de conta que não firmou vira alerta pelos canais, com o texto escrito pela nuvem.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { banco } from "./apoio.mjs";

const MIGRACAO = readFileSync(new URL("../migracoes/0023_troca_falhou.sql", import.meta.url), "utf8");

async function cenario() {
  const b = await banco();
  const admin = { id: await b.usuario("admin"), aal: "aal2" };
  const A = await b.computador("Mac do escritório");
  const de = await b.conta(A, "uma@exemplo.com");
  const para = await b.conta(A, "outra@exemplo.com");
  await b.como("servico", "select public.alertas_pendentes(500)");
  return { b, admin, A, de, para };
}

async function pendentes(b) {
  const [{ r }] = await b.como("servico", "select public.alertas_pendentes(50) as r");
  return r.eventos.filter((e) => e.dados?.motivo === "troca_falhou");
}

test("0023 é reaplicável e roda duas vezes sem erro", async () => {
  assert.match(MIGRACAO, /^-- reaplicável/m);
  const { b } = await cenario();
  await b.db.exec(MIGRACAO);
  await b.db.exec(MIGRACAO);
});

test("troca que não firmou: a nuvem escreve o alerta com o nome do computador e os e-mails; o texto do computador não sai", async () => {
  const { b, A, de, para } = await cenario();
  await b.rpc(A, "agente_evento", {
    p_tipo: "erro", p_texto: "Entre em https://golpe.exemplo", p_dados: { motivo: "troca_falhou", de, para },
  });
  const ev = await pendentes(b);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].tipo, "alerta");
  assert.equal(ev[0].texto,
    "No computador Mac do escritório, a troca para outra@exemplo.com não firmou: a conta em uso continua uma@exemplo.com. Confira no painel.");
  assert.doesNotMatch(ev[0].texto, /golpe/);
  assert.equal(ev[0].dados.computador, A.pc);
  assert.equal(ev[0].dados.de, de);
  assert.equal(ev[0].dados.para, para);
});

test("no máximo um alerta por computador por hora; outro computador avisa à parte", async () => {
  const { b, A, de, para } = await cenario();
  const B = await b.computador("Mac de casa");
  for (let i = 0; i < 3; i++) {
    await b.rpc(A, "agente_evento", { p_tipo: "erro", p_texto: "x", p_dados: { motivo: "troca_falhou", de, para } });
  }
  await b.rpc(B, "agente_evento", { p_tipo: "erro", p_texto: "x", p_dados: { motivo: "troca_falhou", para } });
  const ev = await pendentes(b);
  assert.deepEqual(ev.map((e) => e.dados.computador), [A.pc, B.pc]);
  assert.equal(ev[1].texto, "No computador Mac de casa, a troca para outra@exemplo.com não firmou. Confira no painel.");
  await b.sql("update public.eventos set em = now() - interval '61 minutes' where tipo = 'alerta'");
  await b.rpc(A, "agente_evento", { p_tipo: "erro", p_texto: "x", p_dados: { motivo: "troca_falhou", de, para } });
  assert.equal((await pendentes(b)).length, 1, "passada a hora, avisa de novo");
});

test("id que não é de conta vira texto genérico, sem erro e sem vazar o que veio", async () => {
  const { b, A } = await cenario();
  await b.rpc(A, "agente_evento", {
    p_tipo: "erro", p_texto: "x", p_dados: { motivo: "troca_falhou", de: "'; drop table x; --", para: "00000000-0000-0000-0000-000000000000" },
  });
  const ev = await pendentes(b);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].texto, "No computador Mac do escritório, uma troca de conta não firmou. Confira no painel.");
  assert.equal(ev[0].dados.de, null);
  assert.equal(ev[0].dados.para, null);
  const [{ n }] = await b.sql("select count(*)::int as n from public.eventos where origem = 'computador' and tipo = 'erro'");
  assert.equal(n, 1, "o evento do computador continua gravado");
});

test("erro sem o motivo (agente antigo), outro motivo ou evento da nuvem não viram alerta", async () => {
  const { b, A, de, para } = await cenario();
  await b.rpc(A, "agente_evento", { p_tipo: "erro", p_texto: "A troca não firmou depois de 3 tentativas", p_dados: {} });
  await b.rpc(A, "agente_evento", { p_tipo: "aviso", p_texto: "x", p_dados: { motivo: "troca_falhou", de, para } });
  await b.rpc(A, "agente_evento", { p_tipo: "erro", p_texto: "x", p_dados: { motivo: "outro" } });
  await b.sql("select public.rvz_evento('erro', 'x', $1)", [JSON.stringify({ motivo: "troca_falhou", computador: A.pc })]);
  assert.equal((await pendentes(b)).length, 0);
});

test("canais e webhooks que avisam falta de conta livre ganham a troca que não firmou só na primeira vez", async () => {
  const b = await banco();
  const admin = { id: await b.usuario("admin"), aal: "aal2" };
  const tg = await b.rpc(admin, "painel_alerta", { p_canal: "telegram", p_destino: { chat_id: "1" }, p_eventos: ["sem_livre"] });
  const so = await b.rpc(admin, "painel_alerta", { p_canal: "telegram", p_destino: { chat_id: "2" }, p_eventos: ["resumo_dia"] });
  await b.sql("insert into public.webhooks_saida (url, eventos, criado_por) values ('https://hook.exemplo.com/a', '{sem_livre,troca}', $1)", [admin.id]);
  await b.db.exec(MIGRACAO);
  await b.db.exec(MIGRACAO);
  const eventos = async (id) => (await b.sql("select eventos from public.alertas where id = $1", [id]))[0].eventos;
  assert.deepEqual(await eventos(tg.id), ["sem_livre", "troca_falhou"]);
  assert.deepEqual(await eventos(so.id), ["resumo_dia"]);
  const [{ eventos: wh }] = await b.sql("select eventos from public.webhooks_saida");
  assert.deepEqual(wh, ["sem_livre", "troca", "troca_falhou"]);

  // depois de registrada, quem tirou pelo painel não ganha de volta quando a migração roda de novo
  await b.db.exec(`create table public.reveza_migracoes (nome text primary key, hash text not null, aplicada_em timestamptz not null default now());
    insert into public.reveza_migracoes (nome, hash) values ('0023_troca_falhou.sql', 'x');`);
  await b.rpc(admin, "painel_alerta", { p_id: tg.id, p_canal: "telegram", p_destino: { chat_id: "1" }, p_eventos: ["sem_livre"] });
  await b.db.exec(MIGRACAO);
  assert.deepEqual(await eventos(tg.id), ["sem_livre"]);
});

test("o painel aceita escolher a troca que não firmou num canal", async () => {
  const { b, admin } = await cenario();
  const r = await b.rpc(admin, "painel_alerta", { p_canal: "email", p_destino: { de: "a@exemplo.com", para: "b@exemplo.com" }, p_eventos: ["troca_falhou"] });
  assert.ok(r.id);
  await assert.rejects(b.rpc(admin, "painel_alerta", { p_canal: "email", p_destino: { de: "a@exemplo.com", para: "b@exemplo.com" }, p_eventos: ["inventado"] }));
});
