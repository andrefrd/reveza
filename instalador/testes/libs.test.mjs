// As peças do instalador com rede falsa: Vercel, Supabase, DNS, canais de alerta, arquivos locais e argumentos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Vercel, listar } from "../lib/vercel.mjs";
import { criarProjeto, conferirToken, organizacoes, projetos, regiaoSugerida } from "../lib/supabase.mjs";
import { dnsPronto, dominioValido, passosCloudflare } from "../lib/dominio.mjs";
import { acharChatTelegram, testar, topicoNtfy } from "../lib/alertas.mjs";
import { criarLancador, gravarConfigLocal, gravarInstalacao, lerInstalacao } from "../lib/programa.mjs";
import { emailValido, senhaForte, t } from "../lib/texto.mjs";
import { lerArgs } from "../instalar.mjs";

function rede(rotas) {
  const chamadas = [];
  const f = async (url, init = {}) => {
    const corpo = typeof init.body === "string" ? (() => { try { return JSON.parse(init.body); } catch { return init.body; } })() : init.body;
    chamadas.push({ url, metodo: init.method || "GET", corpo, headers: init.headers || {} });
    for (const [padrao, resp] of rotas) {
      if (typeof padrao === "string" ? url.includes(padrao) : padrao.test(url)) {
        const r = typeof resp === "function" ? resp(url, init, chamadas) : resp;
        return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? r), { status: r.status ?? 200 });
      }
    }
    return new Response(JSON.stringify({ error: { message: `não esperado ${url}` } }), { status: 500 });
  };
  return { f, chamadas };
}

function pasta() {
  const d = mkdtempSync(path.join(os.tmpdir(), "reveza-inst-"));
  return { d, limpar: () => rmSync(d, { recursive: true, force: true }) };
}

test("argumentos: valor obrigatório, opção desconhecida e flags", () => {
  assert.deepEqual(lerArgs(["--foo"]), { erro: "opção desconhecida: --foo" });
  assert.equal(lerArgs(["--importar"]).erro, "--importar pede um valor");
  const a = lerArgs(["--sem-nuvem", "--idioma", "en"]);
  assert.ok(a.flags.has("--sem-nuvem"));
  assert.equal(a.valores["--idioma"], "en");
});

test("senha forte, e-mail e idioma", () => {
  assert.equal(senhaForte("curta1A"), false);
  assert.equal(senhaForte("semnumeroAAAAAA"), false);
  assert.equal(senhaForte("TemTudo12345"), true);
  assert.equal(emailValido("a'b@c.d"), false);
  assert.equal(t("oi", "hi"), "oi");
});

test("Vercel: cria o projeto que falta, sobe os arquivos por hash e espera a produção", async () => {
  const { d, limpar } = pasta();
  try {
    mkdirSync(path.join(d, "assets"));
    writeFileSync(path.join(d, "index.html"), "<html></html>");
    writeFileSync(path.join(d, "assets", "app.js"), "console.log(1)");
    writeFileSync(path.join(d, "vercel.json"), "{}");
    let leituras = 0;
    const { f, chamadas } = rede([
      ["/v9/projects/reveza", { status: 404, body: { error: { code: "not_found" } } }],
      ["/v11/projects", { id: "prj_1", name: "reveza" }],
      ["/v2/files", {}],
      ["/v13/deployments/dpl_1", () => ({ readyState: ++leituras < 2 ? "BUILDING" : "READY", alias: leituras < 4 ? ["reveza-equipe.vercel.app"] : ["reveza-equipe.vercel.app", "reveza.vercel.app"], url: "reveza-abc.vercel.app" })],
      [/\/v13\/deployments(\?|$)/, { id: "dpl_1", url: "reveza-abc.vercel.app" }],
    ]);
    const v = new Vercel("tok", { fetch: f, equipe: "team_9", esperar: async () => {} });
    const p = await v.projeto("reveza");
    assert.deepEqual(p, { id: "prj_1", nome: "reveza", novo: true });
    const r = await v.publicar(p, d);
    assert.equal(r.url, "https://reveza.vercel.app");
    const arquivos = chamadas.filter((c) => c.url.includes("/v2/files"));
    assert.equal(arquivos.length, 3);
    assert.ok(chamadas.every((c) => c.url.includes("teamId=team_9")));
    assert.ok(arquivos.every((c) => /^[0-9a-f]{40}$/.test(c.headers["x-vercel-digest"])));
    const dep = chamadas.find((c) => /\/v13\/deployments\?/.test(c.url));
    assert.equal(dep.corpo.target, "production");
    assert.deepEqual(dep.corpo.files.map((x) => x.file).sort(), ["assets/app.js", "index.html", "vercel.json"]);
    assert.equal(dep.corpo.projectSettings.framework, null);
  } finally { limpar(); }
});

