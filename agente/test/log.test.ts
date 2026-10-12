// Log do agente em arquivo: o "faria" repetido da sombra não enche o disco.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FARIA_REPETIDO_MS, logEmArquivo } from "../src/util/log.js";

test("o mesmo faria vai ao log uma vez por hora; outros textos e info passam sempre", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reveza-log-"));
  try {
    let t = 1_000_000;
    const arq = path.join(dir, "agente.log");
    const log = logEmArquivo(arq, false, () => t);
    log.faria("renovar o login de a@exemplo.com");
    log.faria("renovar o login de a@exemplo.com");
    log.faria("trocar para b@exemplo.com");
    log.info("x");
    log.info("x");
    t += FARIA_REPETIDO_MS;
    log.faria("renovar o login de a@exemplo.com");
    const linhas = fs.readFileSync(arq, "utf8").trim().split("\n");
    assert.equal(linhas.filter((l) => l.includes("renovar o login")).length, 2);
    assert.equal(linhas.filter((l) => l.includes("trocar para")).length, 1);
    assert.equal(linhas.filter((l) => l.endsWith("[info] x")).length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
