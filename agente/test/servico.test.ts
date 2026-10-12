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
  return { sistema, home: tmp.c.home, exec, node: "/opt/node/bin/node", script: "/app/dist/src/cli.js", logs: tmp.c.logs, uid: 501, dormir: async () => undefined,
    portaOcupada: async () => false, ...extra };
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

  test("Linux: unidade de usuário, enable e restart (numa atualização o agente antigo sai) e remoção limpa", async () => {
    tmp = pastaTemporaria();
    const exec = new ExecutorFalso();
    await servico.instalar(op("linux", exec));
    const arq = servico.arquivoUnidade(op("linux"));
    const unidade = fs.readFileSync(arq, "utf8");
    assert.match(unidade, /ExecStart="\/opt\/node\/bin\/node" "\/app\/dist\/src\/cli\.js" "rodar"/);
    assert.match(unidade, /Restart=always/);
    const comandos = exec.chamadas.map((c) => c.argv.join(" "));
    assert.ok(comandos.includes("systemctl --user enable reveza-agente.service"));
    assert.ok(comandos.indexOf("systemctl --user restart reveza-agente.service") > comandos.indexOf("systemctl --user enable reveza-agente.service"));
    assert.ok(!comandos.some((c) => c.includes("--now")), "enable --now não reinicia o agente que já roda");
    await servico.remover(op("linux", exec));
    assert.equal(fs.existsSync(arq), false);
  });

  test("Windows: tarefa por XML, só deste usuário, sem janela, sem limite de tempo, na bateria e voltando se cair", async () => {
    tmp = pastaTemporaria();
    const exec = new ExecutorFalso();
    exec.responder = (argv) => (argv[0] === "whoami" ? { codigo: 0, saida: '"pc\\joão","S-1-5-21-1-2-3-1001"\r\n', erro: "" } : { codigo: 0, saida: "", erro: "" });
    const o = op("windows", exec, { node: "C:\\Program Files\\nodejs\\node.exe", script: "C:\\Users\\João Silva\\.reveza\\app\\cli.js", agora: new Date(2026, 9, 12, 8, 5, 9) });
    const r = await servico.instalar(o);
    assert.match(r, /sem janela/);
    const arq = servico.arquivoTarefa(o);
    const bruto = fs.readFileSync(arq);
    assert.deepEqual([...bruto.subarray(0, 2)], [0xff, 0xfe], "UTF-16 com a marca no começo");
    const x = bruto.subarray(2).toString("utf16le");
    assert.match(x, /<LogonTrigger>\s*<Enabled>true<\/Enabled>\s*<UserId>S-1-5-21-1-2-3-1001<\/UserId>/, "gatilho de entrada só deste usuário");
    assert.match(x, /<Interval>PT1M<\/Interval>/);
    assert.match(x, /<StartBoundary>2026-10-12T08:05:09<\/StartBoundary>/);
    assert.match(x, /<LogonType>InteractiveToken<\/LogonType>\s*<RunLevel>LeastPrivilege<\/RunLevel>/);
    assert.match(x, /<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/);
    assert.match(x, /<DisallowStartIfOnBatteries>false<\/DisallowStartIfOnBatteries>\s*<StopIfGoingOnBatteries>false<\/StopIfGoingOnBatteries>/);
    assert.match(x, /<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/);
    assert.match(x, /<Command>C:\\Windows\\System32\\conhost\.exe<\/Command>/);
    assert.ok(x.includes('<Arguments>--headless &quot;C:\\Program Files\\nodejs\\node.exe&quot; &quot;C:\\Users\\João Silva\\.reveza\\app\\cli.js&quot; rodar --vigiar-pai</Arguments>'), x);
    const comandos = exec.chamadas.map((c) => c.argv.join(" "));
    assert.deepEqual(comandos.filter((c) => c.startsWith("schtasks")), [
      'schtasks /End /TN Reveza AI agente',
      `schtasks /Create /F /TN Reveza AI agente /XML ${arq}`,
      "schtasks /Run /TN Reveza AI agente",
    ], "o agente antigo para antes da tarefa nova subir");
  });

  test("Windows: a remoção desliga, para e apaga a tarefa e o XML", async () => {
    tmp = pastaTemporaria();
    const exec = new ExecutorFalso();
    const o = op("windows", exec, { node: "C:\\node\\node.exe", script: "C:\\app\\cli.js" });
    await servico.instalar(o);
    exec.chamadas = [];
    await servico.remover(o);
    assert.deepEqual(exec.chamadas.map((c) => c.argv.slice(0, 2).join(" ")), ["schtasks /Change", "schtasks /End", "schtasks /Delete"]);
    assert.equal(fs.existsSync(servico.arquivoTarefa(o)), false);
  });

  test("Windows: espera o agente antigo soltar a porta antes de criar a tarefa nova", async () => {
    tmp = pastaTemporaria();
    const exec = new ExecutorFalso();
    let ocupada = 3;
    await servico.instalar(op("windows", exec, { node: "C:\\node\\node.exe", script: "C:\\app\\cli.js", portaOcupada: async () => ocupada-- > 0 }));
    assert.equal(ocupada, -1, "olhou a porta até ela soltar");
  });

  test("aspas da linha de comando do Windows", () => {
    assert.equal(servico.aspasWindows("rodar"), "rodar");
    assert.equal(servico.aspasWindows("C:\\Program Files\\x.exe"), '"C:\\Program Files\\x.exe"');
    assert.equal(servico.aspasWindows('a "b"'), '"a \\"b\\""');
    assert.equal(servico.aspasWindows("C:\\pasta com espaço\\"), '"C:\\pasta com espaço\\\\"');
    assert.equal(servico.aspasWindows(""), '""');
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
