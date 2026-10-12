// O Corrigir da tela Saúde: o painel só pede (comando "diagnostico" com { corrigir: true }) e mostra o que o computador
// respondeu, item a item. Quem decide o que consertar é o agente, numa lista fechada; nada daqui vira comando lá.

import { paraDiagnostico } from "@/dados/supabase"
import type { Comando, Diagnostico, ItemDiagnostico } from "@/dados/tipos"

/** O corpo do pedido: só o sim. */
export const PEDIDO_CORRIGIR = { corrigir: true } as const

/** Os itens com problema que o Corrigir tenta consertar. */
export function consertaveis(d: Diagnostico | null | undefined): ItemDiagnostico[] {
  return (d?.itens ?? []).filter((i) => i.ok !== true && i.conserto)
}

/** Mostra o botão Corrigir: há problema com conserto automático (agente que não conserta não manda `conserto`). */
export function podeCorrigir(d: Diagnostico | null | undefined): boolean {
  return consertaveis(d).length > 0
}

export type AndamentoConserto =
  | { fase: "pedido" }
  | { fase: "consertando" }
  | {
      fase: "feito"
      /** Os problemas de antes: corrigido, não deu, ou o que fazer. */
      itens: ItemDiagnostico[]
      corrigidos: number
      naoDeu: number
      /** A conferência de depois do conserto, inteira (a tela usa até o computador mandar a próxima). */
      diagnostico: Diagnostico | null
    }
  | { fase: "falhou"; motivo: string }

/** Em que pé está o pedido de conserto, lendo o comando (e a resposta que o computador deu). */
export function andamentoDoConserto(cmd: Comando | null, versao = ""): AndamentoConserto {
  if (!cmd || cmd.estado === "pendente") return { fase: "pedido" }
  if (cmd.estado === "reservado") return { fase: "consertando" }
  const resposta = cmd.resposta ?? {}
  if (cmd.estado !== "feito") {
    const erro = typeof resposta.erro === "string" ? resposta.erro.slice(0, 300) : ""
    return { fase: "falhou", motivo: erro || cmd.estado }
  }
  // agente que ainda não conserta responde só o diagnóstico (sem "corrigir"): nada foi tentado
  if (resposta.corrigir !== true) return { fase: "falhou", motivo: "sem_conserto" }
  const d = paraDiagnostico(resposta.diagnostico, versao)
  const itens = (d?.itens ?? []).filter((i) => i.consertado || (i.ok !== true && i.fazer))
  return {
    fase: "feito",
    itens,
    corrigidos: itens.filter((i) => i.consertado?.resultado === "corrigido").length,
    naoDeu: itens.filter((i) => i.consertado?.resultado === "nao_deu").length,
    diagnostico: d,
  }
}

/**
 * O diagnóstico a mostrar: o da resposta do conserto enquanto ele for o mais novo (o painel relê os computadores no
 * máximo a cada 15 s, e o agente manda a conferência nova só na busca seguinte); depois, o que o computador mandou.
 */
export function diagnosticoAtual(guardado: Diagnostico | null, andamento: AndamentoConserto | null): Diagnostico | null {
  return maisNovo(guardado, andamento?.fase === "feito" ? andamento.diagnostico : null)
}

/** O diagnóstico que um "Rodar agora" (comando "diagnostico" sem corrigir) devolveu, quando ele terminou. */
export function diagnosticoDoComando(cmd: Comando | null, versao = ""): Diagnostico | null {
  if (!cmd || cmd.estado !== "feito" || cmd.resposta?.corrigir === true) return null
  return paraDiagnostico(cmd.resposta?.diagnostico, versao)
}

/**
 * O mais novo, pelo `em`, entre o guardado na nuvem (que o agente manda sozinho a cada 10 min) e os que esta tela
 * acabou de pedir. No empate fica o primeiro (o guardado).
 */
export function maisNovo(...ds: (Diagnostico | null | undefined)[]): Diagnostico | null {
  let r: Diagnostico | null = null
  for (const d of ds) if (d && (!r || Date.parse(d.em) > Date.parse(r.em))) r = d
  return r
}
