import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { banco } from "./apoio.mjs";

const resumo = (t) => createHash("sha256").update(t).digest("hex");

test("convite: só com o token certo, para o e-mail certo, uma vez", async () => {
  const b = await banco();
  const admin = { id: await b.usuario("admin"), aal: "aal2" };
  await b.rpc(admin, "painel_convidar", { p_email: "nova@exemplo.com", p_papel: "leitura", p_token_hash: resumo("tok") });
  const nova = await b.usuario(null, "nova@exemplo.com");
  let r = await b.rpc("servico", "convite_aceitar", { p_user: nova, p_email: "outra@exemplo.com", p_token_hash: resumo("tok") });
  assert.equal(r.ok, false);
  r = await b.rpc("servico", "convite_aceitar", { p_user: nova, p_email: "nova@exemplo.com", p_token_hash: resumo("errado") });
  assert.equal(r.ok, false);
  r = await b.rpc("servico", "convite_aceitar", { p_user: nova, p_email: "nova@exemplo.com", p_token_hash: resumo("tok") });
  assert.deepEqual(r, { ok: true, papel: "leitura" });
  r = await b.rpc("servico", "convite_aceitar", { p_user: nova, p_email: "nova@exemplo.com", p_token_hash: resumo("tok") });
  assert.equal(r.ok, false, "só uma vez");
  await assert.rejects(b.rpc({ id: nova, aal: "aal2" }, "convite_aceitar", { p_user: nova, p_email: "x@a.b", p_token_hash: "x" }), /permission denied/);
});

test("vigia: computador parado vira alerta uma vez", async () => {
  const b = await banco();
  const pc = await b.computador("Mac do escritório");
  await b.sql("update public.computadores set visto_em = now() - interval '10 minutes' where id = $1", [pc.pc]);
  assert.equal((await b.sql("select public.vigiar() n"))[0].n, 1);
  assert.equal((await b.sql("select public.vigiar() n"))[0].n, 0);
  const [e] = await b.sql("select texto, dados from public.eventos where tipo = 'alerta'");
  assert.match(e.texto, /Mac do escritório/);
});

test("alertas pendentes andam por cursor e não mostram o segredo", async () => {
  const b = await banco();
  const admin = { id: await b.usuario("admin"), aal: "aal2" };
  const { id } = await b.rpc(admin, "painel_alerta", { p_canal: "telegram", p_destino: { chat_id: "123" }, p_eventos: ["sem_livre"] });
  await b.rpc(admin, "painel_alerta_segredo", { p_id: id, p_segredo: "token-do-bot-123" });
  await b.sql("select public.rvz_evento('alerta', 'x', '{\"motivo\": \"sem_livre\"}')");
  let r = await b.rpc("servico", "alertas_pendentes");
  assert.equal(r.eventos.length, 1);
  assert.equal(r.canais[0].tem_segredo, true);
  assert.ok(!JSON.stringify(r).includes("token-do-bot-123"));
  r = await b.rpc("servico", "alertas_pendentes");
  assert.equal(r.eventos.length, 0, "já foi enviado");
  assert.equal(await b.rpc("servico", "servico_segredo_alerta", { p_alerta: id }), "token-do-bot-123");
  await assert.rejects(b.rpc(admin, "servico_segredo_alerta", { p_alerta: id }), /permission denied/);
  const [{ destino }] = await b.como(admin, "select destino from public.alertas");
  assert.ok(destino.vault_id && !JSON.stringify(destino).includes("token-do-bot-123"));
});

test("API: leitura para membro, troca e config só para admin", async () => {
  const b = await banco();
  const pc = await b.computador();
  const a = await b.conta(pc, "a@exemplo.com", 10);
  const leitor = await b.usuario("leitura");
  const admin = await b.usuario("admin");
  const est = await b.rpc("servico", "api_estado", { p_user: leitor });
  assert.equal(est.contas[0].email, "a@exemplo.com");
  await assert.rejects(b.rpc("servico", "api_trocar", { p_user: leitor, p_computador: pc.pc, p_conta: a }), /sem acesso/);
  assert.equal((await b.rpc("servico", "api_trocar", { p_user: admin, p_computador: pc.pc, p_conta: a })).ok, true);
  await assert.rejects(b.rpc("servico", "api_config", { p_user: admin, p_chave: "aviso", p_valor: 10 }), /só se muda auto e modo/);
  assert.equal((await b.rpc("servico", "api_config", { p_user: admin, p_chave: "auto", p_valor: true })).ok, true);
  const desconhecido = await b.usuario(null);
  await assert.rejects(b.rpc("servico", "api_estado", { p_user: desconhecido }), /sem acesso/);
});
