import { describe, expect, it } from "vitest"

import { fraseValida } from "@/lib/ligacao"
import { FonteDemo, PALAVRAS, gerarDemo } from "./demo"
import { ErroPainel } from "./fonte"

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

  it("frase de ligação: 6 palavras da lista, cifradas para o navegador no caminho", async () => {
    const f = nova()
    const l = await f.pedirLigacao("pc-notebook")
    expect(fraseValida(l.palavras)).toBe(true)
    expect(l.palavras.every((p) => PALAVRAS.includes(p))).toBe(true)
    expect(new Date(l.expiraEm).getTime() - AGORA.getTime()).toBe(10 * 60_000)
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
