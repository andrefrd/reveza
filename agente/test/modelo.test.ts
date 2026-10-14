// Modelo de cada conta: o `model` do Claude Code acompanha a conta em uso, com o modelo que o painel escolheu para ela.
// Conta sem modelo devolve o que a pessoa tinha; o que a pessoa escolheu fica, fora da troca de conta.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { aplicarModelo } from "../src/modelo.js";
import { modeloValido } from "../src/nuvem/rpc.js";
import { aadConta, cifrarLogin } from "../src/cofre/cifra.js";
import { lerChave } from "../src/ligar.js";
import { ativaEm, BancoFalso, blob, contaEstacionada, montar, NuvemFalsa, type Montado } from "./falsos.js";

const temporarias: string[] = [];
let m: Montado | undefined;
afterEach(() => {
  m?.limpar();
  m = undefined;
  for (const d of temporarias.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const arquivoTemp = (conteudo?: unknown) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "reveza-modelo-"));
  temporarias.push(d);
  const f = path.join(d, "settings.json");
  if (conteudo !== undefined) fs.writeFileSync(f, typeof conteudo === "string" ? conteudo : JSON.stringify(conteudo, null, 2));
  return f;
};
const ler = (f: string) => JSON.parse(fs.readFileSync(f, "utf8")) as Record<string, unknown>;

describe("o model do settings.json", () => {
  test("escreve o modelo da conta, guarda o que a pessoa tinha e mantém o resto do arquivo", () => {
    const f = arquivoTemp({ model: "sonnet", theme: "dark" });
    assert.deepEqual(aplicarModelo(f, "opus", null, null, true), { escrito: "opus", original: "sonnet", mudou: true, daPessoa: false });
    assert.deepEqual(ler(f), { model: "opus", theme: "dark" });
    assert.deepEqual(aplicarModelo(f, "opus", "opus", "sonnet", false), { escrito: "opus", original: "sonnet", mudou: false, daPessoa: false },
      "igual: não regrava");
    // outra conta, outro modelo: o original continua o da pessoa
    assert.deepEqual(aplicarModelo(f, "claude-fable-5[1m]", "opus", "sonnet", true),
      { escrito: "claude-fable-5[1m]", original: "sonnet", mudou: true, daPessoa: false });
    // conta sem modelo: volta o da pessoa
    assert.deepEqual(aplicarModelo(f, null, "claude-fable-5[1m]", "sonnet", true), { escrito: null, original: null, mudou: true, daPessoa: false });
    assert.deepEqual(ler(f), { model: "sonnet", theme: "dark" });
  });

  test("a pessoa não tinha modelo: a conta sem modelo tira a chave", () => {
    const f = arquivoTemp({ theme: "dark" });
    assert.equal(aplicarModelo(f, "opus", null, null, false).original, null);
    assert.deepEqual(ler(f), { theme: "dark", model: "opus" }, "sem modelo da pessoa, nem precisa forçar");
    assert.equal(aplicarModelo(f, null, "opus", null, false).mudou, true);
    assert.deepEqual(ler(f), { theme: "dark" });
  });

  test("modelo que a pessoa escolheu fica fora da troca; na troca, o da conta vence e o dela volta depois", () => {
    const f = arquivoTemp({ model: "haiku" });
    assert.deepEqual(aplicarModelo(f, "opus", null, null, false), { escrito: null, original: null, mudou: false, daPessoa: true });
    assert.equal(ler(f).model, "haiku");
    // o agente escreveu, e a pessoa trocou à mão depois
    fs.writeFileSync(f, JSON.stringify({ model: "sonnet" }));
    assert.deepEqual(aplicarModelo(f, "opus", "opus", null, false), { escrito: null, original: null, mudou: false, daPessoa: true });
    assert.deepEqual(aplicarModelo(f, null, "opus", null, false), { escrito: null, original: null, mudou: false, daPessoa: true },
      "conta sem modelo não tira o que a pessoa pôs");
    assert.equal(ler(f).model, "sonnet");
    // troca de conta: vence o da conta, e o da pessoa fica guardado
    assert.deepEqual(aplicarModelo(f, "opus", null, null, true), { escrito: "opus", original: "sonnet", mudou: true, daPessoa: false });
    aplicarModelo(f, null, "opus", "sonnet", true);
    assert.equal(ler(f).model, "sonnet");
  });

  test("a pessoa já usa o modelo da conta: não escreve nem assume", () => {
    const f = arquivoTemp({ model: "opus" });
    assert.deepEqual(aplicarModelo(f, "opus", null, null, true), { escrito: null, original: null, mudou: false, daPessoa: false });
    assert.deepEqual(aplicarModelo(f, null, null, null, true), { escrito: null, original: null, mudou: false, daPessoa: false });
    assert.equal(ler(f).model, "opus");
  });

  test("sem arquivo, cria; arquivo que não se lê, lista ou model que não é texto ficam como estão", () => {
    const f = arquivoTemp();
    assert.equal(aplicarModelo(f, "opus", null, null, false).mudou, true);
    assert.deepEqual(ler(f), { model: "opus" });
    const quebrado = arquivoTemp("{ meio escrito");
    assert.deepEqual(aplicarModelo(quebrado, "opus", "sonnet", "haiku", true), { escrito: "sonnet", original: "haiku", mudou: false, daPessoa: false },
      "ilegível: guarda o que sabia para a próxima");
    assert.equal(fs.readFileSync(quebrado, "utf8"), "{ meio escrito");
    assert.equal(aplicarModelo(arquivoTemp([1]), "opus", null, null, true).mudou, false);
    const estranho = arquivoTemp({ model: { nome: "opus" } });
    assert.equal(aplicarModelo(estranho, "sonnet", null, null, true).mudou, false);
    assert.deepEqual(ler(estranho), { model: { nome: "opus" } });
  });

  test("mantém a permissão do arquivo", () => {
    const f = arquivoTemp({});
    fs.chmodSync(f, 0o600);
    aplicarModelo(f, "opus", null, null, false);
    assert.equal(fs.statSync(f).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(path.dirname(f)), ["settings.json"], "sem sobra de arquivo temporário");
  });
});

