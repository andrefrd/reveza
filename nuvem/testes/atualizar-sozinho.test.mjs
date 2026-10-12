// Atualizar sozinho de madrugada (0017): a opção, a vez de cada computador (um por vez) e o alerta quando um volta
// para a versão anterior. No banco de verdade (PGlite com as migrações).
import { test } from "node:test";
import assert from "node:assert/strict";
import { banco } from "./apoio.mjs";

async function preparar() {
  const b = await banco();
  const admin = { id: await b.usuario("admin"), aal: "aal2" };
  const pc1 = await b.computador("pc1");
  const pc2 = await b.computador("pc2");
  return { b, admin, pc1, pc2 };
}
const vez = (b, pc, de = "1.0.0", para = "1.0.1") => b.rpc(pc, "agente_vez_de_atualizar", { p_de: de, p_para: para });
const fim = (b, pc, estado, para = "1.0.1", motivo = null) => b.rpc(pc, "agente_atualizacao_resultado", { p_para: para, p_estado: estado, p_motivo: motivo });
const alertas = async (b) => b.sql("select texto, dados from public.eventos where tipo = 'alerta' and dados ->> 'motivo' = 'atualizacao_falhou'");

test("a opção começa desligada, só administrador liga, e chega aos computadores no agente_ola", async () => {
  const { b, admin, pc1 } = await preparar();
  assert.deepEqual(await vez(b, pc1), { pode: false, motivo: "desligado" });
  await assert.rejects(b.rpc(pc1, "painel_config", { p_chave: "atualizar_sozinho", p_valor: true }));
  await assert.rejects(b.rpc(admin, "painel_config", { p_chave: "atualizar_sozinho", p_valor: "sim" }), /verdadeiro ou falso/);
  assert.equal((await b.rpc(admin, "painel_config", { p_chave: "atualizar_sozinho", p_valor: true })).ok, true);
  const r = await b.rpc(pc1, "agente_ola", { p_versao: "1.0.0" });
  assert.equal(r.config.atualizar_sozinho, true);
  // a vez não se escreve pelo painel
  await assert.rejects(b.rpc(admin, "painel_config", { p_chave: "atualizacao_vez", p_valor: {} }), /desconhecida/);
});

test("um computador por vez: o segundo só começa quando o primeiro voltou na versão nova", async () => {
  const { b, admin, pc1, pc2 } = await preparar();
  await b.rpc(admin, "painel_config", { p_chave: "atualizar_sozinho", p_valor: true });
  assert.deepEqual(await vez(b, pc1), { pode: true });
  assert.deepEqual(await vez(b, pc2), { pode: false, motivo: "outro" });
  assert.deepEqual(await vez(b, pc1), { pode: false, motivo: "em_andamento" }, "nem o próprio pede de novo no meio");
  // o primeiro voltou na versão nova (o agente novo manda a versão no agente_ola): a vez fica livre
  await b.rpc(pc1, "agente_ola", { p_versao: "1.0.1" });
  assert.deepEqual(await vez(b, pc2), { pode: true });
  // e o agente novo conta que terminou: nada muda para o segundo, que já está com a vez
  assert.deepEqual(await fim(b, pc1, "concluida"), { ok: false });
  assert.deepEqual(await fim(b, pc2, "concluida"), { ok: true });
  const [{ valor }] = await b.sql("select valor from public.config where chave = 'atualizacao_vez'");
  assert.equal(valor.estado, "concluida");
});

test("um voltou para a anterior: os outros não atualizam sozinhos e sai um alerta; desligar e ligar destrava", async () => {
  const { b, admin, pc1, pc2 } = await preparar();
  await b.rpc(admin, "painel_config", { p_chave: "atualizar_sozinho", p_valor: true });
  assert.deepEqual(await vez(b, pc1), { pode: true });
  assert.deepEqual(await fim(b, pc1, "falhou", "1.0.1", "o agente novo não respondeu em 30 s: voltando para a versão anterior"), { ok: true });
  assert.deepEqual(await vez(b, pc2), { pode: false, motivo: "falhou" });
  const [a] = await alertas(b);
  assert.match(a.texto, /pc1 para a 1\.0\.1 não deu certo/);
  assert.equal(a.dados.para, "1.0.1");
  await b.rpc(admin, "painel_config", { p_chave: "atualizar_sozinho", p_valor: false });
  await b.rpc(admin, "painel_config", { p_chave: "atualizar_sozinho", p_valor: true });
  assert.deepEqual(await vez(b, pc2), { pode: true });
});

test("o primeiro não voltou em 45 minutos: os outros param e sai um alerta", async () => {
  const { b, admin, pc1, pc2 } = await preparar();
  await b.rpc(admin, "painel_config", { p_chave: "atualizar_sozinho", p_valor: true });
  await vez(b, pc1);
  await b.sql("update public.config set valor = jsonb_set(valor, '{desde}', to_jsonb(now() - interval '46 minutes')) where chave = 'atualizacao_vez'");
  assert.deepEqual(await vez(b, pc2), { pode: false, motivo: "falhou" });
  assert.equal((await alertas(b)).length, 1);
  assert.deepEqual(await vez(b, pc2), { pode: false, motivo: "falhou" });
  assert.equal((await alertas(b)).length, 1, "um alerta só");
});

test("o pacote nem baixou: a vez fica livre, sem alerta; versão fora do formato é recusada", async () => {
  const { b, admin, pc1, pc2 } = await preparar();
  await b.rpc(admin, "painel_config", { p_chave: "atualizar_sozinho", p_valor: true });
  await vez(b, pc1);
  assert.deepEqual(await fim(b, pc1, "nao_comecou"), { ok: true });
  assert.deepEqual(await vez(b, pc2), { pode: true });
  assert.equal((await alertas(b)).length, 0);
  await assert.rejects(vez(b, pc1, "1.0.0", "https://exemplo.com/x"), /versão inválida/);
  await assert.rejects(fim(b, pc2, "qualquer"), /estado inválido/);
});

test("o alerta da atualização sozinha pode ser escolhido nos canais", async () => {
  const { b, admin } = await preparar();
  const ins = (eventos) => b.sql(`insert into public.alertas (canal, destino, eventos, criado_por) values ('telegram', '{"chat_id": "42"}', $1, $2)`, [eventos, admin.id]);
  await ins(["atualizacao_falhou"]);
  await assert.rejects(ins(["qualquer"]));
});
