import { describe, expect, it } from "vitest"

import {
  chaveDia,
  fmtDataHora,
  fmtDuracao,
  fmtFuturo,
  fmtPct,
  fmtRelativo,
  fmtTokens,
  fmtUsd,
  iniciais,
} from "./formato"

describe("formatação", () => {
  it("dinheiro nos dois idiomas, com o piso de 1 centavo", () => {
    expect(fmtUsd(1234.5, "pt-BR")).toBe("US$ 1.234,50")
    expect(fmtUsd(1234.5, "en")).toBe("$1,234.50")
    expect(fmtUsd(0.004, "pt-BR")).toBe("< US$ 0,01")
    expect(fmtUsd(0, "en")).toBe("$0.00")
    expect(fmtUsd(2196.4, "pt-BR", 0)).toBe("US$ 2.196")
  })

  it("tokens em forma curta", () => {
    expect(fmtTokens(950, "pt-BR")).toBe("950")
    expect(fmtTokens(1_234_567, "en")).toBe("1.2M")
    expect(fmtTokens(345_000, "en")).toBe("345K")
    expect(fmtTokens(902_100_000, "pt-BR")).toMatch(/^902,1\s?mi$/)
  })

  it("porcentagem a partir de 0 a 100, e traço sem valor", () => {
    expect(fmtPct(87, "pt-BR")).toBe("87%")
    expect(fmtPct(41.5, "pt-BR", 1)).toBe("41,5%")
    expect(fmtPct(41.5, "en", 1)).toBe("41.5%")
    expect(fmtPct(null, "en")).toBe("–")
  })

  it("duração com as duas maiores unidades", () => {
    expect(fmtDuracao(45, "pt-BR")).toBe("45 s")
    expect(fmtDuracao(180, "pt-BR")).toBe("3 min")
    expect(fmtDuracao(6720, "pt-BR")).toBe("1 h 52 min")
    expect(fmtDuracao(7200, "en")).toBe("2 h")
    expect(fmtDuracao(2 * 86400 + 3 * 3600 + 59, "pt-BR")).toBe("2 d 3 h")
    expect(fmtDuracao(-5, "pt-BR")).toBe("0 s")
  })

  it("tempo relativo e futuro", () => {
    const agora = new Date("2026-10-11T12:00:00-03:00")
    expect(fmtRelativo(new Date(agora.getTime() - 5000), agora, "pt-BR")).toBe("agora")
    expect(fmtRelativo(new Date(agora.getTime() - 180_000), agora, "pt-BR")).toBe("há 3 min")
    expect(fmtRelativo(new Date(agora.getTime() - 7_200_000), agora, "en")).toBe("2 h ago")
    expect(fmtRelativo(null, agora, "pt-BR")).toBe("nunca")
    expect(fmtFuturo(new Date(agora.getTime() + 4_800_000), agora, "pt-BR")).toBe("em 1 h 20 min")
    expect(fmtRelativo(new Date(agora.getTime() + 60_000), agora, "en")).toBe("in 1 min")
  })

  it("data e hora: dia da semana perto, data longe", () => {
    const agora = new Date("2026-10-11T12:00:00-03:00")
    expect(fmtDataHora("2026-10-09T15:31:00-03:00", agora, "pt-BR")).toBe("sex 15:31")
    expect(fmtDataHora("2026-09-16T09:28:00-03:00", agora, "pt-BR")).toBe("16 set 09:28")
    expect(fmtDataHora("2026-10-09T15:31:00-03:00", agora, "en")).toBe("Fri 03:31 PM")
  })

  it("chave do dia no fuso local e iniciais", () => {
    expect(chaveDia("2026-10-11T02:30:00Z")).toBe("2026-10-10")
    expect(iniciais("Ana Souza")).toBe("AS")
    expect(iniciais("ops@exemplo.com")).toBe("OP")
    expect(iniciais("conta.alfa@exemplo.com")).toBe("CA")
  })
})
