import { afterEach, describe, expect, it, vi } from "vitest"

import { comandoInstalador, sistemaDoNavegador } from "./instalador"

afterEach(() => vi.unstubAllEnvs())

describe("comando de instalar", () => {
  it("com a versão, baixa o pacote da versão (sem Git, igual nos três sistemas)", () => {
    vi.stubEnv("VITE_REVEZA_REPO", "dantaspaulo/reveza")
    vi.stubEnv("VITE_REVEZA_VERSAO", "0.1.3")
    expect(comandoInstalador("--ligar")).toBe("npx https://github.com/dantaspaulo/reveza/archive/refs/tags/v0.1.3.tar.gz --ligar")
  })

  it("sem a versão, cai no github: (instalação antiga ou modo demonstração)", () => {
    vi.stubEnv("VITE_REVEZA_REPO", "dantaspaulo/reveza")
    vi.stubEnv("VITE_REVEZA_VERSAO", "")
    expect(comandoInstalador()).toBe("npx github:dantaspaulo/reveza")
  })
})

describe("sistema de quem vê o painel", () => {
  it("reconhece Windows, macOS e o resto como Linux", () => {
    expect(sistemaDoNavegador({ userAgentData: { platform: "Windows" } })).toBe("windows")
    expect(sistemaDoNavegador({ platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)" })).toBe("macos")
    expect(sistemaDoNavegador({ platform: "Win32" })).toBe("windows")
    expect(sistemaDoNavegador({ platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux x86_64)" })).toBe("linux")
  })
})
