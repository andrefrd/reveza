import { test } from "node:test";
import assert from "node:assert/strict";
import { banco } from "./apoio.mjs";

async function cenario({ auto = true, modo = "limiar" } = {}) {
  const b = await banco();
  const pc = await b.computador();
  await b.config("auto", auto);
  await b.config("modo", modo);
  return { b, pc };
}

async function usar(b, pc, conta) {
  await b.sql("insert into public.atribuicao (computador_id, conta_id, motivo, decidido_em) values ($1, $2, 'teste', now() - interval '1 hour')", [pc.pc, conta]);
}

async function pct(b, conta, valor, tipo = "five_hour") {
  await b.sql(`insert into public.uso_janelas (conta_id, tipo, pct, reset_em, lido_em, fonte) values ($1, $2, $3, now() + interval '2 hours', now(), 'api')
               on conflict (conta_id, tipo) do update set pct = excluded.pct, reset_em = excluded.reset_em, lido_em = now()`, [conta, tipo, valor]);
}

test("limiar: abaixo do aviso nada; no aviso avisa; na troca troca para a melhor", async () => {
  const { b, pc } = await cenario();
  const a = await b.conta(pc, "a@exemplo.com", 50);
  const c = await b.conta(pc, "c@exemplo.com", 30);
  const d = await b.conta(pc, "d@exemplo.com", 5);
  await usar(b, pc, a);
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(pc), a);
  await pct(b, a, 91);
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(pc), a);
  assert.equal((await b.sql("select count(*)::int n from public.eventos where tipo = 'aviso'"))[0].n, 1);
  await pct(b, a, 95);
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(pc), d, "a menos usada entre as de mesma prioridade");
  const [ev] = await b.sql("select dados from public.eventos where tipo = 'troca' order by id desc limit 1");
  assert.equal(ev.dados.de, a);
  assert.equal(ev.dados.para, d);
  void c;
});

test("troca automática desligada: não troca nem na troca", async () => {
  const { b, pc } = await cenario({ auto: false });
  const a = await b.conta(pc, "a@exemplo.com", 99);
  await b.conta(pc, "c@exemplo.com", 5);
  await usar(b, pc, a);
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(pc), a);
});

test("só no limite: 97% não troca, 100% troca, aviso da sessão troca na hora", async () => {
  const { b, pc } = await cenario({ modo: "limite" });
  const a = await b.conta(pc, "a@exemplo.com", 97);
  const c = await b.conta(pc, "c@exemplo.com", 5);
  await usar(b, pc, a);
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(pc), a);
  await b.rpc(pc, "agente_limite", { p_conta: a });
  assert.equal(await b.atribuida(pc), c);
});

test("aviso de limite de uma conta que já saiu não troca de novo", async () => {
  const { b, pc } = await cenario();
  const a = await b.conta(pc, "a@exemplo.com", 10);
  const c = await b.conta(pc, "c@exemplo.com", 10);
  await usar(b, pc, c);
  const r = await b.rpc(pc, "agente_limite", { p_conta: a });
  assert.equal(r.trocou, true);
  assert.equal(await b.atribuida(pc), c);
  const [j] = await b.sql("select pct from public.uso_janelas where conta_id = $1 and tipo = 'five_hour'", [c]);
  assert.equal(Number(j.pct), 10, "a conta nova não ficou marcada esgotada");
});

test("espera entre trocas, menos no limite", async () => {
  const { b, pc } = await cenario();
  const a = await b.conta(pc, "a@exemplo.com", 99);
  const c = await b.conta(pc, "c@exemplo.com", 5);
  await b.sql("insert into public.atribuicao (computador_id, conta_id, motivo, decidido_em) values ($1, $2, 'teste', now())", [pc.pc, a]);
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(pc), a, "acabou de trocar: espera");
  await b.sql("select public.decidir($1, true)", [pc.pc]);
  assert.equal(await b.atribuida(pc), c);
});

test("sem conta livre: alerta uma vez por hora e não troca", async () => {
  const { b, pc } = await cenario();
  const a = await b.conta(pc, "a@exemplo.com", 99);
  await b.conta(pc, "c@exemplo.com", 96);
  await usar(b, pc, a);
  await b.sql("select public.decidir()");
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(pc), a);
  assert.equal((await b.sql("select count(*)::int n from public.eventos where tipo = 'alerta'"))[0].n, 1);
});

test("fora do rodízio: pausada, precisa de login, reserva por último, agenda e teto semanal", async () => {
  const { b, pc } = await cenario();
  const a = await b.conta(pc, "a@exemplo.com", 99);
  await b.conta(pc, "pausada@exemplo.com", 1, { pausada: true });
  await b.conta(pc, "login@exemplo.com", 1, { precisa_login: true });
  await b.conta(pc, "agenda@exemplo.com", 1, { agenda: JSON.stringify([{ dias: [], de: "00:00", ate: "00:01" }]) });
  const teto = await b.conta(pc, "teto@exemplo.com", 1, { teto_semana: 50 });
  await pct(b, teto, 60, "seven_day");
  const reserva = await b.conta(pc, "reserva@exemplo.com", 1, { reserva: true });
  const comum = await b.conta(pc, "comum@exemplo.com", 40);
  await usar(b, pc, a);
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(pc), comum, "a comum (40%) antes da reserva (1%)");
  await b.sql("update public.contas set pausada = true where id = $1", [comum]);
  await b.sql("update public.atribuicao set decidido_em = now() - interval '1 hour'");
  await pct(b, comum, 99);
  await b.sql("delete from public.atribuicao");
  await usar(b, pc, a);
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(pc), reserva, "sobrou só a reserva");
});

test("semana do Opus esgotada tira a conta da fila; reset que passou zera", async () => {
  const { b, pc } = await cenario();
  const a = await b.conta(pc, "a@exemplo.com", 99);
  const c = await b.conta(pc, "c@exemplo.com", 5);
  await pct(b, c, 100, "seven_day_opus");
  await usar(b, pc, a);
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(pc), a, "c tem a semana do Opus cheia");
  await b.sql("update public.uso_janelas set reset_em = now() - interval '1 minute' where conta_id = $1 and tipo = 'seven_day_opus'", [c]);
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(pc), c);
});

test("rodízio: na hora troca para outra livre e marca a próxima", async () => {
  const { b, pc } = await cenario({ modo: "rodizio" });
  const a = await b.conta(pc, "a@exemplo.com", 20);
  const c = await b.conta(pc, "c@exemplo.com", 30);
  await usar(b, pc, a);
  await b.sql("select public.decidir()");
  const [prox] = await b.sql("select (valor #>> '{}')::timestamptz em from public.config where chave = 'proximo_rodizio_em'");
  assert.ok(prox, "marcou o próximo rodízio");
  assert.equal(await b.atribuida(pc), a, "a primeira passada só marca o horário");
  await b.config("proximo_rodizio_em", new Date(Date.now() - 1000).toISOString());
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(pc), c);
});

test("dois computadores nunca ficam com a mesma conta", async () => {
  const { b, pc } = await cenario();
  const pc2 = await b.computador("pc2");
  const a = await b.conta(pc, "a@exemplo.com", 99);
  const c = await b.conta(pc, "c@exemplo.com", 5);
  await usar(b, pc, a);
  await b.sql("insert into public.atribuicao (computador_id, conta_id, motivo) values ($1, $2, 'teste')", [pc2.pc, c]);
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(pc), a, "a única livre é a do outro computador");
});
