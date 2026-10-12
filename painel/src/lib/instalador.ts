// Comandos que o painel mostra para o computador da pessoa. O repositório vem de VITE_REVEZA_REPO (o instalador
// preenche); sem ele, fica o lugar marcado para trocar.

export function repositorio(): string {
  const r = (import.meta.env.VITE_REVEZA_REPO ?? "").trim()
  return /^[\w.-]+\/[\w.-]+$/.test(r) ? r : "<dono>/reveza"
}

export function comandoInstalador(extra = ""): string {
  return `npx github:${repositorio()}${extra ? ` ${extra}` : ""}`
}
