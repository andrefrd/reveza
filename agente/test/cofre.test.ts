// Cofre (AES-256-GCM com dado associado), frase de ligação (scrypt, 6 palavras), listas de palavras e guardas.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { aadConta, aadRegistro, cifrar, cifrarLogin, decifrar, decifrarLogin, novaChave } from "../src/cofre/cifra.js";
import { desembrulhar, embrulhar, gerarFrase, normalizar, palavrasDesconhecidas, PALAVRAS_NA_FRASE } from "../src/cofre/frase.js";
import { PALAVRAS_EN, PALAVRAS_PT } from "../src/cofre/palavras.js";
import { GuardaArquivo, GuardaFalsa, GuardaMac, GuardaSecretTool, GuardaWindows, SEGREDO_COFRE, guardaDoSistema } from "../src/cofre/guarda.js";
import { impressaoDaChave, iniciarCofre, lerChave, publicarLigacao, receberLigacao } from "../src/ligar.js";
import { abrirCofre, abrirCofreComOrigem } from "../src/posse.js";
import { BancoFalso, ExecutorFalso, NuvemFalsa, blob } from "./falsos.js";

describe("cifra do cofre", () => {
  test("ida e volta com o mesmo dado associado", () => {
    const k = novaChave();
    const { cifrado, nonce } = cifrar(k, aadConta("c1", 3), Buffer.from("segredo"));
    assert.equal(nonce.length, 12);
    assert.equal(decifrar(k, aadConta("c1", 3), cifrado, nonce).toString(), "segredo");
  });

  test("o cifrado de uma conta não abre como o de outra, nem em outra versão", () => {
    const k = novaChave();
    const { cifrado, nonce } = cifrar(k, aadConta("c1", 3), Buffer.from("segredo"));
    assert.throws(() => decifrar(k, aadConta("c2", 3), cifrado, nonce));
    assert.throws(() => decifrar(k, aadConta("c1", 2), cifrado, nonce));
  });

  test("chave errada ou cifrado mexido não abre", () => {
    const k = novaChave();
    const { cifrado, nonce } = cifrar(k, "x", Buffer.from("segredo"));
    assert.throws(() => decifrar(novaChave(), "x", cifrado, nonce));
    const mexido = Buffer.from(cifrado);
    mexido[0] = mexido[0]! ^ 1;
    assert.throws(() => decifrar(k, "x", mexido, nonce));
  });

  test("nonce novo a cada cifra", () => {
    const k = novaChave();
    assert.notDeepEqual(cifrar(k, "x", Buffer.from("a")).nonce, cifrar(k, "x", Buffer.from("a")).nonce);
  });

  test("só claudeAiOauth e organizationUuid vão ao cofre", () => {
    const k = novaChave();
    const b = { ...blob("A1"), mcpOAuth: { x: "da-maquina" } };
    const { cifrado, nonce } = cifrarLogin(k, aadConta("c", 1), b);
    const volta = decifrarLogin(k, aadConta("c", 1), cifrado, nonce);
    assert.deepEqual(Object.keys(volta).sort(), ["claudeAiOauth", "organizationUuid"]);
  });

  test("cofre ainda na gravação de registro abre pelo e-mail; de outra conta, não", () => {
    const k = novaChave();
    const { cifrado, nonce } = cifrarLogin(k, aadRegistro("A@Exemplo.com"), blob("A1"));
    const cofre = { cifrado, nonce, versao: 1, expira_em: null };
    assert.equal(abrirCofre(k, "id-a", "a@exemplo.com", cofre)?.claudeAiOauth?.accessToken, "A1");
    assert.equal(abrirCofre(k, "id-a", "b@exemplo.com", cofre), null);
    assert.equal(abrirCofre(k, "id-a", null, cofre), null);
  });

  test("chave de tamanho errado é recusada", () => {
    assert.throws(() => cifrar(Buffer.alloc(16), "x", Buffer.from("a")));
  });
});

