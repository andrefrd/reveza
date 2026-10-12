// Cada arquivo de textos traz o português e o inglês lado a lado; o tipo obriga o inglês a ter as mesmas chaves.

export type Folhas<T> = {
  [K in keyof T]: T[K] extends string ? string : Folhas<T[K]>
}

export function secao<T extends Record<string, unknown>>(textos: { pt: T; en: Folhas<T> }) {
  return textos
}
