// A Edge Function atualizar-nuvem no Node (node --experimental-strip-types): a regra das versões, o pacote da tag (um
// .tar.gz feito aqui, com os arquivos de verdade do repositório), o plano das migrações (o mesmo do instalador) e a
// atualização inteira contra um Postgres de verdade (PGlite), com as migrações rodando como um papel que NÃO é
// superusuário, como a conexão que o Supabase dá às funções.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import * as L from "../atualizar-nuvem/logica.ts";
import { tratar } from "../atualizar-nuvem/tratar.ts";
import { migracoes as migracoesDoInstalador, planoMigracoes as planoDoInstalador, hashesAceitos as hashesDoInstalador } from "../../provisionar.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const sha = (t) => createHash("sha256").update(t).digest("hex");

// ------------------------------------------------------------------------------------------------ um .tar.gz de verdade

function cabecalho(nome, tamanho, tipo = "0", link = "") {
  const h = Buffer.alloc(512);
  let prefixo = "";
  let curto = nome;
  if (Buffer.byteLength(nome) > 100) {
    const i = nome.lastIndexOf("/", nome.length - 1 - 0);
    prefixo = nome.slice(0, i);
    curto = nome.slice(i + 1);
  }
  h.write(curto, 0, 100, "utf8");
  h.write("0000644\0", 100);
  h.write("0000000\0", 108);
  h.write("0000000\0", 116);
  h.write(tamanho.toString(8).padStart(11, "0") + "\0", 124);
  h.write("00000000000\0", 136);
  h.write("        ", 148);
  h.write(tipo, 156);
  h.write(link, 157, 100, "utf8");
  h.write("ustar\0", 257);
  h.write("00", 263);
  h.write(prefixo, 345, 155, "utf8");
  let soma = 0;
  for (const b of h) soma += b;
  h.write(soma.toString(8).padStart(6, "0") + "\0 ", 148);
  return h;
}

/** Os arquivos (caminho → conteúdo) num .tar.gz, como o GitHub entrega (uma pasta de cima com tudo dentro). */
function tarGz(arquivos, extras = []) {
  const partes = [];
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    const c = Buffer.from(conteudo);
    partes.push(cabecalho(nome, c.length), c, Buffer.alloc((512 - (c.length % 512)) % 512));
  }
  for (const e of extras) partes.push(e);
  partes.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(partes));
}

function lerPasta(rel, fora = /node_modules|\/dist\/|react-bits\//) {
  const r = {};
  const varrer = (d) => {
    for (const n of readdirSync(path.join(RAIZ, d))) {
      const p = path.join(d, n);
      if (fora.test(p + "/")) continue;
      if (statSync(path.join(RAIZ, p)).isDirectory()) varrer(p);
      else r[p.split(path.sep).join("/")] = readFileSync(path.join(RAIZ, p));
    }
  };
  varrer(rel);
  return r;
}

/** O pacote de uma versão: o repositório como está (migrações, funções, painel), com a versão trocada. */
function pacoteDe(versao, mexer = (a) => a) {
  const base = {
    "package.json": JSON.stringify({ name: "reveza", version: versao }),
    ...lerPasta("nuvem/migracoes"),
    ...lerPasta("nuvem/funcoes"),
    "nuvem/provisionar.mjs": readFileSync(path.join(RAIZ, "nuvem/provisionar.mjs")),
    ...lerPasta("painel/src"),
    "painel/package.json": readFileSync(path.join(RAIZ, "painel/package.json")),
    "instalador/lib/painel.mjs": readFileSync(path.join(RAIZ, "instalador/lib/painel.mjs")),
    "instalador/lib/vercel.mjs": readFileSync(path.join(RAIZ, "instalador/lib/vercel.mjs")),
  };
  const arquivos = mexer(base);
  return tarGz(Object.fromEntries(Object.entries(arquivos).map(([k, v]) => [`reveza-${versao}/${k}`, v])));
}