describe("frase de ligação", () => {
  test("listas próprias: mais de mil palavras cada, só a-z, sem repetição", () => {
    for (const lista of [PALAVRAS_PT, PALAVRAS_EN]) {
      assert.ok(lista.length >= 1024, String(lista.length));
      assert.equal(new Set(lista).size, lista.length);
      for (const p of lista) assert.match(p, /^[a-z]{2,12}$/);
    }
  });

  test("6 palavras da lista", () => {
    const f = gerarFrase("pt-BR");
    assert.equal(f.split(" ").length, PALAVRAS_NA_FRASE);
    assert.deepEqual(palavrasDesconhecidas(f), []);
    assert.deepEqual(palavrasDesconhecidas(gerarFrase("en")), []);
  });

  test("normaliza maiúsculas, acentos e separadores", () => {
    assert.equal(normalizar("  Abelha-ÁRVORE,  casa\nmesa "), "abelha arvore casa mesa");
  });

  test("embrulha e desembrulha a chave do cofre; frase errada não abre", () => {
    const k = novaChave();
    const frase = gerarFrase();
    const { embrulho, sal } = embrulhar(k, frase);
    assert.deepEqual(desembrulhar(embrulho, sal, frase.toUpperCase()), k);
    const outra = frase.split(" ");
    outra[0] = outra[0] === "abelha" ? "casa" : "abelha";
    assert.throws(() => desembrulhar(embrulho, sal, outra.join(" ")));
    assert.ok(!embrulho.includes(k), "a chave não aparece em claro no embrulho");
  });

  test("frase curta não embrulha", () => {
    assert.throws(() => embrulhar(novaChave(), "casa mesa"));
  });

  test("frase de emergência: quem tem a chave publica, o que perdeu recebe a mesma chave; a frase não vai à nuvem", async () => {
    const banco = new BancoFalso();
    const velho = new GuardaFalsa();
    const novo = new GuardaFalsa();
    assert.equal(await iniciarCofre(velho), true);
    assert.equal(await iniciarCofre(velho), false);
    const { frase } = await publicarLigacao(velho, new NuvemFalsa(banco, "pc-velho"));
    const enviado = JSON.stringify(banco.chamadas) + JSON.stringify(banco.ligacoes.map((l) => l.embrulho.toString("latin1")));
    for (const p of frase.split(" ")) assert.ok(!enviado.includes(` ${p} `));
    await receberLigacao(novo, new NuvemFalsa(banco, "pc-novo"), frase);
    assert.deepEqual(await lerChave(novo), await lerChave(velho));
    await assert.rejects(receberLigacao(new GuardaFalsa(), new NuvemFalsa(banco, "pc-3"), frase), /nenhuma frase aberta/);
  });

  test("computador novo recusa chave que não é a da instalação (a nuvem guarda a impressão da primeira)", async () => {
    const banco = new BancoFalso();
    const daInstalacao = new GuardaFalsa();
    await iniciarCofre(daInstalacao);
    banco.cofreImpressao = impressaoDaChave((await lerChave(daInstalacao))!);
    const outra = new GuardaFalsa(); // um computador que criou uma chave por conta própria
    await iniciarCofre(outra);
    const { frase } = await publicarLigacao(outra, new NuvemFalsa(banco, "pc-intruso"));
    const novo = new GuardaFalsa();
    await assert.rejects(receberLigacao(novo, new NuvemFalsa(banco, "pc-novo"), frase), /não é a desta instalação/);
    assert.equal(await lerChave(novo), null, "nada gravado");
    // e com a chave certa passa
    const certa = await publicarLigacao(daInstalacao, new NuvemFalsa(banco, "pc-velho"));
    await receberLigacao(novo, new NuvemFalsa(banco, "pc-novo"), certa.frase);
    assert.deepEqual(await lerChave(novo), await lerChave(daInstalacao));
  });

  test("ligar com palavra fora da lista avisa antes de gastar a ligação", async () => {
    const banco = new BancoFalso();
    await assert.rejects(receberLigacao(new GuardaFalsa(), new NuvemFalsa(banco), "casa mesa xyzw abelha casa mesa"), /xyzw/);
    assert.equal(banco.chamadas.length, 0);
  });
});

