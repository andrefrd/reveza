import { describe, expect, it } from "vitest"

import { paraDiagnostico } from "@/dados/supabase"
import type { Comando } from "@/dados/tipos"
import { andamentoDoConserto, consertaveis, PEDIDO_CORRIGIR, podeCorrigir } from "./conserto"

const cmd = (estado: Comando["estado"], resposta: Record<string, unknown> | null = null): Comando => ({
  id: 1,
  computadorId: "pc",
  acao: "diagnostico",
  estado,
  criadoEm: "2026-10-12T10:00:00.000Z",
  resposta,
})

// o formato que o agente manda (doctor.ts): conferências com situação, conserto, fazer e consertado
const diagnosticoDoAgente = {
  em: "2026-10-12T10:00:00.000Z",
  versao: "0.1.5",
  conferencias: [
    { id: "servico", nome: "Serviço", situacao: "ok", detalhe: "rodando" },
    { id: "mod", nome: "Mod das sessões", situacao: "aviso", detalhe: "o mod não está carregado", conserto: "mod" },
    { id: "credenciais", nome: "Credencial em uso", situacao: "falha", detalhe: "nenhum login", conserto: "credenciais" },
    { id: "relogio", nome: "Relógio", situacao: "falha", detalhe: "diferença de 600 s", fazer: "acerte a data e a hora do sistema" },
  ],
}

describe("Corrigir na tela Saúde", () => {
  it("o pedido leva só o sim", () => {
    expect(PEDIDO_CORRIGIR).toEqual({ corrigir: true })
  })

  it("o botão aparece só com problema que tem conserto automático", () => {
    const d = paraDiagnostico(diagnosticoDoAgente, "0.1.5")!
    expect(consertaveis(d).map((i) => i.id)).toEqual(["mod", "credenciais"])
    expect(podeCorrigir(d)).toBe(true)
    // só problemas sem conserto (relógio): sem botão, cada um com o que fazer
    const so = paraDiagnostico({ ...diagnosticoDoAgente, conferencias: [diagnosticoDoAgente.conferencias[3]] }, "0.1.5")!
    expect(podeCorrigir(so)).toBe(false)
    expect(so.itens[0]).toMatchObject({ id: "relogio", ok: false, fazer: "acerte a data e a hora do sistema" })
    // agente antigo (sem o campo conserto) e tudo ok: sem botão
    expect(podeCorrigir(paraDiagnostico({ em: 1791700000, conferencias: [{ id: "mod", situacao: "aviso" }] }, "0.1.4"))).toBe(false)
    expect(podeCorrigir(null)).toBe(false)
  })

  it("acompanha o pedido: pedido, consertando, feito item a item, ou falhou com o motivo", () => {
    expect(andamentoDoConserto(null).fase).toBe("pedido")
    expect(andamentoDoConserto(cmd("pendente")).fase).toBe("pedido")
    expect(andamentoDoConserto(cmd("reservado")).fase).toBe("consertando")
    expect(andamentoDoConserto(cmd("expirado"))).toEqual({ fase: "falhou", motivo: "expirado" })
    expect(andamentoDoConserto(cmd("recusado", { ok: false, erro: "este agente não conserta pelo painel" }))).toEqual({
      fase: "falhou",
      motivo: "este agente não conserta pelo painel",
    })
    // agente da versão de antes: responde o diagnóstico e ignora o pedido de conserto
    expect(andamentoDoConserto(cmd("feito", { ok: true, diagnostico: diagnosticoDoAgente }))).toEqual({
      fase: "falhou",
      motivo: "sem_conserto",
    })
    const depois = {
      ...diagnosticoDoAgente,
      conferencias: [
        { id: "servico", nome: "Serviço", situacao: "ok", detalhe: "rodando" },
        {
          id: "mod",
          nome: "Mod das sessões",
          situacao: "ok",
          detalhe: "plugin instalado",
          consertado: { resultado: "corrigido", texto: "mod reinstalado (vale nas sessões novas)" },
        },
        {
          id: "credenciais",
          nome: "Credencial em uso",
          situacao: "falha",
          detalhe: "nenhum login",
          conserto: "credenciais",
          consertado: { resultado: "nao_deu", texto: "a nuvem ainda não mandou conta para este computador" },
        },
        diagnosticoDoAgente.conferencias[3],
      ],
    }
    const a = andamentoDoConserto(cmd("feito", { ok: true, corrigir: true, diagnostico: depois }))
    expect(a.fase).toBe("feito")
    if (a.fase !== "feito") return
    expect(a.corrigidos).toBe(1)
    expect(a.naoDeu).toBe(1)
    expect(a.itens.map((i) => [i.id, i.consertado?.resultado ?? "fazer"])).toEqual([
      ["mod", "corrigido"],
      ["credenciais", "nao_deu"],
      ["relogio", "fazer"],
    ])
    expect(a.itens[1].consertado!.texto).toBe("a nuvem ainda não mandou conta para este computador")
  })

  it("resposta de um computador comprometido não derruba a tela nem passa lixo adiante", () => {
    const lixo = {
      ok: true,
      corrigir: true,
      diagnostico: {
        em: 1791700000,
        conferencias: [
          { id: "x".repeat(500), situacao: "falha", consertado: { resultado: "<script>", texto: 7 }, fazer: ["rm"] },
          { id: "y", situacao: "falha", consertado: { resultado: "corrigido", texto: "z".repeat(5000) } },
        ],
      },
    }
    const a = andamentoDoConserto(cmd("feito", lixo))
    expect(a.fase).toBe("feito")
    if (a.fase !== "feito") return
    expect(a.itens).toHaveLength(1)
    expect(a.itens[0].id).toBe("y")
    expect(a.itens[0].consertado!.texto.length).toBe(400)
    expect(andamentoDoConserto(cmd("feito", { ok: true, corrigir: true, diagnostico: "lixo" }))).toMatchObject({ fase: "feito", itens: [] })
  })
})
