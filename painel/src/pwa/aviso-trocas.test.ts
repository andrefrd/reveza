import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { textoDoAviso } from "@/components/painel/aviso-trocas"
import type { Evento } from "@/dados/tipos"
import { en, pt } from "@/i18n/dicionario"
import { traduzir, traduzirPlural } from "@/i18n/traduzir"
import {
  _zerarSom,
  destravarSom,
  guardarPreferencia,
  NOTAS,
  preferenciaAviso,
  reservarTrocas,
  tocarSinal,
  trocasNovas,
} from "./aviso-trocas"

const ev = (id: number, tipo: Evento["tipo"] = "troca", dados: Evento["dados"] = {}): Evento => ({
  id,
  em: "2026-10-12T04:00:00Z",
  tipo,
  texto: "",
  dados,
})

beforeEach(() => {
  const guardado = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => guardado.get(k) ?? null,
    setItem: (k: string, v: string) => void guardado.set(k, v),
  })
  vi.stubGlobal("window", { dispatchEvent: vi.fn() })
  _zerarSom()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("preferência deste navegador", () => {
  it("começa desligada, com som; guarda e avisa as outras partes da tela", () => {
    expect(preferenciaAviso()).toEqual({ ligado: false, som: true })
    guardarPreferencia({ ligado: true })
    guardarPreferencia({ som: false })
    expect(preferenciaAviso()).toEqual({ ligado: true, som: false })
    expect(window.dispatchEvent).toHaveBeenCalledTimes(2)
  })
})

describe("quais trocas avisar", () => {
  it("só as trocas depois da última vista, da mais antiga para a mais nova", () => {
    const eventos = [ev(44), ev(43, "aviso"), ev(42), ev(41), ev(40)]
    expect(trocasNovas(eventos, 41).map((e) => e.id)).toEqual([42, 44])
    expect(trocasNovas(eventos, 44)).toEqual([])
  })

  it("duas abas abertas não avisam a mesma troca duas vezes", () => {
    expect(reservarTrocas([ev(42), ev(44)]).map((e) => e.id)).toEqual([42, 44])
    // a outra aba recebe as mesmas e mais uma
    expect(reservarTrocas([ev(42), ev(44), ev(45)]).map((e) => e.id)).toEqual([45])
    expect(reservarTrocas([ev(45)])).toEqual([])
  })

  it("o texto sai no idioma da tela e com os nomes atuais de contas e computadores", () => {
    const estado = {
      contas: [
        { id: "c1", email: "ana@exemplo.com" },
        { id: "c2", email: "bia@exemplo.com" },
      ],
      computadores: [{ id: "pc1", nome: "Mac mini" }],
    } as unknown as Parameters<typeof textoDoAviso>[1]
    const i = (dic: typeof pt, idioma: "pt-BR" | "en") =>
      ({
        idioma,
        setIdioma: () => {},
        t: (k: string, v?: Record<string, string | number>) => traduzir(dic, pt, k, v),
        tx: (k: string, v?: Record<string, string | number>) => traduzir(dic, pt, k, v),
        tn: (k: string, n: number, v?: Record<string, string | number>) => traduzirPlural(dic, pt, idioma, k, n, v),
      }) as unknown as Parameters<typeof textoDoAviso>[2]
    const troca = ev(42, "troca", { computador: "pc1", de: "c2", para: "c1", motivo: "limiar" })
    const um = textoDoAviso([troca], estado, i(pt, "pt-BR"))
    expect(um.titulo).toBe("Troca de conta")
    expect(um.corpo).toContain("Mac mini: bia@exemplo.com → ana@exemplo.com")
    const varias = textoDoAviso([troca, ev(43, "troca", { computador: "pc1", para: "c2" })], estado, i(en, "en"))
    expect(varias.titulo).toBe("2 account switches")
    expect(varias.corpo.split("\n")).toHaveLength(2)
  })
})

describe("o sinal sonoro", () => {
  function audioFalso(estado: AudioContextState = "running") {
    const notas: number[] = []
    const ctx = {
      state: estado,
      currentTime: 10,
      destination: {},
      resume: vi.fn(async () => {
        ctx.state = "running"
      }),
      createOscillator: () => ({
        type: "",
        frequency: { setValueAtTime: (hz: number) => void notas.push(hz) },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      }),
      createGain: () => ({
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
      }),
    }
    return { ctx: ctx as unknown as AudioContext, notas }
  }

  it("toca as duas notas quando o navegador já deixou", () => {
    const { ctx, notas } = audioFalso("running")
    expect(tocarSinal(ctx)).toBe(true)
    expect(notas).toEqual(NOTAS.map((n) => n.hz))
  })

  it("sem gesto da pessoa (áudio suspenso) não toca; o gesto destrava", async () => {
    const { ctx, notas } = audioFalso("suspended")
    expect(tocarSinal(ctx)).toBe(false)
    expect(notas).toEqual([])
    const destravado = destravarSom(() => ctx)
    expect(ctx.resume).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    expect(tocarSinal(destravado)).toBe(true)
  })

  it("navegador sem Web Audio: não toca e não quebra", () => {
    expect(tocarSinal(null)).toBe(false)
    expect(destravarSom(() => null)).toBeNull()
  })
})
