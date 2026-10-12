import { test } from "node:test";
import assert from "node:assert/strict";
import { Gerencia, provisionar, configuracaoAuth, migracoes, planoMigracoes, reaplicavel, sqlRegistrar, trocarSite } from "../provisionar.mjs";
import { banco } from "./apoio.mjs";

function falso({ jaTem = false, recusar = [], registro = new Map(), segredos = [] } = {}) {
  const chamadas = [];
  const f = async (url, init = {}) => {
    const corpo = init.body && typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    chamadas.push({ metodo: init.method || "GET", url, corpo });
    const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
    if (url.endsWith("/v1/projects/ref1")) return ok({ status: "ACTIVE_HEALTHY", region: "sa-east-1" });
    if (url.endsWith("/database/query")) {
      const q = corpo.query;
      if (q.includes("to_regclass")) return ok([{ existe: jaTem }]);
      if (q.startsWith("select nome, hash from public.reveza_migracoes")) return ok([...registro].map(([nome, hash]) => ({ nome, hash })));
      const reg = q.match(/^insert into public\.reveza_migracoes \(nome, hash\) values \('([^']+)', '([0-9a-f]+)'\)/);
      if (reg) registro.set(reg[1], reg[2]);
      return ok([]);
    }
    if (url.endsWith("/config/auth")) {
      const k = Object.keys(corpo)[0];
      return recusar.includes(k) ? new Response(JSON.stringify({ message: "plano" }), { status: 402 }) : ok({});
    }
    if (url.includes("/api-keys")) return ok([{ name: "anon", api_key: "anon-publica" }, { name: "service_role", api_key: "SEGREDO-servico" }]);
    if (url.endsWith("/secrets")) {
      if ((init.method || "GET") === "GET") return ok(segredos.map((name) => ({ name, value: "digest" })));
      for (const x of corpo) if (!segredos.includes(x.name)) segredos.push(x.name);
      return ok({});
    }
    if (url.includes("/functions/deploy")) return ok({ version: 1 });
    if (url.endsWith("/auth/v1/admin/users")) return ok({ id: "11111111-2222-3333-4444-555555555555" });
    return new Response("nao esperado: " + url, { status: 500 });
  };
  return { f, chamadas, registro, segredos };
}
const migracoesAplicadas = (chamadas) => chamadas.filter((c) => c.url.endsWith("/database/query"))
  .map((c) => c.corpo.query).filter((q) => /^-- Reveza AI · 0\d{3}/.test(q));

test("provisiona na ordem certa e não põe segredo no log", async () => {
  const { f, chamadas } = falso({ recusar: ["password_hibp_enabled", "sessions_timebox"] });
  const log = [];
  const r = await provisionar({
    gerencia: new Gerencia("token-x", { fetch: f, esperar: async () => {} }), ref: "ref1",
    site: "https://painel.exemplo.com", admin: { email: "admin@exemplo.com", senha: "SenhaForte123!" },
    log: (m) => log.push(m), fetch: f,
  });
  assert.equal(r.url, "https://ref1.supabase.co");
  assert.equal(r.anon, "anon-publica");
  assert.match(r.computador.email, /@computadores\.reveza\.invalid$/);
  assert.ok(r.computador.senha.length >= 40);
  const sqls = chamadas.filter((c) => c.url.endsWith("/database/query")).map((c) => c.corpo.query);
  assert.equal(sqls.length, 4 + 2 * migracoes().length + 4 + 2, "checagem, registro e padrão fechado + migrações registradas + Vault (2 x busca e grava) + 2 membros");
  // segredo do Vault só como parâmetro: o texto do SQL (que pode ficar no histórico de consultas) não leva o valor
  const vault = chamadas.filter((c) => c.url.endsWith("/database/query") && /^select vault\.(create|update)_secret/.test(c.corpo.query));
  assert.equal(vault.length, 2);
  for (const c of vault) {
    assert.ok(Array.isArray(c.corpo.parameters) && c.corpo.parameters.length === 2, c.corpo.query);
    for (const v of c.corpo.parameters) if (!/^reveza_/.test(v)) assert.ok(!c.corpo.query.includes(v), "valor no texto do SQL");
  }
  // o padrão fechado vem antes da primeira migração (a primeira instalação não fica aberta até o 0099)
  const iFechar = sqls.findIndex((q) => /alter default privileges in schema public revoke execute on functions from anon/.test(q));
  const iPrimeira = sqls.findIndex((q) => q.includes("Reveza AI · 0001"));
  assert.ok(iFechar >= 0 && iFechar < iPrimeira, `fechar ${iFechar} antes da 0001 ${iPrimeira}`);
  assert.equal(migracoesAplicadas(chamadas).length, migracoes().length);
  assert.ok(migracoesAplicadas(chamadas).at(-1).includes("0099"), "as permissões vão por último");
  assert.equal(chamadas.filter((c) => c.url.includes("/functions/deploy")).length, 5, "as 5 funções publicadas");
  assert.ok(migracoesAplicadas(chamadas)[0].includes("create type public.papel"));
  const auth = chamadas.filter((c) => c.url.endsWith("/config/auth"));
  assert.equal(auth[0].corpo.disable_signup, true);
  assert.equal(auth[0].corpo.mfa_totp_enroll_enabled, true);
  assert.equal(auth[0].corpo.password_min_length, 12);
  assert.ok(log.some((l) => l.includes("password_hibp_enabled")));
  const tudo = log.join("\n");
  assert.ok(!tudo.includes("SEGREDO-servico") && !tudo.includes("SenhaForte123!") && !tudo.includes(r.computador.senha));
});

