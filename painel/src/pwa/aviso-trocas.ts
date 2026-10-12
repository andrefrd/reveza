// "Avisar trocas de conta neste navegador": enquanto o painel está aberto (numa aba ou instalado), cada troca nova que
// chega pelo dado ao vivo vira notificação do sistema e um sinal curto. A escolha fica neste navegador (localStorage),
// não na conta: cada aparelho decide se avisa.

import * as React from "react"

import type { Evento } from "@/dados/tipos"

const CHAVE = "reveza.avisar-trocas"
const CHAVE_SOM = "reveza.avisar-trocas-som"
/** A última troca avisada, dividida entre as abas: duas abas abertas não avisam a mesma troca duas vezes. */
const CHAVE_ULTIMA = "reveza.ultima-troca-avisada"
const EVENTO = "reveza:aviso-trocas"

export interface PreferenciaAviso {
  ligado: boolean
  som: boolean
}

function ler(chave: string): string | null {
  try {
    return localStorage.getItem(chave)
  } catch {
    return null
  }
}

function gravar(chave: string, valor: string) {
  try {
    localStorage.setItem(chave, valor)
  } catch {
    // sem armazenamento (janela privada): vale até fechar a aba
  }
}

export function preferenciaAviso(): PreferenciaAviso {
  return { ligado: ler(CHAVE) === "1", som: ler(CHAVE_SOM) !== "0" }
}

export function guardarPreferencia(p: Partial<PreferenciaAviso>) {
  if (p.ligado !== undefined) gravar(CHAVE, p.ligado ? "1" : "0")
  if (p.som !== undefined) gravar(CHAVE_SOM, p.som ? "1" : "0")
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENTO))
}

/** A preferência, atualizada quando muda nesta aba ou em outra. */
export function usePreferenciaAviso(): PreferenciaAviso {
  const [p, setP] = React.useState(preferenciaAviso)
  React.useEffect(() => {
    const ao = () => setP(preferenciaAviso())
    window.addEventListener(EVENTO, ao)
    window.addEventListener("storage", ao)
    return () => {
      window.removeEventListener(EVENTO, ao)
      window.removeEventListener("storage", ao)
    }
  }, [])
  return p
}

/** As trocas que chegaram depois de `desde` (id do evento), da mais antiga para a mais nova. */
export function trocasNovas(eventos: readonly Evento[], desde: number): Evento[] {
  return eventos.filter((e) => e.tipo === "troca" && e.id > desde).sort((a, b) => a.id - b.id)
}

/**
 * Reserva as trocas para esta aba avisar: devolve só as que nenhuma outra aba avisou ainda e marca a mais nova.
 */
export function reservarTrocas(novas: readonly Evento[]): Evento[] {
  const ultima = Number(ler(CHAVE_ULTIMA) ?? 0) || 0
  const minhas = novas.filter((e) => e.id > ultima)
  if (minhas.length) gravar(CHAVE_ULTIMA, String(minhas[minhas.length - 1]!.id))
  return minhas
}

// ——— o sinal sonoro (Web Audio, gerado na hora: nenhum arquivo de som) ———

type ContextoAudio = Pick<
  AudioContext,
  "state" | "currentTime" | "destination" | "resume" | "createOscillator" | "createGain"
>

let contexto: ContextoAudio | null = null

/**
 * Prepara o som. Os navegadores só deixam tocar depois de um gesto da pessoa na página (clique, toque, tecla): esta
 * função é chamada no clique que liga a opção, no "Testar" e no primeiro gesto depois de recarregar.
 */
export function destravarSom(criar: () => ContextoAudio | null = criarContexto): ContextoAudio | null {
  if (!contexto) contexto = criar()
  if (contexto && contexto.state === "suspended") void contexto.resume().catch(() => {})
  return contexto
}

function criarContexto(): ContextoAudio | null {
  if (typeof window === "undefined") return null
  const C =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!C) return null
  try {
    return new C()
  } catch {
    return null
  }
}

/** As duas notas do sinal (lá e mi, subindo): curto e reconhecível, sem assustar. */
export const NOTAS = [
  { hz: 880, inicio: 0, duracao: 0.13 },
  { hz: 1318.5, inicio: 0.14, duracao: 0.2 },
] as const

/**
 * Toca o sinal curto. Devolve false quando o navegador ainda não deixou (nenhum gesto desde que a página abriu): a
 * notificação sai do mesmo jeito, só sem som.
 */
export function tocarSinal(ctx: ContextoAudio | null = contexto, volume = 0.18): boolean {
  if (!ctx || ctx.state !== "running") return false
  const t0 = ctx.currentTime + 0.01
  for (const n of NOTAS) {
    const osc = ctx.createOscillator()
    const ganho = ctx.createGain()
    osc.type = "sine"
    osc.frequency.setValueAtTime(n.hz, t0 + n.inicio)
    // ataque rápido e queda suave, sem estalo
    ganho.gain.setValueAtTime(0.0001, t0 + n.inicio)
    ganho.gain.exponentialRampToValueAtTime(volume, t0 + n.inicio + 0.015)
    ganho.gain.exponentialRampToValueAtTime(0.0001, t0 + n.inicio + n.duracao)
    osc.connect(ganho)
    ganho.connect(ctx.destination)
    osc.start(t0 + n.inicio)
    osc.stop(t0 + n.inicio + n.duracao + 0.02)
  }
  return true
}

/** Só para os testes: esquece o contexto de áudio. */
export function _zerarSom() {
  contexto = null
}
