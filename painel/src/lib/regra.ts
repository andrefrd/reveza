// A regra de alternar contas, para o simulador da página "Como funciona". É o espelho, em TypeScript, das funções
// decidir() e rvz_candidatas() do banco (nuvem/migracoes/0003_decidir.sql e 0024_conta_preferida.sql). Quem decide de
// verdade é o banco; isto aqui explica, com as mesmas condições e a mesma ordem. Olha um computador só: a troca pedida à
// mão (que a conta preferida não desfaz) e se o dono da preferida de outro está sem ela ficam por conta de quem chama.

import type { Modo, OrdemRodizio } from "@/dados/tipos"

export interface ContaRegra {
  id: string
  nome: string
  /** Uso da janela de 5 horas, 0 a 100. */
  p5: number
  /** Uso da semana, 0 a 100. */
  p7: number
  /** Uso da semana da família de modelo, quando o plano tem essa janela. */
  p7Familia?: number | null
  /** Menor = preferida. */
  prioridade: number
  reserva?: boolean
  pausada?: boolean
  precisaLogin?: boolean
  foraDaAgenda?: boolean
  /** Outro computador está com esta conta (atribuição ou posse). */
  ocupada?: boolean
  /** % máximo da semana: com a semana nesse ponto, a conta não é escolhida. */
  tetoSemana?: number | null
  /** Plano da semana: quanto já devia ter ido até agora. Acima disso, a conta vai para depois das outras. */
  ritmoEsperado?: number | null
  /** A conta preferida deste computador: vem antes de todas, e ele volta para ela quando ela fica livre. */
  preferida?: boolean
  /** Preferida de outro computador ligado: vem depois das outras, e quem está com ela devolve se tiver outra. */
  preferidaDeOutro?: boolean
}

export interface EntradaRegra {
  auto: boolean
  modo: Modo
  aviso: number
  troca: number
  contas: ContaRegra[]
  atualId: string | null
  /** Chegou a hora marcada do rodízio. */
  rodizioVenceu?: boolean
  ordemRodizio?: OrdemRodizio
  /** Uma sessão foi barrada pelo limite (troca na hora, sem esperar). */
  sessaoBateuLimite?: boolean
  segundosDesdeUltimaTroca?: number | null
  esperaMinimaS?: number
  /** Número em [0, 1) para o sorteio do rodízio (o teste passa um fixo). */
  sorteio?: () => number
}

/** Por que uma conta não entra (ou entra por último) na lista de candidatas. */
export type MotivoConta =
  | "atual"
  | "pausada"
  | "precisa_login"
  | "ocupada"
  | "fora_agenda"
  | "esgotada"
  | "acima_aviso"
  | "teto_semana"
  | "reserva"
  | "acima_ritmo"
  | "preferida"
  | "preferida_de_outro"

const BLOQUEIOS: MotivoConta[] = [
  "atual",
  "pausada",
  "precisa_login",
  "ocupada",
  "fora_agenda",
  "esgotada",
  "acima_aviso",
  "teto_semana",
]

export type MotivoDecisao =
  | "primeira_escolha"
  | "sem_conta_sem_livre"
  | "auto_desligada"
  | "fica_ate_limite"
  | "fica_abaixo_aviso"
  | "fica_aviso"
  | "fica_rodizio_cedo"
  | "troca_limite"
  | "troca_limiar"
  | "troca_sessao_limite"
  | "troca_rodizio"
  | "espera_minima"
  | "sem_livre"
  | "rodizio_sem_livre"
  | "troca_preferida"
  | "devolve_preferida"
  | "fica_preferida"

export interface AvaliacaoConta {
  id: string
  /** % efetivo: a maior entre as janelas. */
  efetivo: number
  motivos: MotivoConta[]
  candidata: boolean
  /** Posição na fila de candidatas (1 = a primeira); null quando não entra. */
  posicao: number | null
}

