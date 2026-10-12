/**
 * O que um rascunho de tela manda ao salvar: só os campos que a pessoa mexeu nesta tela e que ficaram diferentes da base.
 * Um rascunho aberto há tempo não regrava o que outra aba, outra tela ou outra pessoa mudou depois (a Troca guardava uma
 * cópia do "Atualizar sozinho" e, ao salvar, voltava o jeito de antes).
 */
export function camposMudados<T extends object>(rascunho: T, base: T, tocados: ReadonlySet<keyof T>): Partial<T> {
  const r: Partial<T> = {}
  for (const k of tocados) if (rascunho[k] !== base[k]) r[k] = rascunho[k]
  return r
}