test("Vercel: pasta sem index.html não publica; implantação com erro para", async () => {
  const { d, limpar } = pasta();
  try {
    const { f } = rede([]);
    await assert.rejects(new Vercel("t", { fetch: f }).publicar({ id: "p", nome: "x" }, d), /index\.html/);
    writeFileSync(path.join(d, "index.html"), "x");
    const r2 = rede([["/v2/files", {}], [/\/v13\/deployments$/, { id: "d" }], ["/v13/deployments/d", { readyState: "ERROR" }]]);
    await assert.rejects(new Vercel("t", { fetch: r2.f, esperar: async () => {} }).publicar({ id: "p", nome: "x" }, d), /ERROR/);
    assert.throws(() => listar(path.join(d, "nao-existe")));
  } finally { limpar(); }
});

test("Vercel: domínio próprio devolve o CNAME recomendado; apex usa A", async () => {
  const { f } = rede([
    ["/domains/contas.exemplo.com/config", { misconfigured: true, recommendedCNAME: [{ rank: 2, value: "b.vercel-dns.com." }, { rank: 1, value: "a.vercel-dns-017.com." }] }],
    ["/v10/projects/prj_1/domains", {}],
    ["/domains/exemplo.com/config", { misconfigured: true, recommendedIPv4: [{ rank: 1, value: ["76.76.21.21"] }] }],
  ]);
  const v = new Vercel("t", { fetch: f });
  const r = await v.adicionarDominio({ id: "prj_1" }, "contas.exemplo.com");
  assert.deepEqual(r, { configurado: false, registro: { tipo: "CNAME", nome: "contas", valor: "a.vercel-dns-017.com" } });
  const apex = await v.registroDns("exemplo.com");
  assert.deepEqual(apex.registro, { tipo: "A", nome: "@", valor: "76.76.21.21" });
});

test("Vercel: domínio de outro projeto é recusado com mensagem clara", async () => {
  const { f } = rede([["/domains", { status: 409, body: { error: { code: "domain_already_in_use", message: "x" } } }]]);
  await assert.rejects(new Vercel("t", { fetch: f }).adicionarDominio({ id: "p" }, "a.exemplo.com"), /já está em outro projeto/);
});

test("Supabase: organizações, projetos, criação com região específica e token de organização", async () => {
  const { f, chamadas } = rede([
    ["/v1/organizations", [{ id: "x", slug: "minha-org", name: "Minha" }]],
    [/\/v1\/projects$/, (url, init) => (init.method === "POST" ? { id: "abcdefghijklmnopqrst" } : [{ ref: "abcdefghijklmnopqrst", name: "r", organization_slug: "minha-org", region: "sa-east-1", status: "ACTIVE_HEALTHY" }])],
  ]);
  const g = { pedir: async (m, c, corpo) => { const r = await f(`https://api.supabase.com${c}`, { method: m, body: corpo && JSON.stringify(corpo) }); if (!r.ok) { const e = new Error("x"); e.status = r.status; throw e; } return r.json(); } };
  assert.deepEqual(await organizacoes(g), [{ slug: "minha-org", nome: "Minha" }]);
  assert.equal((await projetos(g))[0].ref, "abcdefghijklmnopqrst");
  assert.equal(await criarProjeto(g, { org: "minha-org", regiao: "sa-east-1" }), "abcdefghijklmnopqrst");
  const criar = chamadas.find((c) => c.metodo === "POST");
  assert.equal(criar.corpo.organization_slug, "minha-org");
  assert.deepEqual(criar.corpo.region_selection, { type: "specific", code: "sa-east-1" });
  assert.ok(criar.corpo.db_pass.length >= 30);
  await assert.rejects(criarProjeto(g, { org: "x y", regiao: "sa-east-1" }), /organização inválida/);
  await assert.rejects(criarProjeto(g, { org: "x", regiao: "marte-1" }), /região desconhecida/);
  const g403 = { pedir: async () => { const e = new Error("x"); e.status = 403; throw e; } };
  assert.match((await conferirToken(g403)).erro, /token pessoal/);
});

