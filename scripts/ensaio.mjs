#!/usr/bin/env node
// Ensaio antes de publicar: nenhuma execução vermelha no GitHub depois do envio. Pedido do Paulo (12/10/2026): "não pode
// ter falha ali... corrija sempre... mas não desligue os testes".
//
//   node scripts/ensaio.mjs
//
// 1. Roda aqui, primeiro, tudo o que dá para rodar no Mac: os testes da raiz, do agente, da nuvem e do painel (tsc e
//    vitest). Falhou aqui, nada vai ao GitHub.
// 2. Leva a mudança ainda não publicada (git diff origin/main) para os três testes do GitHub que este Mac não roda
//    (instalação nos três sistemas, Windows de verdade e ponta a ponta), por um gist secreto do dono, apagado no fim.
// 3. Tudo verde: anota a árvore do HEAD em .git/reveza-ensaio. O `lancar` e o pre-push da main só aceitam envio de
//    código com o ensaio verde da mesma árvore (ou da árvore de antes do commit de versão).
//
// A 0.2.0 saiu sem o ensaio no Windows e o teste da janela ficou vermelho depois do lançamento; a 762aa80 subiu sem
// passar no Windows. Este roteiro existe para isso não repetir.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FLUXOS = ["instalar.yml", "windows.yml", "e2e.yml"];

/** dono/repositório do `origin` (o projeto oficial ou um fork: o ensaio roda no repositório de quem publica). */
export function repositorioDoOrigin(url) {
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(String(url || "").trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/** Arquivos que não mudam o que os testes provam: só documentação e imagens. */
export function soDocumentacao(arquivos) {
  return arquivos.length > 0 && arquivos.every((f) => /\.(md|png|jpe?g|webp|gif|svg)$/i.test(f) || f.startsWith("docs/"));
}

/** O ensaio anotado vale para esta árvore? Vale para a própria e para a de antes do commit de versão do `lancar`. */
export function ensaioVale(anotado, arvores) {
  if (!anotado) return false;
  const a = String(anotado).split(/\s+/)[0];
  return /^[0-9a-f]{40}$/.test(a) && arvores.includes(a);
}

export function arquivoDoEnsaio(raiz = RAIZ) {
  return path.join(raiz, ".git", "reveza-ensaio");
}

export function lerEnsaio(raiz = RAIZ) {
  const f = arquivoDoEnsaio(raiz);
  return existsSync(f) ? readFileSync(f, "utf8").trim() : null;
}

const git = (...a) => execFileSync("git", a, { cwd: RAIZ, encoding: "utf8" }).trim();
const gh = (...a) => execFileSync("gh", a, { cwd: RAIZ, encoding: "utf8" }).trim();
// o Node da pessoa; num Mac com o Node 22 do Homebrew ao lado de um mais novo, usa o 22 (o projeto é provado nele)
const NODE22 = ["/opt/homebrew/opt/node@22/bin", "/usr/local/opt/node@22/bin"].find((d) => existsSync(d)) ?? null;

function rodarAqui(nome, cmd, args, cwd) {
  process.stdout.write(`· ${nome}... `);
  const env = NODE22 ? { ...process.env, PATH: `${NODE22}${path.delimiter}${process.env.PATH}` } : process.env;
  const r = spawnSync(cmd, args, { cwd: path.join(RAIZ, cwd), env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.log("FALHOU");
    console.error(((r.stdout || "") + (r.stderr || "")).slice(-3000));
    throw new Error(`${nome} falhou aqui: nada foi ao GitHub`);
  }
  console.log("ok");
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function principal() {
  if (git("status", "--porcelain", "--untracked-files=no")) throw new Error("há mudança sem commit: commite (com pathspec) antes do ensaio");
  const arvore = git("rev-parse", "HEAD^{tree}");
  const REPO = repositorioDoOrigin(git("remote", "get-url", "origin"));
  if (!REPO) throw new Error("o origin não é um repositório do GitHub: o ensaio roda nos testes do GitHub do projeto");
  // 1. aqui
  rodarAqui("testes da raiz", "npm", ["test"], ".");
  rodarAqui("testes do agente", "npm", ["test"], "agente");
  rodarAqui("testes da nuvem", "npm", ["test"], "nuvem");
  rodarAqui("painel: tipos", "npx", ["tsc", "-b", "--noEmit"], "painel");
  rodarAqui("painel: testes", "npx", ["vitest", "run"], "painel");
  // 2. no GitHub
  git("fetch", "-q", "origin");
  const diff = execFileSync("git", ["diff", "origin/main", "HEAD"], { cwd: RAIZ, maxBuffer: 256 * 1024 * 1024 });
  let gist = null;
  let ensaio = "";
  if (diff.length) {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "reveza-ensaio-"));
    const arq = path.join(tmp, "ensaio.txt");
    writeFileSync(arq, gzipSync(diff, { level: 9 }).toString("base64"));
    const url = gh("gist", "create", "--desc", "Reveza: ensaio antes de publicar (apagado no fim)", arq).split(/\s+/).pop();
    rmSync(tmp, { recursive: true, force: true });
    gist = url.split("/").pop();
    ensaio = gh("api", `gists/${gist}`, "--jq", ".files | to_entries[0].value.raw_url");
  }
  try {
    const desde = new Date(Date.now() - 5000).toISOString();
    for (const f of FLUXOS) gh("workflow", "run", f, "-R", REPO, "-f", `ensaio=${ensaio}`);
    // acha as execuções disparadas agora (uma por fluxo)
    const ids = {};
    for (let i = 0; i < 30 && Object.keys(ids).length < FLUXOS.length; i++) {
      await esperar(4000);
      for (const f of FLUXOS) {
        if (ids[f]) continue;
        const l = JSON.parse(gh("run", "list", "-R", REPO, "-w", f, "-e", "workflow_dispatch", "-L", "3", "--json", "databaseId,createdAt"));
        const r = l.find((x) => x.createdAt >= desde);
        if (r) ids[f] = r.databaseId;
      }
    }
    if (Object.keys(ids).length < FLUXOS.length) throw new Error("não achei as execuções do ensaio no GitHub");
    console.log(`· GitHub: ${FLUXOS.map((f) => `${f} #${ids[f]}`).join(", ")} (uns 10 minutos)`);
    const falhas = [];
    for (const f of FLUXOS) {
      const r = spawnSync("gh", ["run", "watch", String(ids[f]), "-R", REPO, "--exit-status", "--interval", "30"], { cwd: RAIZ, stdio: "ignore" });
      if (r.status !== 0) falhas.push(`${f}: https://github.com/${REPO}/actions/runs/${ids[f]}`);
    }
    if (falhas.length) throw new Error(`o ensaio ficou vermelho no GitHub (nada foi publicado):\n  ${falhas.join("\n  ")}`);
  } finally {
    if (gist) spawnSync("gh", ["gist", "delete", gist, "--yes"], { cwd: RAIZ, stdio: "ignore" });
  }
  // 3. anota
  writeFileSync(arquivoDoEnsaio(), `${arvore} ${new Date().toISOString()} ${git("rev-parse", "HEAD")}\n`);
  console.log(`ok: ensaio verde aqui e no GitHub para a árvore ${arvore.slice(0, 12)}; pode publicar`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  principal().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
