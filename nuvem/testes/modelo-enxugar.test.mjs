import { test } from "node:test";
import assert from "node:assert/strict";
import { banco } from "./apoio.mjs";

async function cenario() {
  const b = await banco();
  await b.config("auto", false);
  const admin = { id: await b.usuario("admin", "admin@exemplo.com"), aal: "aal2" };
  return { b, admin };
}

test("o modelo da conta chega ao computador junto com a atribuição; sem modelo, vem nulo", async () => {
  const { b, admin } = await cenario();
  const pc = await b.computador("mini");
  const conta = await b.conta(pc, "vinte@exemplo.com", 10);
  await b.sql("select public.decidir()");
  let r = await b.rpc(pc, "agente_ola", { p_versao: "0.6.0" });
  assert.equal(r.atribuicao.conta_id, conta);
  assert.equal(r.atribuicao.modelo, null);

  assert.deepEqual(await b.rpc(admin, "painel_conta", { p_conta: conta, p_campos: { modelo: "claude-fable-5[1m]" } }), { ok: true });
  r = await b.rpc(pc, "agente_ola", { p_versao: "0.6.0" });
  assert.equal(r.atribuicao.modelo, "claude-fable-5[1m]");

  await b.rpc(admin, "painel_conta", { p_conta: conta, p_campos: { modelo: "  Opus " } });
  r = await b.rpc(pc, "agente_ola", { p_versao: "0.6.0" });
  assert.equal(r.atribuicao.modelo, "opus", "espaço e maiúscula não contam");

  await b.rpc(admin, "painel_conta", { p_conta: conta, p_campos: { modelo: "" } });
  r = await b.rpc(pc, "agente_ola", { p_versao: "0.6.0" });
  assert.equal(r.atribuicao.modelo, null, "vazio tira o modelo");

  await b.rpc(admin, "painel_conta", { p_conta: conta, p_campos: { modelo: "sonnet" } });
  await b.rpc(admin, "painel_conta", { p_conta: conta, p_campos: { prioridade: 3 } });
  r = await b.rpc(pc, "agente_ola", { p_versao: "0.6.0" });
  assert.equal(r.atribuicao.modelo, "sonnet", "mudar outro campo não apaga o modelo");
  await b.rpc(admin, "painel_conta", { p_conta: conta, p_campos: { modelo: null } });
  r = await b.rpc(pc, "agente_ola", { p_versao: "0.6.0" });
  assert.equal(r.atribuicao.modelo, null, "nulo também tira");
});

test("modelo fora do formato é recusado, pelo painel e pela tabela", async () => {
  const { b, admin } = await cenario();
  const pc = await b.computador("mini");
  const conta = await b.conta(pc, "a@exemplo.com", 10);
  for (const ruim of ["opus; rm -rf /", "../../x", "claude opus", "-opus", "a".repeat(80), "opus[2m]", "\"opus\""]) {
    await assert.rejects(b.rpc(admin, "painel_conta", { p_conta: conta, p_campos: { modelo: ruim } }), /modelo inválido/, ruim);
  }
  await assert.rejects(b.rpc(admin, "painel_conta", { p_conta: conta, p_campos: { modelo: 5 } }), /modelo inválido/);
  await assert.rejects(b.rpc(admin, "painel_conta", { p_conta: conta, p_campos: { modelo: ["opus"] } }), /modelo inválido/);
  await assert.rejects(b.sql("update public.contas set modelo = 'Opus Grande' where id = $1", [conta]), /contas_modelo_formato/);
  for (const bom of ["opus", "sonnet", "haiku", "opusplan", "default", "claude-opus-5-5", "claude-sonnet-4-5-20250929",
    "claude-fable-5[1m]", "sonnet[1m]"]) {
    assert.deepEqual(await b.rpc(admin, "painel_conta", { p_conta: conta, p_campos: { modelo: bom } }), { ok: true }, bom);
  }
});

test("só administrador com duas etapas muda o modelo; o computador não grava direto na tabela", async () => {
  const { b, admin } = await cenario();
  const pc = await b.computador("mini");
  const conta = await b.conta(pc, "a@exemplo.com", 10);
  const leitura = { id: await b.usuario("leitura", "leitura@exemplo.com"), aal: "aal2" };
  await assert.rejects(b.rpc(leitura, "painel_conta", { p_conta: conta, p_campos: { modelo: "opus" } }), /só administrador/);
  await b.sql("insert into auth.mfa_factors (user_id, status) values ($1, 'verified')", [admin.id]);
  await assert.rejects(b.rpc({ id: admin.id, aal: "aal1" }, "painel_conta", { p_conta: conta, p_campos: { modelo: "opus" } }),
    /duas etapas/);
  await b.como(pc, "update public.contas set modelo = 'opus' where id = $1", [conta]).catch(() => null);
  const [{ modelo }] = await b.sql("select modelo from public.contas where id = $1", [conta]);
  assert.equal(modelo, null);
});

test("saída enxuta: desligada por padrão, liga e desliga por computador, com auditoria", async () => {
  const { b, admin } = await cenario();
  const mini = await b.computador("mini");
  const air = await b.computador("air");
  assert.equal((await b.rpc(mini, "agente_ola", { p_versao: "0.6.0" })).enxugar, false);

  assert.deepEqual(await b.rpc(admin, "painel_computador_enxugar", { p_computador: mini.pc, p_ligado: true }), { ok: true });
  assert.equal((await b.rpc(mini, "agente_ola", { p_versao: "0.6.0" })).enxugar, true);
  assert.equal((await b.rpc(air, "agente_ola", { p_versao: "0.6.0" })).enxugar, false, "um computador não liga o outro");

  const [aud] = await b.sql("select alvo, detalhes from public.auditoria where acao = 'enxugar' order by id limit 1");
  assert.equal(aud.alvo, mini.pc);
  assert.equal(aud.detalhes.ligado, true);

  await b.rpc(admin, "painel_computador_enxugar", { p_computador: mini.pc, p_ligado: false });
  assert.equal((await b.rpc(mini, "agente_ola", { p_versao: "0.6.0" })).enxugar, false);
  await b.rpc(admin, "painel_computador_enxugar", { p_computador: mini.pc, p_ligado: null });
  assert.equal((await b.rpc(mini, "agente_ola", { p_versao: "0.6.0" })).enxugar, false, "nulo é desligado");
});

test("saída enxuta: só administrador com duas etapas, computador revogado ou desconhecido recusa", async () => {
  const { b, admin } = await cenario();
  const mini = await b.computador("mini");
  const leitura = { id: await b.usuario("leitura", "leitura@exemplo.com"), aal: "aal2" };
  await assert.rejects(b.rpc(leitura, "painel_computador_enxugar", { p_computador: mini.pc, p_ligado: true }), /só administrador/);
  await assert.rejects(b.rpc(mini, "painel_computador_enxugar", { p_computador: mini.pc, p_ligado: true }), /só administrador/);
  await b.como(mini, "update public.computadores set enxugar = true where id = $1", [mini.pc]).catch(() => null);
  const [{ enxugar }] = await b.sql("select enxugar from public.computadores where id = $1", [mini.pc]);
  assert.equal(enxugar, false, "o computador não se liga sozinho");
  await assert.rejects(b.rpc(admin, "painel_computador_enxugar",
    { p_computador: "00000000-0000-0000-0000-000000000001", p_ligado: true }), /computador desconhecido/);
  await b.sql("update public.computadores set revogado = true where id = $1", [mini.pc]);
  await assert.rejects(b.rpc(admin, "painel_computador_enxugar", { p_computador: mini.pc, p_ligado: true }),
    /computador desconhecido/);
});
