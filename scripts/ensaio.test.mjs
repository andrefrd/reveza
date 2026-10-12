import { test } from "node:test";
import assert from "node:assert/strict";
import { ensaioVale, FLUXOS, repositorioDoOrigin, soDocumentacao } from "./ensaio.mjs";

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
    assert.match(y, /workflow_dispatch:\s*\n\s*inputs:\s*\n\s*ensaio:/, `${f} aceita o ensaio`);
    assert.match(y, /gist\.githubusercontent\.com\/\$DONO\//, `${f} só aceita gist do dono do repositório`);
  }
});
