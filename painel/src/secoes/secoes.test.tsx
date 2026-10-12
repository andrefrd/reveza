// Cada seção do painel montada com o que a nuvem entrega de verdade: as linhas no formato das tabelas, passando pelo
// mapeamento da FonteSupabase (dados/supabase.ts), para a pessoa administradora sem as duas etapas na sessão (aal1) e
// com um fator pendente, como na instalação de produção em 12/10/2026. Sem DOM: a renderização do servidor do React
// roda a fase de desenho de cada tela (onde a falta de um campo derruba a seção) e espera o que carrega sob demanda.

import * as React from "react"
import { prerenderToNodeStream } from "react-dom/static"
import { beforeAll, describe, expect, it, vi } from "vitest"

const linhas = vi.hoisted(() => {
  const agora = Date.now()
  const iso = (msAtras: number) => new Date(agora - msAtras).toISOString()
  const H = 3_600_000
  // a janela, o histórico e o resto do navegador que as telas leem ao desenhar
  const ouvinte = { addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
  const g = globalThis as unknown as Record<string, unknown>
  g.window = {
    location: {
      pathname: "/alertas",
      search: "",
      hash: "",
      origin: "https://painel.exemplo",
      href: "https://painel.exemplo/alertas",
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true
    },
    matchMedia: () => ({ matches: false, media: "", ...ouvinte }),
    history: { pushState() {}, replaceState() {} },
    scrollTo() {},
  }
  const guardado = new Map<string, string>()
  g.localStorage = {
    getItem: (k: string) => guardado.get(k) ?? null,
    setItem: (k: string, v: string) => void guardado.set(k, v),
    removeItem: (k: string) => void guardado.delete(k),
  }

  const contas = [
    ["c1", "ana@escritorio-a.exemplo", "Escritório A - Team Startup", "team", "5x", 0, 10],
    ["c2", "bia@escritorio-a.exemplo", "Escritório A - Team Startup", "team", "5x", 0, 20],
    ["c3", "caio@escritorio-a.exemplo", "Escritório A - Team Startup", "team", "5x", 0, 30],
    ["c4", "duda@escritorio-a.exemplo", "Escritório A - Team Startup", "team", "5x", 0, 40],
    ["c5", "edu@escritorio-b.exemplo", "Escritório B Team", "team", null, 1, 50],
    ["c6", "fulano@gmail.com", null, "max", "20x", 2, 60],
  ].map(([id, email, organizacao, plano, nivel, cor, prioridade]) => ({
    id,
    email,
    organizacao,
    plano,
    nivel,
    cor,
    prioridade,
    reserva: false,
    pausada: false,
    agenda: [],
    teto_semana: null,
    precisa_login: false,
    criado_em: iso(9 * 24 * H),
  }))
  const uso_janelas = contas.slice(0, 5).flatMap((c, i) => [
    {
      conta_id: c.id,
      tipo: "five_hour",
      pct: 12 + i * 17,
      reset_em: iso(-2 * H),
      lido_em: iso(60_000),
      fonte: "sessao",
    },
    {
      conta_id: c.id,
      tipo: "seven_day",
      pct: 30 + i * 9,
      reset_em: iso(-80 * H),
      lido_em: iso(60_000),
      fonte: "sessao",
    },
  ])
  const computadores = [
    {
      id: "pc1",
      nome: "Mac mini",
      sistema: "macos",
      versao: "0.1.4",
      visto_em: iso(4_000),
      revogado: false,
      diagnostico: {
        em: Math.floor((agora - 600_000) / 1000),
        conferencias: [{ id: "agente", nome: "Agente", situacao: "ok", detalhe: "versão 0.1.4" }],
      },
      criado_em: iso(8 * 24 * H),
    },
    {
      id: "pc2",
      nome: "MacBook",
      sistema: "macos",
      versao: "0.1.3",
      visto_em: iso(9_000),
      revogado: false,
      diagnostico: null,
      criado_em: iso(7 * 24 * H),
    },
    // os códigos de acesso criados e revogados antes do primeiro contato
    ...["pc3", "pc4"].map((id) => ({
      id,
      nome: "Computador novo",
      sistema: "pendente",
      versao: "",
      visto_em: null,
      revogado: true,
      diagnostico: null,
      criado_em: iso(2 * 24 * H),
    })),
  ]
  const config = [
    ["aviso", 90],
    ["troca", 95],
    ["modo", "limiar"],
    ["auto", true],
    ["rodizio_minutos", 90],
    ["rodizio_ordem", "aleatoria"],
    ["espera_entre_trocas_s", 90],
    ["fuso", "America/Fortaleza"],
    ["intervalo_s", 10],
    ["retomar_terminal", true],
    ["cofre_impressao", "a1b2c3d4"],
    ["alertas_ate", 24],
  ].map(([chave, valor]) => ({ chave, valor }))
  const eventos = [
    {
      id: 41,
      em: iso(5 * 60_000),
      tipo: "troca",
      texto: "Mac mini: bia → ana (limiar)",
      dados: { de: "c2", para: "c1", computador: "pc1", motivo: "limiar" },
    },
    {
      id: 40,
      em: iso(20 * 60_000),
      tipo: "aviso",
      texto: "bia em 91%",
      dados: { conta: "c2", pct: 91, origem: "nuvem" },
    },
    { id: 39, em: iso(H), tipo: "conexao", texto: "MacBook voltou", dados: { computador: "pc2" } },
    { id: 38, em: iso(2 * H), tipo: "info", texto: "computador novo pendente", dados: {} },
  ]
  return {
    agora,
    tabelas: {
      contas,
      uso_janelas,
      posse: [{ conta_id: "c1", computador_id: "pc1", motivo: "uso", expira_em: iso(-60_000) }],
      computadores,
      atribuicao: [
        { computador_id: "pc1", conta_id: "c1", motivo: "limiar", decidido_em: iso(5 * 60_000) },
        { computador_id: "pc2", conta_id: "c3", motivo: "computador sem conta", decidido_em: iso(H) },
      ],
      config,
      eventos,
      membros: [{ user_id: "u-admin", papel: "admin", nome: null, idioma: "pt-BR", criado_em: iso(9 * 24 * H) }],
      comandos: [
        {
          id: 7,
          computador_id: "pc1",
          acao: "diagnostico",
          estado: "feito",
          criado_em: iso(10 * 60_000),
          resposta: { ok: true },
        },
      ],
      chaves_api: [],
      convites: [],
      alertas: [] as Record<string, unknown>[],
      webhooks_saida: [],
    } as Record<string, Record<string, unknown>[]>,
  }
})

vi.mock("@/dados/cliente", () => {
  // Consulta encadeável do supabase-js (select, order, eq, in, is, gt, limit, range, maybeSingle) que resolve com as
  // linhas da tabela; o filtro de membros por user_id devolve uma linha só.
  function consulta(tabela: string) {
    let unica = false
    const q = {
      select: () => q,
      order: () => q,
      eq: () => q,
      in: () => q,
      is: () => q,
      gt: () => q,
      gte: () => q,
      lt: () => q,
      limit: () => q,
      range: () => q,
      maybeSingle: () => {
        unica = true
        return q
      },
      then: (ok: (r: unknown) => unknown, falha?: (e: unknown) => unknown) => {
        const dados = linhas.tabelas[tabela] ?? []
        return Promise.resolve({ data: unica ? (dados[0] ?? null) : dados, error: null }).then(ok, falha)
      },
    }
    return q
  }
  const cliente = {
    from: consulta,
    rpc: async (nome: string) => ({
      data:
        nome === "painel_validade_logins"
          ? [{ conta_id: "c1", expira_em: new Date(linhas.agora + 3 * 864e5).toISOString() }]
          : [],
      error: null,
    }),
    auth: {
      getUser: async () => ({ data: { user: { id: "u-admin", email: "admin@exemplo.com" } }, error: null }),
      mfa: {
        // um fator começado e não confirmado: a sessão fica em aal1 e o supabase-js não lista o fator em "totp"
        getAuthenticatorAssuranceLevel: async () => ({
          data: { currentLevel: "aal1", nextLevel: "aal1" },
          error: null,
        }),
        listFactors: async () => ({
          data: {
            all: [{ id: "f1", status: "unverified", factor_type: "totp", created_at: "2026-10-11T23:00:00Z" }],
            totp: [],
            phone: [],
          },
          error: null,
        }),
      },
    },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: async () => {},
  }
  return { supabase: () => cliente, urlSupabase: () => "https://projeto.exemplo.co" }
})

import { AuthDemo } from "@/auth/auth"
import { SessaoProvider } from "@/auth/sessao"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { DadosFixos } from "@/dados/contexto"
import { FonteSupabase } from "@/dados/supabase"
import type { Instantaneo } from "@/dados/tipos"
import { I18nProvider } from "@/i18n"
import { pintarPorWorkspace } from "@/lib/cores"
import { SECOES, type IdSecao } from "./rotas"

const TELAS: Record<IdSecao, () => Promise<{ default: React.ComponentType }>> = {
  visao: () => import("./visao-geral"),
  contas: () => import("./contas"),
  computadores: () => import("./computadores"),
  uso: () => import("./uso"),
  plano: () => import("./plano"),
  troca: () => import("./troca"),
  alertas: () => import("./alertas"),
  integracoes: () => import("./integracoes"),
  time: () => import("./time"),
  minhaConta: () => import("./minha-conta"),
  comoFunciona: () => import("./como-funciona"),
  saude: () => import("./saude"),
}

/** Desenha a tela inteira (esperando o que carrega sob demanda) e devolve o HTML e os erros de cada pedaço. */
async function desenhar(Tela: React.ComponentType, fonte: FonteSupabase, estado: Instantaneo) {
  const erros: unknown[] = []
  const { prelude } = await prerenderToNodeStream(
    <ThemeProvider>
      <I18nProvider>
        <TooltipProvider>
          <SessaoProvider auth={new AuthDemo()}>
            <DadosFixos fonte={fonte} estado={estado}>
              <Tela />
            </DadosFixos>
          </SessaoProvider>
        </TooltipProvider>
      </I18nProvider>
    </ThemeProvider>,
    { onError: (e) => void erros.push(e) }
  )
  let html = ""
  for await (const pedaco of prelude as unknown as AsyncIterable<unknown>) html += String(pedaco)
  return { html, erros }
}

let fonte: FonteSupabase
let estado: Instantaneo

beforeAll(async () => {
  fonte = new FonteSupabase()
  const lido = await fonte.carregar()
  estado = { ...lido, contas: pintarPorWorkspace(lido.contas) }
})

describe("telas com os dados da produção (admin em aal1, fator pendente, alertas vazios)", () => {
  it("o mapeamento entrega o que a produção tem", () => {
    expect(estado.eu).toMatchObject({ papel: "admin", aal: "aal1", totp: null })
    expect(estado.alertas).toEqual([])
    expect(estado.computadores.filter((c) => c.sistema === "pendente")).toHaveLength(2)
    expect(estado.config).toMatchObject({ fuso: "America/Fortaleza", auto: true, intervaloS: 10 })
  })

  it.each(SECOES.map((s) => s.id))("a seção %s desenha sem erro", async (id) => {
    const { default: Tela } = await TELAS[id]()
    const { html, erros } = await desenhar(Tela, fonte, estado)
    expect(erros).toEqual([])
    expect(html.length).toBeGreaterThan(200)
  })

  it("Alertas vazia mostra o convite para criar o primeiro, com o botão liberado", async () => {
    const { default: Tela } = await TELAS.alertas()
    const { html } = await desenhar(Tela, fonte, estado)
    expect(html).toContain("Nenhum alerta ainda")
    const botoes = [...html.matchAll(/<button([^>]*)>(?:<svg[^]*?<\/svg>)?Novo alerta<\/button>/g)]
    expect(botoes).toHaveLength(2)
    for (const [, atributos] of botoes) expect(atributos).not.toMatch(/\sdisabled=""/)
  })

  it("Alertas com um alerta de cada canal (e um canal que saiu) desenha sem erro", async () => {
    const { default: Tela } = await TELAS.alertas()
    const alertas = [
      { id: "a1", canal: "telegram", destino: { chat_id: "123", vault_id: "v1" }, eventos: ["sem_livre"], ativo: true },
      {
        id: "a2",
        canal: "email",
        destino: { para: "a@exemplo.com", de: "b@exemplo.com", vault_id: "v2" },
        eventos: ["troca", "limite"],
        ativo: false,
      },
      {
        id: "a3",
        canal: "webhook",
        destino: { url: "https://hook.exemplo.com/x", vault_id: "v3" },
        eventos: ["resumo_dia"],
        ativo: true,
      },
      { id: "a4", canal: "push", destino: {}, eventos: ["computador_parado"], ativo: true },
      // canal que já existiu (ntfy) ou que uma versão nova da nuvem crie: a tela não pode cair por causa dele
      {
        id: "a5",
        canal: "ntfy",
        destino: { servidor: "https://ntfy.sh", vault_id: "v5" },
        eventos: ["precisa_login", "evento_novo"],
        ativo: true,
      },
    ]
    linhas.tabelas.alertas = alertas
    try {
      const lido = await fonte.carregar()
      const { html, erros } = await desenhar(Tela, fonte, { ...lido, contas: pintarPorWorkspace(lido.contas) })
      expect(erros).toEqual([])
      expect(html).toContain("hook.exemplo.com")
    } finally {
      linhas.tabelas.alertas = []
    }
  })
})

describe("a caixa da tela quebrada", () => {
  async function caixa(erro: unknown) {
    const { SecaoQuebrou } = await import("@/App")
    const Tela = () => <SecaoQuebrou erro={erro} componentes={"\n    at Alertas"} aoTentar={() => {}} />
    return (await desenhar(Tela, fonte, estado)).html
  }

  it("mostra a mensagem do erro, tentar de novo e copiar detalhes", async () => {
    const html = await caixa(new TypeError("Cannot read properties of undefined (reading 'map')"))
    expect(html).toContain("Esta tela encontrou um dado que não soube mostrar")
    expect(html).toContain("Cannot read properties of undefined (reading &#x27;map&#x27;)")
    expect(html).toContain("Tentar de novo")
    expect(html).toContain("Copiar detalhes")
  })

  it("pedaço do build de uma versão anterior: pede para recarregar a página", async () => {
    const html = await caixa(
      new TypeError("Failed to fetch dynamically imported module: https://painel.exemplo/assets/alertas-5U9JIrVV.js")
    )
    expect(html).toContain("Saiu uma versão nova do painel")
    expect(html).toContain("Recarregar a página")
    expect(html).not.toContain("Tentar de novo")
    expect(html).toContain("Copiar detalhes")
  })
})
