// Cor de cada conta: um índice estável (contas.cor) numa paleta de 7 cores validada para daltonismo, no claro e no
// escuro (src/index.css). A cor segue a conta, nunca a posição: filtrar ou reordenar não repinta ninguém.

export const N_CORES = 7

export const NOMES_CORES = ["azul", "ouro", "turquesa", "ameixa", "lima", "indigo", "verde"] as const

/** Normaliza qualquer índice (inclusive negativo) para 0..6. */
export function indiceCor(cor: number): number {
  return ((Math.trunc(cor) % N_CORES) + N_CORES) % N_CORES
}

/** Valor CSS da cor da conta, que troca sozinho entre claro e escuro. */
export function corConta(cor: number): string {
  return `var(--conta-${indiceCor(cor) + 1})`
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
