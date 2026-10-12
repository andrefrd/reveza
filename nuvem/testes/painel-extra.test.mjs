// O que o painel lê e pede além do básico: sessões abertas, e-mail dos membros, validade dos logins e o comando
// "ligar" (a frase cifrada para o navegador, que saiu na 0.2.0).
import { test } from "node:test";
import assert from "node:assert/strict";
import { banco } from "./apoio.mjs";

async function cenario() {
  const b = await banco();
  const admin = { id: await b.usuario("admin", "admin@exemplo.com"), aal: "aal2" };
  const leitor = { id: await b.usuario("leitura", "leitor@exemplo.com"), aal: "aal1" };
  return { b, admin, leitor };
}

test("sessões: cada um vê e encerra só as suas, com a atual marcada", async () => {
  const { b, admin, leitor } = await cenario();
  const [s1] = await b.sql("insert into auth.sessions (user_id, user_agent) values ($1, 'Firefox no Mac') returning id", [admin.id]);
  await b.sql("insert into auth.sessions (user_id, user_agent) values ($1, 'celular')", [admin.id]);
  const [sl] = await b.sql("insert into auth.sessions (user_id) values ($1) returning id", [leitor.id]);
  const minhas = await b.como({ ...admin }, "select public.painel_minhas_sessoes() as r");
  assert.equal(minhas[0].r.length, 2);
  const comAtual = await b.db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: admin.id, role: "authenticated", aal: "aal2", session_id: s1.id })]);
    await tx.query("set local role authenticated");
    return (await tx.query("select public.painel_minhas_sessoes() as r")).rows[0].r;
  });
  assert.equal(comAtual.find((s) => s.id === s1.id).atual, true);
  assert.equal(comAtual.find((s) => s.aparelho === "Firefox no Mac").id, s1.id);
  assert.equal((await b.rpc(admin, "painel_encerrar_sessao", { p_id: sl.id })).ok, false, "a de outra pessoa não");
  assert.equal((await b.rpc(admin, "painel_encerrar_sessao", { p_id: s1.id })).ok, true);
  assert.equal((await b.sql("select 1 from auth.sessions where id = $1", [s1.id])).length, 0);
});

test("membros com e-mail só para administrador com duas etapas; computador fica de fora", async () => {
  const { b, admin, leitor } = await cenario();
  await b.sql("insert into public.config (chave, valor) values ('exigir_duas_etapas', 'true') on conflict (chave) do update set valor = 'true'");
  await b.computador("pc");
  const m = await b.rpc(admin, "painel_membros", {});
  assert.deepEqual(m.map((x) => x.email).sort(), ["admin@exemplo.com", "leitor@exemplo.com"]);
  await assert.rejects(b.rpc(leitor, "painel_membros", {}), /só administrador/);
  await assert.rejects(b.rpc({ ...admin, aal: "aal1" }, "painel_membros", {}), /duas etapas/);
});

test("validade dos logins: membro vê a data, nunca o cifrado", async () => {
  const { b, leitor } = await cenario();
  const pc = await b.computador("pc");
  await b.conta(pc, "c@exemplo.com");
  const v = await b.rpc(leitor, "painel_validade_logins", {});
  assert.equal(v.length, 1);
  assert.deepEqual(Object.keys(v[0]).sort(), ["conta_id", "expira_em", "versao"]);
});

test("comando ligar saiu (0.2.0): o painel não pede mais a frase cifrada para o navegador", async () => {
  const { b, admin } = await cenario();
  const pc = await b.computador("pc");
  const publica = { kty: "EC", crv: "P-256", x: "a".repeat(43), y: "b".repeat(43), ext: true };
  await assert.rejects(b.rpc(admin, "painel_comando", { p_computador: pc.pc, p_acao: "ligar", p_corpo: { publica, idioma: "en" } }),
    /ligação pelo painel saiu/);
  const [{ n }] = await b.sql("select count(*)::int as n from public.comandos where acao = 'ligar'");
  assert.equal(n, 0);
});

test("tempo de atualização: só 5, 10, 15 ou 30 segundos", async () => {
  const { b, admin } = await cenario();
  for (const n of [5, 10, 15, 30]) assert.equal((await b.rpc(admin, "painel_config", { p_chave: "intervalo_s", p_valor: n })).ok, true);
  for (const n of [3, 7, 60]) await assert.rejects(b.rpc(admin, "painel_config", { p_chave: "intervalo_s", p_valor: n }), /5, 10, 15 ou 30/);
  const [{ valor }] = await b.sql("select valor from public.config where chave = 'intervalo_s'");
  assert.equal(valor, 30);
});

test("duas etapas opcionais: quem não ativou age só com a senha; quem ativou precisa do código; exigir pede as suas", async () => {
  const { b, admin } = await cenario();
  const semFator = { ...admin, aal: "aal1" };
  assert.equal((await b.rpc(semFator, "painel_config", { p_chave: "auto", p_valor: true })).ok, true, "sem fator e sem exigência: passa");
  assert.equal(await b.rpc("servico", "servico_aal_ok", { p_user: admin.id, p_aal: "aal1" }), true);
  await assert.rejects(b.rpc(semFator, "painel_config", { p_chave: "exigir_duas_etapas", p_valor: true }), /ative as suas duas etapas/);
  await b.sql("insert into auth.mfa_factors (user_id, status) values ($1, 'verified')", [admin.id]);
  await assert.rejects(b.rpc(semFator, "painel_config", { p_chave: "auto", p_valor: false }), /duas etapas/, "com fator ativo, o código vale em toda sessão");
  assert.equal(await b.rpc("servico", "servico_aal_ok", { p_user: admin.id, p_aal: "aal1" }), false);
  assert.equal((await b.rpc(admin, "painel_config", { p_chave: "exigir_duas_etapas", p_valor: true })).ok, true);
  const outro = { id: await b.usuario("admin"), aal: "aal1" };
  await assert.rejects(b.rpc(outro, "painel_config", { p_chave: "auto", p_valor: true }), /duas etapas/, "exigido: até quem não ativou precisa");
  assert.equal(await b.rpc("servico", "servico_aal_ok", { p_user: outro.id, p_aal: "aal1" }), false);
  assert.equal((await b.rpc(admin, "painel_config", { p_chave: "exigir_duas_etapas", p_valor: false })).ok, true);
});
