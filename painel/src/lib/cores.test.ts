import { describe, expect, it } from "vitest"

import {
  N_TONS,
  corConta,
  coresPorWorkspace,
  juntasPorWorkspace,
  pintarPorWorkspace,
  provedorPublico,
  workspaceDaConta,
} from "./cores"

type C = { id: string; email: string; organizacao: string | null; cor: number; criadaEm: string }

const dia = (n: number) => `2026-09-${String(n).padStart(2, "0")}T12:00:00.000Z`
const conta = (id: string, email: string, organizacao: string | null, cor: number, criada: number): C => ({
  id,
  email,
  organizacao,
  cor,
  criadaEm: dia(criada),
})

// O caso real que pediu a regra: 4 contas de um time, 1 de outro e 1 pessoal, cada uma com uma cor diferente.
const REAL: C[] = [
  conta("a", "um@escritorio.adv.br", "Escritório Exemplo - Time", 0, 1),
  conta("b", "dois@escritorio.adv.br", "Escritório Exemplo - Time", 1, 2),
  conta("c", "tres@escritorio.adv.br", "Escritório Exemplo - Time", 2, 3),
  conta("d", "quatro@escritorio.adv.br", "Escritório Exemplo - Time", 3, 4),
  conta("e", "socio@outra.com.br", "Outra Time", 4, 5),
  conta("f", "pessoa@gmail.com", "pessoa@gmail.com's Organization", 5, 6),
]

describe("workspace de cada conta", () => {
  it("agrupa pela organização, sem ligar para caixa e espaços", () => {
    const a = workspaceDaConta({ id: "1", email: "x@a.com", organizacao: "Escritório  Exemplo - Time " })
    const b = workspaceDaConta({ id: "2", email: "y@b.com", organizacao: "escritório exemplo - time" })
    expect(a.chave).toBe(b.chave)
    expect(a.nome).toBe("Escritório Exemplo - Time")
  })

  it("sem organização, agrupa pelo domínio do e-mail", () => {
    const a = workspaceDaConta({ id: "1", email: "Ana@Empresa.com.br", organizacao: null })
    const b = workspaceDaConta({ id: "2", email: "bia@empresa.com.br", organizacao: "  " })
    expect(a).toEqual({ chave: "dominio:empresa.com.br", nome: "empresa.com.br" })
    expect(b.chave).toBe(a.chave)
  })

  it("provedor público não agrupa: cada conta fica sozinha", () => {
    for (const d of ["gmail.com", "hotmail.com", "hotmail.com.br", "yahoo.com.br", "yahoo.co.uk", "uol.com.br"])
      expect(provedorPublico(d)).toBe(true)
    expect(provedorPublico("empresa.com.br")).toBe(false)
    expect(provedorPublico("liveworks.com")).toBe(false)
    const a = workspaceDaConta({ id: "1", email: "ana@gmail.com", organizacao: null })
    const b = workspaceDaConta({ id: "2", email: "bia@gmail.com", organizacao: null })
    expect(a.chave).not.toBe(b.chave)
    expect(a.nome).toBeNull()
  })

  it("a organização vence o domínio", () => {
    const cores = coresPorWorkspace([
      conta("a", "a@empresa.com", "Time A", 0, 1),
      conta("b", "b@empresa.com", "Time B", 1, 2),
    ])
    expect(cores.get("a")!.cor).not.toBe(cores.get("b")!.cor)
  })
})

