// A regra do simulador espelha decidir() do banco: os mesmos cenários de nuvem/testes/decidir.test.mjs.
import { describe, expect, it } from "vitest"

import { decidir, faixaRodizio, trocasPorDia, type ContaRegra, type EntradaRegra } from "./regra"

const conta = (id: string, p5: number, extra: Partial<ContaRegra> = {}): ContaRegra => ({
  id,
  nome: id,
  p5,
  p7: 0,
  prioridade: 100,
  ...extra,
})

const entrada = (e: Partial<EntradaRegra>): EntradaRegra => ({
  auto: true,
  modo: "limiar",
  aviso: 90,
  troca: 95,
  contas: [],
  atualId: "a",
  segundosDesdeUltimaTroca: 3600,
  ...e,
})

describe("regra de alternar (espelho de decidir())", () => {
  it("limiar: abaixo do aviso nada; no aviso avisa; na troca vai para a menos usada de mesma prioridade", () => {
    const outras = [conta("c", 30), conta("d", 5)]
    const abaixo = decidir(entrada({ contas: [conta("a", 50), ...outras] }))
    expect(abaixo).toMatchObject({ contaId: "a", trocou: false, motivo: "fica_abaixo_aviso", aviso: false })

    const noAviso = decidir(entrada({ contas: [conta("a", 91), ...outras] }))
    expect(noAviso).toMatchObject({ contaId: "a", trocou: false, motivo: "fica_aviso", aviso: true })

    const naTroca = decidir(entrada({ contas: [conta("a", 95), ...outras] }))
    expect(naTroca).toMatchObject({ contaId: "d", trocou: true, motivo: "troca_limiar" })
    expect(naTroca.fila).toEqual(["d", "c"])
  })

  it("troca automática desligada: não troca nem na troca", () => {
    const d = decidir(entrada({ auto: false, contas: [conta("a", 99), conta("c", 5)] }))
    expect(d).toMatchObject({ contaId: "a", trocou: false, motivo: "auto_desligada" })
  })

  it("computador sem conta recebe a primeira livre mesmo com a troca automática desligada", () => {
    const d = decidir(entrada({ auto: false, atualId: null, contas: [conta("a", 99), conta("c", 5)] }))
    expect(d).toMatchObject({ contaId: "c", trocou: true, motivo: "primeira_escolha" })
  })

  it("só no limite: 97% fica; 100% troca; sessão barrada troca na hora", () => {
    const base = { modo: "limite" as const }
    expect(decidir(entrada({ ...base, contas: [conta("a", 97), conta("c", 5)] }))).toMatchObject({
      contaId: "a",
      motivo: "fica_aviso",
    })
    expect(decidir(entrada({ ...base, contas: [conta("a", 100), conta("c", 5)] }))).toMatchObject({
      contaId: "c",
      motivo: "troca_limite",
    })
    expect(
      decidir(entrada({ ...base, sessaoBateuLimite: true, contas: [conta("a", 40), conta("c", 5)] }))
    ).toMatchObject({ contaId: "c", motivo: "troca_sessao_limite" })
  })

  it("espera mínima entre trocas, menos quando a sessão bateu o limite", () => {
    const contas = [conta("a", 99), conta("c", 5)]
    expect(decidir(entrada({ contas, segundosDesdeUltimaTroca: 10 }))).toMatchObject({
      contaId: "a",
      motivo: "espera_minima",
    })
    expect(decidir(entrada({ contas, segundosDesdeUltimaTroca: 10, sessaoBateuLimite: true }))).toMatchObject({
      contaId: "c",
      motivo: "troca_sessao_limite",
    })
  })

  it("sem conta livre: fica na atual e gera o alerta", () => {
    const d = decidir(entrada({ contas: [conta("a", 99), conta("c", 96)] }))
    expect(d).toMatchObject({ contaId: "a", trocou: false, motivo: "sem_livre", alertaSemLivre: true })
  })

  it("fora da fila: pausada, precisa de login, fora da agenda, teto da semana; reserva por último", () => {
    const contas = [
      conta("a", 99),
      conta("pausada", 1, { pausada: true }),
      conta("login", 1, { precisaLogin: true }),
      conta("agenda", 1, { foraDaAgenda: true }),
      conta("teto", 1, { tetoSemana: 50, p7: 60 }),
      conta("reserva", 1, { reserva: true }),
      conta("comum", 40),
    ]
    const d = decidir(entrada({ contas }))
    expect(d.contaId).toBe("comum")
    expect(d.fila).toEqual(["comum", "reserva"])
    const motivos = Object.fromEntries(d.avaliacoes.map((a) => [a.id, a.motivos]))
    expect(motivos.pausada).toContain("pausada")
    expect(motivos.login).toContain("precisa_login")
    expect(motivos.agenda).toContain("fora_agenda")
    expect(motivos.teto).toContain("teto_semana")

    const soReserva = decidir(entrada({ contas: contas.map((c) => (c.id === "comum" ? { ...c, pausada: true } : c)) }))
    expect(soReserva).toMatchObject({ contaId: "reserva", usouReserva: true })
  })

  it("a semana da família de modelo cheia tira a conta da fila", () => {
    const d = decidir(entrada({ contas: [conta("a", 99), conta("c", 5, { p7Familia: 100 })] }))
    expect(d).toMatchObject({ contaId: "a", motivo: "sem_livre" })
  })

  it("rodízio: fora da hora fica; na hora vai para outra livre (sorteada ou a menos usada)", () => {
    const contas = [conta("a", 20), conta("c", 30), conta("e", 10)]
    expect(decidir(entrada({ modo: "rodizio", contas }))).toMatchObject({ contaId: "a", motivo: "fica_rodizio_cedo" })
    expect(decidir(entrada({ modo: "rodizio", rodizioVenceu: true, ordemRodizio: "menor_uso", contas }))).toMatchObject(
      { contaId: "e", motivo: "troca_rodizio" }
    )
    const sorteada = decidir(
      entrada({ modo: "rodizio", rodizioVenceu: true, ordemRodizio: "aleatoria", contas, sorteio: () => 0.5 })
    )
    expect(["c", "e"]).toContain(sorteada.contaId)
    expect(sorteada.motivo).toBe("troca_rodizio")
  })

  it("rodízio na hora mas sem outra livre: fica", () => {
    const d = decidir(entrada({ modo: "rodizio", rodizioVenceu: true, contas: [conta("a", 20), conta("c", 92)] }))
    expect(d).toMatchObject({ contaId: "a", motivo: "rodizio_sem_livre" })
  })

  it("conta de outro computador nunca entra na fila", () => {
    const d = decidir(entrada({ contas: [conta("a", 99), conta("c", 5, { ocupada: true })] }))
    expect(d).toMatchObject({ contaId: "a", motivo: "sem_livre" })
  })

  it("acima do ritmo da semana vai para depois das outras de mesma prioridade", () => {
    const d = decidir(
      entrada({
        contas: [
          conta("a", 99),
          conta("rapida", 1, { p7: 70, ritmoEsperado: 40 }),
          conta("calma", 30, { p7: 20, ritmoEsperado: 40 }),
        ],
      })
    )
    expect(d.fila).toEqual(["calma", "rapida"])
  })

  it("faixa e frequência do rodízio", () => {
    expect(faixaRodizio(90)).toEqual({ min: 68, max: 113 })
    expect(trocasPorDia(90)).toBe(16)
    expect(trocasPorDia(0)).toBe(0)
  })
})
