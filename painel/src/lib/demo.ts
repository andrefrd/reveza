// Modo demonstração: ?demo=1 liga dados de exemplo gerados no navegador, sem nuvem. Os links internos carregam o
// parâmetro, então a demonstração continua ao navegar e o endereço pode ser compartilhado.

export function emDemo(): boolean {
  if (typeof window === "undefined") return false
  return new URLSearchParams(window.location.search).get("demo") === "1"
}

export function comDemo(caminho: string, demo = emDemo()): string {
  if (!demo) return caminho
  const [base, hash] = caminho.split("#")
  const sep = base.includes("?") ? "&" : "?"
  return `${base}${sep}demo=1${hash ? `#${hash}` : ""}`
}

/** A nuvem está configurada neste build? (só a URL e a chave pública do Supabase entram no front) */
export function temNuvem(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
}
