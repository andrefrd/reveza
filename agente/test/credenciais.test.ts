// Credenciais locais: chaveiro do macOS (stdin quando cabe, argv quando não), arquivo no Linux/Windows, sombra.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { ChaveiroMac, comandoGravar, decodificarSaida, LIMITE_LINHA } from "../src/credenciais/macos.js";
import { CredenciaisArquivo } from "../src/credenciais/arquivo.js";
import { CredenciaisSombra } from "../src/credenciais/sombra.js";
import { CredenciaisFalsas } from "../src/credenciais/falsa.js";
import { comLogin, servicoDaPasta, soLogin, SERVICO_PRINCIPAL } from "../src/credenciais/blob.js";
import { PRINCIPAL } from "../src/credenciais/tipos.js";
import { LogMemoria } from "../src/util/log.js";
import { ExecutorFalso, blob } from "./falsos.js";

/** Chaveiro falso por trás do `security`: entende o -i (stdin) e o argv, e guarda o valor decodificado do -X. */
function securityFalso() {
  const exec = new ExecutorFalso();
  const itens = new Map<string, string>();
  exec.responder = (argv, entrada) => {
    if (argv[1] === "-i") {
      const linha = entrada!;
      if (linha.length > 4034) return { codigo: 1, saida: "", erro: "linha cortada" };
      const m = /-s "([^"]+)" -X ([0-9a-f]+)/.exec(linha)!;
      itens.set(m[1]!, Buffer.from(m[2]!, "hex").toString("utf8"));
      return { codigo: 0, saida: "", erro: "" };
    }
    if (argv[1] === "add-generic-password") {
      itens.set(argv[argv.indexOf("-s") + 1]!, Buffer.from(argv[argv.indexOf("-X") + 1]!, "hex").toString("utf8"));
      return { codigo: 0, saida: "", erro: "" };
    }
    if (argv[1] === "find-generic-password") {
      const v = itens.get(argv[argv.indexOf("-s") + 1]!);
      return v === undefined ? { codigo: 44, saida: "", erro: "" } : { codigo: 0, saida: v + "\n", erro: "" };
    }
    if (argv[1] === "delete-generic-password") itens.delete(argv[argv.indexOf("-s") + 1]!);
    return { codigo: 0, saida: "", erro: "" };
  };
  return { exec, itens };
}

