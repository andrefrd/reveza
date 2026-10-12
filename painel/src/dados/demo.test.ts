import { afterEach, describe, expect, it, vi } from "vitest"

import { coresPorWorkspace } from "@/lib/cores"
import { versaoMaisNova } from "@/dados/derivados"
import { andamentoDaAtualizacao, PEDIDO_ATUALIZAR, versaoDisponivel } from "@/lib/atualizar"
import { andamentoDoConserto, diagnosticoDoComando, podeCorrigir } from "@/lib/conserto"
import { FonteDemo, gerarDemo, versaoAnterior, versaoDemo } from "./demo"
import { faixasDeAlerta } from "./derivados"
import { ErroPainel } from "./fonte"
import PACOTE from "../../package.json"

afterEach(() => vi.unstubAllEnvs())

const AGORA = new Date("2026-10-08T15:20:00-03:00")
const nova = () => new FonteDemo({ agora: () => AGORA, atrasoMs: 0, relogio: false })

describe("FonteDemo", () => {
  it("gera 5 contas fictícias, 2 computadores, 30 dias de uso e eventos", async () => {
    const f = nova()
    const e = await f.carregar()
    expect(e.contas).toHaveLength(5)
    expect(e.computadores).toHaveLength(2)
    expect(e.contas.every((c) => c.email.endsWith("@exemplo.com"))).toBe(true)
    expect(e.eventos.length).toBeGreaterThan(5)
    const uso = await f.uso({
      de: new Date(AGORA.getTime() - 31 * 86_400_000),
      ate: new Date(AGORA.getTime() + 3_600_000),
    })
    const dias = new Set(uso.map((l) => l.hora.slice(0, 10)))
    expect(dias.size).toBeGreaterThanOrEqual(28)
    expect(uso.every((l) => l.usd >= 0 && l.entrada >= 0 && !l.projeto.includes("/"))).toBe(true)
    const sessoes = await f.sessoes({ de: new Date(AGORA.getTime() - 31 * 86_400_000), ate: AGORA })
    expect(sessoes.length).toBeGreaterThan(30)
  })

  it("é determinística pela semente", () => {
    const a = gerarDemo(AGORA, 7)
    const b = gerarDemo(AGORA, 7)
    const c = gerarDemo(AGORA, 8)
    expect(JSON.stringify(a.uso)).toBe(JSON.stringify(b.uso))
    expect(JSON.stringify(a.uso)).not.toBe(JSON.stringify(c.uso))
  })

  it("o histórico termina no uso que as contas mostram agora", () => {
    const d = gerarDemo(AGORA, 7)
    for (const c of d.contas) {
      const ultimo = d.historico.filter((p) => p.contaId === c.id).pop()
      const p7 = c.janelas.find((j) => j.tipo === "seven_day")?.pct
      if (!ultimo || p7 == null) continue
      expect(Math.abs((ultimo.p7 ?? 0) - p7)).toBeLessThan(1.5)
    }
  })

  it("devolve cópias: mexer no instantâneo não muda a fonte", async () => {
    const f = nova()
    const e = await f.carregar()
    e.contas[0].email = "mudado@exemplo.com"
    expect((await f.carregar()).contas[0].email).not.toBe("mudado@exemplo.com")
  })

  it("config: recusa aviso maior ou igual à troca, como o banco", async () => {
    const f = nova()
    await expect(f.salvarConfig({ aviso: 96 })).rejects.toBeInstanceOf(ErroPainel)
    await f.salvarConfig({ aviso: 80, troca: 85, modo: "rodizio" })
    const e = await f.carregar()
    expect(e.config).toMatchObject({ aviso: 80, troca: 85, modo: "rodizio" })
  })

  it("trocar agora: não pega conta de outro computador e grava evento e auditoria", async () => {
    const f = nova()
    await expect(f.trocarAgora("pc-notebook", "conta-pessoal")).rejects.toMatchObject({ codigo: "conta_ocupada" })
    await f.trocarAgora("pc-notebook", "conta-reserva")
    const e = await f.carregar()
    expect(e.computadores.find((c) => c.id === "pc-notebook")?.atribuicao?.contaId).toBe("conta-reserva")
    expect(e.eventos[0]).toMatchObject({ tipo: "troca", dados: { de: "conta-trabalho", para: "conta-reserva" } })
    expect((await f.auditoria(1))[0].acao).toBe("trocar")
  })

  it("chave de API no formato do banco, mostrada uma vez", async () => {
    const f = nova()
    const { chave } = await f.criarChave("teste", ["ler"])
    expect(chave).toMatch(/^rvz_[a-z0-9]{6}_[0-9a-f]{64}$/)
    const e = await f.carregar()
    expect(e.chaves[0].prefixo).toMatch(/^rvz_[a-z0-9]{6}$/)
    expect(JSON.stringify(e.chaves)).not.toContain(chave)
  })

  it("convite e webhook validam a entrada", async () => {
    const f = nova()
    await expect(f.convidar("sem-arroba", "leitura")).rejects.toMatchObject({ codigo: "email_invalido" })
    await expect(f.criarWebhook("http://inseguro.exemplo.com", ["troca"])).rejects.toMatchObject({
      codigo: "url_invalida",
    })
    await f.convidar("Nova@Exemplo.com", "admin")
    expect((await f.carregar()).convites.some((c) => c.email === "nova@exemplo.com")).toBe(true)
  })

  it("revogar computador solta as contas dele", async () => {
    const f = nova()
    await f.revogarComputador("pc-desktop")
    const e = await f.carregar()
    expect(e.computadores.find((c) => c.id === "pc-desktop")?.revogado).toBe(true)
    expect(e.contas.find((c) => c.id === "conta-pessoal")?.posse).toBeNull()
  })

  it("computador novo: aparece pendente, pede, a pessoa digita o código no escolhido e ele entra", async () => {
    let agora = AGORA.getTime()
    const f = new FonteDemo({ agora: () => new Date(agora), atrasoMs: 0, relogio: false })
    const { codigo, computadorId } = await f.criarAcessoComputador()
    expect(codigo).toMatch(/^rvzc_/)
    expect((await f.carregar()).computadores.find((c) => c.id === computadorId)?.sistema).toBe("pendente")
    await f.escolherAprovador(computadorId!, "pc-notebook")
    expect((await f.estadoLigacao(computadorId!)).fase).toBe("esperando_pedido")
    agora += 6_000
    const pedindo = await f.estadoLigacao(computadorId!)
    expect(pedindo.fase).toBe("esperando_codigo")
    expect(pedindo.aprovadorId).toBe("pc-notebook")
    agora += 10_000
    expect((await f.estadoLigacao(computadorId!)).fase).toBe("entregue")
    agora += 2_000
    expect((await f.estadoLigacao(computadorId!)).fase).toBe("ligado")
    expect((await f.carregar()).computadores.find((c) => c.id === computadorId)?.sistema).toBe("macos")
  })

  it("em inglês, os textos de exemplo saem em inglês (nomes, organizações, projetos, e-mails)", async () => {
    const f = new FonteDemo({ agora: () => AGORA, atrasoMs: 0, relogio: false, idioma: "en" })
    const e = await f.carregar()
    expect(e.eu.nome).toBe("Admin")
    expect(e.contas.map((c) => c.email)).toContain("work@example.com")
    expect(e.contas.map((c) => c.organizacao)).toContain("Example Company")
    const uso = await f.uso({ de: new Date(AGORA.getTime() - 3 * 86_400_000), ate: AGORA })
    const tudo = JSON.stringify([e, uso, await f.auditoria(50), await f.sessoes({ de: new Date(0), ate: AGORA })])
    expect(tudo).not.toMatch(/exemplo|Administração|Laboratório|loja-online|modelo-grande/)
    expect(e.contas[0].id).toBe("conta-trabalho") // ids não mudam
    f.usarIdioma("pt-BR")
    expect((await f.carregar()).eu.nome).toBe("Administração")
  })

  it("tem contas de um mesmo workspace, para a cor por workspace aparecer", () => {
    const d = gerarDemo(AGORA, 7)
    const cores = coresPorWorkspace(d.contas)
    const empresa = d.contas.filter((c) => c.organizacao === "Empresa Exemplo").map((c) => cores.get(c.id)!)
    expect(empresa.length).toBeGreaterThanOrEqual(2)
    expect(new Set(empresa.map((c) => c.cor)).size).toBe(1)
    expect(new Set(empresa.map((c) => c.tom)).size).toBe(empresa.length)
    expect(new Set([...cores.values()].map((c) => c.cor)).size).toBe(new Set(d.contas.map((c) => c.organizacao)).size)
  })

  it("os computadores mostram a versão do pacote, um deles uma atrás (o aviso de atualização aparece)", async () => {
    vi.stubEnv("VITE_REVEZA_VERSAO", "")
    expect(versaoDemo()).toBe(PACOTE.version)
    const e = await nova().carregar()
    const versoes = e.computadores.map((c) => c.versao)
    expect(versoes).toContain(PACOTE.version)
    expect(versoes).toContain(versaoAnterior(PACOTE.version) ?? PACOTE.version)
    expect(faixasDeAlerta(e, AGORA).some((f) => f.tipo === "versao_antiga")).toBe(
      versaoAnterior(PACOTE.version) !== null
    )
  })

  it("com a versão que o instalador passa no build, ela vale; a anterior sai dela, sem número fixo", async () => {
    vi.stubEnv("VITE_REVEZA_VERSAO", "0.1.5")
    const e = await nova().carregar()
    expect(e.computadores.map((c) => c.versao).sort()).toEqual(["0.1.4", "0.1.5"])
    const desktop = e.computadores.find((c) => c.versao === "0.1.4")!
    expect(desktop.diagnostico?.versao).toBe("0.1.4")
    expect(faixasDeAlerta(e, AGORA)).toContainEqual(
      expect.objectContaining({ tipo: "versao_antiga", computadorId: desktop.id })
    )
  })

  it("versão anterior: correção, versão menor, maior, e nenhuma antes da 0.0.0", () => {
    expect(versaoAnterior("0.1.5")).toBe("0.1.4")
    expect(versaoAnterior("0.1.10")).toBe("0.1.9")
    expect(versaoAnterior("0.2.0")).toBe("0.1.0")
    expect(versaoAnterior("1.0.0")).toBe("0.0.0")
    expect(versaoAnterior("0.0.0")).toBeNull()
  })

  it("atualizar leva o computador atrasado até a versão do pacote", async () => {
    vi.useFakeTimers({ now: AGORA })
    try {
      const f = new FonteDemo({ agora: () => AGORA, atrasoMs: 0, relogio: false, versao: "2.3.0" })
      const antes = await f.carregar()
      const atrasado = antes.computadores.find((c) => c.versao === "2.2.0")!
      await f.comando(atrasado.id, "atualizar", { ...PEDIDO_ATUALIZAR })
      await vi.runAllTimersAsync()
      const depois = await f.carregar()
      expect(depois.computadores.map((c) => c.versao)).toEqual(["2.3.0", "2.3.0"])
      expect(faixasDeAlerta(depois, AGORA).some((x) => x.tipo === "versao_antiga")).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it("Corrigir: o Desktop tem problema com conserto; o conserto resolve o mod e a conta e o relógio segue com o que fazer", async () => {
    vi.useFakeTimers()
    try {
      const f = nova()
      const antes = (await f.carregar()).computadores
      expect(podeCorrigir(antes.find((c) => c.id === "pc-notebook")!.diagnostico)).toBe(false)
      expect(podeCorrigir(antes.find((c) => c.id === "pc-desktop")!.diagnostico)).toBe(true)
      const cmd = await f.comando("pc-desktop", "diagnostico", { corrigir: true })
      expect(andamentoDoConserto(await f.lerComando(cmd.id)).fase).toBe("pedido")
      await vi.advanceTimersByTimeAsync(800)
      expect(andamentoDoConserto(await f.lerComando(cmd.id)).fase).toBe("consertando")
      await vi.advanceTimersByTimeAsync(2000)
      const a = andamentoDoConserto(await f.lerComando(cmd.id))
      expect(a).toMatchObject({ fase: "feito", corrigidos: 2, naoDeu: 0 })
      if (a.fase !== "feito") return
      expect(a.itens.map((i) => [i.id, i.consertado?.resultado ?? i.fazer?.slice(0, 6)])).toEqual([
        ["mod", "corrigido"],
        ["credenciais", "corrigido"],
        ["relogio", "acerte"],
      ])
      const e = await f.carregar()
      expect(podeCorrigir(e.computadores.find((c) => c.id === "pc-desktop")!.diagnostico)).toBe(false)
      expect(e.eventos[0]).toMatchObject({ tipo: "info", dados: { conserto: true, corrigidos: 2 } })
      expect((await f.auditoria(1))[0]).toMatchObject({ acao: "comando" })
      // o Rodar agora responde o diagnóstico, como o agente
      const rodar = await f.comando("pc-desktop", "diagnostico")
      await vi.advanceTimersByTimeAsync(2800)
      const rodado = diagnosticoDoComando(await f.lerComando(rodar.id), versaoAnterior(versaoDemo()) ?? versaoDemo())
      expect(rodado!.itens.find((i) => i.id === "credenciais")).toMatchObject({ ok: true })
      expect(rodado!.itens.find((i) => i.id === "relogio")).toMatchObject({ ok: false, fazer: expect.stringMatching(/^acerte/) })
    } finally {
      vi.useRealTimers()
    }
  })

  it("Atualizar: o Desktop tem versão nova; o pedido leva só 'a mais nova' e ele volta na versão nova", async () => {
    vi.useFakeTimers()
    try {
      const f = new FonteDemo({ agora: () => AGORA, atrasoMs: 0, relogio: false, versao: "2.3.0" })
      const antes = await f.carregar()
      const desktop = antes.computadores.find((c) => c.id === "pc-desktop")!
      const outros = versaoMaisNova(antes.computadores.map((c) => c.versao))
      expect(versaoDisponivel(desktop, outros)).toBe("2.3.0")
      expect(versaoDisponivel(antes.computadores.find((c) => c.id === "pc-notebook")!, outros)).toBeNull()
      const cmd = await f.comando("pc-desktop", "atualizar", { ...PEDIDO_ATUALIZAR })
      await vi.advanceTimersByTimeAsync(2700)
      let e = await f.carregar()
      expect(andamentoDaAtualizacao(e.computadores.find((c) => c.id === "pc-desktop")!, await f.lerComando(cmd.id), e.eventos, AGORA)).toMatchObject({
        fase: "atualizando",
        para: "2.3.0",
      })
      await vi.advanceTimersByTimeAsync(4100)
      e = await f.carregar()
      const depois = e.computadores.find((c) => c.id === "pc-desktop")!
      expect(depois.versao).toBe("2.3.0")
      expect(andamentoDaAtualizacao(depois, await f.lerComando(cmd.id), e.eventos, AGORA)).toEqual({ fase: "concluida", para: "2.3.0" })
      expect(e.eventos[0]).toMatchObject({ dados: { atualizacao: "concluida", de: "2.2.0", para: "2.3.0" } })
      expect((await f.auditoria(1)).some((a) => a.acao === "comando")).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it("atualizar sozinho de madrugada começa desligado e só administrador liga", async () => {
    const f = nova()
    expect((await f.carregar()).config.atualizarSozinho).toBe(false)
    await f.salvarConfig({ atualizarSozinho: true })
    expect((await f.carregar()).config.atualizarSozinho).toBe(true)
  })

  it("avisa quem assinou quando algo muda", async () => {
    const f = nova()
    let n = 0
    const cancelar = f.assinar(() => n++)
    await f.salvarConta("conta-reserva", { pausada: true })
    cancelar()
    await f.salvarConta("conta-reserva", { pausada: false })
    expect(n).toBe(1)
  })
})
