// A janela de confirmação da ligação em cada sistema, e o que conta como liberar, recusar e "sem tela".
import { test } from "node:test";
import assert from "node:assert/strict";
import { comandoDaJanela, pedirConfirmacao } from "../src/confirmar.js";
import { ExecutorFalso } from "./falsos.js";

test("cada sistema abre a sua janela, com o código; Linux sem tela não abre nada", () => {
  assert.equal(comandoDaJanela("macos", "K7Q2", "pt-BR")![0], "osascript");
  assert.ok(comandoDaJanela("macos", "K7Q2", "pt-BR")!.join(" ").includes("K7Q2"));
  assert.equal(comandoDaJanela("windows", "K7Q2", "en")![0], "powershell");
  assert.equal(comandoDaJanela("linux", "K7Q2", "pt-BR", { DISPLAY: ":0" })![0], "zenity");
  assert.equal(comandoDaJanela("linux", "K7Q2", "pt-BR", {}), null);
  assert.equal(comandoDaJanela("macos", 'K7"; do shell script "x', "pt-BR"), null, "código fora do formato não entra no comando");
});

test("o que cada resposta da janela quer dizer", async () => {
  const exec = new ExecutorFalso();
  const caso = async (sistema: "macos" | "windows" | "linux", r: { codigo: number; saida?: string; erro?: string }) => {
    exec.responder = () => ({ codigo: r.codigo, saida: r.saida ?? "", erro: r.erro ?? "" });
    return pedirConfirmacao(exec, sistema, "K7Q2", "pt-BR", { DISPLAY: ":0" });
  };
  assert.equal(await caso("macos", { codigo: 0, saida: "button returned:Liberar, gave up:false" }), "liberou");
  assert.equal(await caso("macos", { codigo: 0, saida: "button returned:, gave up:true" }), "recusou", "o tempo acabou");
  assert.equal(await caso("macos", { codigo: 1, erro: "User canceled." }), "recusou");
  assert.equal(await caso("macos", { codigo: 127, erro: "spawn osascript ENOENT" }), "sem_tela");
  assert.equal(await caso("windows", { codigo: 0, saida: "Yes" }), "liberou");
  assert.equal(await caso("windows", { codigo: 0, saida: "No" }), "recusou");
  assert.equal(await caso("linux", { codigo: 0 }), "liberou");
  assert.equal(await caso("linux", { codigo: 5 }), "recusou", "o tempo acabou");
  assert.equal(await caso("linux", { codigo: 127 }), "sem_tela");
  assert.equal(await pedirConfirmacao(exec, "linux", "K7Q2", "pt-BR", {}), "sem_tela");
});