/** O GitHub falso: a lista de versões, a página da mais nova e o pacote de cada tag (pelo codeload). */
function github({ versoes, pacotes = {}, apiStatus = 200, latest = null }) {
  const pedidos = [];
  const f = async (url, init = {}) => {
    pedidos.push(String(url));
    if (url === L.URL_VERSOES) {
      if (apiStatus !== 200) return new Response("{}", { status: apiStatus });
      return Response.json(versoes.map((v) => (typeof v === "string" ? { tag_name: `v${v}` } : v)));
    }
    if (url === L.URL_MAIS_NOVA) {
      return new Response(null, { status: 302, headers: latest ? { location: latest } : {} });
    }
    const tag = /archive\/refs\/tags\/v([0-9.]+)\.tar\.gz$/.exec(url);
    if (tag) {
      assert.equal(init.redirect, "manual", "o download não segue redirecionamento sozinho");
      return new Response(null, { status: 302, headers: { location: `https://codeload.github.com/${L.REPOSITORIO}/tar.gz/refs/tags/v${tag[1]}` } });
    }
    const code = /codeload\.github\.com\/.+\/v([0-9.]+)$/.exec(url);
    if (code && pacotes[code[1]]) return new Response(pacotes[code[1]], { status: 200 });
    return new Response("não achei", { status: 404 });
  };
  return { f, pedidos };
}

// ------------------------------------------------------------------------------------------------ as regras

test("versões: só publicada (nem rascunho nem pré-lançamento), do repositório fixo; o redirecionamento só da mais nova dele", () => {
  assert.deepEqual(L.versoesPublicadas([{ tag_name: "v0.3.0" }, { tag_name: "v0.4.0", prerelease: true }, { tag_name: "v0.5.0", draft: true },
    { tag_name: "v0.2.10" }, { tag_name: "nightly" }]), ["0.3.0", "0.2.10"]);
  assert.equal(L.versaoDoRedirecionamento(`https://github.com/${L.REPOSITORIO}/releases/tag/v0.3.1`), "0.3.1");
  for (const mau of [`https://github.com/outro/reveza/releases/tag/v0.3.1`, `http://github.com/${L.REPOSITORIO}/releases/tag/v0.3.1`,
    `https://github.com/${L.REPOSITORIO}/releases/tag/v0.3`, `https://github.com/${L.REPOSITORIO}/releases/tag/v0.3.1?x=1`, null, ""]) {
    assert.equal(L.versaoDoRedirecionamento(mau), null, String(mau));
  }
  assert.throws(() => L.urlDoPacote("../../x"), /versão inválida/);
  assert.equal(L.urlDoPacote("0.3.0"), `https://github.com/${L.REPOSITORIO}/archive/refs/tags/v0.3.0.tar.gz`);
  assert.equal(L.compararVersao("0.10.0", "0.9.9"), 1);
});

test("a versão mais nova: pela API; com a API recusando (limite por endereço), pela página da mais nova", async () => {
  assert.equal(await L.versaoMaisNova(github({ versoes: ["0.3.1", "0.3.0"] }).f), "0.3.1");
  const g = github({ versoes: [], apiStatus: 403, latest: `https://github.com/${L.REPOSITORIO}/releases/tag/v0.3.2` });
  assert.equal(await L.versaoMaisNova(g.f), "0.3.2");
  await assert.rejects(L.versaoMaisNova(github({ versoes: [], apiStatus: 403, latest: "https://exemplo.com/releases/tag/v9.9.9" }).f), /não consegui ler a versão publicada/);
});

test("o pacote: segue só para o GitHub, tem tamanho máximo; o .tar recusa link e caminho para fora", async () => {
  const fora = async () => new Response(null, { status: 302, headers: { location: "https://exemplo.com/pacote.tar.gz" } });
  await assert.rejects(L.baixarPacote(fora, "0.3.0"), /para fora do GitHub/);
  const grande = async () => new Response("x", { status: 200, headers: { "content-length": String(L.PACOTE_MAXIMO + 1) } });
  await assert.rejects(L.baixarPacote(grande, "0.3.0"), /grande demais/);
  await assert.rejects(L.gunzip(gzipSync(Buffer.alloc(4096)), 1024), /grande demais/);
  const comLink = tarGz({ "r/package.json": "{}" }, [cabecalho("r/link", 0, "2", "/etc/passwd"), Buffer.alloc(0)]);
  const tarComLink = await L.gunzip(comLink);
  assert.throws(() => L.lerTar(tarComLink), /link/);
  const fugindo = await L.gunzip(tarGz({ "r/../../fora.sql": "x" }));
  assert.throws(() => L.lerTar(fugindo), /caminho inválido/);
  const ok = L.lerTar(await L.gunzip(tarGz({ "r/a.txt": "um", [`r/${"p".repeat(90)}/${"q".repeat(60)}.sql`]: "longo" })));
  assert.equal(new TextDecoder().decode(ok.get("r/a.txt")), "um");
  assert.ok([...ok.keys()].some((k) => k.endsWith(`${"q".repeat(60)}.sql`)), "nome longo pelo prefixo do ustar");
});

