// A janela de liberar computador novo em cada sistema, e o que conta como liberar, código errado, recusar, sem
// resposta e "sem tela". O código (12 caracteres) aparece no computador novo; a janela só pede.
import { test } from "node:test";
import assert from "node:assert/strict";
import { comandoDaJanela, pedirConfirmacao } from "../src/confirmar.js";
import { ExecutorFalso } from "./falsos.js";

test("cada sistema abre a sua janela pedindo o código do computador novo (sem mostrá-lo); Linux sem tela não abre nada", () => {
  assert.equal(comandoDaJanela("macos", "pt-BR")![0], "osascript");
  assert.match(comandoDaJanela("macos", "pt-BR")!.join(" "), /default answer ""/);
  assert.match(comandoDaJanela("macos", "pt-BR")!.join(" "), /12 caracteres que aparece na tela do computador NOVO/);
  assert.match(comandoDaJanela("macos", "pt-BR", {}, true)!.join(" "), /não confere/);
  assert.equal(comandoDaJanela("windows", "en")![0], "powershell");
  assert.match(comandoDaJanela("windows", "en")!.join(" "), /InputBox/);
  assert.match(comandoDaJanela("windows", "en")!.join(" "), /12-character code shown on the NEW computer/);
  assert.deepEqual(comandoDaJanela("linux", "pt-BR", { DISPLAY: ":0" })!.slice(0, 2), ["zenity", "--entry"]);
  assert.equal(comandoDaJanela("linux", "pt-BR", {}), null);
});

test("o texto da janela é fixo: sem aspas que quebrem o AppleScript, e as do PowerShell dobradas", () => {
  for (const errou of [false, true]) {
    for (const idioma of ["pt-BR", "en"] as const) {
      const mac = comandoDaJanela("macos", idioma, {}, errou)![2]!;
      const dentro = /display dialog "(.*)" default answer/.exec(mac)![1]!;
      assert.ok(!dentro.replace(/" & return & "/g, "").includes('"'), "nenhuma aspa dupla solta no texto");
      const win = comandoDaJanela("windows", idioma, {}, errou)![4]!;
      // cada pedaço entre aspas simples tem as aspas internas dobradas
      for (const m of win.matchAll(/'((?:[^']|'')*)'/g)) assert.ok(!/(^|[^'])'([^']|$)/.test(m[1]!));
    }
  }
});

// desde a 0.4.0 o código não se calcula no computador que libera: quem confere é o verificador do pedido
const CERTO = (d: string) => d === "K7Q2M9XAPQRS";

test("só libera quem digita o código do computador novo; errado pergunta de novo; Recusar e tempo esgotado são diferentes", async () => {
  const exec = new ExecutorFalso();
  const caso = async (sistema: "macos" | "windows" | "linux", r: { codigo: number; saida?: string; erro?: string }) => {
    exec.responder = () => ({ codigo: r.codigo, saida: r.saida ?? "", erro: r.erro ?? "" });
    return pedirConfirmacao(exec, sistema, CERTO, "pt-BR", { DISPLAY: ":0" });
  };
  assert.equal(await caso("macos", { codigo: 0, saida: "button returned:Liberar, text returned:k7q2m9xapqrs, gave up:false" }), "liberou", "minúscula e sem hífen valem");
  assert.equal(await caso("macos", { codigo: 0, saida: "button returned:Liberar, text returned:K7Q2 M9XA PQRS, gave up:false" }), "liberou", "com espaço vale");
  assert.equal(await caso("macos", { codigo: 0, saida: "button returned:Liberar, text returned:, gave up:false" }), "errado", "clique sem digitar");
  assert.equal(await caso("macos", { codigo: 0, saida: "button returned:Liberar, text returned:AAAA-AAAA, gave up:false" }), "errado", "código errado");
  assert.equal(await caso("macos", { codigo: 0, saida: "button returned:Liberar, text returned:K7Q2-M9XA-PQR, gave up:false" }), "errado", "11 de 12 não bastam");
  assert.equal(await caso("macos", { codigo: 0, saida: "button returned:, text returned:K7Q2M9XAPQRS, gave up:true" }), "sem_resposta", "o tempo acabou");
  assert.equal(await caso("macos", { codigo: 1, erro: "execution error: User canceled. (-128)" }), "recusou");
  assert.equal(await caso("macos", { codigo: 1, erro: "algo diferente" }), "sem_resposta");
  assert.equal(await caso("macos", { codigo: 127, erro: "spawn osascript ENOENT" }), "sem_tela");
  assert.equal(await caso("windows", { codigo: 0, saida: "K7Q2-M9XA-PQRS\r\n" }), "liberou");
  assert.equal(await caso("windows", { codigo: 0, saida: "K7Q2M9XAPQRT\r\n" }), "errado");
  assert.equal(await caso("windows", { codigo: 0, saida: "" }), "recusou", "Cancelar devolve vazio");
  assert.equal(await caso("windows", { codigo: 1, saida: "" }), "sem_resposta", "o executor encerrou a janela esquecida");
  assert.equal(await caso("linux", { codigo: 0, saida: "k7q2-m9xa-pqrs\n" }), "liberou");
  assert.equal(await caso("linux", { codigo: 1 }), "recusou");
  assert.equal(await caso("linux", { codigo: 5 }), "sem_resposta", "o tempo acabou");
  assert.equal(await caso("linux", { codigo: 127 }), "sem_tela");
  assert.equal(await pedirConfirmacao(exec, "linux", CERTO, "pt-BR", {}), "sem_tela");
  // o que não tem 12 letras e números (o código de 8 da versão 2, por exemplo) nem chega à conferência (um scrypt)
  let conferidas = 0;
  exec.responder = () => ({ codigo: 0, saida: "K7Q2M9XA\r\n", erro: "" });
  assert.equal(await pedirConfirmacao(exec, "windows", (d) => (conferidas++, CERTO(d)), "pt-BR"), "errado");
  assert.equal(conferidas, 0);
});

test("a janela de confirmação roda sem ser escondida (no Windows, esconder o PowerShell esconde a InputBox junto)", async () => {
  const exec = new ExecutorFalso();
  const opcoes: unknown[] = [];
  exec.rodar = async (argv, op = {}) => {
    exec.chamadas.push({ argv });
    opcoes.push(op);
    return { codigo: 0, saida: "K7Q2M9XAPQRS\r\n", erro: "" };
  };
  assert.equal(await pedirConfirmacao(exec, "windows", CERTO, "en"), "liberou");
  assert.equal((opcoes[0] as { janela?: boolean }).janela, true);
});
