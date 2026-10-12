import { describe, expect, it } from "vitest"

import { en, pt } from "./dicionario"
import { buscar, interpolar, traduzir, traduzirPlural } from "./traduzir"

function folhas(o: unknown, prefixo = ""): Record<string, string> {
  const r: Record<string, string> = {}
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    const caminho = prefixo ? `${prefixo}.${k}` : k
    if (typeof v === "string") r[caminho] = v
    else Object.assign(r, folhas(v, caminho))
  }
  return r
}

const fPt = folhas(pt)
const fEn = folhas(en)

describe("i18n", () => {
  it("português e inglês têm exatamente as mesmas chaves", () => {
    expect(Object.keys(fEn).sort()).toEqual(Object.keys(fPt).sort())
  })

  it("nenhum texto vazio", () => {
    expect(Object.entries(fPt).filter(([, v]) => !v.trim())).toEqual([])
    expect(Object.entries(fEn).filter(([, v]) => !v.trim())).toEqual([])
  })

  it("as variáveis {x} são as mesmas nos dois idiomas", () => {
    const vars = (s: string) =>
      [...s.matchAll(/\{(\w+)\}/g)]
        .map((m) => m[1])
        .sort()
        .join(",")
    const diferentes = Object.keys(fPt).filter((k) => vars(fPt[k]) !== vars(fEn[k]))
    expect(diferentes).toEqual([])
  })

  it("sem nome de marca de terceiros do assistente nos textos", () => {
    const proibidas = /claude|anthropic|opus|sonnet|haiku/i
    expect(Object.entries(fPt).filter(([, v]) => proibidas.test(v))).toEqual([])
    expect(Object.entries(fEn).filter(([, v]) => proibidas.test(v))).toEqual([])
  })

  it("busca por caminho, troca variáveis e cai no português quando falta", () => {
    expect(buscar(pt, "menu.secoes.uso")).toBe("Uso")
    expect(buscar(pt, "menu.nao.existe")).toBeUndefined()
    expect(interpolar("Olá {nome}, {n} contas", { nome: "Ana", n: 3 })).toBe("Olá Ana, 3 contas")
    expect(interpolar("fica {x}", {})).toBe("fica {x}")
    expect(traduzir(en, pt, "menu.secoes.uso")).toBe("Usage")
    expect(traduzir({}, pt, "menu.secoes.uso")).toBe("Uso")
    expect(traduzir({}, {}, "chave.que.falta")).toBe("chave.que.falta")
    expect(traduzir(pt, pt, "computadores.versao", { versao: "0.4.2" })).toBe("versão 0.4.2")
  })

  it("plural: zero cai em 'outros' no português e usa .zero quando existe", () => {
    const dic = {
      c: { um: "{n} conta", outros: "{n} contas" },
      z: { zero: "nenhuma", um: "{n} conta", outros: "{n} contas" },
    }
    expect(traduzirPlural(dic, dic, "pt-BR", "c", 1)).toBe("1 conta")
    expect(traduzirPlural(dic, dic, "pt-BR", "c", 0)).toBe("0 contas")
    expect(traduzirPlural(dic, dic, "pt-BR", "c", 2)).toBe("2 contas")
    expect(traduzirPlural(dic, dic, "en", "z", 0)).toBe("nenhuma")
  })
})