test("o pacote tem de ser o Reveza na versão pedida", async () => {
  const arq = L.lerTar(await L.gunzip(tarGz({ "x/package.json": JSON.stringify({ name: "reveza", version: "0.3.0" }) })));
  assert.equal(L.raizDoPacote(arq, "0.3.0"), "x");
  assert.throws(() => L.raizDoPacote(arq, "0.3.1"), /não é o da 0\.3\.1/);
  const outro = L.lerTar(await L.gunzip(tarGz({ "x/package.json": JSON.stringify({ name: "outro", version: "0.3.0" }) })));
  assert.throws(() => L.raizDoPacote(outro, "0.3.0"), /não tem o programa/);
});

test("o plano das migrações é o do instalador (mesmos nomes, mesma ordem, mesmos resumos)", async () => {
  const doRepo = migracoesDoInstalador(path.join(RAIZ, "nuvem", "migracoes"));
  const arq = L.lerTar(await L.gunzip(pacoteDe("9.9.9")));
  const daFuncao = L.migracoesDoPacote(arq, "reveza-9.9.9");
  assert.deepEqual(daFuncao.map((m) => m.nome), doRepo.map((m) => m.nome));
  // nuvem que já tem tudo menos a 0021 e a 0022, com a 0099 de antes e uma reaplicável (0005) mudada
  const feitas = new Map(doRepo.filter((m) => !/^002[12]/.test(m.nome)).map((m) => [m.nome, sha(m.sql)]));
  feitas.set("0099_permissoes.sql", "0".repeat(64));
  feitas.set("0005_cron.supabase.sql", "1".repeat(64));
  const daqui = (await L.planoMigracoes(daFuncao, feitas)).map((m) => [m.nome, m.hash]);
  const dele = planoDoInstalador(doRepo, feitas, true).map((m) => [m.nome, m.hash]);
  assert.deepEqual(daqui, dele);
  assert.deepEqual(daqui.map(([n]) => n), ["0005_cron.supabase.sql", "0021_atualizar_nuvem.sql", "0022_atualizar_nuvem_agenda.supabase.sql", "0099_permissoes.sql"]);
  // migração de tabela que mudou depois de aplicada: recusada, como no instalador
  feitas.set("0001_base.sql", "2".repeat(64));
  await assert.rejects(L.planoMigracoes(daFuncao, feitas), /0001_base\.sql mudou depois de aplicada/);
  await assert.rejects(L.planoMigracoes(daFuncao, new Map()), /não tem o registro/);
});

