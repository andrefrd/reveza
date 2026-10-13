import { describe, expect, it } from "vitest"

import { janelaDoLogin, urlDeLogin } from "./dialogo-login"

describe("urlDeLogin", () => {
  it("abre só o login oficial em https", () => {
    expect(urlDeLogin("https://claude.ai/oauth/authorize?code=true&state=x")).toBe(
      "https://claude.ai/oauth/authorize?code=true&state=x"
    )
    expect(urlDeLogin("https://console.anthropic.com/oauth/authorize")).not.toBeNull()
  })
  it("aceita o login do Claude Code 2.1.29x, em claude.com (o painel jogava fora e a pessoa ficava sem o link)", () => {
    const u = "https://claude.com/cai/oauth/authorize?code=true&client_id=x&response_type=code&state=y"
    expect(urlDeLogin(u)).toBe(u)
    expect(urlDeLogin("https://platform.claude.com/oauth/code/callback")).not.toBeNull()
    expect(urlDeLogin("https://claude.com.exemplo.com/")).toBeNull()
    expect(urlDeLogin("https://exemploclaude.com/")).toBeNull()
  })
  it("recusa o que um computador mal-intencionado mandaria", () => {
    for (const v of [
      "http://claude.ai/oauth",
      "https://claude.ai.exemplo.com/oauth",
      "https://exemploclaude.ai/",
      "https://user:senha@claude.ai/",
      "https://claude.ai:8443/",
      "javascript:alert(1)",
      "https://exemplo.com/?claude.ai",
      42,
      null,
    ])
      expect(urlDeLogin(v)).toBeNull()
  })
})

describe("janelaDoLogin", () => {
  it("lê onde o login abriu no computador (agente 0.3.4+)", () => {
    expect(janelaDoLogin({ aberto: true, navegador: "Google Chrome", privado: true })).toEqual({
      aberto: true,
      navegador: "Google Chrome",
      privado: true,
    })
    expect(janelaDoLogin({ aberto: false, navegador: null, privado: false })).toEqual({
      aberto: false,
      navegador: null,
      privado: false,
    })
  })
  it("agente antigo (sem o campo) ou resposta estranha: nada, e o painel diz o texto de sempre", () => {
    for (const v of [undefined, null, "sim", 1, {}, { aberto: "true", privado: true }, { aberto: true }]) expect(janelaDoLogin(v)).toBeNull()
  })
  it("nome de navegador com qualquer coisa além de letras e espaço não aparece", () => {
    expect(janelaDoLogin({ aberto: true, navegador: "<img src=x onerror=alert(1)>", privado: true })?.navegador).toBeNull()
    expect(janelaDoLogin({ aberto: true, navegador: "x".repeat(41), privado: true })?.navegador).toBeNull()
  })
})
