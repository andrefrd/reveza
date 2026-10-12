import { describe, expect, it } from "vitest"

import { abrirEnvelope, cifrarParaNavegador, codigoDeAcesso, codigoDeConfirmacao, codigoDeLigacao, criarPedido, fraseValida, lerCodigoDeAcesso } from "./ligacao"

describe("frase de ligação cifrada para o navegador", () => {
  it("ida e volta: só a chave privada deste navegador abre", async () => {
    const pedido = await criarPedido()
    expect(pedido.publica).not.toHaveProperty("d")
    const conteudo = { palavras: ["gato", "lua", "trem", "figo", "sino", "vela"], expiraEm: "2026-10-11T12:10:00Z" }
    const envelope = await cifrarParaNavegador(pedido.publica, conteudo)
    expect(JSON.stringify(envelope)).not.toContain("gato")
    expect(await abrirEnvelope(pedido.privada, envelope)).toEqual(conteudo)

    const outro = await criarPedido()
    await expect(abrirEnvelope(outro.privada, envelope)).rejects.toBeTruthy()
  })

  it("texto cifrado mexido não abre", async () => {
    const pedido = await criarPedido()
    const envelope = await cifrarParaNavegador(pedido.publica, { a: 1 })
    const bytes = atob(envelope.cifrado).split("")
    bytes[0] = String.fromCharCode(bytes[0].charCodeAt(0) ^ 1)
    await expect(abrirEnvelope(pedido.privada, { ...envelope, cifrado: btoa(bytes.join("")) })).rejects.toBeTruthy()
  })

  it("forma da frase", () => {
    expect(fraseValida(["gato", "lua", "trem", "figo", "sino", "vela"])).toBe(true)
    expect(fraseValida(["gato", "lua"])).toBe(false)
    expect(fraseValida(["Gato", "lua", "trem", "figo", "sino", "vela"])).toBe(false)
    expect(fraseValida("gato lua")).toBe(false)
  })
})

describe("código de acesso do computador novo", () => {
  it("vai e volta, e recusa o que não é código", () => {
    const a = { u: "https://abcdefghijklmnopqrst.supabase.co", k: "chave-publica", e: "pc-1@computadores.reveza.invalid", s: "s".repeat(48) }
    const c = codigoDeAcesso(a)
    expect(c).toMatch(/^rvzpc_[A-Za-z0-9_-]+$/)
    expect(lerCodigoDeAcesso(c)).toEqual(a)
    expect(lerCodigoDeAcesso("rvzpc_!!")).toBeNull()
    expect(lerCodigoDeAcesso("outra coisa")).toBeNull()
  })
})

describe("ligação em um passo", () => {
  it("o código de confirmação é o mesmo que o agente mostra na janela (mesma chave, mesmo código)", async () => {
    const publica = { kty: "EC", crv: "P-256", x: "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU", y: "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0" }
    // valor calculado pelo agente (agente/src/ligar.ts, codigoDeConfirmacao) para esta mesma chave
    expect(await codigoDeConfirmacao(publica)).toBe("A4X338")
  })

  it("o código de ligação junta o acesso e as 6 palavras, e o leitor do acesso não o confunde com o antigo", () => {
    const acesso = { u: "https://abcdefghijklmnopqrst.supabase.co", k: "anon", e: "pc@computadores.reveza.invalid", s: "senha" }
    const c = codigoDeLigacao(acesso, ["uma", "duas", "tres", "quatro", "cinco", "seis"])
    expect(c).toMatch(/^rvzl_[A-Za-z0-9_-]+$/)
    const t = c.slice(5).replace(/-/g, "+").replace(/_/g, "/")
    const json = JSON.parse(atob(t + "=".repeat((4 - (t.length % 4)) % 4)))
    expect(json).toEqual({ ...acesso, f: "uma duas tres quatro cinco seis" })
    expect(lerCodigoDeAcesso(c)).toBeNull()
  })
})