test("o fim de linha não muda o resumo: nuvem instalada de um clone com CRLF (Windows) não trava nem reaplica", async () => {
  const doRepo = migracoesDoInstalador(path.join(RAIZ, "nuvem", "migracoes"));
  const daFuncao = L.migracoesDoPacote(L.lerTar(await L.gunzip(pacoteDe("9.9.9"))), "reveza-9.9.9");
  const crlf = new Map(doRepo.map((m) => [m.nome, sha(m.sql.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n"))]));
  assert.deepEqual(await L.planoMigracoes(daFuncao, crlf), [], "a função aceita o resumo registrado com CRLF");
  assert.deepEqual(planoDoInstalador(doRepo, crlf, true), [], "o instalador também");
  // e os dois registram o resumo com LF, o mesmo para o arquivo com CRLF ou com LF
  const m = doRepo.find((x) => x.nome === "0021_atualizar_nuvem.sql");
  assert.equal(await L.hashDe(m.sql.replace(/\n/g, "\r\n")), await L.hashDe(m.sql));
  assert.deepEqual(await L.hashesAceitos(m.sql), hashesDoInstalador(m.sql));
});

test("toda migração de hoje cabe numa transação; as que não cabem são recusadas antes de começar", () => {
  for (const m of migracoesDoInstalador(path.join(RAIZ, "nuvem", "migracoes"))) assert.equal(L.foraDeTransacao(m), null, m.nome);
  assert.match(L.foraDeTransacao({ nome: "x.sql", sql: "begin;\ncreate table t();\ncommit;" }), /própria transação/);
  assert.match(L.foraDeTransacao({ nome: "x.sql", sql: "create index concurrently i on t (a);" }), /concurrently/);
  assert.match(L.foraDeTransacao({ nome: "x.sql", sql: "vacuum full public.t;" }), /vacuum/);
});

test("os resumos das partes: teste e arquivo oculto não contam; mexer no painel muda só o do painel", async () => {
  const resumo = async (pacote, v) => {
    const a = L.lerTar(await L.gunzip(pacote));
    return L.impressoesDoPacote(a, L.raizDoPacote(a, v));
  };
  const base = await resumo(pacoteDe("1.0.0"), "1.0.0");
  assert.match(base.funcoes, /^[0-9a-f]{64}$/);
  assert.deepEqual(await resumo(pacoteDe("1.0.1"), "1.0.1"), base, "só a versão mudou: as partes são as mesmas");
  const soTeste = await resumo(pacoteDe("1.0.2", (a) => ({ ...a, "painel/src/lib/novo.test.ts": "x", "nuvem/funcoes/testes/outro.test.mjs": "y", "painel/.npmrc": "z" })), "1.0.2");
  assert.deepEqual(soTeste, base);
  const painel = await resumo(pacoteDe("1.0.3", (a) => ({ ...a, "painel/src/App.tsx": "mudou" })), "1.0.3");
  assert.equal(painel.funcoes, base.funcoes);
  assert.notEqual(painel.painel, base.painel);
  const funcoes = await resumo(pacoteDe("1.0.4", (a) => ({ ...a, "nuvem/provisionar.mjs": "// segredo novo" })), "1.0.4");
  assert.notEqual(funcoes.funcoes, base.funcoes);
  assert.equal(funcoes.painel, base.painel);
});

test("de madrugada: das 3h às 5h no fuso da instalação", () => {
  const h = (iso) => Date.parse(iso);
  assert.equal(L.naMadrugada(h("2026-10-12T06:30:00Z"), "America/Sao_Paulo"), true);
  assert.equal(L.naMadrugada(h("2026-10-12T08:00:00Z"), "America/Sao_Paulo"), false);
  assert.equal(L.naMadrugada(h("2026-10-12T03:30:00Z"), "Fuso/Inventado"), false, "fuso desconhecido: o padrão");
});

// ------------------------------------------------------------------------------------------------ contra o Postgres

const DONO = "reveza_dono";

/**
 * Um Postgres com o que o Supabase traz pronto (Auth, Vault, um pg_cron de mentira) e o papel `reveza_dono`: NÃO é
 * superusuário, só tem o que o papel postgres do Supabase tem (criar no public, referenciar auth.users, as funções do
 * Auth, do Vault e do pg_cron).
 */
async function postgresComDono() {
  const db = new PGlite();
  await db.exec(readFileSync(path.join(RAIZ, "nuvem", "testes", "supabase-falso.sql"), "utf8"));
  await db.exec(`
    create schema if not exists cron;
    create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
    create function cron.schedule(p_nome text, p_quando text, p_comando text) returns bigint language sql as
      $$ insert into cron.job (jobname, schedule, command) values (p_nome, p_quando, p_comando)
         on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
    create function cron.unschedule(p_id bigint) returns boolean language sql as $$ delete from cron.job where jobid = p_id returning true $$;
    create role ${DONO} nologin;
    grant usage, create on schema public to ${DONO};
    grant usage on schema auth, vault, cron to ${DONO};
    grant select, references, update, delete on all tables in schema auth to ${DONO};
    grant execute on all functions in schema auth, vault, cron to ${DONO};
    grant select, insert, update, delete on cron.job to ${DONO};
    grant usage on all sequences in schema cron to ${DONO};
    grant select on vault.decrypted_secrets to ${DONO};
    grant anon, authenticated, service_role to ${DONO};
  `);
  return db;
}

/** A 0005 cria as extensões pg_cron e pg_net, que o Postgres do teste não tem: ela fica registrada como feita. */
const SO_NO_SUPABASE = /^0005_/;

/** Uma nuvem da 0.3.0 montada pelo papel dado: todas as migrações de hoje, registradas, e a versão da nuvem. */
async function nuvemDe030({ dono = DONO } = {}) {
  const db = await postgresComDono();
  if (dono !== "postgres") await db.exec(`set role ${dono}`);
  await db.exec(`create table if not exists public.reveza_migracoes (nome text primary key, hash text not null, aplicada_em timestamptz not null default now());
    alter table public.reveza_migracoes enable row level security;
    revoke all on public.reveza_migracoes from anon, authenticated;`);
  for (const m of migracoesDoInstalador(path.join(RAIZ, "nuvem", "migracoes"))) {
    if (!SO_NO_SUPABASE.test(m.nome)) await db.exec(m.sql);
    await db.query("insert into public.reveza_migracoes (nome, hash) values ($1, $2)", [m.nome, sha(m.sql)]);
  }
  await db.exec(`insert into public.config (chave, valor) values ('nuvem_versao', '"0.3.0"'), ('fuso', '"America/Sao_Paulo"')`);
  await db.exec("reset role");
  return db;
}

/** A conexão da função: como o papel dado (no Supabase, o da conexão que a plataforma dá às funções). */
function conexao(db, papel = DONO) {
  const comoPapel = () => db.exec(papel === "postgres" ? "reset role" : `set role ${papel}`);
  return {
    consulta: async (sql, parametros) => {
      await comoPapel();
      return (await db.query(sql, parametros ?? [])).rows;
    },
    executar: async (sql) => {
      // fim de transação (inclusive a abortada, que não aceita mais nada) vai direto
      if (!/^(rollback|commit)$/.test(sql)) await comoPapel();
      await db.exec(sql);
    },
  };
}

async function configDe(db, chave) {
  await db.exec("reset role");
  return (await db.query("select valor from public.config where chave = $1", [chave])).rows[0]?.valor ?? null;
}

/** A 0.3.1 de teste: uma migração nova (tabela, função e a liberação dela na 0099) e um painel mudado. */
const MIGRACAO_NOVA = `-- Reveza AI · 0023 · de teste
create table if not exists public.x_nova (id int primary key);
create or replace function public.agente_x_nova() returns integer language sql security definer set search_path = public, pg_temp as $$ select 23 $$;
`;
const pacote031 = (extra = {}) =>
  pacoteDe("0.3.1", (a) => ({
    ...a,
    "nuvem/migracoes/0023_x_nova.sql": MIGRACAO_NOVA,
    "nuvem/migracoes/0099_permissoes.sql": `${a["nuvem/migracoes/0099_permissoes.sql"]}\ngrant execute on function public.agente_x_nova() to authenticated;\n`,
    "painel/src/App.tsx": "// mudou",
    ...extra,
  }));

test("toda migração de hoje roda numa transação própria, pelo caminho da função, com um papel que não é superusuário", async () => {
  const db = await postgresComDono();
  const b = conexao(db);
  await b.executar(`create table public.reveza_migracoes (nome text primary key, hash text not null, aplicada_em timestamptz not null default now())`);
  await b.executar(L.SQL_FECHAR_PADRAO);
  const todas = migracoesDoInstalador(path.join(RAIZ, "nuvem", "migracoes"));
  for (const m of todas) {
    if (SO_NO_SUPABASE.test(m.nome)) continue;
    assert.equal(await L.aplicarUma(b, { ...m, hash: sha(m.sql) }), true, m.nome);
  }
  await db.exec("reset role");
  const donos = (await db.query(`select distinct pg_get_userbyid(relowner) as d from pg_class
    where relnamespace = 'public'::regnamespace and relkind = 'r'`)).rows.map((x) => x.d);
  assert.deepEqual(donos, [DONO], "tudo do papel dono, nada do superusuário");
  assert.equal((await db.query("select count(*)::int as n from public.reveza_migracoes")).rows[0].n, todas.length - 1);
  // e a agenda da 0022 (no pg_cron de mentira): a função, de hora em hora, com o segredo do cron
  const job = (await db.query("select schedule, command from cron.job where jobname = 'reveza-atualizar-nuvem'")).rows[0];
  assert.equal(job.schedule, "7 * * * *");
  assert.match(job.command, /functions\/v1\/atualizar-nuvem[\s\S]*x-reveza-cron[\s\S]*"acao": "sozinho"[\s\S]*timeout_milliseconds := 150000/);
});

test("a nuvem da 0.3.0 vai para a 0.3.1 sozinha: a migração nova e as permissões entram como o papel dono, e tudo fica registrado", async () => {
  const db = await nuvemDe030();
  await db.exec(`insert into public.config (chave, valor) values ('publicado', '{"funcoes": "0.3.0", "painel": "0.3.0"}')`);
  const g = github({ versoes: ["0.3.1", "0.3.0"], pacotes: { "0.3.1": pacote031(), "0.3.0": pacoteDe("0.3.0") } });
  // desligada (o padrão): a sozinha não faz nada e nem vai ao GitHub
  assert.deepEqual(await L.atualizarNuvem({ banco: conexao(db), fetch: g.f, por: "sozinho" }), { ok: true, estado: "desligada" });
  assert.deepEqual(g.pedidos, []);
  // de madrugada, fora da hora
  await db.exec(`insert into public.config (chave, valor) values ('atualizar_sozinho', 'true')`);
  assert.equal((await L.atualizarNuvem({ banco: conexao(db), fetch: g.f, por: "sozinho", agora: Date.parse("2026-10-12T15:00:00Z") })).estado, "fora_da_hora");
  const r = await L.atualizarNuvem({ banco: conexao(db), fetch: g.f, por: "sozinho", agora: Date.parse("2026-10-12T06:10:00Z") });
  assert.equal(r.estado, "atualizada", JSON.stringify(r));
  assert.deepEqual(r.aplicadas, ["0023_x_nova.sql", "0099_permissoes.sql"]);
  assert.equal(r.de, "0.3.0");
  assert.equal(await configDe(db, "nuvem_versao"), "0.3.1");
  const at = await configDe(db, "nuvem_atualizacao");
  assert.equal(at.estado, "atualizada");
  assert.equal(at.por, "sozinho");
  // os resumos: o da 0.3.1 e o da 0.3.0 (o que está no ar), para saber o que publicar
  const imp = await configDe(db, "impressoes");
  assert.equal(imp["0.3.1"].funcoes, imp["0.3.0"].funcoes, "as funções não mudaram");
  assert.notEqual(imp["0.3.1"].painel, imp["0.3.0"].painel, "o painel mudou");
  assert.deepEqual((await db.query("select public.rvz_publicacao_pendente() as p")).rows[0].p, { versao: "0.3.1", funcoes: false, painel: true });
  // o que entrou é do papel dono, e a permissão nova (da 0099 da 0.3.1) vale
  assert.equal((await db.query("select pg_get_userbyid(relowner) as d from pg_class where oid = 'public.x_nova'::regclass")).rows[0].d, DONO);
  assert.equal((await db.query("select has_function_privilege('authenticated', 'public.agente_x_nova()', 'execute') as p")).rows[0].p, true);
  assert.equal((await db.query("select has_function_privilege('authenticated', 'public.servico_nuvem_estado()', 'execute') as p")).rows[0].p, false);
  const reg = (await db.query("select nome, hash from public.reveza_migracoes where nome in ('0023_x_nova.sql', '0099_permissoes.sql')")).rows;
  assert.equal(reg.length, 2);
  // de novo: em dia, nada muda
  assert.equal((await L.atualizarNuvem({ banco: conexao(db), fetch: g.f, por: "sozinho", agora: Date.parse("2026-10-12T06:20:00Z") })).estado, "em_dia");
  assert.match((await db.query("select texto from public.eventos where tipo = 'info' order by id desc limit 1")).rows[0].texto, /0\.3\.1 \(2 migração/);
});

test("uma migração que quebra não deixa nada pela metade: a anterior fica, a quebrada sai inteira, e sai o alerta", async () => {
  const db = await nuvemDe030();
  const quebrada = pacote031({ "nuvem/migracoes/0024_quebrada.sql": "create table public.x_meio (id int);\ninsert into public.x_meio values (1);\nselect 1 / 0;\n" });
  const g = github({ versoes: ["0.3.1"], pacotes: { "0.3.1": quebrada } });
  const r = await L.atualizarNuvem({ banco: conexao(db), fetch: g.f, por: "painel" });
  assert.equal(r.estado, "falhou");
  assert.match(r.motivo, /0024_quebrada\.sql não entrou \(nada dela ficou\).*division by zero/);
  await db.exec("reset role");
  assert.equal((await db.query("select to_regclass('public.x_meio') as t")).rows[0].t, null, "a tabela da migração quebrada não ficou");
  const nomes = (await db.query("select nome from public.reveza_migracoes")).rows.map((x) => x.nome);
  assert.ok(nomes.includes("0023_x_nova.sql"), "a que veio antes entrou inteira");
  assert.ok(!nomes.includes("0024_quebrada.sql"));
  assert.equal(await configDe(db, "nuvem_versao"), "0.3.0", "a versão da nuvem não muda");
  const at = await configDe(db, "nuvem_atualizacao");
  assert.equal(at.estado, "falhou");
  assert.match(at.motivo, /0024_quebrada/);
  const alerta = (await db.query("select dados from public.eventos where tipo = 'alerta' order by id desc limit 1")).rows[0];
  assert.equal(alerta.dados.parte, "nuvem");
  assert.equal(alerta.dados.motivo, "atualizacao_falhou");
  // sozinha, a mesma versão que falhou não é tentada de novo (quem pede de novo é o administrador, pelo painel)
  await db.exec(`insert into public.config (chave, valor) values ('atualizar_sozinho', '"assim_que_sair"')`);
  assert.equal((await L.atualizarNuvem({ banco: conexao(db), fetch: g.f, por: "sozinho" })).estado, "parada");
  // consertada a versão (outro pacote), o administrador pede e vai
  const g2 = github({ versoes: ["0.3.1"], pacotes: { "0.3.1": pacote031() } });
  assert.equal((await L.atualizarNuvem({ banco: conexao(db), fetch: g2.f, por: "painel" })).estado, "atualizada");
});

test("a conexão que não é dona do banco para antes de mexer, e diz quais papéis", async () => {
  // a nuvem montada por outro papel (aqui, o superusuário); a função chega com o papel dela
  const db = await nuvemDe030({ dono: "postgres" });
  const g = github({ versoes: ["0.3.1"], pacotes: { "0.3.1": pacote031() } });
  const r = await L.atualizarNuvem({ banco: conexao(db, DONO), fetch: g.f, por: "painel" });
  assert.equal(r.estado, "falhou");
  assert.match(r.motivo, /papel reveza_dono\) não é dona do banco do Reveza \(tabelas de postgres, funções de postgres\): atualize pelo instalador/);
  assert.deepEqual(g.pedidos, [], "nem foi ao GitHub");
  assert.equal((await db.query("select count(*)::int as n from public.reveza_migracoes where nome like '0023%'")).rows[0].n, 0);
});

test("duas rodadas: a vez da nuvem segura a segunda, e a mesma migração não entra duas vezes", async () => {
  const db = await nuvemDe030();
  const b = conexao(db);
  const m = { nome: "0023_x_nova.sql", sql: MIGRACAO_NOVA, hash: sha(MIGRACAO_NOVA) };
  assert.equal(await L.aplicarUma(b, m), true);
  assert.equal(await L.aplicarUma(b, m), false, "a segunda rodada vê o registro dentro da trava e não aplica");
  assert.deepEqual((await b.consulta("select public.servico_nuvem_comecar('0.3.1', 'painel') as r"))[0].r, { ok: true, de: "0.3.0" });
  const g = github({ versoes: ["0.3.1"], pacotes: { "0.3.1": pacote031() } });
  const segunda = await L.atualizarNuvem({ banco: b, fetch: g.f, por: "painel" });
  assert.equal(segunda.estado, "atualizando", "a primeira ainda está com a vez");
});

// ------------------------------------------------------------------------------------------------ quem pode pedir

function supabaseFalso(rotas) {
  const f = async (url) => {
    for (const [padrao, resp] of rotas) if (String(url).includes(padrao)) return new Response(JSON.stringify(resp.body ?? resp), { status: resp.status ?? 200 });
    return new Response(JSON.stringify({ message: "nao esperado" }), { status: 500 });
  };
  return { url: "https://ref.supabase.co", anon: "anon", servico: "SERVICO", fetch: f };
}
const jwt = (carga) => `x.${Buffer.from(JSON.stringify(carga)).toString("base64url")}.y`;

test("quem pede: administrador (a regra das duas etapas) pelo painel, ou o pg_cron com o segredo dele; o resto não", async () => {
  const chamadas = [];
  const deps = {
    comBanco: async (fn) => {
      chamadas.push("banco");
      return fn({
        consulta: async (sql) => (/pg_has_role/.test(sql) ? [{ tabela: true, funcao: true }] : [{ r: { atualizar_sozinho: "desligada" } }]),
        executar: async () => undefined,
      });
    },
    fetch: async () => new Response("{}", { status: 500 }),
    cron: "segredo-do-cron",
  };
  const req = (corpo, headers = {}) => new Request("https://x/functions/v1/atualizar-nuvem", { method: "POST", headers, body: JSON.stringify(corpo) });
  const semLogin = supabaseFalso([["/auth/v1/user", { status: 401, body: {} }]]);
  assert.equal((await tratar(req({ acao: "atualizar" }), semLogin, deps)).status, 401);
  assert.equal((await tratar(req({ acao: "sozinho" }, { "x-reveza-cron": "errado" }), semLogin, deps)).status, 401);
  const leitor = supabaseFalso([["/auth/v1/user", { id: "l", email: "l@exemplo.com" }], ["servico_papel", "leitura"]]);
  assert.equal((await tratar(req({ acao: "atualizar" }, { authorization: `Bearer ${jwt({ aal: "aal2" })}` }), leitor, deps)).status, 403);
  const adminSemCodigo = supabaseFalso([["/auth/v1/user", { id: "a", email: "a@exemplo.com" }], ["servico_aal_ok", false], ["servico_papel", "admin"]]);
  assert.equal((await tratar(req({ acao: "atualizar" }, { authorization: `Bearer ${jwt({ aal: "aal1" })}` }), adminSemCodigo, deps)).status, 403);
  const admin = supabaseFalso([["/auth/v1/user", { id: "a", email: "a@exemplo.com" }], ["servico_papel", "admin"]]);
  assert.equal((await tratar(req({ acao: "outra" }, { authorization: `Bearer ${jwt({ aal: "aal2" })}` }), admin, deps)).status, 400);
  assert.deepEqual(chamadas, [], "ninguém de fora chegou ao banco");
  const cron = await tratar(req({ acao: "sozinho" }, { "x-reveza-cron": "segredo-do-cron" }), semLogin, deps);
  assert.equal(cron.status, 200);
  assert.deepEqual(await cron.json(), { ok: true, estado: "desligada" });
  const pedido = await tratar(req({ acao: "atualizar" }, { authorization: `Bearer ${jwt({ aal: "aal2" })}` }), admin, deps);
  assert.equal(pedido.status, 200);
  assert.equal((await pedido.json()).estado, "falhou", "o GitHub falso respondeu 500: falha com motivo, sem 500 da função");
});

test("a função publicada leva só o que precisa e não guarda token: o cliente Postgres do Edge Runtime e a conexão da plataforma", () => {
  const fonte = readFileSync(path.join(RAIZ, "nuvem", "funcoes", "atualizar-nuvem", "index.ts"), "utf8");
  assert.match(fonte, /from "jsr:@db\/postgres@0\.19\.5"/, "versão travada do cliente");
  assert.match(fonte, /SUPABASE_DB_URL/);
  assert.ok(!/SUPABASE_ACCESS_TOKEN|VERCEL_TOKEN|api\.supabase\.com/.test(fonte + readFileSync(path.join(RAIZ, "nuvem", "funcoes", "atualizar-nuvem", "logica.ts"), "utf8")));
});
