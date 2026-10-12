// A atualização completa no instalador (0.3.0): o registro do que está no ar na nuvem, a oferta no fim da instalação
// (padrão NÃO, tokens só pela entrada padrão) e o modo --publicar-nuvem, que o agente chama, contra o emulador da nuvem.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { banco } from "../../nuvem/testes/apoio.mjs";
import { migracoes } from "../../nuvem/provisionar.mjs";
import { dadosDaPublicacao, lerPublicacao, registrarPublicacao } from "../lib/nuvem.mjs";
import { perguntador } from "../lib/texto.mjs";
import { lerPartes, oferecerAtualizacaoCompleta, textoAtualizacaoCompleta } from "../instalar.mjs";
import { iniciarEmulador } from "./emulador/emulador.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const VERSAO = JSON.parse(readFileSync(path.join(RAIZ, "package.json"), "utf8")).version;
const SEM_SH = process.platform === "win32" ? "o npm falso é um script sh" : false;
// tokens de mentira (a trava do repositório recusa os de formato real)
const TOKENS = { supabase: "token-supabase-de-teste-123456", vercel: "token-vercel-de-teste-654321" };
const PAINEL = { projeto: "reveza", equipe: "team_abc123", dominio: null, url: "https://reveza.vercel.app", urlVercel: "https://reveza.vercel.app", vapid: "B".repeat(87) };

test("o registro do que está no ar: a versão da nuvem só sobe, o publicado se soma, os dados do painel vão sem token", async () => {
  const b = await banco();
  const consultar = async (sql, parametros) => (await b.db.query(sql, parametros)).rows;
  await registrarPublicacao(consultar, { versao: "0.3.0", publicacao: PAINEL });
  let c = await lerPublicacao(consultar);
  assert.equal(c.versao, "0.3.0");
  assert.equal(c.publicado.funcoes, "0.3.0");
  assert.equal(c.publicado.painel, "0.3.0");
  assert.deepEqual(c.painel, PAINEL);
  // um instalador mais velho não volta a versão da nuvem; publicar só as funções soma ao que estava
  await registrarPublicacao(consultar, { versao: "0.2.9", painel: false });
  await registrarPublicacao(consultar, { versao: "0.3.1", painel: false });
  c = await lerPublicacao(consultar);
  assert.equal(c.versao, "0.3.1");
  assert.equal(c.publicado.funcoes, "0.3.1");
  assert.equal(c.publicado.painel, "0.3.0");
  // o que falta publicar, pela mesma regra do banco
  const [{ p }] = await b.sql("select public.rvz_publicacao_pendente() as p");
  assert.deepEqual(p, { versao: "0.3.1", funcoes: false, painel: true });
  await assert.rejects(registrarPublicacao(consultar, { versao: "1.2" }), /versão inválida/);
});

test("os dados do painel são conferidos (nada de endereço estranho nem token no lugar errado)", () => {
  assert.deepEqual(dadosDaPublicacao(PAINEL), { projeto: "reveza", equipe: "team_abc123", dominio: null, url: "https://reveza.vercel.app", url_vercel: "https://reveza.vercel.app", vapid: "B".repeat(87) });
  assert.throws(() => dadosDaPublicacao({ ...PAINEL, projeto: "Com Espaço" }), /projeto/);
  assert.throws(() => dadosDaPublicacao({ ...PAINEL, url: "http://reveza.vercel.app" }), /endereço/);
  assert.throws(() => dadosDaPublicacao({ ...PAINEL, url: "https://x.com/caminho" }), /endereço/);
  assert.throws(() => dadosDaPublicacao({ ...PAINEL, equipe: "a b" }), /equipe/);
});

