import { describe, expect, it } from "vitest"

import { paraDiagnostico } from "@/dados/supabase"
import type { Comando } from "@/dados/tipos"
import {
  andamentoDoConserto,
  consertaveis,
  diagnosticoAtual,
  diagnosticoDoComando,
  maisNovo,
  PEDIDO_CORRIGIR,
  podeCorrigir,
} from "./conserto"

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
    // a tela mostra a conferência de depois até o computador mandar uma mais nova
    const guardado = paraDiagnostico({ ...diagnosticoDoAgente, em: "2026-10-12T09:59:00.000Z" }, "0.1.5")
    expect(diagnosticoAtual(guardado, a)!.itens.find((i) => i.id === "mod")!.ok).toBe(true)
    const maisNovo = paraDiagnostico({ ...diagnosticoDoAgente, em: "2026-10-12T10:05:00.000Z" }, "0.1.5")
    expect(diagnosticoAtual(maisNovo, a)).toBe(maisNovo)
    expect(diagnosticoAtual(guardado, { fase: "consertando" })).toBe(guardado)
    expect(diagnosticoAtual(null, a)).toBe(a.diagnostico)
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

describe("Rodar agora na tela Saúde", () => {
  // o caso do MacBook do Paulo (12/10/2026): o guardado dizia "nenhum login"; o Rodar agora voltou com a conta
  const guardado = paraDiagnostico(
    {
      em: "2026-10-12T04:00:00.000Z",
      conferencias: [{ id: "credenciais", nome: "Credencial em uso", situacao: "falha", detalhe: "nenhum login em Claude Code-credentials" }],
    },
    "0.1.6"
  )
  const resposta = {
    ok: true,
    diagnostico: {
      em: "2026-10-12T04:12:00.000Z",
      conferencias: [{ id: "credenciais", nome: "Credencial em uso", situacao: "ok", detalhe: "pa@exemplo.com; token vence em 478 min" }],
    },
  }

  it("quando o comando volta, a tela mostra o diagnóstico da resposta (o mais novo), não o guardado", () => {
    const rodado = diagnosticoDoComando(cmd("feito", resposta), "0.1.6")
    expect(rodado!.itens[0]).toMatchObject({ id: "credenciais", ok: true, detalhe: "pa@exemplo.com; token vence em 478 min" })
    expect(maisNovo(guardado, rodado)).toBe(rodado)
    // o guardado ficou novo depois (o agente manda na busca seguinte): vale o mais novo
    const depois = paraDiagnostico({ ...resposta.diagnostico, em: "2026-10-12T04:13:00.000Z" }, "0.1.6")
    expect(maisNovo(depois, rodado)).toBe(depois)
    expect(maisNovo(rodado, null, undefined)).toBe(rodado)
    expect(maisNovo(null, undefined)).toBeNull()
  })

  it("só o comando terminado conta, e o do Corrigir fica com o andamento do conserto", () => {
    expect(diagnosticoDoComando(null)).toBeNull()
    expect(diagnosticoDoComando(cmd("reservado", resposta))).toBeNull()
    expect(diagnosticoDoComando(cmd("recusado", { ok: false, erro: "x" }))).toBeNull()
    expect(diagnosticoDoComando(cmd("feito", { ...resposta, corrigir: true }))).toBeNull()
    expect(diagnosticoDoComando(cmd("feito", { ok: true, diagnostico: "lixo" }))).toBeNull()
  })
})
