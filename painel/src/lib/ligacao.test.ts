import { describe, expect, it } from "vitest"

import { codigoDeAcesso, lerCodigoDeAcesso } from "./ligacao"

describe("código de acesso do computador novo (rvzc_)", () => {
  const a = { u: "https://abcdefghijklmnopqrst.supabase.co", k: "chave-publica", e: "pc-1@computadores.reveza.invalid", s: "s".repeat(48) }

  it("vai e volta, e recusa o que não é código", () => {
    const c = codigoDeAcesso(a)
    expect(c).toMatch(/^rvzc_[A-Za-z0-9_-]+$/)
    expect(lerCodigoDeAcesso(c)).toEqual(a)
    expect(lerCodigoDeAcesso(` ${c}\n`)).toEqual(a)
    expect(lerCodigoDeAcesso("rvzc_!!")).toBeNull()
    expect(lerCodigoDeAcesso("outra coisa")).toBeNull()
  })

  it("leva só endereço, chave pública e a identidade pendente: nada de frase nem chave do cofre", () => {
    const c = codigoDeAcesso({ ...a, f: "abelha abismo abrigo acervo adega afeto" } as typeof a)
    const json = JSON.parse(atob(c.slice(5).replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - ((c.length - 5) % 4)) % 4)))
    expect(Object.keys(json).sort()).toEqual(["e", "k", "s", "u"])
  })

  it("os códigos de antes (rvzl_ com a frase do cofre, rvzpc_) não são lidos", () => {
    const corpo = btoa(JSON.stringify({ ...a, f: "uma duas tres quatro cinco seis" })).replace(/=+$/, "")
    expect(lerCodigoDeAcesso("rvzl_" + corpo)).toBeNull()
    expect(lerCodigoDeAcesso("rvzpc_" + corpo)).toBeNull()
  })
})