describe("cor por workspace", () => {
  it("o caso real: as 4 do time ficam com a cor da mais antiga, e os 3 workspaces com cores diferentes", () => {
    const cores = coresPorWorkspace(REAL)
    expect(["a", "b", "c", "d"].map((id) => cores.get(id)!.cor)).toEqual([0, 0, 0, 0])
    expect(cores.get("e")!.cor).toBe(4)
    expect(cores.get("f")!.cor).toBe(5)
    expect(cores.get("a")!.contasNoWorkspace).toBe(4)
    expect(cores.get("f")!.workspace.nome).toBe("pessoa@gmail.com's Organization")
  })

  it("a cor do workspace é a cor gravada da conta mais antiga dele, não a da primeira da lista", () => {
    const cores = coresPorWorkspace([
      conta("nova", "nova@empresa.com", null, 6, 9),
      conta("velha", "velha@empresa.com", null, 3, 1),
    ])
    expect(cores.get("nova")!.cor).toBe(3)
    expect(cores.get("velha")!.cor).toBe(3)
  })

  it("cor gravada fora da paleta (o banco guarda 0..31) cai no índice 0..6", () => {
    const cores = coresPorWorkspace([conta("a", "a@empresa.com", null, 9, 1)])
    expect(cores.get("a")!.cor).toBe(2)
  })

  it("colisão: o workspace mais novo que quer a cor de um mais antigo fica com a primeira livre", () => {
    const cores = coresPorWorkspace([
      conta("a", "a@um.com", null, 0, 1),
      conta("b", "b@dois.com", null, 0, 2),
      conta("c", "c@tres.com", null, 1, 3),
    ])
    expect(cores.get("a")!.cor).toBe(0)
    expect(cores.get("b")!.cor).toBe(1)
    // a 1 já foi para "dois.com": "tres.com" fica com a próxima livre
    expect(cores.get("c")!.cor).toBe(2)
  })

  it("com mais workspaces que cores, repete a menos usada", () => {
    const contas = Array.from({ length: 8 }, (_, i) => conta(`x${i}`, `p${i}@gmail.com`, null, 0, i + 1))
    const cores = [...coresPorWorkspace(contas).values()].map((c) => c.cor)
    expect(new Set(cores.slice(0, 7)).size).toBe(7)
    expect(cores[7]).toBe(0)
  })

  it("tons: a mais antiga com a cor cheia, as seguintes cada uma num tom diferente", () => {
    const cores = coresPorWorkspace(REAL)
    expect(["a", "b", "c", "d"].map((id) => cores.get(id)!.tom)).toEqual([0, 1, 2, 3])
    expect(cores.get("e")!.tom).toBe(0)
    const valores = ["a", "b", "c", "d"].map((id) => corConta(cores.get(id)!.cor, cores.get(id)!.tom))
    expect(new Set(valores).size).toBe(4)
    expect(valores[0]).toBe("var(--conta-1)")
    for (const v of valores.slice(1)) expect(v).toMatch(/^color-mix\(in oklab, var\(--conta-1\) \d+%, var\(--/)
  })

  it("os tons são distintos até o último e depois se repetem", () => {
    const tons = Array.from({ length: N_TONS }, (_, t) => corConta(2, t))
    expect(new Set(tons).size).toBe(N_TONS)
    expect(corConta(2, N_TONS)).toBe(corConta(2, 0))
  })

  it("estável: reordenar ou filtrar a lista não repinta ninguém", () => {
    const base = coresPorWorkspace(REAL)
    const embaralhada = [REAL[4], REAL[2], REAL[5], REAL[0], REAL[3], REAL[1]]
    expect(coresPorWorkspace(embaralhada)).toEqual(base)
    expect(coresPorWorkspace([...REAL].reverse())).toEqual(base)
    // sem a conta "b", as outras do time seguem na mesma cor; "c" e "d" sobem um tom, mas a cor não muda
    const sem = coresPorWorkspace(REAL.filter((c) => c.id !== "b"))
    expect(sem.get("a")!.cor).toBe(base.get("a")!.cor)
    expect(sem.get("e")!.cor).toBe(base.get("e")!.cor)
    expect(sem.get("f")!.cor).toBe(base.get("f")!.cor)
  })

  it("empate na data de criação: desempata pelo id, em qualquer ordem", () => {
    const x = conta("x", "x@empresa.com", null, 4, 1)
    const y = conta("y", "y@empresa.com", null, 5, 1)
    expect(coresPorWorkspace([y, x]).get("y")!.cor).toBe(4)
    expect(coresPorWorkspace([x, y])).toEqual(coresPorWorkspace([y, x]))
  })

  it("juntasPorWorkspace: as do mesmo workspace lado a lado, na ordem de preferência e do tom 0 em diante", () => {
    const prioridade: Record<string, number> = { a: 30, b: 10, c: 90, d: 40, e: 20, f: 50 }
    const pintadas = pintarPorWorkspace(REAL).map((c) => ({ ...c, prioridade: prioridade[c.id] }))
    // o time tem a melhor prioridade (10, da "b"), depois "e" (20), depois "f" (50)
    expect(juntasPorWorkspace(pintadas).map((c) => c.id)).toEqual(["a", "b", "c", "d", "e", "f"])
    expect(juntasPorWorkspace([...pintadas].reverse()).map((c) => c.id)).toEqual(["a", "b", "c", "d", "e", "f"])
  })

  it("pintarPorWorkspace troca a cor pela do workspace e mantém o resto da conta", () => {
    const pintadas = pintarPorWorkspace(REAL)
    expect(pintadas.map((c) => c.id)).toEqual(REAL.map((c) => c.id))
    expect(pintadas.find((c) => c.id === "c")).toMatchObject({
      email: "tres@escritorio.adv.br",
      cor: 0,
      tom: 2,
      nomeWorkspace: "Escritório Exemplo - Time",
      contasNoWorkspace: 4,
    })
    // aplicar de novo não muda nada
    expect(pintarPorWorkspace(pintadas)).toEqual(pintadas)
  })
})
