// Resumo da conversa: o `autoCompactWindow` das configurações do Claude Code acompanha a conta em uso.
//
// Por quê (relato do Paulo, 12 e 13/10/2026): no Claude Code 2.1.29x a janela de resumo automático do Opus 5.5 é de 1
// milhão de tokens. Sessões de dias chegavam a 600 mil e travavam com "Prompt is too long", e aí nem o /compact
// resolvia (para resumir, ele manda a conversa inteira). Cada mensagem também manda a conversa inteira: uma conversa de
// 600 mil gasta 600 mil tokens da conta por mensagem. Resumir perto de 180 mil evita a trava e faz a conta durar mais.
// Nas contas de 20x fica o automático do Claude Code (pedido do Paulo: o limite delas é maior).
//
// O que se escreve: só a chave `autoCompactWindow` do settings.json do usuário, em número (o Claude Code ignora "180k"
// ali e valores abaixo de 100 mil; conferido no 2.1.296). Um `/autocompact` da pessoa grava por modelo
// (`modelSettings`), e esse vence o daqui. Valor que a pessoa escreveu à mão na mesma chave também é dela: o agente só
// muda ou tira o que ele mesmo escreveu.

import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import type { ContaLocal } from "./estado.js";

/** A janela que o agente usa de fábrica nas contas que não são 20x. */
export const RESUMO_PADRAO = 180_000;
export const RESUMO_MINIMO = 100_000;
export const RESUMO_MAXIMO = 1_000_000;

/** Conta de 20x (limite maior): fica no automático do Claude Code. */
export function contaGrande(conta: ContaLocal | null | undefined): boolean {
  return /20x/i.test(conta?.tier ?? "");
}

/** A janela para a conta em uso: um número, ou null para o automático do Claude Code (ou com o resumo desligado). */
export function janelaDaConta(conta: ContaLocal | null | undefined, config: number | false): number | null {
  if (config === false || !conta) return null;
  return contaGrande(conta) ? null : config;
}

/** "180k", "180 mil", "180000" → 180000; fora de 100 mil a 1 milhão, ou ilegível, null. */
export function lerJanela(texto: string): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(k|mil|m)?\s*$/i.exec(texto);
  if (!m) return null;
  const n = Number(m[1]!.replace(",", "."));
  const unidade = (m[2] ?? "").toLowerCase();
  const v = Math.round(unidade === "m" ? n * 1_000_000 : unidade ? n * 1000 : n);
  return Number.isFinite(v) && v >= RESUMO_MINIMO && v <= RESUMO_MAXIMO ? v : null;
}

export interface ResultadoResumo {
  /** O que o agente deixou escrito (null: nada dele no arquivo). */
  escrito: number | null;
  /** Se o arquivo mudou agora. */
  mudou: boolean;
  /** A pessoa tem um valor próprio na chave: o agente não mexe. */
  daPessoa: boolean;
}

/**
 * Deixa o `autoCompactWindow` do settings.json em `desejado` (null: tira). Só mexe no que o próprio agente escreveu
 * (`escritoAntes`); arquivo ilegível fica como está.
 */
export function aplicarResumo(arquivo: string, desejado: number | null, escritoAntes: number | null): ResultadoResumo {
  let dados: Record<string, unknown> = {};
  let modo = 0o644;
  try {
    const bruto = fs.readFileSync(arquivo, "utf8");
    const v = JSON.parse(bruto) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return { escrito: escritoAntes, mudou: false, daPessoa: false };
    dados = v as Record<string, unknown>;
    modo = fs.statSync(arquivo).mode & 0o777;
  } catch (e) {
    // sem arquivo, começa vazio; arquivo que não se lê (o Claude Code no meio de uma gravação?) fica para a próxima
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") return { escrito: escritoAntes, mudou: false, daPessoa: false };
  }
  const atual = dados.autoCompactWindow;
  if (atual !== undefined && atual !== escritoAntes) return { escrito: null, mudou: false, daPessoa: true };
  if (desejado === null) {
    if (atual === undefined) return { escrito: null, mudou: false, daPessoa: false };
    delete dados.autoCompactWindow;
  } else {
    if (atual === desejado) return { escrito: desejado, mudou: false, daPessoa: false };
    dados.autoCompactWindow = desejado;
  }
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const tmp = `${arquivo}.tmp.reveza.${process.pid}.${randomBytes(6).toString("hex")}`;
  fs.writeFileSync(tmp, JSON.stringify(dados, null, 2) + "\n", { mode: modo, flag: "wx" });
  fs.renameSync(tmp, arquivo);
  return { escrito: desejado, mudou: true, daPessoa: false };
}