test("banco de antes do registro: não recria as tabelas e roda de novo as funções", async () => {
  const { f, chamadas } = falso({ jaTem: true });
  await provisionar({ gerencia: new Gerencia("t", { fetch: f, esperar: async () => {} }), ref: "ref1",
    site: "https://p.exemplo.com", log: () => {}, fetch: f, computador: false });
  const sqls = migracoesAplicadas(chamadas);
  assert.ok(!sqls.some((q) => q.includes("create type public.papel")), "não recria as tabelas");
  assert.ok(sqls.some((q) => q.includes("revoke execute on all functions")), "reaplica as permissões");
  assert.ok(!chamadas.some((c) => c.url.endsWith("/auth/v1/admin/users")), "atualização sem computador novo");
});

test("atualização com o registro em dia não aplica nada; arquivo de função mudado roda de novo com as seguintes e as permissões", async () => {
  const registro = new Map();
  const primeira = falso({ registro });
  await provisionar({ gerencia: new Gerencia("t", { fetch: primeira.f, esperar: async () => {} }), ref: "ref1",
    site: "https://p.exemplo.com", log: () => {}, fetch: primeira.f });
  const log = [];
  const segunda = falso({ jaTem: true, registro });
  await provisionar({ gerencia: new Gerencia("t", { fetch: segunda.f, esperar: async () => {} }), ref: "ref1",
    site: "https://p.exemplo.com", log: (m) => log.push(m), fetch: segunda.f, computador: false });
  assert.equal(migracoesAplicadas(segunda.chamadas).length, 0);
  assert.ok(log.includes("Banco já estava em dia"));
  registro.set("0003_decidir.sql", "0".repeat(64));
  const terceira = falso({ jaTem: true, registro });
  await provisionar({ gerencia: new Gerencia("t", { fetch: terceira.f, esperar: async () => {} }), ref: "ref1",
    site: "https://p.exemplo.com", log: () => {}, fetch: terceira.f, computador: false });
  const nomes = migracoesAplicadas(terceira.chamadas).map((q) => q.match(/· (\d{4})/)[1]);
  // a 0003 e todas as reaplicáveis depois dela (uma função redefinida adiante não volta ao corpo antigo), a 0099 por último
  const depois = migracoes().map((m) => m.nome.slice(0, 4)).filter((n) => n >= "0003");
  assert.deepEqual(nomes, depois);
});

test("migração de tabela que mudou depois de aplicada é recusada", () => {
  const todas = migracoes();
  const feitas = new Map(todas.map((m) => [m.nome, "f".repeat(64)]));
  assert.throws(() => planoMigracoes(todas, feitas, true), /0001_base\.sql mudou depois de aplicada/);
  assert.equal(reaplicavel(todas.find((m) => m.nome.startsWith("0001"))), false);
  for (const m of todas.filter((x) => !x.nome.startsWith("0001"))) assert.ok(reaplicavel(m), `${m.nome} marcada como reaplicável`);
  assert.throws(() => sqlRegistrar("x'; drop table y;--", "a".repeat(64)), /nome inesperado/);
});

