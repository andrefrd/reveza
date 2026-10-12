// Cor das contas: um índice estável (contas.cor) numa paleta de 7 cores validada para daltonismo, no claro e no
// escuro (src/index.css). Contas do mesmo workspace dividem a mesma cor (coresPorWorkspace); onde há uma série por
// conta (gráficos), cada uma do workspace ganha um tom dessa cor. A cor segue o workspace, nunca a posição: filtrar ou
// reordenar não repinta ninguém.

export const N_CORES = 7

export const NOMES_CORES = ["azul", "ouro", "turquesa", "ameixa", "lima", "indigo", "verde"] as const

/** Normaliza qualquer índice (inclusive negativo) para 0..6. */
export function indiceCor(cor: number): number {
  return ((Math.trunc(cor) % N_CORES) + N_CORES) % N_CORES
}

/**
 * Os tons de uma cor, para distinguir as contas de um mesmo workspace num gráfico. O 0 é a cor cheia; os outros
 * alternam um passo para o lado do texto (mais escuro no claro, mais claro no escuro) e um para o lado do cartão.
 * Medido com o validador de rampa (dataviz, --ordinal) nas 7 cores, no claro e no escuro: passos de luminosidade
 * de 0,06 ou mais entre vizinhos e todos os tons com contraste de 2:1 ou mais sobre o cartão. O tom mais fraco
 * (o 4) só aparece a partir da 5ª conta do workspace; da 6ª em diante os tons se repetem e o nome na legenda separa.
 */
const TONS: readonly (readonly [string, number] | null)[] = [
  null,
  ["var(--foreground)", 72],
  ["var(--card)", 82],
  ["var(--foreground)", 50],
  ["var(--card)", 64],
]

export const N_TONS = TONS.length

function indiceTom(tom: number): number {
  return ((Math.trunc(tom) % N_TONS) + N_TONS) % N_TONS
}

/** Valor CSS da cor (e do tom) da conta, que troca sozinho entre claro e escuro. */
export function corConta(cor: number, tom = 0): string {
  const base = `var(--conta-${indiceCor(cor) + 1})`
  const passo = TONS[indiceTom(tom)]
  return passo ? `color-mix(in oklab, ${base} ${passo[1]}%, ${passo[0]})` : base
}

export const COR_OUTRAS = "var(--conta-outras)"

/** A primeira cor que nenhuma conta usa; se todas estiverem em uso, a menos repetida. */
export function proximaCorLivre(usadas: number[]): number {
  const contagem = new Array(N_CORES).fill(0)
  for (const c of usadas) contagem[indiceCor(c)] += 1
  let melhor = 0
  for (let i = 1; i < N_CORES; i++) if (contagem[i] < contagem[melhor]) melhor = i
  return melhor
}

/**
 * Para gráficos com uma série por conta: as que têm cor própria aparecem; a partir da 8ª (por volume), o resto vira
 * "Outras". Devolve o id da série de cada conta.
 */
export function seriesPorConta(contas: { id: string; volume: number }[], maximo = N_CORES): Map<string, string> {
  const ordenadas = [...contas].sort((a, b) => b.volume - a.volume)
  const mapa = new Map<string, string>()
  ordenadas.forEach((c, i) => mapa.set(c.id, i < maximo ? c.id : "outras"))
  return mapa
}

// ── workspace ──────────────────────────────────────────────────────────────

/** E-mail de provedor aberto ao público: o domínio não diz nada sobre o workspace, e a conta fica sozinha. */
const PROVEDORES_PUBLICOS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "uol.com.br",
  "bol.com.br",
  "terra.com.br",
])
/** yahoo.com, yahoo.com.br, yahoo.co.uk…, e as versões por país de hotmail, outlook e live (hotmail.com.br). */
const FAMILIAS_PUBLICAS = /^(yahoo\.[a-z.]+|(hotmail|outlook|live)\.(com?\.)?[a-z]{2})$/

export function provedorPublico(dominio: string): boolean {
  const d = dominio.trim().toLowerCase()
  return PROVEDORES_PUBLICOS.has(d) || FAMILIAS_PUBLICAS.test(d)
}

export interface IdentidadeWorkspace {
  /** O que agrupa: a organização (normalizada), o domínio do e-mail ou, sozinha, a própria conta. */
  chave: string
  /** Nome para a tela: a organização como veio, o domínio, ou null quando a conta está sozinha. */
  nome: string | null
}

type ContaParaCor = { id: string; email: string; organizacao: string | null; cor: number; criadaEm: string }