export interface Decisao {
  contaId: string | null
  trocou: boolean
  motivo: MotivoDecisao
  /** O banco grava um aviso (a conta em uso passou do limiar de aviso). */
  aviso: boolean
  /** O banco grava um alerta de "nenhuma conta livre". */
  alertaSemLivre: boolean
  usouReserva: boolean
  avaliacoes: AvaliacaoConta[]
  fila: string[]
}

export const ESPERA_MINIMA_PADRAO_S = 90

/** % efetivo: a maior entre 5 horas, semana e semana da família de modelo. */
export function efetivo(c: Pick<ContaRegra, "p5" | "p7" | "p7Familia">): number {
  return Math.max(c.p5 ?? 0, c.p7 ?? 0, c.p7Familia ?? 0)
}

/** As mesmas condições de rvz_candidatas: a conta atual e as de outro computador nunca entram. */
export function avaliarConta(c: ContaRegra, e: EntradaRegra): AvaliacaoConta {
  const ef = efetivo(c)
  const motivos: MotivoConta[] = []
  if (c.id === e.atualId) motivos.push("atual")
  if (c.pausada) motivos.push("pausada")
  if (c.precisaLogin) motivos.push("precisa_login")
  if (c.ocupada) motivos.push("ocupada")
  if (c.foraDaAgenda) motivos.push("fora_agenda")
  if (ef >= 100) motivos.push("esgotada")
  else if (ef >= e.aviso) motivos.push("acima_aviso")
  if (c.tetoSemana != null && c.p7 >= c.tetoSemana) motivos.push("teto_semana")
  if (c.reserva) motivos.push("reserva")
  if (c.ritmoEsperado != null && c.p7 > c.ritmoEsperado) motivos.push("acima_ritmo")
  if (c.preferida) motivos.push("preferida")
  if (c.preferidaDeOutro) motivos.push("preferida_de_outro")
  return {
    id: c.id,
    efetivo: ef,
    motivos,
    candidata: !motivos.some((m) => BLOQUEIOS.includes(m)),
    posicao: null,
  }
}

type ContaAvaliada = ContaRegra & { av: AvaliacaoConta; sorteio: number }

/**
 * A ordem de rvz_candidatas: a preferida deste computador primeiro; reserva por último, e a preferida de outro
 * computador logo antes dela; depois, no rodízio, o sorteio ou o menor uso; depois prioridade, quem está acima do ritmo
 * da semana por último e, por fim, o menor uso.
 */
function ordenar(lista: ContaAvaliada[], ordem: "preferencia" | OrdemRodizio): ContaAvaliada[] {
  return [...lista].sort((a, b) => {
    const p = Number(!!b.preferida) - Number(!!a.preferida)
    if (p) return p
    const r = Number(!!a.reserva) - Number(!!b.reserva)
    if (r) return r
    const o = Number(!!a.preferidaDeOutro) - Number(!!b.preferidaDeOutro)
    if (o) return o
    if (ordem === "aleatoria" && a.sorteio !== b.sorteio) return a.sorteio - b.sorteio
    if (ordem === "menor_uso" && a.av.efetivo !== b.av.efetivo) return a.av.efetivo - b.av.efetivo
    if (a.prioridade !== b.prioridade) return a.prioridade - b.prioridade
    const ra = Number(a.av.motivos.includes("acima_ritmo"))
    const rb = Number(b.av.motivos.includes("acima_ritmo"))
    if (ra !== rb) return ra - rb
    if (a.av.efetivo !== b.av.efetivo) return a.av.efetivo - b.av.efetivo
    return a.id.localeCompare(b.id)
  })
}

