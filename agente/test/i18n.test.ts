// O idioma do que o agente mostra: o da instalação (instalacao.json), o REVEZA_IDIOMA do instalador ou o --idioma.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { idiomaAtual, idiomaDaInstalacao, normalizarIdioma, resolverIdioma, t, usarIdioma } from "../src/i18n.js";
import { pastaTemporaria } from "./falsos.js";

let tmp: ReturnType<typeof pastaTemporaria>;
afterEach(() => {
  tmp?.limpar();
  usarIdioma("pt-BR");
});

test("en e en-US viram inglês; o resto (e nada) fica no português", () => {
  for (const [pedido, idioma] of [["en", "en"], ["en-US", "en"], ["pt", "pt-BR"], ["pt-BR", "pt-BR"], ["es", "pt-BR"], [undefined, "pt-BR"], [1, "pt-BR"]] as const) {
    assert.equal(normalizarIdioma(pedido), idioma, String(pedido));
  }
  assert.equal(t("oi", "hi"), "oi");
  usarIdioma("en");
  assert.equal(idiomaAtual(), "en");
  assert.equal(t("oi", "hi"), "hi");
});

test("o idioma da instalação: o campo do instalacao.json; sem ele (versão antiga) ou sem arquivo, português", () => {
  tmp = pastaTemporaria();
  fs.mkdirSync(tmp.c.base, { recursive: true });
  const arq = path.join(tmp.c.base, "instalacao.json");
  assert.equal(idiomaDaInstalacao(tmp.c), "pt-BR", "sem arquivo");
  fs.writeFileSync(arq, JSON.stringify({ versao: "0.4.6" }));
  assert.equal(idiomaDaInstalacao(tmp.c), "pt-BR", "sem o campo");
  fs.writeFileSync(arq, JSON.stringify({ idioma: "en" }));
  assert.equal(idiomaDaInstalacao(tmp.c), "en");
  fs.writeFileSync(arq, "{ quebrado");
  assert.equal(idiomaDaInstalacao(tmp.c), "pt-BR", "arquivo ilegível não derruba");
});

test("--idioma vence o REVEZA_IDIOMA, que vence a instalação; o LANG não decide", () => {
  tmp = pastaTemporaria();
  fs.mkdirSync(tmp.c.base, { recursive: true });
  fs.writeFileSync(path.join(tmp.c.base, "instalacao.json"), JSON.stringify({ idioma: "en" }));
  assert.equal(resolverIdioma(undefined, {}, tmp.c), "en");
  assert.equal(resolverIdioma(undefined, { REVEZA_IDIOMA: "pt-BR" }, tmp.c), "pt-BR");
  assert.equal(resolverIdioma("pt", { REVEZA_IDIOMA: "en" }, tmp.c), "pt-BR");
  assert.equal(resolverIdioma(true, { REVEZA_IDIOMA: "en" }, tmp.c), "en", "--idioma sem valor não conta");
  fs.rmSync(path.join(tmp.c.base, "instalacao.json"));
  assert.equal(resolverIdioma(undefined, { LANG: "en_US.UTF-8" }, tmp.c), "pt-BR");
});
