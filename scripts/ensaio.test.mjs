import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ARGS_DO_DIFF, chamadoDireto, ensaioVale, execucaoDoEnsaio, FLUXOS, repositorioDoOrigin, soDocumentacao } from "./ensaio.mjs";

test("documentação e imagens não pedem ensaio; código, testes, scripts e travas pedem", () => {
  assert.equal(soDocumentacao(["README.md", "README.en.md", "docs/ARQUITETURA.md", "docs/imagens/pt/visao.webp"]), true);
  assert.equal(soDocumentacao(["README.md", "agente/src/ligar.ts"]), false);
  assert.equal(soDocumentacao(["scripts/e2e-windows.mjs"]), false, "o teste do Windows mudou: precisa de ensaio");
  assert.equal(soDocumentacao(["package-lock.json"]), false);
  assert.equal(soDocumentacao([]), false, "nada mudado não é 'só documentação'");
});

test("o ensaio vale só para a mesma árvore (ou a de antes do commit de versão)", () => {
  const a = "a".repeat(40);
  const b = "b".repeat(40);
  assert.equal(ensaioVale(`${a} 2026-10-12T12:00:00Z ${"c".repeat(40)}`, [a]), true);
  assert.equal(ensaioVale(`${a} 2026-10-12T12:00:00Z`, [b, a]), true, "a árvore de antes do commit de versão vale");
  assert.equal(ensaioVale(`${a} 2026-10-12T12:00:00Z`, [b]), false, "mudou depois do ensaio: ensaia de novo");
  assert.equal(ensaioVale(null, [a]), false);
  assert.equal(ensaioVale("qualquer coisa", ["qualquer"]), false);
});

test("o ensaio roda no repositório do origin (projeto oficial ou fork)", () => {
  assert.equal(repositorioDoOrigin("git@github.com:dantaspaulo/reveza.git"), "dantaspaulo/reveza");
  assert.equal(repositorioDoOrigin("https://github.com/fulana/reveza"), "fulana/reveza");
  assert.equal(repositorioDoOrigin("https://github.com/fulana/reveza.git/"), "fulana/reveza");
  assert.equal(repositorioDoOrigin("https://gitlab.com/fulana/reveza.git"), null);
});

test("os três testes do GitHub entram no ensaio, e cada fluxo aceita o ensaio pelo gist do dono", async () => {
  const { readFileSync } = await import("node:fs");
  assert.deepEqual(FLUXOS, ["instalar.yml", "windows.yml", "e2e.yml"]);
  for (const f of FLUXOS) {
    const y = readFileSync(new URL(`../.github/workflows/${f}`, import.meta.url), "utf8");
    assert.match(y, /workflow_dispatch:\s*\n\s*inputs:\s*\n\s*id:[\s\S]*?\n\s*ensaio:/, `${f} aceita o id e o ensaio`);
    assert.match(y, /^run-name: \$\{\{ inputs\.id && format\('ensaio \{0\}', inputs\.id\) \|\| '' \}\}$/m, `${f} dá o nome "ensaio <id>"`);
    assert.ok(y.includes("[ \"${BASH_REMATCH[1]}\" = \"$DONO\" ]"), `${f} só aceita gist do dono do repositório`);
    assert.ok(y.includes("curl -fsS --proto =https --max-redirs 0"), `${f} não segue redirecionamento`);
  }
});

test("a expressão do gist dos fluxos recusa outro usuário, '..', '@' e consulta", () => {
  const y = readFileSync(new URL("../.github/workflows/e2e.yml", import.meta.url), "utf8");
  const G = new RegExp(/G='([^']+)'/.exec(y)[1]);
  const H = "a".repeat(40);
  const I = "b".repeat(32);
  const dono = (u) => G.exec(u)?.[1] ?? null;
  assert.equal(dono(`https://gist.githubusercontent.com/dantaspaulo/${I}/raw/${H}/ensaio.txt`), "dantaspaulo");
  assert.equal(dono(`https://gist.githubusercontent.com/dantaspaulo/../outro/${I}/raw/${H}/x`), null);
  assert.equal(dono(`https://gist.githubusercontent.com/dantaspaulo@x.com/${I}/raw/${H}/x`), null);
  assert.equal(dono(`https://gist.githubusercontent.com/dantaspaulo/${I}/raw/${H}/x?y=1`), null);
  assert.equal(dono(`https://gist.githubusercontent.com/outro/${I}/raw/${H}/x`), "outro", "o fluxo confere o dono depois");
});

test("chamado direto: vale em pasta com espaço e acento (antes, saía com sucesso sem fazer nada)", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "reveza ensaio "));
  try {
    const pasta = path.join(dir, "Código dir");
    mkdirSync(pasta);
    const arq = path.join(pasta, "x.mjs");
    writeFileSync(arq, "");
    assert.equal(chamadoDireto(pathToFileURL(arq).href, arq), true);
    assert.equal(chamadoDireto(pathToFileURL(arq).href, path.join(pasta, "outro.mjs")), false);
    assert.equal(chamadoDireto(pathToFileURL(arq).href, undefined), false);
    // e de verdade: o script sai com o erro dele, não com sucesso calado
    writeFileSync(arq, `import { chamadoDireto } from ${JSON.stringify(pathToFileURL(path.resolve("scripts/ensaio.mjs")).href)};\nif (chamadoDireto(import.meta.url)) process.exit(7);\n`);
    let codigo = 0;
    try {
      execFileSync(process.execPath, [arq], { stdio: "ignore" });
    } catch (e) {
      codigo = e.status;
    }
    assert.equal(codigo, 7);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a execução do ensaio é a que tem o nome dele, não a mais recente", () => {
  const lista = [
    { databaseId: 3, displayTitle: "ensaio outro" },
    { databaseId: 2, displayTitle: "ensaio abc123" },
    { databaseId: 1, displayTitle: "Ponta a ponta" },
  ];
  assert.equal(execucaoDoEnsaio(lista, "abc123"), 2);
  assert.equal(execucaoDoEnsaio(lista, "zzz"), null);
  assert.equal(execucaoDoEnsaio(null, "abc123"), null);
});

test("o patch do ensaio leva arquivo binário e ignora a configuração de git da pessoa", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "reveza-diff-"));
  const g = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    const a = path.join(dir, "a");
    mkdirSync(a);
    g(a, "init", "-q");
    g(a, "config", "user.email", "t@exemplo.invalid");
    g(a, "config", "user.name", "t");
    writeFileSync(path.join(a, "t.txt"), "um\n");
    writeFileSync(path.join(a, "i.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
    g(a, "add", "-A");
    g(a, "commit", "-q", "-m", "base");
    const base = g(a, "rev-parse", "HEAD").trim();
    g(dir, "clone", "-q", a, "b");
    writeFileSync(path.join(a, "t.txt"), "dois\n");
    writeFileSync(path.join(a, "i.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 9, 9, 9, 9]));
    g(a, "commit", "-qam", "muda");
    // a configuração de quem roda o ensaio (cor sempre, sem prefixo) não entra no patch
    g(a, "config", "color.diff", "always");
    g(a, "config", "diff.noprefix", "true");
    const patch = execFileSync("git", [...ARGS_DO_DIFF, base, "HEAD"], { cwd: a });
    const b = path.join(dir, "b");
    execFileSync("git", ["apply", "--whitespace=nowarn"], { cwd: b, input: patch });
    assert.equal(readFileSync(path.join(b, "t.txt"), "utf8"), "dois\n");
    assert.deepEqual([...readFileSync(path.join(b, "i.png"))], [0x89, 0x50, 0x4e, 0x47, 0, 9, 9, 9, 9]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