/**
 * O workspace de uma conta: a organização, quando o computador já leu; sem ela, o domínio do e-mail, menos os de
 * provedor público (gmail.com, outlook.com…), em que a conta fica sozinha.
 */
export function workspaceDaConta(c: Pick<ContaParaCor, "id" | "email" | "organizacao">): IdentidadeWorkspace {
  const org = (c.organizacao ?? "").normalize("NFKC").replace(/\s+/g, " ").trim()
  if (org) return { chave: `org:${org.toLowerCase()}`, nome: org }
  const email = c.email.trim().toLowerCase()
  const arroba = email.lastIndexOf("@")
  const dominio = arroba > 0 ? email.slice(arroba + 1) : ""
  if (dominio && !provedorPublico(dominio)) return { chave: `dominio:${dominio}`, nome: dominio }
  return { chave: `conta:${c.id}`, nome: null }
}

export interface CorDaConta {
  /** Índice da cor do workspace (0..6). */
  cor: number
  /** Tom dentro do workspace: 0 para a conta mais antiga, 1, 2… para as seguintes. */
  tom: number
  workspace: IdentidadeWorkspace
  /** Quantas contas o workspace tem. */
  contasNoWorkspace: number
}

const maisAntigaPrimeiro = (a: ContaParaCor, b: ContaParaCor) =>
  a.criadaEm.localeCompare(b.criadaEm) || a.id.localeCompare(b.id)

/**
 * A cor de cada conta pelo workspace. Os workspaces entram na ordem da conta mais antiga de cada um; a cor do
 * workspace é a `cor` gravada da conta mais antiga dele e, se um workspace anterior já ficou com ela, a primeira livre.
 * Dentro do workspace, a mais antiga fica com a cor cheia e as seguintes com os tons, na ordem em que entraram.
 * Determinística: a mesma lista em qualquer ordem dá o mesmo resultado.
 */
export function coresPorWorkspace(contas: readonly ContaParaCor[]): Map<string, CorDaConta> {
  const grupos = new Map<string, { workspace: IdentidadeWorkspace; contas: ContaParaCor[] }>()
  for (const c of [...contas].sort(maisAntigaPrimeiro)) {
    const w = workspaceDaConta(c)
    const g = grupos.get(w.chave)
    if (g) g.contas.push(c)
    else grupos.set(w.chave, { workspace: w, contas: [c] })
  }
  const usadas: number[] = []
  const resultado = new Map<string, CorDaConta>()
  for (const { workspace, contas: membros } of grupos.values()) {
    const desejada = indiceCor(membros[0].cor)
    const cor = usadas.includes(desejada) ? proximaCorLivre(usadas) : desejada
    usadas.push(cor)
    membros.forEach((c, i) => resultado.set(c.id, { cor, tom: i, workspace, contasNoWorkspace: membros.length }))
  }
  return resultado
}

/**
 * As contas com as do mesmo workspace juntas, para a pilha e a legenda de um gráfico lerem como um bloco de tons: os
 * workspaces pela melhor prioridade deles (a ordem de preferência) e, dentro de cada um, do tom 0 em diante.
 */
export function juntasPorWorkspace<T extends { id: string; prioridade: number; workspace?: string; tom?: number }>(
  contas: readonly T[]
): T[] {
  const chave = (c: T) => c.workspace ?? `conta:${c.id}`
  const melhor = new Map<string, number>()
  for (const c of contas) melhor.set(chave(c), Math.min(melhor.get(chave(c)) ?? Infinity, c.prioridade))
  return [...contas].sort(
    (a, b) =>
      melhor.get(chave(a))! - melhor.get(chave(b))! ||
      chave(a).localeCompare(chave(b)) ||
      (a.tom ?? 0) - (b.tom ?? 0) ||
      a.prioridade - b.prioridade
  )
}

/**
 * As contas como as telas usam: `cor` passa a ser a do workspace, e cada uma ganha o tom e o workspace dela.
 * Aplicado uma vez, no instantâneo que chega da fonte (dados/contexto).
 */
export function pintarPorWorkspace<T extends ContaParaCor>(
  contas: readonly T[]
): (T & { tom: number; workspace: string; nomeWorkspace: string | null; contasNoWorkspace: number })[] {
  const cores = coresPorWorkspace(contas)
  return contas.map((c) => {
    const p = cores.get(c.id)!
    return {
      ...c,
      cor: p.cor,
      tom: p.tom,
      workspace: p.workspace.chave,
      nomeWorkspace: p.workspace.nome,
      contasNoWorkspace: p.contasNoWorkspace,
    }
  })
}