describe("chaveiro do macOS", () => {
  test("linha curta vai pelo stdin e longa pelo argv, como o assistente faz", () => {
    const curto = comandoGravar("eu", "s", JSON.stringify({ x: "a".repeat(100) }));
    assert.deepEqual(curto.argv, ["security", "-i"]);
    assert.match(curto.entrada!, /add-generic-password -U -a "eu" -s "s" -X [0-9a-f]+\n/);
    const longo = comandoGravar("eu", "s", JSON.stringify({ x: "a".repeat(3000) }));
    assert.deepEqual(longo.argv.slice(0, 2), ["security", "add-generic-password"]);
    assert.equal(longo.entrada, null);
    assert.ok(curto.entrada!.length <= LIMITE_LINHA);
  });

  test("nome de entrada com aspas é recusado (nada de injeção na linha do -i)", () => {
    assert.throws(() => comandoGravar('eu" -s "outro', "s", "{}"));
  });

  test("entrada de cada pasta: Claude Code-credentials-<sha256(pasta)[:8]>", () => {
    const pasta = "/Users/x/.reveza/contas/ab12";
    assert.equal(servicoDaPasta(pasta), `${SERVICO_PRINCIPAL}-${createHash("sha256").update(pasta).digest("hex").slice(0, 8)}`);
    const ch = new ChaveiroMac(new ExecutorFalso(), "eu");
    assert.equal(ch.nome(PRINCIPAL), "Claude Code-credentials");
    assert.equal(ch.nome(pasta), servicoDaPasta(pasta));
  });

  test("a principal grande (com mcpOAuth) volta igual", async () => {
    const { exec } = securityFalso();
    const ch = new ChaveiroMac(exec, "eu");
    const grande = { ...blob("A1"), mcpOAuth: { y: "z".repeat(3000) } };
    await ch.gravar(PRINCIPAL, grande);
    assert.deepEqual(await ch.ler(PRINCIPAL), grande);
    const gravacao = exec.chamadas.find((c) => c.argv[1] === "add-generic-password")!;
    assert.ok(gravacao, "a grande vai pelo argv");
  });

  test("a de conta (pequena) vai pelo stdin e o token não aparece no argv", async () => {
    const { exec } = securityFalso();
    const ch = new ChaveiroMac(exec, "eu");
    await ch.gravar("/p/conta", blob("SEGREDO1"));
    assert.ok(exec.chamadas.every((c) => !c.argv.join(" ").includes(Buffer.from("SEGREDO1").toString("hex"))));
    assert.equal((await ch.ler("/p/conta"))?.claudeAiOauth?.accessToken, "SEGREDO1");
  });

  test("leitura estrita: não existe é null; chaveiro que não respondeu é erro (a troca não sobrescreve a principal)", async () => {
    const exec = new ExecutorFalso();
    const ch = new ChaveiroMac(exec, "eu");
    exec.responder = () => ({ codigo: 44, saida: "", erro: "could not be found" });
    assert.equal(await ch.lerEstrito(PRINCIPAL), null);
    exec.responder = () => ({ codigo: 51, saida: "", erro: "User interaction is not allowed." });
    assert.equal(await ch.ler(PRINCIPAL), null, "a leitura comum segue tratando como vazia");
    await assert.rejects(ch.lerEstrito(PRINCIPAL), /não respondeu/);
    exec.responder = () => ({ codigo: 0, saida: JSON.stringify(blob("A1")), erro: "" });
    assert.equal((await ch.lerEstrito(PRINCIPAL))?.claudeAiOauth?.accessToken, "A1");
  });

  test("gravação que não volta igual é erro", async () => {
    const { exec } = securityFalso();
    const original = exec.responder;
    exec.responder = (argv, entrada) => (argv[1] === "find-generic-password" ? { codigo: 0, saida: '{"outro":1}', erro: "" } : original(argv, entrada));
    await assert.rejects(new ChaveiroMac(exec, "eu").gravar("/p/c", blob("A1")));
  });

  test("valor com acento volta em hexa do security e é decodificado", () => {
    const json = JSON.stringify({ org: "Organização" });
    assert.equal(decodificarSaida(Buffer.from(json).toString("hex")), json);
    assert.equal(decodificarSaida('{"a":1}\n'), '{"a":1}');
    assert.equal(decodificarSaida(""), null);
  });
});

describe("arquivo (Linux e Windows)", () => {
  test("principal em ~/.claude/.credentials.json, conta na pasta dela, modo 600", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reveza-cred-"));
    try {
      const principalDir = path.join(dir, ".claude");
      const cr = new CredenciaisArquivo(principalDir);
      await cr.gravar(PRINCIPAL, blob("A1"));
      assert.equal(cr.nome(PRINCIPAL), path.join(principalDir, ".credentials.json"));
      if (process.platform !== "win32") assert.equal(fs.statSync(cr.nome(PRINCIPAL)).mode & 0o777, 0o600);
      const conta = path.join(dir, "contas", "x");
      await cr.gravar(conta, blob("B1"));
      assert.equal((await cr.ler(conta))?.claudeAiOauth?.accessToken, "B1");
      await cr.apagar(conta);
      assert.equal(await cr.ler(conta), null);
      assert.equal(fs.readdirSync(principalDir).filter((n) => n.includes(".tmp")).length, 0, "sem sobra de arquivo temporário");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("regras do conteúdo", () => {
  test("soLogin e comLogin mexem só no login", () => {
    const base = { ...blob("A1"), mcpOAuth: { m: 1 } };
    assert.deepEqual(Object.keys(soLogin(base)).sort(), ["claudeAiOauth", "organizationUuid"]);
    const novo = comLogin(base, blob("B1"));
    assert.equal(novo.claudeAiOauth?.accessToken, "B1");
    assert.deepEqual(novo.mcpOAuth, { m: 1 });
  });

  test("sombra: lê de verdade, não grava nem apaga, e registra o que faria", async () => {
    const base = new CredenciaisFalsas();
    base.d.set(PRINCIPAL, blob("A1"));
    const log = new LogMemoria();
    const s = new CredenciaisSombra(base, log);
    assert.equal((await s.ler(PRINCIPAL))?.claudeAiOauth?.accessToken, "A1");
    await s.gravar(PRINCIPAL);
    await s.apagar(PRINCIPAL);
    assert.equal(base.token(PRINCIPAL), "A1");
    assert.equal(base.gravacoes.length, 0);
    assert.equal(log.linhas.filter((l) => l.includes("faria")).length, 2);
  });
});