describe("o que vem da nuvem", () => {
  test("modelo fora do formato vira sem modelo", () => {
    for (const bom of ["opus", "claude-opus-5-5", "claude-fable-5[1m]", "sonnet[1m]"]) assert.equal(modeloValido(bom), bom);
    for (const ruim of ["Opus", "opus; rm -rf /", "../x", "-opus", "", "opus[2m]", 5, null, undefined]) assert.equal(modeloValido(ruim), null, String(ruim));
  });
});

describe("no agente", () => {
  let banco: BancoFalso;
  async function preparar(opcoes: { sombra?: boolean } = {}): Promise<Montado> {
    banco = new BancoFalso();
    const mm = await montar({ nuvem: new NuvemFalsa(banco, "pc-1"), ...opcoes });
    m = mm;
    banco.agora = () => mm.relogio.agora();
    fs.writeFileSync(path.join(mm.c.principalDir, "settings.json"), JSON.stringify({ model: "sonnet", theme: "dark" }));
    return mm;
  }
  const arquivo = (mm: Montado) => path.join(mm.c.principalDir, "settings.json");
  /** O settings.json sem o autoCompactWindow, que o resumo grava na troca (contas 5x), no mesmo arquivo. */
  const settings = (mm: Montado) => {
    const { autoCompactWindow: _, ...resto } = ler(arquivo(mm)) as Record<string, unknown>;
    return resto as { model?: unknown };
  };

  /** Conta na nuvem com o login no cofre (cifrado com a chave deste computador). */
  async function semear(mm: Montado, letra: string, versao = 2) {
    const c = banco.conta(`${letra.toLowerCase()}@exemplo.com`);
    const k = (await lerChave(mm.guarda))!;
    const { cifrado, nonce } = cifrarLogin(k, aadConta(c.id, versao), blob(letra + "1", true, 3600, mm.relogio.agora()));
    c.cofre = { cifrado, nonce, versao, expira_em: null };
    return c;
  }

  /** A em uso (a nuvem atribui a que já estava no computador) e B estacionada, com o login no cofre. undefined: nuvem de antes. */
  async function comAeB(modeloA: string | null | undefined, modeloB: string | null | undefined) {
    const mm = await preparar();
    if (modeloA !== undefined) banco.conta("a@exemplo.com").modelo = modeloA;
    const a = await ativaEm(mm, "A", 10);
    await mm.agente.esperar();
    await mm.agente.busca();
    const cb = await semear(mm, "B");
    if (modeloB !== undefined) cb.modelo = modeloB;
    const b = contaEstacionada(mm, "B", 3, { contaId: cb.id });
    mm.agente.estado.contas[b]!.versaoCofre = 2;
    return { mm, a, b, cb };
  }

  test("a troca leva o modelo da conta; o painel muda na hora; conta sem modelo devolve o da pessoa", async () => {
    const { mm, a, b, cb } = await comAeB(null, "claude-fable-5[1m]");
    const e = () => mm.agente.estado;
    assert.equal(e().ativa, a);
    assert.equal(e().modelos![e().contas[a]!.contaId!], null);
    assert.deepEqual(settings(mm), { model: "sonnet", theme: "dark" }, "conta sem modelo não mexe");

    banco.atribuir("pc-1", cb.id, "teste");
    await mm.agente.busca();
    assert.equal(e().ativa, b);
    assert.deepEqual(settings(mm), { model: "claude-fable-5[1m]", theme: "dark" });
    assert.equal((ler(arquivo(mm)) as Record<string, unknown>).autoCompactWindow, 180_000,
      "o resumo e o modelo dividem o arquivo sem um apagar o outro");
    assert.equal(e().modeloOriginal, "sonnet");
    assert.equal(mm.agente.publico().modelo, "claude-fable-5[1m]");

    // o painel muda o modelo da conta em uso: vale sem esperar troca
    cb.modelo = "opus";
    await mm.agente.busca();
    assert.equal(settings(mm).model, "opus");
    assert.equal(e().modeloOriginal, "sonnet", "o original continua o da pessoa");

    cb.modelo = null;
    await mm.agente.busca();
    assert.deepEqual(settings(mm), { model: "sonnet", theme: "dark" }, "voltou o da pessoa");
    assert.equal(e().modeloEscrito, null);

    // a pessoa troca à mão: na partida do agente (sem forçar), o dela fica, e a conta sem modelo não tira
    cb.modelo = "opus";
    await mm.agente.busca();
    assert.equal(settings(mm).model, "opus");
    fs.writeFileSync(arquivo(mm), JSON.stringify({ model: "haiku" }));
    mm.agente.aplicarModelo(false);
    assert.equal(settings(mm).model, "haiku");
    assert.equal(e().modeloEscrito, null);
    cb.modelo = null;
    await mm.agente.busca();
    assert.equal(settings(mm).model, "haiku");
  });

  test("nuvem de antes da 0.6 (sem modelo) não mexe; a saída enxuta chega pela ponte", async () => {
    const { mm, b, cb } = await comAeB(undefined, undefined);
    banco.atribuir("pc-1", cb.id, "teste");
    await mm.agente.busca();
    assert.equal(mm.agente.estado.ativa, b);
    assert.deepEqual(settings(mm), { model: "sonnet", theme: "dark" });
    assert.equal(mm.agente.estado.modelos, undefined);

    assert.equal(mm.agente.alvoPonte().ativa().enxugar, false);
    assert.equal(mm.agente.publico().enxugar, false);
    banco.computadores.set("pc-1", { ...banco.computadores.get("pc-1")!, enxugar: true });
    await mm.agente.busca();
    assert.equal(mm.agente.alvoPonte().ativa().enxugar, true);
    assert.equal(mm.agente.publico().enxugar, true);
    banco.computadores.set("pc-1", { ...banco.computadores.get("pc-1")!, enxugar: false });
    await mm.agente.busca();
    assert.equal(mm.agente.alvoPonte().ativa().enxugar, false);
  });

  test("em modo sombra, nem modelo nem saída enxuta", async () => {
    const mm = await preparar({ sombra: true });
    const ca = await semear(mm, "A");
    ca.modelo = "opus";
    await ativaEm(mm, "A", 10, ca.id);
    banco.atribuir("pc-1", ca.id, "teste");
    banco.computadores.set("pc-1", { ...banco.computadores.get("pc-1")!, enxugar: true });
    await mm.agente.busca();
    assert.deepEqual(settings(mm), { model: "sonnet", theme: "dark" });
    assert.equal(mm.agente.estado.modelos, undefined);
    assert.equal(mm.agente.alvoPonte().ativa().enxugar, false);
  });
});
