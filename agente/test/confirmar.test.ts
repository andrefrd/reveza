// A janela de confirmação da ligação em cada sistema, e o que conta como liberar, recusar e "sem tela".
import { test } from "node:test";
import assert from "node:assert/strict";
import { comandoDaJanela, pedirConfirmacao } from "../src/confirmar.js";
import { ExecutorFalso } from "./falsos.js";

test("cada sistema abre a sua janela pedindo o código (sem mostrá-lo); Linux sem tela não abre nada", () => {
  assert.equal(comandoDaJanela("macos", "pt-BR")![0], "osascript");
  assert.match(comandoDaJanela("macos", "pt-BR")!.join(" "), /default answer ""/);
  assert.equal(comandoDaJanela("windows", "en")![0], "powershell");
  assert.match(comandoDaJanela("windows", "en")!.join(" "), /InputBox/);
  assert.deepEqual(comandoDaJanela("linux", "pt-BR", { DISPLAY: ":0" })!.slice(0, 2), ["zenity", "--entry"]);
  assert.equal(comandoDaJanela("linux", "pt-BR", {}), null);
});

test("só libera quem digita o código do painel; clique sem o código, código errado ou tempo esgotado recusam", async () => {
  const exec = new ExecutorFalso();
  const caso = async (sistema: "macos" | "windows" | "linux", r: { codigo: number; saida?: string; erro?: string }) => {
    exec.responder = () => ({ codigo: r.codigo, saida: r.saida ?? "", erro: r.erro ?? "" });
    return pedirConfirmacao(exec, sistema, "K7Q2", "pt-BR", { DISPLAY: ":0" });
  };
  assert.equal(await caso("macos", { codigo: 0, saida: "button returned:Liberar, text returned:k7q2, gave up:false" }), "liberou", "minúscula vale");
  assert.equal(await caso("macos", { codigo: 0, saida: "button returned:Liberar, text returned:, gave up:false" }), "recusou", "clique sem digitar");
  assert.equal(await caso("macos", { codigo: 0, saida: "button returned:Liberar, text returned:AAAA, gave up:false" }), "recusou", "código errado");
  assert.equal(await caso("macos", { codigo: 0, saida: "button returned:, text returned:K7Q2, gave up:true" }), "recusou", "o tempo acabou");
  assert.equal(await caso("macos", { codigo: 1, erro: "User canceled." }), "recusou");
  assert.equal(await caso("macos", { codigo: 127, erro: "spawn osascript ENOENT" }), "sem_tela");
  assert.equal(await caso("windows", { codigo: 0, saida: "K7Q2\r\n" }), "liberou");
  assert.equal(await caso("windows", { codigo: 0, saida: "" }), "recusou", "Cancelar devolve vazio");
  assert.equal(await caso("linux", { codigo: 0, saida: "k7q2\n" }), "liberou");
  assert.equal(await caso("linux", { codigo: 5 }), "recusou", "o tempo acabou");
  assert.equal(await caso("linux", { codigo: 127 }), "sem_tela");
  assert.equal(await pedirConfirmacao(exec, "linux", "K7Q2", "pt-BR", {}), "sem_tela");
});
