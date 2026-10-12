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
