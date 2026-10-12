#!/usr/bin/env node
// A versão do Reveza anda junta: package.json (raiz, agente e painel), as travas do npm, o VERSAO do agente, os badges
// do README e a primeira entrada do CHANGELOG. Pedido do Paulo (12/10/2026): toda correção vai ao repositório com
// versão nova e release no GitHub.
//
//   node scripts/versao.mjs conferir          tudo na mesma versão (o npm test roda)
//   node scripts/versao.mjs lancar 0.1.2      sobe a versão (a entrada da CHANGELOG já precisa estar escrita), commita,
//                                             publica, marca a tag e cria a release com o texto da CHANGELOG
//   node scripts/versao.mjs pre-push          (hook .githooks/pre-push) recusa empurrar para a main código mudado desde
//                                             a última versão sem subir a versão

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACOTES = ["package.json", "agente/package.json", "painel/package.json"];
const TRAVAS = ["package-lock.json", "agente/package-lock.json", "painel/package-lock.json"];
const CONFIG = "agente/src/config.ts";
const BADGES = [
  ["README.md", (v) => `vers%C3%A3o-${v}-`, (v) => `alt="Versão ${v}"`],
  ["README.en.md", (v) => `version-${v}-`, (v) => `alt="Version ${v}"`],
];
/** Mudança nestas pastas é mudança no que se instala: pede versão nova. Documentação não pede. */
export const CODIGO = ["agente/", "painel/", "nuvem/", "instalador/", "mod/", ".claude-plugin/", "package.json", "package-lock.json"];

const ler = (f) => readFileSync(path.join(RAIZ, f), "utf8");
const git = (...a) => execFileSync("git", a, { cwd: RAIZ, encoding: "utf8" }).trim();

export const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function maior(a, b) {
  const x = SEMVER.exec(a).slice(1).map(Number);
  const y = SEMVER.exec(b).slice(1).map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/** A primeira entrada da CHANGELOG: "## X.Y.Z · DD/MM/AAAA". */
export function primeiraDoChangelog(texto) {
  return /^## (\d+\.\d+\.\d+) · \d{2}\/\d{2}\/\d{4}$/m.exec(texto)?.[1] ?? null;
}

/** O texto de uma versão na CHANGELOG (vira a nota da release). */
export function secaoDoChangelog(texto, v) {
  const i = texto.indexOf(`## ${v} · `);
  if (i < 0) return null;
  const corpo = texto.slice(texto.indexOf("\n", i) + 1);
  const fim = corpo.search(/^## \d+\.\d+\.\d+ · /m);
  return (fim < 0 ? corpo : corpo.slice(0, fim)).trim();
}

/** Precisa de versão nova? Só quando código mudou desde a última tag e a versão ainda é a da tag. */
export function precisaVersao(mudados, versaoAtual, versaoDaTag) {
  const mexeuEmCodigo = mudados.some((f) => CODIGO.some((c) => (c.endsWith("/") ? f.startsWith(c) : f === c)));
  return mexeuEmCodigo && versaoAtual === versaoDaTag;
}

export function versoes() {
  const r = {};
  for (const f of PACOTES) r[f] = JSON.parse(ler(f)).version;
  for (const f of TRAVAS) {
    const t = JSON.parse(ler(f));
    r[f] = t.version;
    r[`${f} (packages[""])`] = t.packages?.[""]?.version;
  }
  r[CONFIG] = /export const VERSAO = "([^"]+)"/.exec(ler(CONFIG))?.[1];
  for (const [f, badge] of BADGES) {
    const m = new RegExp(badge("(\\d+\\.\\d+\\.\\d+)")).exec(ler(f));
    r[`${f} (badge)`] = m?.[1];
  }
  for (const [f] of BADGES) {
    const m = /archive\/refs\/tags\/v(\d+\.\d+\.\d+)\.tar\.gz/.exec(ler(f));
    if (m) r[`${f} (pacote da versão)`] = m[1];
  }
  r["CHANGELOG.md"] = primeiraDoChangelog(ler("CHANGELOG.md"));
  return r;
}

/**
 * Tudo na mesma versão. A CHANGELOG pode estar uma versão à frente: é o momento entre escrever a entrada nova e rodar o
 * `lancar`. Devolve a versão dos pacotes.
 */
export function conferir(v = versoes()) {
  const { "CHANGELOG.md": changelog, ...resto } = v;
  const unicas = [...new Set(Object.values(resto))];
  const ok = unicas.length === 1 && SEMVER.test(unicas[0] ?? "") && SEMVER.test(changelog ?? "") && (changelog === unicas[0] || maior(changelog, unicas[0]));
  if (!ok) {
    for (const [f, x] of Object.entries(v)) console.error(`  ${String(x).padEnd(8)} ${f}`);
    throw new Error("as versões não batem (escreva a CHANGELOG e rode node scripts/versao.mjs lancar X.Y.Z)");
  }
  return unicas[0];
}

