// Som da troca de conta: toca o som do sistema quando ESTE computador troca, nunca em sombra nem com o som desligado,
// e o comando reveza som liga, desliga e testa pela ponte local.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { comandosDoSom, tocarSom } from "../src/som.js";
import { ativaEm, contaEstacionada, ExecutorFalso, montar, type Montado } from "./falsos.js";

let m: Montado;
afterEach(() => m?.limpar());
const tick = async (n = 20) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};
const sons = (x: ExecutorFalso) => x.chamadas.filter((c) => ["afplay", "paplay", "canberra-gtk-play", "powershell"].includes(c.argv[0]!));

test("a troca toca o som do sistema", async () => {
  const exec = new ExecutorFalso();
  m = await montar({ exec });
  await ativaEm(m, "A", 96);
  const b = contaEstacionada(m, "B", 3);
  const r = await m.agente.trocador.trocar(b, "teste");
  assert.ok(r.ok, r.erro);
  await tick();
  assert.deepEqual(sons(exec).map((c) => c.argv), [["afplay", "/System/Library/Sounds/Glass.aiff"]]);
});

test("som desligado não toca; reveza som liga, desliga e testa pela ponte", async () => {
  const exec = new ExecutorFalso();
  m = await montar({ exec });
  const ponte = (m.agente as unknown as { alvoPonte(): { som(c: Record<string, unknown>): Promise<{ corpo: unknown }> } }).alvoPonte();
  assert.deepEqual((await ponte.som({ ligado: false })).corpo, { ok: true, ligado: false, tocou: null });
  assert.equal(m.agente.estado.config.som, false);
  await ativaEm(m, "A", 96);
  const b = contaEstacionada(m, "B", 3);
  assert.ok((await m.agente.trocador.trocar(b, "teste")).ok);
  await tick();
  assert.equal(sons(exec).length, 0, "desligado não toca");
  // testar toca mesmo desligado (é o botão de ouvir)
  assert.deepEqual((await ponte.som({ testar: true })).corpo, { ok: true, ligado: false, tocou: true });
  assert.equal(sons(exec).length, 1);
  assert.deepEqual((await ponte.som({ ligado: true })).corpo, { ok: true, ligado: true, tocou: null });
});

test("em modo sombra a troca não acontece de verdade, então não toca", async () => {
  const exec = new ExecutorFalso();
  m = await montar({ exec, sombra: true });
  await ativaEm(m, "A", 96);
  const b = contaEstacionada(m, "B", 3);
  await m.agente.trocador.trocar(b, "teste");
  await tick();
  assert.equal(sons(exec).length, 0);
});

test("cada sistema tem o seu tocador; no Linux, se o primeiro falha, tenta o próximo; sem nenhum, só não toca", async () => {
  assert.equal(comandosDoSom("macos")[0]![0], "afplay");
  assert.equal(comandosDoSom("windows")[0]![0], "powershell");
  assert.deepEqual(comandosDoSom("linux").map((c) => c[0]), ["paplay", "canberra-gtk-play"]);
  const exec = new ExecutorFalso();
  exec.responder = (argv) => (argv[0] === "paplay" ? { codigo: 127, saida: "", erro: "não existe" } : { codigo: 0, saida: "", erro: "" });
  assert.equal(await tocarSom(exec, "linux"), true);
  assert.deepEqual(exec.chamadas.map((c) => c.argv[0]), ["paplay", "canberra-gtk-play"]);
  const mudo = new ExecutorFalso();
  mudo.responder = () => ({ codigo: 127, saida: "", erro: "não existe" });
  assert.equal(await tocarSom(mudo, "linux"), false);
});
