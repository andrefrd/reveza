// Modelo de cada conta: o `model` das configurações do Claude Code acompanha a conta em uso (pedido de um usuário,
// 13/10/2026: "quero poder escolher o modelo de cada conta"). O painel escolhe o modelo da conta; quando o computador
// passa para ela, o agente grava esse modelo no settings.json do usuário. Vale para as sessões que abrirem depois.
//
// O que se escreve: só a chave `model`. Conta sem modelo: o agente não mexe, e devolve o que a pessoa tinha se foi ele
// quem trocou. Valor que a pessoa escolheu (à mão ou pelo /model) é dela: fora da troca de conta e da mudança no
// painel, o agente não passa por cima. Na troca (ou quando o painel muda o modelo da conta em uso), o modelo da conta
// vence, e o da pessoa fica guardado para voltar quando a conta não tiver modelo.

import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { apagarSemErro } from "./util/arquivos.js";

export interface ResultadoModelo {
  /** O que o agente deixou escrito (null: nada dele no arquivo). */
  escrito: string | null;
  /** O que a pessoa tinha antes do agente escrever (null: não tinha a chave). Só vale com `escrito`. */
  original: string | null;
  /** Se o arquivo mudou agora. */
  mudou: boolean;
  /** A pessoa tem um modelo próprio na chave e o agente não mexeu. */
  daPessoa: boolean;
}

/**
 * Deixa o `model` do settings.json em `desejado` (null: o da pessoa). `escritoAntes`/`originalAntes` vêm da última
 * chamada. Sem `forcar`, um modelo que a pessoa escolheu fica; com `forcar` (troca de conta, painel), o da conta vence.
 * Arquivo ilegível fica como está.
 */
export function aplicarModelo(
  arquivo: string,
  desejado: string | null,
  escritoAntes: string | null,
  originalAntes: string | null,
  forcar: boolean,
): ResultadoModelo {
  const igual: ResultadoModelo = { escrito: escritoAntes, original: originalAntes, mudou: false, daPessoa: false };
  let dados: Record<string, unknown> = {};
  let modo = 0o644;
  try {
    const v = JSON.parse(fs.readFileSync(arquivo, "utf8")) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return igual;
    dados = v as Record<string, unknown>;
    modo = fs.statSync(arquivo).mode & 0o777;
  } catch (e) {
    // sem arquivo, começa vazio; arquivo que não se lê (o Claude Code no meio de uma gravação?) fica para a próxima
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") return igual;
  }
  const atual = dados.model;
  const nada: ResultadoModelo = { escrito: null, original: null, mudou: false, daPessoa: false };
  // algo que não é texto na chave não é do agente: não mexe
  if (atual !== undefined && typeof atual !== "string") return { ...nada, daPessoa: true };
  const daAgente = escritoAntes !== null && atual === escritoAntes;
  if (desejado === null) {
    if (!daAgente) return { ...nada, daPessoa: atual !== undefined && escritoAntes !== null };
    if (originalAntes === null) delete dados.model;
    else dados.model = originalAntes;
  } else {
    if (atual === desejado) return daAgente ? igual : nada;
    if (atual !== undefined && !daAgente && !forcar) return { ...nada, daPessoa: true };
  }
  const original = daAgente ? originalAntes : ((atual as string | undefined) ?? null);
  if (desejado !== null) dados.model = desejado;
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const tmp = `${arquivo}.tmp.reveza.${process.pid}.${randomBytes(6).toString("hex")}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(dados, null, 2) + "\n", { mode: modo, flag: "wx" });
    fs.renameSync(tmp, arquivo);
  } catch (e) {
    apagarSemErro(tmp);
    throw e;
  }
  return desejado === null ? { ...nada, mudou: true } : { escrito: desejado, original, mudou: true, daPessoa: false };
}