test("a oferta no fim da instalação: padrão NÃO; sem pergunta (--sim, sem terminal), fica desligada", async () => {
  const linhas = [];
  const chamadas = [];
  const r = await oferecerAtualizacaoCompleta({
    p: perguntador({ semPerguntas: true }), tokens: TOKENS, rodarCli: (...x) => chamadas.push(x), mostrar: (l) => linhas.push(l),
  });
  assert.equal(r, false);
  assert.deepEqual(chamadas, [], "nada foi guardado");
  const texto = linhas.join("\n");
  assert.match(texto, /CIFRADOS com a chave do cofre/);
  assert.match(texto, /quem tiver um computador desta instalação passa a ter esses tokens/);
  assert.match(texto, /Vercel: escopo só no time do painel e com validade/);
  assert.match(texto, /Supabase: com validade.*conta que só tenha a organização do Reveza/);
  assert.match(texto, /Atualização completa desligada/);
  // a pergunta tem o padrão não
  let padrao = null;
  await oferecerAtualizacaoCompleta({ p: { sim: async (_q, d) => ((padrao = d), false) }, tokens: TOKENS, rodarCli: () => assert.fail("não devia"), mostrar: () => {} });
  assert.equal(padrao, false);
  assert.deepEqual(textoAtualizacaoCompleta().filter((l) => /token-/.test(l)), []);
});

test("a oferta aceita: os tokens vão ao agente só pela entrada padrão, nunca em argumento", async () => {
  const chamadas = [];
  const r = await oferecerAtualizacaoCompleta({
    p: { sim: async () => true }, tokens: TOKENS, mostrar: () => {},
    rodarCli: (args, entrada) => {
      chamadas.push({ args, entrada });
      return { ok: true, saida: "", erro: "" };
    },
  });
  assert.equal(r, true);
  assert.deepEqual(chamadas[0].args, ["atualizacao-completa", "ligar", "--stdin"]);
  assert.deepEqual(JSON.parse(chamadas[0].entrada), TOKENS);
  assert.ok(!chamadas[0].args.join(" ").includes("token-"), "token nenhum em argumento");
  assert.equal(await oferecerAtualizacaoCompleta({ p: { sim: async () => true }, tokens: { supabase: "x" }, rodarCli: () => assert.fail(), mostrar: () => {} }), false,
    "sem os dois tokens, nem oferece");
});

test("--partes: funcoes, painel ou os dois", () => {
  assert.deepEqual(lerPartes(undefined), { funcoes: true, painel: true });
  assert.deepEqual(lerPartes("painel"), { funcoes: false, painel: true });
  assert.deepEqual(lerPartes("funcoes, painel"), { funcoes: true, painel: true });
  assert.throws(() => lerPartes("tudo"), /--partes/);
  assert.throws(() => lerPartes(""), /--partes/);
});

/** Um HOME temporário com um npm falso que "compila" o painel (dist/index.html) sem baixar nada. */
function casa() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "reveza-publicar-"));
  const home = path.join(tmp, "casa");
  const bin = path.join(tmp, "bin");
  mkdirSync(path.join(home, ".reveza"), { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, "npm"), `#!/bin/sh\nif [ "$1" = "run" ] && [ "$2" = "build" ]; then mkdir -p dist && echo '<!doctype html><title>painel</title>' > dist/index.html; fi\nexit 0\n`);
  chmodSync(path.join(bin, "npm"), 0o755);
  return { tmp, home, bin, limpar: () => rmSync(tmp, { recursive: true, force: true }) };
}

/** A nuvem do emulador com todas as migrações registradas, a versão dela e os dados do painel. */
async function nuvemPronta(emu, versaoDaNuvem) {
  await emu.db.exec(`create table if not exists public.reveza_migracoes (nome text primary key, hash text not null, aplicada_em timestamptz not null default now())`);
  const { createHash } = await import("node:crypto");
  for (const m of migracoes(path.join(RAIZ, "nuvem", "migracoes"))) {
    if (!m.nome.endsWith(".supabase.sql")) await emu.db.exec(m.sql);
    await emu.db.query("insert into public.reveza_migracoes (nome, hash) values ($1, $2)", [m.nome, createHash("sha256").update(m.sql).digest("hex")]);
  }
  const consultar = async (sql, parametros) => (await emu.db.query(sql, parametros)).rows;
  await registrarPublicacao(consultar, { versao: "0.0.1", publicacao: PAINEL });
  await emu.db.query("update public.config set valor = to_jsonb($1::text) where chave = 'nuvem_versao'", [versaoDaNuvem]);
}

