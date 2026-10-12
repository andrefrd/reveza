// A prova final espera a conta que a nuvem mandou chegar ao assistente antes de conferir (sem esperar à toa).
import { test } from "node:test";
import assert from "node:assert/strict";
import { esperarConta } from "../lib/prova.mjs";

const sem = async () => undefined;

test("espera enquanto o agente diz que a conta está a caminho, e para quando ela chega", async () => {
  const estados = [{ credencial: { esperandoConta: true } }, { credencial: { esperandoConta: true } }, { credencial: { esperandoConta: false } }];
  let i = 0;
  const r = await esperarConta(() => estados[i++], { dormir: sem, passoMs: 2000 });
  assert.deepEqual(r, { esperou: 4, chegou: true });
  assert.equal(i, 3);
});

test("sem conta a caminho (ou agente antigo, ou parado): não espera nada", async () => {
  for (const e of [{ credencial: { esperandoConta: false } }, { contas: [] }, null]) {
    let dormiu = 0;
    const r = await esperarConta(() => e, { dormir: async () => void dormiu++ });
    assert.deepEqual(r, { esperou: 0, chegou: false });
    assert.equal(dormiu, 0);
  }
});

test("a conta não chega: desiste em 60 s e deixa o doctor dizer o que fazer", async () => {
  let lidas = 0;
  const r = await esperarConta(() => (lidas++, { credencial: { esperandoConta: true } }), { dormir: sem, passoMs: 2000 });
  assert.deepEqual(r, { esperou: 60, chegou: false });
  assert.equal(lidas, 31);
});