test("região sugerida pelo fuso", () => {
  assert.equal(regiaoSugerida("America/Fortaleza"), "sa-east-1");
  assert.equal(regiaoSugerida("America/New_York"), "us-east-1");
  assert.equal(regiaoSugerida("Europe/Lisbon"), "eu-west-2");
  assert.equal(regiaoSugerida("Asia/Tokyo"), "ap-northeast-1");
  assert.equal(regiaoSugerida(""), "us-east-1");
});

test("domínio: validação, passos da Cloudflare e DNS conferido de fora", async () => {
  assert.equal(dominioValido("https://Contas.Exemplo.com/"), "contas.exemplo.com");
  assert.equal(dominioValido("sem ponto"), null);
  assert.equal(dominioValido("a..b.com"), null);
  const passos = passosCloudflare({ tipo: "CNAME", nome: "contas", valor: "cname.vercel-dns.com" }, t).join("\n");
  assert.match(passos, /DNS only/);
  assert.match(passos, /CNAME/);
  const ok = rede([["cloudflare-dns.com", { Answer: [{ data: "cname.vercel-dns.com." }] }]]);
  assert.equal(await dnsPronto("contas.exemplo.com", { tipo: "CNAME", valor: "cname.vercel-dns.com" }, { fetch: ok.f }), true);
  const nao = rede([["cloudflare-dns.com", { Answer: [{ data: "outro.com." }] }]]);
  assert.equal(await dnsPronto("contas.exemplo.com", { tipo: "CNAME", valor: "cname.vercel-dns.com" }, { fetch: nao.f }), false);
  assert.equal(await dnsPronto("x.com", { tipo: "A", valor: "1.1.1.1" }, { fetch: async () => { throw new Error("sem rede"); } }), false);
});

test("alertas: telegram acha a conversa, teste de cada canal e assinatura do webhook", async () => {
  const token = "123456:" + "A".repeat(35);
  const tg = rede([
    ["/getUpdates", { ok: true, result: [{ message: { chat: { id: 42, first_name: "Ana" } } }, { message: { chat: { id: 42, first_name: "Ana" } } }] }],
    ["/sendMessage", { ok: true }],
  ]);
  assert.deepEqual(await acharChatTelegram(token, { fetch: tg.f }), [{ id: "42", nome: "Ana" }]);
  await assert.rejects(acharChatTelegram("errado", { fetch: tg.f }), /formato estranho/);
  assert.deepEqual(await testar("telegram", { chat_id: "42" }, token, { fetch: tg.f }), { ok: true });

  const n = rede([["ntfy.sh", {}]]);
  const topico = topicoNtfy();
  assert.match(topico, /^reveza-[0-9a-f]{24}$/);
  assert.deepEqual(await testar("ntfy", {}, topico, { fetch: n.f }), { ok: true });
  assert.equal(n.chamadas[0].url, `https://ntfy.sh/${topico}`);
  assert.equal((await testar("ntfy", { servidor: "http://inseguro" }, topico, { fetch: n.f })).ok, false);

  const w = rede([["hook.exemplo.com", {}]]);
  assert.deepEqual(await testar("webhook", { url: "https://hook.exemplo.com/x" }, "segredo123", { fetch: w.f }), { ok: true });
  const c = w.chamadas[0];
  assert.equal(c.headers["X-Reveza-Assinatura"], "sha256=" + createHmac("sha256", "segredo123").update(JSON.stringify(c.corpo)).digest("hex"));
  assert.equal((await testar("webhook", { url: "http://x" }, "s", { fetch: w.f })).ok, false);

  const e = rede([["api.resend.com", { status: 403, body: "domínio não verificado" }]]);
  const r = await testar("email", { de: "a@b.com", para: "c@d.com" }, "re_x", { fetch: e.f });
  assert.equal(r.ok, false);
  assert.match(r.erro, /403/);
});