test("as migrações reaplicáveis rodam duas vezes no mesmo banco sem erro", async () => {
  const b = await banco();
  for (const m of migracoes().filter((x) => reaplicavel(x) && !x.nome.endsWith(".supabase.sql"))) await b.db.exec(m.sql);
  const [{ n }] = await b.sql("select count(*)::int as n from pg_proc where proname = 'agente_marcar_login'");
  assert.equal(n, 1);
});

test("trocar o endereço do painel atualiza o login e o segredo das funções", async () => {
  const { f, chamadas } = falso();
  await trocarSite(new Gerencia("t", { fetch: f, esperar: async () => {} }), "ref1", "https://reveza.exemplo.com");
  assert.equal(chamadas[0].corpo.site_url, "https://reveza.exemplo.com");
  assert.equal(chamadas[0].corpo.uri_allow_list, "https://reveza.exemplo.com/**");
  assert.deepEqual(chamadas[1].corpo, [{ name: "REVEZA_SITE", value: "https://reveza.exemplo.com" }]);
  await assert.rejects(trocarSite(new Gerencia("t", { fetch: f }), "ref1", "http://x.com/'"), /inválido/);
});

test("e-mail estranho não vira SQL", async () => {
  const { f } = falso();
  await assert.rejects(provisionar({ gerencia: new Gerencia("t", { fetch: f, esperar: async () => {} }), ref: "ref1",
    site: "https://p.exemplo.com", admin: { email: "x'; drop table x;--@a.b", senha: "SenhaForte123!" }, log: () => {}, fetch: f }),
  /e-mail inválido/);
});

test("captcha e SMTP entram só quando informados", () => {
  assert.equal(configuracaoAuth({ site: "https://a.b" }).base.security_captcha_enabled, undefined);
  const c = configuracaoAuth({ site: "https://a.b", turnstileSegredo: "x", smtp: { host: "h", porta: 587, usuario: "u", senha: "s", remetente: "r@a.b" } });
  assert.equal(c.base.security_captcha_provider, "turnstile");
  assert.equal(c.base.smtp_port, "587");
});

test("as chaves do push nascem uma vez: a atualização não troca", async () => {
  const segredos = [];
  const a = falso({ segredos });
  const r1 = await provisionar({ gerencia: new Gerencia("t", { fetch: a.f, esperar: async () => {} }), ref: "ref1",
    site: "https://p.exemplo.com", log: () => {}, fetch: a.f });
  assert.ok(r1.vapidPublica);
  const b = falso({ jaTem: true, segredos, registro: a.registro });
  const r2 = await provisionar({ gerencia: new Gerencia("t", { fetch: b.f, esperar: async () => {} }), ref: "ref1",
    site: "https://p.exemplo.com", log: () => {}, fetch: b.f, computador: false });
  assert.equal(r2.vapidPublica, null);
  const enviados = b.chamadas.filter((c) => c.url.endsWith("/secrets") && c.metodo === "POST").flatMap((c) => c.corpo.map((x) => x.name));
  assert.deepEqual(enviados.sort(), ["REVEZA_CRON", "REVEZA_SITE"]);
});

test("rodar de novo com o administrador já criado: reaproveita e troca a senha", async () => {
  const { f, chamadas } = falso();
  const f2 = async (url, init = {}) => {
    if (url.endsWith("/auth/v1/admin/users") && JSON.parse(init.body).email === "admin@exemplo.com") {
      chamadas.push({ metodo: "POST", url, corpo: JSON.parse(init.body) });
      return new Response(JSON.stringify({ msg: "email_exists" }), { status: 422 });
    }
    if (url.endsWith("/database/query") && JSON.parse(init.body).query.startsWith("select id from auth.users")) {
      return new Response(JSON.stringify([{ id: "99999999-2222-3333-4444-555555555555" }]), { status: 200 });
    }
    if (url.includes("/auth/v1/admin/users/")) {
      chamadas.push({ metodo: init.method, url, corpo: JSON.parse(init.body) });
      return new Response("{}", { status: 200 });
    }
    return f(url, init);
  };
  const r = await provisionar({ gerencia: new Gerencia("t", { fetch: f2, esperar: async () => {} }), ref: "ref1",
    site: "https://p.exemplo.com", admin: { email: "admin@exemplo.com", senha: "SenhaForte123!" }, log: () => {}, fetch: f2 });
  assert.equal(r.adminId, "99999999-2222-3333-4444-555555555555");
  const put = chamadas.find((c) => c.metodo === "PUT");
  assert.equal(put.corpo.password, "SenhaForte123!");
});
