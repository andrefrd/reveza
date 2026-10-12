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

describe("textoEvento da atualização", () => {
  const t = ((k: string, v?: Record<string, unknown>) => `[${k}${v ? ` ${JSON.stringify(v)}` : ""}]`) as never
  const estado = { contas: [], computadores: [{ id: "pc-1", nome: "MacBook" } as never] }
  const evento = (tipo: "info" | "erro" | "alerta", dados: Record<string, unknown>) => ({ id: 1, em: "2026-10-12T10:00:00.000Z", tipo, texto: "x", dados })
  it("de e para são versões (não contas), e a falha traz o motivo", async () => {
    const { textoEvento } = await import("./evento")
    const i = { t, tx: t, idioma: "pt-BR" } as never
    const p = textoEvento(evento("info", { computador: "pc-1", atualizacao: "pedida", de: "0.1.6", para: "0.1.7", sozinho: true }), estado, i)
    expect(p.titulo).toBe('[evento.atualizacaoPedida {"computador":"MacBook","de":"0.1.6","para":"0.1.7"}]')
    expect(p.detalhe).toBe("[evento.atualizacaoSozinho]")
    const f = textoEvento(evento("erro", { computador: "pc-1", atualizacao: "falhou", de: "0.1.6", para: "0.1.7", motivo: "não subiu" }), estado, i)
    expect(f.titulo).toContain("evento.atualizacaoFalhou")
    expect(f.detalhe).toBe("não subiu")
    const a = textoEvento(evento("alerta", { computador: "pc-1", motivo: "atualizacao_falhou", para: "0.1.7" }), estado, i)
    expect(a.titulo).toContain("evento.atualizacaoSozinhoFalhou")
    const lixo = textoEvento(evento("info", { computador: "pc-1", atualizacao: "pedida", de: "<script>", para: "../x" }), estado, i)
    expect(lixo.titulo).toContain('"de":"?","para":"?"')
  })
})