export function decidir(e: EntradaRegra): Decisao {
  const espera = e.esperaMinimaS ?? ESPERA_MINIMA_PADRAO_S
  const sorteio = e.sorteio ?? Math.random
  const contas: ContaAvaliada[] = e.contas.map((c) => ({ ...c, av: avaliarConta(c, e), sorteio: sorteio() }))
  const atual = contas.find((c) => c.id === e.atualId) ?? null
  const candidatas = contas.filter((c) => c.av.candidata)
  const fila = ordenar(candidatas, "preferencia")
  fila.forEach((c, i) => (c.av.posicao = i + 1))

  const resultado = (
    contaId: string | null,
    motivo: MotivoDecisao,
    extra: Partial<Pick<Decisao, "aviso" | "alertaSemLivre">> = {}
  ): Decisao => {
    const escolhida = contas.find((c) => c.id === contaId)
    return {
      contaId,
      trocou: contaId !== null && contaId !== (atual?.id ?? null),
      motivo,
      aviso: extra.aviso ?? false,
      alertaSemLivre: extra.alertaSemLivre ?? false,
      usouReserva: !!escolhida?.reserva && contaId !== (atual?.id ?? null),
      avaliacoes: contas.map((c) => c.av),
      fila: fila.map((c) => c.id),
    }
  }

  // Computador sem conta: recebe a melhor livre, mesmo com a troca automática desligada.
  if (!atual) {
    return fila[0] ? resultado(fila[0].id, "primeira_escolha") : resultado(null, "sem_conta_sem_livre")
  }
  if (!e.auto) return resultado(atual.id, "auto_desligada")

  const ef = atual.av.efetivo
  const gatilho = e.modo === "limite" ? 100 : e.troca
  const esperou = e.segundosDesdeUltimaTroca == null || e.segundosDesdeUltimaTroca >= espera

  if (e.sessaoBateuLimite || ef >= gatilho) {
    const proxima = fila[0]
    if (!proxima) return resultado(atual.id, "sem_livre", { alertaSemLivre: true })
    if (e.sessaoBateuLimite) return resultado(proxima.id, "troca_sessao_limite")
    if (!esperou) return resultado(atual.id, "espera_minima")
    return resultado(proxima.id, e.modo === "limite" ? "troca_limite" : "troca_limiar")
  }

  // Volta para a preferida quando ela está livre de novo.
  const preferida = contas.find((c) => c.preferida)
  if (preferida && preferida !== atual && preferida.av.candidata && esperou) {
    return resultado(preferida.id, "troca_preferida")
  }

  // Devolve a preferida de outro computador ligado, se houver outra boa (nem reserva nem preferida de um terceiro).
  if (atual.preferidaDeOutro && esperou) {
    const outra = fila.find((c) => !c.reserva && !c.preferidaDeOutro)
    if (outra) return resultado(outra.id, "devolve_preferida")
  }

  // No rodízio, o computador que está na preferida fica nela.
  if (e.modo === "rodizio" && e.rodizioVenceu && esperou && !atual.preferida) {
    const proxima = ordenar(candidatas, e.ordemRodizio ?? "aleatoria")[0]
    return proxima ? resultado(proxima.id, "troca_rodizio") : resultado(atual.id, "rodizio_sem_livre")
  }

  if (ef >= e.aviso) return resultado(atual.id, "fica_aviso", { aviso: true })
  if (e.modo === "limite") return resultado(atual.id, "fica_ate_limite")
  if (e.modo === "rodizio") {
    return resultado(atual.id, e.rodizioVenceu && atual.preferida ? "fica_preferida" : "fica_rodizio_cedo")
  }
  return resultado(atual.id, "fica_abaixo_aviso")
}

/** Rodízio: o intervalo real é sorteado entre 75% e 125% do escolhido. */
export function faixaRodizio(minutos: number): { min: number; max: number } {
  return { min: Math.round(minutos * 0.75), max: Math.round(minutos * 1.25) }
}

/** Trocas de rodízio por dia, contando o dia inteiro. */
export function trocasPorDia(minutos: number): number {
  return minutos > 0 ? Math.round((24 * 60) / minutos) : 0
}