test("arquivos locais: configuração mescla no estado, instalação não guarda segredo, lançador executável", () => {
  const { d, limpar } = pasta();
  try {
    const est = path.join(d, "estado.json");
    writeFileSync(est, JSON.stringify({ formato: 1, ativa: "x", config: { intervaloS: 7 } }));
    gravarConfigLocal(est, { auto: false, modo: "limite" });
    const e = JSON.parse(readFileSync(est, "utf8"));
    assert.equal(e.ativa, "x");
    assert.deepEqual(e.config, { intervaloS: 7, auto: false, modo: "limite" });
    const inst = path.join(d, "instalacao.json");
    gravarInstalacao(inst, { nuvem: { url: "https://x.supabase.co", anon: "eyJpublica" } });
    assert.equal(lerInstalacao(inst).nuvem.url, "https://x.supabase.co");
    if (process.platform !== "win32") assert.equal(statSync(inst).mode & 0o777, 0o600);
    assert.throws(() => gravarInstalacao(inst, { nuvem: { token: "x" } }), /não guarda segredo/);
    assert.throws(() => gravarInstalacao(inst, { x: "sbp_" + "a".repeat(40) }), /não guarda segredo/);
    assert.equal(lerInstalacao(path.join(d, "nada.json")), null);
    const l = criarLancador(path.join(d, "bin"), "/app/cli.js", "/usr/bin/node");
    if (process.platform !== "win32") {
      assert.equal(readFileSync(l, "utf8"), '#!/bin/sh\nexec "/usr/bin/node" "/app/cli.js" "$@"\n');
      assert.ok(statSync(l).mode & 0o100);
    }
  } finally { limpar(); }
});

test("erro do build mostra o começo, não o fim da pilha", async () => {
  const { trechoDoErro } = await import("../lib/painel.mjs");
  const t = trechoDoErro("vite v8\ntransforming...\nerror during build:\nError: faltou react-is\n    at x (a.js:1)\n    at y (b.js:2)");
  assert.match(t, /^error during build:\nError: faltou react-is$/);
});

test("filhos do instalador não herdam token nem senha", async () => {
  const { ambienteLimpo } = await import("../lib/programa.mjs");
  process.env.VERCEL_TOKEN = "v";
  process.env.REVEZA_ADMIN_SENHA = "SenhaForte123";
  try {
    const e = ambienteLimpo({ REVEZA_SENHA: "so-para-este" });
    assert.equal(e.VERCEL_TOKEN, undefined);
    assert.equal(e.REVEZA_ADMIN_SENHA, undefined);
    assert.equal(e.REVEZA_SENHA, "so-para-este");
    assert.equal(e.PATH, process.env.PATH);
  } finally {
    delete process.env.VERCEL_TOKEN;
    delete process.env.REVEZA_ADMIN_SENHA;
  }
});

test("Vercel: conexão que cai no meio é tentada de novo; erro que não é de rede não", async () => {
  let n = 0;
  const f = async () => {
    if (++n < 3) { const e = new TypeError("fetch failed"); e.cause = { message: "other side closed" }; throw e; }
    return new Response(JSON.stringify({ user: { username: "x" } }), { status: 200 });
  };
  const v = new Vercel("t", { fetch: f, esperar: async () => {} });
  assert.deepEqual(await v.pedir("GET", "/v2/user"), { user: { username: "x" } });
  assert.equal(n, 3);
  const v2 = new Vercel("t", { fetch: async () => { throw new Error("certificado inválido"); }, esperar: async () => {} });
  await assert.rejects(v2.pedir("GET", "/v2/user"), /certificado/);
});

