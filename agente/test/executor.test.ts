// O executor de verdade: no prazo, `arvore` mata também o que o programa abriu (o instalador abre o build do painel e a
// publicação; sem isso o neto seguia publicando sozinho e segurava a saída aberta até terminar).

import { test } from "node:test";
import assert from "node:assert/strict";
import { descendentes, executorReal } from "../src/util/executor.js";

test("descendentes: filhos e netos pela tabela do ps, sem o próprio processo nem os de fora", () => {
  const tabela = ["    1     0", "  100     1", "  200   100", "  201   100", "  300   200", "  400     1", "  500   500", ""].join("\n");
  assert.deepEqual(descendentes(tabela, 100), [200, 201, 300]);
  assert.deepEqual(descendentes(tabela, 300), []);
  assert.deepEqual(descendentes("", 100), []);
});

const vivo = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("no prazo, com arvore, o neto morre junto e o rodar volta logo", async () => {
  const neto = `setTimeout(() => {}, 60000)`;
  const filho = `const { spawn } = require("node:child_process");
const n = spawn(process.execPath, ["-e", ${JSON.stringify(neto)}], { stdio: "inherit" });
process.stdout.write(String(n.pid) + "\\n");
setTimeout(() => {}, 60000);`;
  const inicio = Date.now();
  const r = await executorReal.rodar([process.execPath, "-e", filho], { timeoutMs: 1500, arvore: true });
  assert.ok(Date.now() - inicio < 20_000, `voltou em ${Date.now() - inicio} ms`);
  const pid = Number(r.saida.trim().split(/\s+/)[0]);
  assert.ok(pid > 0, r.saida);
  for (let i = 0; i < 50 && vivo(pid); i++) await new Promise((ok) => setTimeout(ok, 100));
  assert.equal(vivo(pid), false, "o neto morreu");
});
