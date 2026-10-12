// Comandos que o painel mostra para o computador da pessoa. O repositório vem de VITE_REVEZA_REPO e a versão de
// VITE_REVEZA_VERSAO (o instalador preenche os dois); sem eles, fica o lugar marcado para trocar.

export type SistemaDoNavegador = "macos" | "windows" | "linux"

export function repositorio(): string {
  const r = (import.meta.env.VITE_REVEZA_REPO ?? "").trim()
  return /^[\w.-]+\/[\w.-]+$/.test(r) ? r : "<dono>/reveza"
}

export function versao(): string | null {
  const v = (import.meta.env.VITE_REVEZA_VERSAO ?? "").trim()
  return /^\d+\.\d+\.\d+$/.test(v) ? v : null
}

/**
 * O comando de instalar. Com a versão conhecida, baixa o pacote daquela versão direto do GitHub: funciona igual no
 * macOS, no Windows e no Linux, sem precisar do Git (o `npx github:...` precisa, e o Windows não vem com ele), e o
 * computador novo fica na mesma versão dos outros.
 */
export function comandoInstalador(extra = ""): string {
  const v = versao()
  const r = repositorio()
  const pacote = v && !r.startsWith("<") ? `https://github.com/${r}/archive/refs/tags/v${v}.tar.gz` : `github:${r}`
  return `npx ${pacote}${extra ? ` ${extra}` : ""}`
}

/** O sistema de quem está vendo o painel (para abrir as instruções certas primeiro). */
export function sistemaDoNavegador(nav: { userAgent?: string; platform?: string; userAgentData?: { platform?: string } } = navigator): SistemaDoNavegador {
  const p = `${nav.userAgentData?.platform ?? ""} ${nav.platform ?? ""} ${nav.userAgent ?? ""}`.toLowerCase()
  if (p.includes("win")) return "windows"
  if (p.includes("mac") || p.includes("iphone") || p.includes("ipad")) return "macos"
  return "linux"
}