describe("guardas de segredo", () => {
  test("arquivo: modo 600, ida e volta, apagar", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reveza-guarda-"));
    try {
      const g = new GuardaArquivo(dir);
      await g.gravar(SEGREDO_COFRE, "abc");
      assert.equal(await g.ler(SEGREDO_COFRE), "abc");
      if (process.platform !== "win32") assert.equal(fs.statSync(path.join(dir, SEGREDO_COFRE)).mode & 0o777, 0o600);
      assert.ok(g.aviso);
      await g.apagar(SEGREDO_COFRE);
      assert.equal(await g.ler(SEGREDO_COFRE), null);
      await assert.rejects(g.gravar("../fora", "x"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("macOS: segredo pelo stdin do security, no serviço do Reveza", async () => {
    const exec = new ExecutorFalso();
    const guardado = new Map<string, string>();
    exec.responder = (argv, entrada) => {
      if (argv[1] === "-i") {
        const m = /-a "([^"]+)" -s "([^"]+)" -X ([0-9a-f]+)/.exec(entrada!)!;
        guardado.set(m[1]!, Buffer.from(m[3]!, "hex").toString());
        return { codigo: 0, saida: "", erro: "" };
      }
      if (argv[1] === "find-generic-password") {
        const v = guardado.get(argv[argv.indexOf("-a") + 1]!);
        return v ? { codigo: 0, saida: v + "\n", erro: "" } : { codigo: 44, saida: "", erro: "" };
      }
      return { codigo: 0, saida: "", erro: "" };
    };
    const g = new GuardaMac(exec);
    await g.gravar(SEGREDO_COFRE, "chave-base64");
    assert.equal(await g.ler(SEGREDO_COFRE), "chave-base64");
    const gravacao = exec.chamadas.find((c) => c.argv[1] === "-i")!;
    assert.ok(!gravacao.argv.join(" ").includes("chave"), "o segredo não vai no argv");
    assert.match(gravacao.entrada!, /-s "Reveza AI"/);
  });

  test("Windows: DPAPI pelo PowerShell, segredo pelo stdin, arquivo protegido", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reveza-dpapi-"));
    try {
      const exec = new ExecutorFalso();
      exec.responder = (argv, entrada) => {
        const script = argv[argv.length - 1]!;
        if (script.includes("::Protect(")) return { codigo: 0, saida: Buffer.from("P:" + entrada).toString("base64"), erro: "" };
        if (script.includes("::Unprotect(")) return { codigo: 0, saida: Buffer.from(entrada!, "base64").toString().slice(2), erro: "" };
        return { codigo: 1, saida: "", erro: "" };
      };
      const g = new GuardaWindows(exec, dir);
      await g.gravar("computador", '{"senha":"x"}');
      assert.equal(await g.ler("computador"), '{"senha":"x"}');
      assert.ok(!fs.readFileSync(path.join(dir, "computador.dpapi"), "utf8").includes("senha"));
      assert.ok(exec.chamadas.every((c) => !c.argv.join(" ").includes("senha")));
      assert.equal(exec.chamadas[0]!.argv[0], "powershell.exe");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("Linux: secret-tool quando responde; senão arquivo 600 com aviso", async () => {
    const comSecret = new ExecutorFalso();
    comSecret.responder = () => ({ codigo: 0, saida: "", erro: "" });
    assert.ok((await guardaDoSistema("linux", comSecret, "/tmp/x")) instanceof GuardaSecretTool);
    const semSecret = new ExecutorFalso();
    semSecret.responder = () => ({ codigo: 127, saida: "", erro: "spawn secret-tool ENOENT" });
    const g = await guardaDoSistema("linux", semSecret, "/tmp/x");
    assert.ok(g instanceof GuardaArquivo);
    assert.ok(g.aviso);
    const semDbus = new ExecutorFalso();
    semDbus.responder = () => ({ codigo: 1, saida: "", erro: "Cannot autolaunch D-Bus without X11" });
    assert.ok((await guardaDoSistema("linux", semDbus, "/tmp/x")) instanceof GuardaArquivo);
  });

  test("secret-tool: segredo pelo stdin", async () => {
    const exec = new ExecutorFalso();
    let guardado = "";
    exec.responder = (argv, entrada) => {
      if (argv[1] === "store") guardado = entrada ?? "";
      if (argv[1] === "lookup") return { codigo: 0, saida: guardado, erro: "" };
      return { codigo: 0, saida: "", erro: "" };
    };
    const g = new GuardaSecretTool(exec);
    await g.gravar("computador", "segredo-longo");
    assert.equal(await g.ler("computador"), "segredo-longo");
    assert.ok(exec.chamadas.every((c) => !c.argv.includes("segredo-longo")));
  });
});

describe("cofre: gravação de registro não volta no tempo", () => {
  test("abrir diz quando veio da gravação de registro", () => {
    const k = novaChave();
    const { cifrado, nonce } = cifrarLogin(k, aadRegistro("a@exemplo.com"), blob("A1"));
    const r = abrirCofreComOrigem(k, "id-a", "a@exemplo.com", { cifrado, nonce, versao: 7, expira_em: null });
    assert.equal(r?.registro, true);
    const d = cifrarLogin(k, aadConta("id-a", 7), blob("A2"));
    assert.equal(abrirCofreComOrigem(k, "id-a", "a@exemplo.com", { ...d, versao: 7, expira_em: null })?.registro, false);
  });
});
