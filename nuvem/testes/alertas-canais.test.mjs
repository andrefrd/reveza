// Canais de alerta depois da 0017: o ntfy saiu (12/10/2026). A migração é reaplicável e limpa o que tiver sobrado de
// ntfy numa instalação antiga, com o segredo dele no Vault.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { banco } from "./apoio.mjs";

const MIGRACAO = readFileSync(new URL("../migracoes/0017_alertas_sem_ntfy.sql", import.meta.url), "utf8");

test("0017 é reaplicável (o instalador roda de novo quando ela muda)", () => {
  assert.match(MIGRACAO, /^-- reaplicável/m);
});

test("alerta ntfy não entra mais, nem pela função do painel nem direto na tabela; os outros canais seguem", async () => {
  const b = await banco();
  const admin = { id: await b.usuario("admin"), aal: "aal2" };
  await assert.rejects(
    b.rpc(admin, "painel_alerta", { p_canal: "ntfy", p_destino: { servidor: "https://ntfy.sh" }, p_eventos: ["troca"] }),
    /canal desconhecido/
  );
  await assert.rejects(
    b.sql("insert into public.alertas (canal, destino, eventos, criado_por) values ('ntfy', '{}', '{troca}', $1)", [admin.id]),
    /alertas_canal_check/
  );
  for (const [canal, destino] of [
    ["telegram", { chat_id: "123" }],
    ["email", { de: "a@exemplo.com", para: "b@exemplo.com" }],
    ["webhook", { url: "https://hook.exemplo.com/x" }],
    ["push", {}],
  ]) {
    const r = await b.rpc(admin, "painel_alerta", { p_canal: canal, p_destino: destino, p_eventos: ["troca"] });
    assert.equal(r.ok, true, canal);
  }
});

test("rodar a 0017 numa instalação com alerta ntfy apaga o alerta e o tópico guardado no Vault; rodar de novo não muda nada", async () => {
  const b = await banco();
  const admin = { id: await b.usuario("admin"), aal: "aal2" };
  // como estava antes da 0017
  await b.sql("alter table public.alertas drop constraint alertas_canal_check");
  await b.sql(
    "alter table public.alertas add constraint alertas_canal_check check (canal in ('telegram', 'ntfy', 'email', 'webhook', 'push'))"
  );
  const [{ id: vault }] = await b.sql("select vault.create_secret('reveza-topico-secreto', 'reveza-alerta-x', '') as id");
  await b.sql(
    "insert into public.alertas (canal, destino, eventos, criado_por) values ('ntfy', jsonb_build_object('servidor', 'https://ntfy.sh', 'vault_id', $1::text), '{troca}', $2)",
    [vault, admin.id]
  );
  const tg = await b.rpc(admin, "painel_alerta", { p_canal: "telegram", p_destino: { chat_id: "1" }, p_eventos: ["troca"] });
  await b.rpc(admin, "painel_alerta_segredo", { p_id: tg.id, p_segredo: "123456:TOKEN-DO-BOT" });

  await b.db.exec(MIGRACAO);
  await b.db.exec(MIGRACAO);

  assert.deepEqual((await b.sql("select canal from public.alertas")).map((l) => l.canal), ["telegram"]);
  assert.equal((await b.sql("select count(*)::int as n from vault.secrets where id = $1", [vault]))[0].n, 0);
  assert.equal(await b.rpc("servico", "servico_segredo_alerta", { p_alerta: tg.id }), "123456:TOKEN-DO-BOT");
});

test("push: cada um confere só a própria inscrição (o painel mostra se este aparelho recebe)", async () => {
  const b = await banco();
  const admin = { id: await b.usuario("admin"), aal: "aal2" };
  const leitor = { id: await b.usuario("leitura"), aal: "aal1" };
  const endpoint = "https://fcm.googleapis.com/fcm/send/abc123";
  const r = await b.rpc(leitor, "painel_push_inscrever", { p_endpoint: endpoint, p_p256dh: "B".repeat(87), p_auth: "a".repeat(22) });
  assert.equal(r.ok, true);
  const consulta = "select id from public.push_inscricoes where endpoint = $1 limit 1";
  assert.equal((await b.como(leitor, consulta, [endpoint])).length, 1);
  assert.equal((await b.como(admin, consulta, [endpoint])).length, 0, "a inscrição de outra pessoa não aparece");
  await assert.rejects(b.como(leitor, "select p256dh from public.push_inscricoes"), /permission denied/);
});