/** O instalador num processo à parte (assíncrono: o emulador roda neste mesmo processo e precisa responder). */
function publicar(c, emu, args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(RAIZ, "instalador", "instalar.mjs"), "--publicar-nuvem", "--ref", emu.ref, "--sem-react-bits", ...args], {
      cwd: c.tmp,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        HOME: c.home, USERPROFILE: c.home, REVEZA_HOME: path.join(c.home, ".reveza"),
        PATH: [c.bin, path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter),
        REVEZA_EMULADOR: emu.url,
        NODE_OPTIONS: `--import ${path.join(RAIZ, "instalador", "testes", "emulador", "rede.mjs")}`,
      },
    });
    let saida = "";
    p.stdout.on("data", (d) => (saida += d));
    p.stderr.on("data", (d) => (saida += d));
    const limite = setTimeout(() => p.kill("SIGKILL"), 120_000);
    p.on("close", (status) => {
      clearTimeout(limite);
      resolve({ status, saida });
    });
    p.stdin.end(JSON.stringify(TOKENS));
  });
}

test("--publicar-nuvem: publica as funções e o painel da versão em que a nuvem está, com os dados que estão nela", { skip: SEM_SH }, async () => {
  const emu = await iniciarEmulador();
  const c = casa();
  try {
    await nuvemPronta(emu, VERSAO);
    const r = await publicar(c, emu, ["--partes", "funcoes,painel"]);
    assert.equal(r.status, 0, r.saida.slice(-2000));
    assert.equal(emu.estado.funcoes.length, 5, "as 5 funções, com a atualizar-nuvem");
    const dep = emu.estado.implantacoes.at(-1);
    assert.ok(dep && dep.files.includes("index.html") && dep.files.includes("vercel.json"), "o painel foi publicado com os cabeçalhos");
    const consultar = async (sql, parametros) => (await emu.db.query(sql, parametros)).rows;
    const depois = await lerPublicacao(consultar);
    assert.equal(depois.publicado.funcoes, VERSAO);
    assert.equal(depois.publicado.painel, VERSAO);
    assert.equal(depois.painel.projeto, "reveza");
    assert.ok(!r.saida.includes(TOKENS.supabase) && !r.saida.includes(TOKENS.vercel) && !/token-supabase|token-vercel/.test(r.saida), "nenhum pedaço de token na saída");
    assert.ok(!existsSync(path.join(c.home, ".reveza", "instalacao.json")), "a publicação não mexe na instalação deste computador");
  } finally {
    c.limpar();
    await emu.fechar();
  }
});

test("--publicar-nuvem recusa: a nuvem em outra versão (ela vem antes), sem os dados do painel, ou com terminal", { skip: SEM_SH }, async () => {
  const emu = await iniciarEmulador();
  const c = casa();
  try {
    await nuvemPronta(emu, "9.9.9");
    let r = await publicar(c, emu, ["--partes", "funcoes"]);
    assert.equal(r.status, 1);
    assert.match(r.saida, /a nuvem está na 9\.9\.9 e esta publicação é da .*: a nuvem se atualiza antes/);
    assert.equal(emu.estado.funcoes.length, 0, "nada publicado");
    await emu.db.query("update public.config set valor = to_jsonb($1::text) where chave = 'nuvem_versao'", [VERSAO]);
    await emu.db.exec("delete from public.config where chave = 'painel_publicacao'");
    r = await publicar(c, emu, ["--partes", "painel"]);
    assert.equal(r.status, 1);
    assert.match(r.saida, /não tem os dados do painel: rode uma vez o instalador com --atualizar/);
    r = await publicar(c, emu, ["--partes", "funcao"]);
    assert.equal(r.status, 1);
    assert.match(r.saida, /--partes/);
  } finally {
    c.limpar();
    await emu.fechar();
  }
});
