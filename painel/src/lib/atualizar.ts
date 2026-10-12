// O botão de atualizar o programa de um computador: o painel só pede ({ versao: "mais_nova" }); quem escolhe a versão,
// baixa e instala é o agente, só com versão oficial publicada e maior que a dele. O painel e a nuvem continuam sendo
// atualizados pelo instalador no computador principal (com os tokens).

import { compararVersao } from "@/dados/derivados"
import type { Comando, Computador, Evento } from "@/dados/tipos"

/** O corpo do pedido: nunca endereço nem caminho, só "a mais nova" (o agente confere tudo). */
export const PEDIDO_ATUALIZAR = { versao: "mais_nova" } as const

const SEMVER = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/

function maior(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return compararVersao(a, b) >= 0 ? a : b
}

/**
 * A versão que este computador pode receber: a mais nova publicada que o agente leu, ou a de outro computador que já
 * está na frente. Null quando ele já está nela (ou não há notícia de versão mais nova).
 */
export function versaoDisponivel(pc: Computador, versaoDosOutros: string | null = null): string | null {
  const publicada = pc.diagnostico?.versaoNova && SEMVER.test(pc.diagnostico.versaoNova) ? pc.diagnostico.versaoNova : null
  const alvo = maior(publicada, versaoDosOutros && SEMVER.test(versaoDosOutros) ? versaoDosOutros : null)
  if (!alvo) return null
  if (!SEMVER.test(pc.versao)) return alvo
  return compararVersao(alvo, pc.versao) > 0 ? alvo : null
}

export type AndamentoAtualizacao =
  | { fase: "pedido" }
  | { fase: "atualizando"; para: string | null; desde: string | null }
  | { fase: "concluida"; para: string }
  | { fase: "falhou"; motivo: string; para: string | null }
  | { fase: "sem_suporte" }

const MIN = 60_000

/** Os eventos de atualização deste computador, do mais novo para o mais velho. */
function eventosDe(pc: Computador, eventos: Evento[]): Evento[] {
  return eventos
    .filter((e) => e.dados?.computador === pc.id && typeof e.dados?.atualizacao === "string")
    .sort((a, b) => Date.parse(b.em) - Date.parse(a.em))
}

/**
 * Em que pé está a atualização deste computador: pelo pedido feito nesta tela (se houver), pelo que o agente manda no
 * diagnóstico e pelos eventos dele (pedida, concluída, falhou). Null quando não há nada a mostrar.
 */
export function andamentoDaAtualizacao(pc: Computador, cmd: Comando | null, eventos: Evento[], agora: Date): AndamentoAtualizacao | null {
  const t = agora.getTime()
  const desde = cmd ? Date.parse(cmd.criadoEm) - 5_000 : t - 60 * MIN
  const ev = eventosDe(pc, eventos).filter((e) => Date.parse(e.em) >= desde)
  const ultimo = ev[0]
  const para = (v: unknown) => (typeof v === "string" && SEMVER.test(v) ? v : null)
  if (cmd) {
    if (cmd.estado === "pendente") return { fase: "pedido" }
    if (cmd.estado === "reservado") return { fase: "atualizando", para: null, desde: cmd.criadoEm }
    const r = cmd.resposta ?? {}
    if (cmd.estado !== "feito") {
      const erro = typeof r.erro === "string" ? r.erro.slice(0, 300) : cmd.estado
      return { fase: "falhou", motivo: erro, para: null }
    }
    // agente de versão anterior: o "atualizar" dele só relê as contas
    if (r.atualizando !== true) return { fase: "sem_suporte" }
    const alvo = para(r.para)
    if (alvo && compararVersao(pc.versao, alvo) >= 0) return { fase: "concluida", para: alvo }
    if (ultimo?.dados?.atualizacao === "falhou") {
      return { fase: "falhou", motivo: String(ultimo.dados.motivo ?? "").slice(0, 300), para: alvo }
    }
    return { fase: "atualizando", para: alvo, desde: cmd.criadoEm }
  }
  // sem pedido desta tela (outra aba, Atualizar todos, ou sozinho de madrugada): pelo que o computador conta
  const emCurso = pc.diagnostico?.atualizacao
  if (ultimo?.dados?.atualizacao === "falhou") {
    return { fase: "falhou", motivo: String(ultimo.dados.motivo ?? "").slice(0, 300), para: para(ultimo.dados.para) }
  }
  if (ultimo?.dados?.atualizacao === "concluida" && t - Date.parse(ultimo.em) < 15 * MIN) {
    return { fase: "concluida", para: para(ultimo.dados.para) ?? pc.versao }
  }
  const alvo = para(ultimo?.dados?.para) ?? para(emCurso?.para)
  if ((ultimo?.dados?.atualizacao === "pedida" || emCurso) && alvo && compararVersao(pc.versao, alvo) < 0) {
    if (t - Date.parse(ultimo?.em ?? emCurso!.desde) < 30 * MIN) return { fase: "atualizando", para: alvo, desde: ultimo?.em ?? emCurso!.desde }
  }
  if (alvo && compararVersao(pc.versao, alvo) >= 0 && ultimo?.dados?.atualizacao === "pedida") return { fase: "concluida", para: alvo }
  return null
}

/** A versão dos computadores quando ela está na frente da do painel (o painel é atualizado no computador principal). */
export function painelAtras(versaoPainel: string, computadores: Computador[]): string | null {
  let maisNova: string | null = null
  for (const pc of computadores) if (!pc.revogado && SEMVER.test(pc.versao)) maisNova = maior(maisNova, pc.versao)
  return maisNova && SEMVER.test(versaoPainel) && compararVersao(maisNova, versaoPainel) > 0 ? maisNova : null
}

// ------------------------------------------------------------------------------------------------ pedidos em andamento

/** Os pedidos feitos nesta aba (computador → comando), para o cartão e a Saúde mostrarem o mesmo andamento. */
const pedidos = new Map<string, number>()
const ouvintes = new Set<() => void>()

export function guardarPedido(computadorId: string, comandoId: number): void {
  pedidos.set(computadorId, comandoId)
  for (const o of ouvintes) o()
}

export function pedidoDe(computadorId: string): number | null {
  return pedidos.get(computadorId) ?? null
}

export function assinarPedidos(fn: () => void): () => void {
  ouvintes.add(fn)
  return () => ouvintes.delete(fn)
}
