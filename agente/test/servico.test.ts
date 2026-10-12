// Serviço do usuário: launchd (macOS), systemd de usuário (Linux) e Agendador de Tarefas (Windows). Com executor
// falso e HOME temporária: nada é instalado de verdade.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as servico from "../src/servico.js";
import { ExecutorFalso, pastaTemporaria } from "./falsos.js";

let tmp: ReturnType<typeof pastaTemporaria>;
afterEach(() => tmp?.limpar());

function op(sistema: "macos" | "linux" | "windows", exec = new ExecutorFalso(), extra: Partial<servico.OpcoesServico> = {}): servico.OpcoesServico {
  return { sistema, home: tmp.c.home, exec, node: "/opt/node/bin/node", script: "/app/dist/src/cli.js", logs: tmp.c.logs, uid: 501, dormir: async () => undefined, ...extra };
}

describe("serviço", () => {
  test("macOS: reinstalar espera o rótulo sair e tenta o bootstrap de novo (o erro 5 do launchd)", async () => {
    tmp = pastaTemporaria();
    const exec = new ExecutorFalso();
    let prints = 0;
    let bootstraps = 0;
    exec.responder = (argv) => {
      if (argv[1] === "print") return { codigo: ++prints < 3 ? 0 : 113, saida: "", erro: "" };
      if (argv[1] === "bootstrap") return ++bootstraps < 2 ? { codigo: 5, saida: "", erro: "Bootstrap failed: 5: Input/output error" } : { codigo: 0, saida: "", erro: "" };
      return { codigo: 0, saida: "", erro: "" };
    };
    await servico.instalar(op("macos", exec));
    assert.equal(prints, 3, "esperou o rótulo sair");
    assert.equal(bootstraps, 2, "tentou de novo depois do erro 5");
  });

  test("macOS: plist com rodar, KeepAlive e log; bootstrap no gui/<uid>", async () => {
    tmp = pastaTemporaria();
    const exec = new ExecutorFalso();
    exec.responder = (argv) => ({ codigo: argv[1] === "bootout" ? 3 : 0, saida: "", erro: "" }); // nada carregado antes
    await servico.instalar(op("macos", exec));
    const plist = fs.readFileSync(servico.arquivoPlist(op("macos")), "utf8");
    assert.match(plist, /<string>ai\.reveza\.agente<\/string>/);
    assert.match(plist, /<string>\/app\/dist\/src\/cli\.js<\/string>\s*<string>rodar<\/string>/);
    assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
    assert.ok(!plist.includes("--sombra"));
    assert.deepEqual(exec.chamadas.map((c) => c.argv.slice(0, 2)), [
      ["launchctl", "bootout"],
      ["launchctl", "bootstrap"],
    ]);
    assert.equal(exec.chamadas[1]!.argv[2], "gui/501");
  });

  test("modo sombra e porta vão para os argumentos do serviço", async () => {
    tmp = pastaTemporaria();
    const plist = servico.plist(op("macos", undefined, { sombra: true, porta: 7799 }));
    assert.match(plist, /<string>--sombra<\/string>\s*<string>--porta<\/string>\s*<string>7799<\/string>/);
  });

  test("XML do plist escapado", () => {
    tmp = pastaTemporaria();
    const plist = servico.plist(op("macos", undefined, { script: "/a&b/<x>.js" }));
    assert.ok(plist.includes("/a&amp;b/&lt;x&gt;.js"));
  });

  test("Linux: unidade de usuário, enable --now e remoção limpa", async () => {
    tmp = pastaTemporaria();
    const exec = new ExecutorFalso();
    await servico.instalar(op("linux", exec));
    const arq = servico.arquivoUnidade(op("linux"));
    const unidade = fs.readFileSync(arq, "utf8");
    assert.match(unidade, /ExecStart="\/opt\/node\/bin\/node" "\/app\/dist\/src\/cli\.js" "rodar"/);
    assert.match(unidade, /Restart=always/);
    assert.ok(exec.chamadas.some((c) => c.argv.join(" ") === "systemctl --user enable --now reveza-agente.service"));
    await servico.remover(op("linux", exec));
    assert.equal(fs.existsSync(arq), false);
  });

  test("Windows: tarefa ao entrar, sem privilégio elevado", async () => {
    tmp = pastaTemporaria();
    const exec = new ExecutorFalso();
    await servico.instalar(op("windows", exec, { node: "C:\\node\\node.exe", script: "C:\\app\\cli.js" }));
    const criar = exec.chamadas[0]!.argv;
    assert.deepEqual(criar.slice(0, 2), ["schtasks", "/Create"]);
    assert.ok(criar.includes("ONLOGON") && criar.includes("LIMITED"));
    assert.equal(criar[criar.indexOf("/TR") + 1], '"C:\\node\\node.exe" "C:\\app\\cli.js" "rodar"');
  });

  test("status lê o estado de cada sistema", async () => {
    tmp = pastaTemporaria();
    const exec = new ExecutorFalso();
    exec.responder = (argv) => (argv[0] === "launchctl" ? { codigo: 0, saida: "state = running", erro: "" } : { codigo: 0, saida: "active\n", erro: "" });
    assert.equal((await servico.status(op("macos", exec))).rodando, true);
    assert.equal((await servico.status(op("linux", exec))).rodando, true);
    exec.responder = () => ({ codigo: 1, saida: "", erro: "" });
    assert.equal((await servico.status(op("windows", exec))).instalado, false);
  });

  test("falha do launchctl vira erro claro", async () => {
    tmp = pastaTemporaria();
    const exec = new ExecutorFalso();
    exec.responder = (argv) => (argv[1] === "bootstrap" ? { codigo: 5, saida: "", erro: "Bootstrap failed: 5" } : { codigo: 0, saida: "", erro: "" });
    await assert.rejects(servico.instalar(op("macos", exec)), /bootstrap falhou/);
    assert.ok(fs.existsSync(path.join(tmp.c.home, "Library", "LaunchAgents", "ai.reveza.agente.plist")));
  });
});