function trocar(f, de, para) {
  const t = ler(f);
  if (!t.includes(de)) throw new Error(`não achei ${de} em ${f}`);
  writeFileSync(path.join(RAIZ, f), t.replace(de, para));
}

function lancar(nova) {
  if (!SEMVER.test(nova || "")) throw new Error("uso: node scripts/versao.mjs lancar X.Y.Z");
  if (git("status", "--porcelain", "--untracked-files=no")) throw new Error("há mudança sem commit: commite (com pathspec) antes de lançar");
  const atual = conferir();
  if (!maior(nova, atual)) throw new Error(`${nova} precisa ser maior que ${atual}`);
  const changelog = ler("CHANGELOG.md");
  if (primeiraDoChangelog(changelog) !== nova) throw new Error(`escreva antes a entrada "## ${nova} · DD/MM/AAAA" no topo da CHANGELOG.md e commite`);
  const notas = secaoDoChangelog(changelog, nova);
  if (!notas) throw new Error("a entrada da CHANGELOG está vazia");
  for (const f of PACOTES) trocar(f, `"version": "${atual}"`, `"version": "${nova}"`);
  for (const f of TRAVAS) {
    const t = JSON.parse(ler(f));
    t.version = nova;
    if (t.packages?.[""]) t.packages[""].version = nova;
    writeFileSync(path.join(RAIZ, f), JSON.stringify(t, null, 2) + "\n");
  }
  trocar(CONFIG, `export const VERSAO = "${atual}";`, `export const VERSAO = "${nova}";`);
  for (const [f, badge, alt] of BADGES) {
    trocar(f, badge(atual), badge(nova));
    trocar(f, alt(atual), alt(nova));
    const t = ler(f);
    writeFileSync(path.join(RAIZ, f), t.replaceAll(`archive/refs/tags/v${atual}.tar.gz`, `archive/refs/tags/v${nova}.tar.gz`));
  }
  const depois = versoes();
  if (conferir(depois) !== nova || depois["CHANGELOG.md"] !== nova) throw new Error("a troca de versão não fechou");
  const arquivos = [...PACOTES, ...TRAVAS, CONFIG, ...BADGES.map(([f]) => f)];
  // título da release: a primeira frase da entrada (o resto vai nas notas)
  const titulo = notas.split("\n")[0].split(/\.\s/)[0].replace(/[.:]$/, "").slice(0, 80);
  git("commit", "-q", "-m", `chore: versão ${nova}\n\n${titulo}\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, "--", ...arquivos);
  execFileSync(process.execPath, ["scripts/trava.mjs", "--historia"], { cwd: RAIZ, stdio: "inherit" });
  git("push", "-q", "origin", "main");
  git("tag", "-a", `v${nova}`, "-m", `Reveza AI ${nova}`);
  git("push", "-q", "origin", `v${nova}`);
  execFileSync("gh", ["release", "create", `v${nova}`, "-R", "dantaspaulo/reveza", "--title", `Reveza AI ${nova}: ${titulo}`, "--notes", notas, "--latest"], {
    cwd: RAIZ,
    stdio: "inherit",
  });
  console.log(`ok: versão ${nova} no repositório, com tag e release`);
}

/** Hook de pre-push: o git passa "<ref local> <sha local> <ref remota> <sha remota>" por linha no stdin. */
function prePush() {
  let entrada = "";
  try {
    entrada = readFileSync(0, "utf8");
  } catch {
    return;
  }
  for (const linha of entrada.split("\n").filter(Boolean)) {
    const [, sha, ref] = linha.split(" ");
    if (ref !== "refs/heads/main" || /^0+$/.test(sha)) continue;
    let tag;
    try {
      tag = git("describe", "--tags", "--abbrev=0", "--match", "v*", sha);
    } catch {
      continue; // sem versão ainda
    }
    const mudados = git("diff", "--name-only", `${tag}..${sha}`).split("\n").filter(Boolean);
    const atual = JSON.parse(git("show", `${sha}:package.json`)).version;
    if (precisaVersao(mudados, atual, tag.replace(/^v/, ""))) {
      console.error(`\nRECUSADO: há mudança no que se instala desde ${tag} e a versão continua ${atual}.`);
      console.error("Escreva a entrada nova no topo da CHANGELOG.md, commite e rode: node scripts/versao.mjs lancar X.Y.Z\n");
      process.exit(1);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const cmd = process.argv[2];
    if (cmd === "conferir") console.log(`ok: tudo na versão ${conferir()}`);
    else if (cmd === "lancar") lancar(process.argv[3]);
    else if (cmd === "pre-push") prePush();
    else throw new Error("uso: node scripts/versao.mjs conferir | lancar X.Y.Z | pre-push");
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
