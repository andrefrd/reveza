import { describe, expect, it } from "vitest"

import { traduzirMotivo } from "./evento"

describe("traduzirMotivo", () => {
  const t = ((k: string) => `[${k}]`) as never
  it("traduz o que o banco grava e devolve o resto como veio", () => {
    expect(traduzirMotivo("pedido pelo painel", { t })).toBe("[motivo.manual]")
    expect(traduzirMotivo("outro motivo", { t })).toBe("outro motivo")
  })
  it("nome de propriedade herdada não vira chave de tradução (não derruba a tela)", () => {
    for (const m of ["constructor", "__proto__", "toString", "hasOwnProperty"]) expect(traduzirMotivo(m, { t })).toBe(m)
  })
})

describe("textoEvento do conserto", () => {
  it("monta o texto pelos números do evento, no idioma da tela, sem ler o texto do computador", async () => {
    const { textoEvento } = await import("./evento")
    const t = ((k: string, v?: Record<string, unknown>) => `[${k}${v ? ` ${JSON.stringify(v)}` : ""}]`) as never
    const r = textoEvento(
      {
        id: 1,
        em: "2026-10-12T10:00:00.000Z",
        tipo: "info",
        texto: "Conserto pedido pelo painel: <qualquer coisa>",
        dados: { computador: "pc-1", conserto: true, comando: 3, corrigidos: 2, nao_deu: "x" },
      },
      { contas: [], computadores: [{ id: "pc-1", nome: "Desktop" } as never] },
      { t, tx: t, idioma: "pt-BR" } as never
    )
    expect(r.titulo).toContain("evento.conserto")
    expect(r.titulo).toContain("Desktop")
    expect(r.detalhe).toBe('[evento.consertoResumo {"corrigidos":2,"naoDeu":0}]')
  })
})
