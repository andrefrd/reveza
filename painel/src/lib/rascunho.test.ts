import { describe, expect, it } from "vitest"
import { camposMudados } from "./rascunho"

describe("rascunho de tela", () => {
  it("só o que se mexeu nesta tela e ficou diferente da base vai ao salvar", () => {
    const rascunho = { aviso: 85, troca: 95, atualizarSozinho: "desligada" }
    // outra aba ligou o "assim que sair" depois de este rascunho nascer
    const base = { aviso: 90, troca: 95, atualizarSozinho: "assim_que_sair" }
    expect(camposMudados(rascunho, base, new Set(["aviso"] as const))).toEqual({ aviso: 85 })
    expect(camposMudados(rascunho, base, new Set(["troca"] as const))).toEqual({})
    expect(camposMudados(rascunho, base, new Set())).toEqual({})
  })
})