test("conta os componentes do React Bits pela saída do script do painel", async () => {
  const { contarComponentes } = await import("../lib/painel.mjs");
  assert.equal(contarComponentes("baixados: CountUp, Aurora\njá estavam: BlurText  (use --forcar para baixar de novo)\npronto: /x"), 3);
  assert.equal(contarComponentes("pronto: /x"), 0);
});

test("a troca que valia no computador vai para a nuvem nova", async () => {
  const { trocaLocal } = await import("../instalar.mjs");
  const { d, limpar } = pasta();
  try {
    const arq = path.join(d, "estado.json");
    writeFileSync(arq, JSON.stringify({ config: { auto: true, modo: "limite", aviso: 90, troca: 95, intervaloS: 5 } }));
    assert.deepEqual(trocaLocal(arq), { auto: true, modo: "limite", aviso: 90, troca: 95 });
    writeFileSync(arq, JSON.stringify({ config: { auto: false, modo: "limiar", aviso: 97, troca: 95 } }));
    assert.deepEqual(trocaLocal(arq), { auto: false, modo: "limiar", aviso: 90, troca: 95 }, "limiares invertidos voltam ao padrão");
    assert.equal(trocaLocal(path.join(d, "nada.json")), null);
  } finally { limpar(); }
});

test("código de acesso do painel: o instalador lê o que o painel gera", async () => {
  const { lerCodigoDeAcesso } = await import("../instalar.mjs");
  const a = { u: "https://abcdefghijklmnopqrst.supabase.co", k: "chave-publica", e: "pc-1@computadores.reveza.invalid", s: "s".repeat(48) };
  const codigo = "rvzpc_" + Buffer.from(JSON.stringify(a)).toString("base64url");
  assert.deepEqual(lerCodigoDeAcesso(codigo), { url: a.u, anon: a.k, email: a.e, senha: a.s });
  assert.equal(lerCodigoDeAcesso("rvzpc_" + Buffer.from("{}").toString("base64url")), null);
  assert.equal(lerCodigoDeAcesso("qualquer coisa"), null);
  // o de um passo só (rvzl_) traz também a frase, e frase fora do formato invalida o código
  const um = "rvzl_" + Buffer.from(JSON.stringify({ ...a, f: "Abacate bola casa dado elefante faca" })).toString("base64url");
  assert.deepEqual(lerCodigoDeAcesso(um), { url: a.u, anon: a.k, email: a.e, senha: a.s, frase: "abacate bola casa dado elefante faca" });
  assert.equal(lerCodigoDeAcesso("rvzl_" + Buffer.from(JSON.stringify({ ...a, f: "duas palavras" })).toString("base64url")), null);
  assert.equal(lerCodigoDeAcesso("rvzl_" + Buffer.from(JSON.stringify({ ...a, f: "a b c d e; rm -rf" })).toString("base64url")), null);
});

test("dependências só pelas versões travadas: npm ci, sem script de terceiros, com package-lock.json no repositório", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  const raiz = new URL("../../", import.meta.url).pathname;
  for (const p of ["agente", "painel"]) assert.ok(existsSync(`${raiz}${p}/package-lock.json`), `${p}/package-lock.json`);
  for (const f of ["instalador/lib/programa.mjs", "instalador/lib/painel.mjs", "instalador/instalar.mjs"]) {
    const fonte = readFileSync(`${raiz}${f}`, "utf8");
    assert.ok(!/rodar\(npm, \["install"/.test(fonte), `${f} ainda usa npm install`);
    for (const m of fonte.matchAll(/rodar\(npm, \["ci"([^\]]*)\]/g)) assert.match(m[1], /--ignore-scripts/, `${f}: npm ci sem --ignore-scripts`);
  }
});
