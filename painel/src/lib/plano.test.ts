import { describe, expect, it } from "vitest"

import { inclinacaoMinimosQuadrados, planoSemana, preverEsgotar, usoPorDia } from "./plano"

const H = 3_600_000
const D = 24 * H

describe("plano da semana", () => {
  const agora = new Date("2026-10-08T12:00:00Z")
  const reset = new Date(agora.getTime() + 3 * D) // 4 dias já passaram

  it("cota por dia, esperado, ritmo e quanto cabe até renovar", () => {
    const p = planoSemana({ p7: 40, resetEm: reset, agora })!
    expect(p.cotaDia).toBeCloseTo(100 / 7)
    expect(p.esperadoAgora).toBeCloseTo((4 / 7) * 100)
    expect(p.ritmo).toBe("abaixo")
    expect(p.porDiaRestante).toBeCloseTo(60 / 3)
    expect(p.esgotaEm).toBeNull()
  })

  it("acima do ritmo prevê esgotar antes do reset", () => {
    const p = planoSemana({ p7: 90, resetEm: reset, agora })!
    expect(p.ritmo).toBe("acima")
    expect(p.esgotaEm).not.toBeNull()
    expect(p.esgotaEm!.getTime()).toBeLessThan(reset.getTime())
  })

  it("teto da semana vira o limite; esgotada e sem dado", () => {
    expect(planoSemana({ p7: 50, resetEm: reset, agora, teto: 50 })!.ritmo).toBe("esgotada")
    expect(planoSemana({ p7: null, resetEm: reset, agora })!.ritmo).toBe("sem_dado")
    expect(planoSemana({ p7: 10, resetEm: null, agora })).toBeNull()
  })

  it("uso de cada dia pela subida de p7, recomeçando no reset", () => {
    const inicio = new Date("2026-10-05T00:00:00Z")
    const pontos = [
      { em: "2026-10-05T01:00:00Z", p7: 0 },
      { em: "2026-10-05T20:00:00Z", p7: 10 },
      { em: "2026-10-06T10:00:00Z", p7: 25 },
      { em: "2026-10-07T10:00:00Z", p7: 5 },
      { em: "2026-10-07T12:00:00Z", p7: 8 },
    ]
    expect(usoPorDia(pontos, inicio)).toEqual([10, 15, 8, 0, 0, 0, 0])
  })
})

describe("previsão de esgotar", () => {
  const agora = new Date("2026-10-08T12:00:00Z")
  const serie = (passoPorHora: number, campo: "p5" | "p7", horas: number, base = 0) =>
    Array.from({ length: horas * 12 + 1 }, (_, i) => {
      const t = agora.getTime() - (horas * 12 - i) * 5 * 60_000
      const v = base + ((t - (agora.getTime() - horas * H)) / H) * passoPorHora
      return { em: new Date(t).toISOString(), p5: campo === "p5" ? v : null, p7: campo === "p7" ? v : null }
    })

  it("pela janela de 5 horas, no ritmo da última hora", () => {
    const pontos = serie(20, "p5", 1, 60) // 60% → 80% na última hora
    const p = preverEsgotar({
      pontos,
      agora,
      reset5: new Date(agora.getTime() + 3 * H),
      reset7: null,
      atual5: 80,
      atual7: null,
    })
    expect(p?.janela).toBe("cinco_horas")
    expect((p!.em.getTime() - agora.getTime()) / H).toBeCloseTo(1, 1)
  })

  it("não prevê se renova antes, se o uso caiu ou se já esgotou", () => {
    const pontos = serie(20, "p5", 1, 60)
    expect(
      preverEsgotar({
        pontos,
        agora,
        reset5: new Date(agora.getTime() + 0.5 * H),
        reset7: null,
        atual5: 80,
        atual7: null,
      })
    ).toBeNull()
    expect(
      preverEsgotar({ pontos: serie(-5, "p5", 1, 60), agora, reset5: null, reset7: null, atual5: 55, atual7: null })
    ).toBeNull()
    expect(preverEsgotar({ pontos, agora, reset5: null, reset7: null, atual5: 100, atual7: null })).toBeNull()
  })

  it("mínimos quadrados", () => {
    expect(
      inclinacaoMinimosQuadrados([
        { x: 0, y: 1 },
        { x: 1, y: 3 },
        { x: 2, y: 5 },
      ])
    ).toBeCloseTo(2)
    expect(
      inclinacaoMinimosQuadrados([
        { x: 0, y: 1 },
        { x: 1, y: 3 },
      ])
    ).toBeNull()
    expect(
      inclinacaoMinimosQuadrados([
        { x: 1, y: 1 },
        { x: 1, y: 3 },
        { x: 1, y: 5 },
      ])
    ).toBeNull()
  })
})
