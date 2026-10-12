// Atualizar sozinho com três jeitos e a trava de compatibilidade (0020). No banco de verdade (PGlite com as migrações).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { banco } from "./apoio.mjs";
import { migracoes, SQL_REGISTRO, sqlRegistrar } from "../provisionar.mjs";

async function preparar() {
  const b = await banco();
  const admin = { id: await b.usuario("admin"), aal: "aal2" };
  const pc1 = await b.computador("pc1");
  const pc2 = await b.computador("pc2");
  return { b, admin, pc1, pc2 };
}
const gravado = async (b) => (await b.sql("select valor from public.config where chave = 'atualizar_sozinho'"))[0]?.valor;
const escolher = (b, admin, valor) => b.rpc(admin, "painel_config", { p_chave: "atualizar_sozinho", p_valor: valor });
const vez = (b, pc) => b.rpc(pc, "agente_vez_de_atualizar", { p_de: "1.0.0", p_para: "1.0.1" });

test("a escolha: desligada e de madrugada gravam false e true (os agentes de antes entendem), assim que sair grava o nome", async () => {
  const { b, admin, pc1 } = await preparar();
  await escolher(b, admin, "madrugada");
  assert.equal(await gravado(b), true);
  await escolher(b, admin, "assim_que_sair");
  assert.equal(await gravado(b), "assim_que_sair");
  assert.equal((await b.rpc(pc1, "agente_ola", { p_versao: "1.0.0" })).config.atualizar_sozinho, "assim_que_sair");
  await escolher(b, admin, "desligada");
  assert.equal(await gravado(b), false);
  // o painel de antes (liga e desliga) segue valendo
  await escolher(b, admin, true);
  assert.equal(await gravado(b), true);
  for (const mau of ["sempre", "", 1, { modo: "madrugada" }, null]) {
    await assert.rejects(escolher(b, admin, mau), /desligada, madrugada ou assim_que_sair|precisa/, JSON.stringify(mau));
  }
  // só administrador escolhe
  await assert.rejects(b.rpc(pc1, "painel_config", { p_chave: "atualizar_sozinho", p_valor: "assim_que_sair" }));
});

test("o jeito a partir do valor gravado: true continua de madrugada", async () => {
  const { b } = await preparar();
  const modo = async (v) => (await b.sql("select public.rvz_modo_atualizar($1::jsonb) as m", [JSON.stringify(v)]))[0].m;
  assert.equal(await modo(true), "madrugada");
  assert.equal(await modo("madrugada"), "madrugada");
  assert.equal(await modo("assim_que_sair"), "assim_que_sair");
  assert.equal(await modo(false), "desligada");
  assert.equal(await modo("desligada"), "desligada");
  assert.equal(await modo("qualquer"), "desligada");
});

test("a vez vale nos dois jeitos ligados, um computador por vez; desligada não dá a vez", async () => {
  const { b, admin, pc1, pc2 } = await preparar();
  assert.deepEqual(await vez(b, pc1), { pode: false, motivo: "desligado" });
  await escolher(b, admin, "assim_que_sair");
  assert.deepEqual(await vez(b, pc1), { pode: true });
  assert.deepEqual(await vez(b, pc2), { pode: false, motivo: "outro" });
  // instalação que já estava ligada (true, de antes da escolha): também dá a vez
  await b.config("atualizar_sozinho", true);
  await b.sql("delete from public.config where chave = 'atualizacao_vez'");
  assert.deepEqual(await vez(b, pc2), { pode: true });
  // mudar a escolha no meio não tira a vez de quem está atualizando (senão seriam dois ao mesmo tempo)
  await escolher(b, admin, "madrugada");
  assert.deepEqual(await vez(b, pc1), { pode: false, motivo: "outro" });
  await escolher(b, admin, "desligada");
  await escolher(b, admin, "assim_que_sair");
  assert.deepEqual(await vez(b, pc1), { pode: false, motivo: "outro" });
  // e o resultado de quem estava no meio ainda acha a vez: voltou para a anterior, os outros param
  assert.deepEqual(await b.rpc(pc2, "agente_atualizacao_resultado", { p_para: "1.0.1", p_estado: "falhou", p_motivo: "voltou" }), { ok: true });
  assert.deepEqual(await vez(b, pc1), { pode: false, motivo: "falhou" });
  // gravar a mesma escolha (o Retomar do painel) destrava a vez parada
  await escolher(b, admin, "assim_que_sair");
  assert.deepEqual(await vez(b, pc1), { pode: true });
});

test("o alerta de quem voltou para a anterior diz como destravar", async () => {
  const { b, admin, pc1 } = await preparar();
  await escolher(b, admin, "assim_que_sair");
  await vez(b, pc1);
  await b.rpc(pc1, "agente_atualizacao_resultado", { p_para: "1.0.1", p_estado: "falhou", p_motivo: "voltou" });
  const [a] = await b.sql("select texto from public.eventos where tipo = 'alerta' and dados ->> 'motivo' = 'atualizacao_falhou'");
  assert.match(a.texto, /escolher de novo como atualizar/);
});

test("as migrações da nuvem: o computador lê só os nomes e os resumos, pela função; a tabela segue fechada", async () => {
  const { b, admin, pc1 } = await preparar();
  // sem o registro (banco montado fora do instalador): não se sabe
  assert.deepEqual(await b.rpc(pc1, "agente_migracoes"), { nomes: null, hashes: null });
  await b.db.exec(SQL_REGISTRO);
  assert.deepEqual(await b.rpc(pc1, "agente_migracoes"), { nomes: [], hashes: {} });
  // como o instalador registra: o nome do arquivo e o hash
  const todas = migracoes();
  for (const m of todas) await b.sql(sqlRegistrar(m.nome, createHash("sha256").update(m.sql).digest("hex")));
  const { nomes } = await b.rpc(pc1, "agente_migracoes");
  assert.deepEqual(nomes, todas.map((m) => m.nome).sort());
  assert.ok(nomes.includes("0020_atualizar_escolha.sql"));
  // nada além dos nomes e dos resumos (de arquivos públicos) chega ao computador
  const r = await b.rpc(pc1, "agente_migracoes");
  assert.deepEqual(Object.keys(r).sort(), ["hashes", "nomes"]);
  for (const m of todas) assert.equal(r.hashes[m.nome], createHash("sha256").update(m.sql).digest("hex"), m.nome);
  await assert.rejects(b.como(pc1, "select * from public.reveza_migracoes"), /permission denied/);
  await assert.rejects(b.como(admin, "select * from public.reveza_migracoes"), /permission denied/);
  // só computador ativo: administrador e anônimo não chamam
  await assert.rejects(b.rpc(admin, "agente_migracoes"), /só computador ativo/);
  await assert.rejects(b.rpc("anon", "agente_migracoes"), /permission denied/);
});
