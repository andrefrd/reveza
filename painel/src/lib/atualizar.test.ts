import { describe, expect, it } from "vitest"

import type { Comando, Computador, Evento } from "@/dados/tipos"
import { andamentoDaAtualizacao, guardarPedido, painelAtras, PEDIDO_ATUALIZAR, pedidoDe, pedidoRecente, versaoDisponivel } from "./atualizar"

const AGORA = new Date("2026-10-12T10:00:00.000Z")
const min = (n: number) => new Date(AGORA.getTime() + n * 60_000).toISOString()

const pc = (versao: string, extra: Partial<Computador> = {}): Computador => ({
  id: "pc-1",
  nome: "MacBook",
  sistema: "macos",
  versao,
  vistoEm: AGORA.toISOString(),
  revogado: false,
  criadoEm: min(-1000),
  diagnostico: { em: min(-5), versao, atrasoBuscaMs: 100, itens: [], versaoNova: "0.1.7" },
  atribuicao: null,
  ...extra,
})

const cmd = (estado: Comando["estado"], resposta: Record<string, unknown> | null = null): Comando => ({
  id: 9,
  computadorId: "pc-1",
  acao: "atualizar",
  estado,
  criadoEm: min(-2),
  resposta,
})

const ev = (minutos: number, dados: Evento["dados"], tipo: Evento["tipo"] = "info"): Evento => ({
  id: Math.round(1000 + minutos),
  em: min(minutos),
  tipo,
  texto: "",
  dados: { computador: "pc-1", ...dados },
})

describe("botão de atualizar do painel", () => {
  it("o pedido leva só 'a mais nova': nunca endereço nem caminho", () => {
    expect(PEDIDO_ATUALIZAR).toEqual({ versao: "mais_nova" })
  })

  it("versão disponível: a publicada que o agente leu, ou a de outro computador na frente; nada quando já está nela", () => {
    expect(versaoDisponivel(pc("0.1.6"))).toBe("0.1.7")
    expect(versaoDisponivel(pc("0.1.7"))).toBeNull()
    expect(versaoDisponivel(pc("0.1.8"))).toBeNull()
    expect(versaoDisponivel(pc("0.1.6", { diagnostico: null }), "0.1.8")).toBe("0.1.8")
    expect(versaoDisponivel(pc("0.1.6"), "0.1.10")).toBe("0.1.10")
    expect(versaoDisponivel(pc("0.1.6", { diagnostico: null }))).toBeNull()
  })

  it("andamento pelo pedido: pedido, atualizando, voltou na versão nova, ou falhou com o motivo", () => {
    expect(andamentoDaAtualizacao(pc("0.1.6"), cmd("pendente"), [], AGORA)).toEqual({ fase: "pedido" })
    expect(andamentoDaAtualizacao(pc("0.1.6"), cmd("reservado"), [], AGORA)?.fase).toBe("atualizando")
    const feito = cmd("feito", { ok: true, atualizando: true, de: "0.1.6", para: "0.1.7" })
    expect(andamentoDaAtualizacao(pc("0.1.6"), feito, [], AGORA)).toMatchObject({ fase: "atualizando", para: "0.1.7" })
    expect(andamentoDaAtualizacao(pc("0.1.7"), feito, [], AGORA)).toEqual({ fase: "concluida", para: "0.1.7" })
    const falha = [ev(-1, { atualizacao: "falhou", de: "0.1.6", para: "0.1.7", motivo: "o agente novo não respondeu em 30 s" }, "erro")]
    expect(andamentoDaAtualizacao(pc("0.1.6"), feito, falha, AGORA)).toEqual({
      fase: "falhou",
      motivo: "o agente novo não respondeu em 30 s",
      para: "0.1.7",
    })
    expect(andamentoDaAtualizacao(pc("0.1.6"), cmd("recusado", { ok: false, erro: "já está na versão mais nova (0.1.7)" }), [], AGORA)).toEqual({
      fase: "falhou",
      motivo: "já está na versão mais nova (0.1.7)",
      para: null,
    })
    expect(andamentoDaAtualizacao(pc("0.1.6"), cmd("expirado"), [], AGORA)?.fase).toBe("falhou")
    // agente de versão anterior: o "atualizar" dele só relê as contas
    expect(andamentoDaAtualizacao(pc("0.1.4"), cmd("feito", { ok: true }), [], AGORA)).toEqual({ fase: "sem_suporte" })
  })

  it("sem pedido desta tela (Atualizar todos, outra aba, sozinho de madrugada): pelos eventos e pelo diagnóstico", () => {
    expect(andamentoDaAtualizacao(pc("0.1.6"), null, [], AGORA)).toBeNull()
    expect(andamentoDaAtualizacao(pc("0.1.6"), null, [ev(-3, { atualizacao: "pedida", de: "0.1.6", para: "0.1.7" })], AGORA)).toMatchObject({
      fase: "atualizando",
      para: "0.1.7",
    })
    expect(andamentoDaAtualizacao(pc("0.1.7"), null, [ev(-1, { atualizacao: "concluida", de: "0.1.6", para: "0.1.7" })], AGORA)).toEqual({
      fase: "concluida",
      para: "0.1.7",
    })
    const comDiag = pc("0.1.6")
    comDiag.diagnostico!.atualizacao = { para: "0.1.7", desde: min(-4) }
    expect(andamentoDaAtualizacao(comDiag, null, [], AGORA)?.fase).toBe("atualizando")
    // velho demais: some da tela
    expect(andamentoDaAtualizacao(pc("0.1.6"), null, [ev(-90, { atualizacao: "pedida", de: "0.1.6", para: "0.1.7" })], AGORA)).toBeNull()
    // de outro computador: não conta
    const outro = { ...ev(-1, { atualizacao: "falhou", para: "0.1.7" }), dados: { computador: "pc-2", atualizacao: "falhou", para: "0.1.7" } }
    expect(andamentoDaAtualizacao(pc("0.1.6"), null, [outro], AGORA)).toBeNull()
  })

  it("o pedido desta aba fica guardado para o cartão e a Saúde, e o Atualizar todos não pede de novo por 15 minutos", () => {
    guardarPedido("pc-x", 42, AGORA.getTime())
    expect(pedidoDe("pc-x")).toBe(42)
    expect(pedidoRecente("pc-x", AGORA.getTime() + 14 * 60_000)).toBe(true)
    expect(pedidoRecente("pc-x", AGORA.getTime() + 16 * 60_000)).toBe(false)
    expect(pedidoRecente("pc-y", AGORA.getTime())).toBe(false)
  })

  it("o painel atrás dos computadores aparece (ele é atualizado no computador principal)", () => {
    expect(painelAtras("0.1.6", [pc("0.1.7"), pc("0.1.6")])).toBe("0.1.7")
    expect(painelAtras("0.1.7", [pc("0.1.7")])).toBeNull()
    expect(painelAtras("0.1.7", [pc("0.1.9", { revogado: true })])).toBeNull()
  })
})
