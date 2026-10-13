// Resumo da conversa: o autoCompactWindow do Claude Code acompanha a conta em uso (180 mil nas que não são 20x, o
// automático nas de 20x), e o agente só mexe no que ele mesmo escreveu. Pedido do Paulo, 13/10/2026.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { aplicarResumo, janelaDaConta, lerJanela, RESUMO_PADRAO } from "../src/resumo.js";
import type { ContaLocal } from "../src/estado.js";
import { ativaEm, contaEstacionada, montar, type Montado } from "./falsos.js";

const temporarias: string[] = [];
let m: Montado | undefined;
afterEach(() => {
  m?.limpar();
  m = undefined;
  for (const d of temporarias.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const arquivoTemp = (conteudo?: unknown) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "reveza-resumo-"));
  temporarias.push(d);
  const f = path.join(d, "settings.json");
  if (conteudo !== undefined) fs.writeFileSync(f, typeof conteudo === "string" ? conteudo : JSON.stringify(conteudo, null, 2));
  return f;
};
const ler = (f: string) => JSON.parse(fs.readFileSync(f, "utf8")) as Record<string, unknown>;
const conta = (tier: string | null) => ({ tier }) as ContaLocal;

describe("a janela de cada conta", () => {
  test("180 mil nas que não são 20x (5x, equipe padrão, sem tier); automático nas de 20x e com o resumo desligado", () => {
    assert.equal(RESUMO_PADRAO, 180_000);
    for (const t of ["default_claude_max_5x", "default_raven", "default_claude_pro", null]) assert.equal(janelaDaConta(conta(t), 180_000), 180_000, String(t));
    assert.equal(janelaDaConta(conta("default_claude_max_20x"), 180_000), null);
    assert.equal(janelaDaConta(conta("default_claude_max_5x"), false), null);
    assert.equal(janelaDaConta(null, 180_000), null, "sem conta em uso, nada");
  });

  test("lê 180k, 180 mil, 180000 e 1m; fora de 100 mil a 1 milhão, não (o Claude Code ignora abaixo de 100 mil)", () => {
    for (const [t, v] of [["180k", 180_000], ["180 mil", 180_000], ["180000", 180_000], ["1m", 1_000_000], ["1,5m", null], ["99k", null], ["2m", null], ["abc", null], ["", null]] as const) {
      assert.equal(lerJanela(t), v, t);
    }
  });
});

describe("o settings.json do Claude Code", () => {
  test("escreve o número (o Claude Code ignora \"180k\" ali) e mantém o resto do arquivo", () => {
    const f = arquivoTemp({ model: "opus", modelSettings: { "claude-opus-5-5": { autoCompactWindow: 400_000 } } });
    const r = aplicarResumo(f, 180_000, null);
    assert.deepEqual(r, { escrito: 180_000, mudou: true, daPessoa: false });
    assert.deepEqual(ler(f), { model: "opus", modelSettings: { "claude-opus-5-5": { autoCompactWindow: 400_000 } }, autoCompactWindow: 180_000 });
    assert.deepEqual(aplicarResumo(f, 180_000, 180_000), { escrito: 180_000, mudou: false, daPessoa: false }, "igual: não regrava");
  });

  test("conta de 20x: tira o que o agente escreveu e volta ao automático", () => {
    const f = arquivoTemp({ autoCompactWindow: 180_000, outra: 1 });
    assert.deepEqual(aplicarResumo(f, null, 180_000), { escrito: null, mudou: true, daPessoa: false });
    assert.deepEqual(ler(f), { outra: 1 });
  });

  test("valor que a pessoa pôs à mão é dela: o agente não muda nem tira", () => {
    const f = arquivoTemp({ autoCompactWindow: 300_000 });
    assert.deepEqual(aplicarResumo(f, 180_000, null), { escrito: null, mudou: false, daPessoa: true });
    assert.deepEqual(aplicarResumo(f, null, 180_000), { escrito: null, mudou: false, daPessoa: true });
    assert.equal(ler(f).autoCompactWindow, 300_000);
  });

  test("sem arquivo, cria; arquivo que não se lê fica como está", () => {
    const f = arquivoTemp();
    assert.equal(aplicarResumo(f, 180_000, null).mudou, true);
    assert.deepEqual(ler(f), { autoCompactWindow: 180_000 });
    const quebrado = arquivoTemp("{ meio escrito");
    assert.deepEqual(aplicarResumo(quebrado, 180_000, null), { escrito: null, mudou: false, daPessoa: false });
    assert.equal(fs.readFileSync(quebrado, "utf8"), "{ meio escrito");
    const lista = arquivoTemp([1, 2]);
    assert.equal(aplicarResumo(lista, 180_000, null).mudou, false);
  });
});

describe("no agente", () => {
  test("a troca leva o resumo junto: 5x escreve 180 mil, 20x volta ao automático, e o reveza resumo muda ou desliga", async () => {
    m = await montar();
    const settings = path.join(m.c.principalDir, "settings.json");
    fs.writeFileSync(settings, JSON.stringify({ theme: "dark" }));
    await ativaEm(m, "A", 10);
    m.agente.aplicarResumo();
    assert.deepEqual(ler(settings), { theme: "dark", autoCompactWindow: 180_000 });
    assert.equal(m.agente.estado.resumoEscrito, 180_000);

    // a conta de 20x entra
    const b = contaEstacionada(m, "B", 5);
    m.agente.estado.contas[b]!.tier = "default_claude_max_20x";
    const r = await m.agente.trocador.trocar(b, "teste");
    assert.ok(r.ok, r.erro);
    assert.deepEqual(ler(settings), { theme: "dark" }, "a troca tirou o que o agente escreveu");
    assert.equal(m.agente.estado.resumoEscrito, null);

    const alvo = m.agente.alvoPonte();
    // volta para a de 5x pelo comando, com outro valor
    m.agente.estado.contas[b]!.tier = "default_claude_max_5x";
    let res = await alvo.resumo({ tokens: 300_000 });
    assert.equal(res.status, 200);
    assert.equal(ler(settings).autoCompactWindow, 300_000);
    res = await alvo.resumo({ tokens: 50_000 });
    assert.equal(res.status, 400, "abaixo de 100 mil o Claude Code ignora: recusa");
    res = await alvo.resumo({ tokens: false });
    assert.deepEqual(ler(settings), { theme: "dark" });
    assert.equal(m.agente.estado.config.resumo, false);
  });

  test("sessão que parou com Prompt is too long vira evento com o tamanho da conversa (uma vez a cada 10 min)", async () => {
    m = await montar();
    const alvo = m.agente.alvoPonte();
    const antes = m.agente.estado.eventos.length;
    await alvo.sessaoErro({ sessao: "abcdef12-0000", tipo: "contexto", tokens: 615_000, janela: 1_000_000 });
    await alvo.sessaoErro({ sessao: "abcdef12-0000", tipo: "contexto", tokens: 615_000, janela: 1_000_000 });
    const novos = m.agente.estado.eventos.slice(antes);
    assert.equal(novos.length, 1);
    assert.match(novos[0]!.texto, /Prompt is too long": conversa em 615 mil de 1000 mil tokens/);
    assert.equal(novos[0]!.tipo, "erro");
  });
});
