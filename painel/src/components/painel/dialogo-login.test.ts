import { describe, expect, it } from "vitest"

import { urlDeLogin } from "./dialogo-login"

describe("urlDeLogin", () => {
  it("abre só o login oficial em https", () => {
    expect(urlDeLogin("https://claude.ai/oauth/authorize?code=true&state=x")).toBe(
      "https://claude.ai/oauth/authorize?code=true&state=x"
    )
    expect(urlDeLogin("https://console.anthropic.com/oauth/authorize")).not.toBeNull()
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
