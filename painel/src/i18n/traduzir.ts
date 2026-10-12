// Busca de texto por caminho ("contas.titulo"), troca de {variáveis} e plural. Sem dependência de React, para testar.

import type { Idioma } from "@/dados/tipos"

export type Variaveis = Record<string, string | number>

export function buscar(dic: unknown, chave: string): string | undefined {
  let atual: unknown = dic
  for (const parte of chave.split(".")) {
    if (atual && typeof atual === "object" && parte in (atual as object))
      atual = (atual as Record<string, unknown>)[parte]
    else return undefined
  }
  return typeof atual === "string" ? atual : undefined
}

export function interpolar(texto: string, vars?: Variaveis): string {
  if (!vars) return texto
  return texto.replace(/\{(\w+)\}/g, (inteiro, nome: string) => (nome in vars ? String(vars[nome]) : inteiro))
}

/**
 * Texto da chave no dicionário do idioma; se faltar, cai no reserva (português) e, em último caso, devolve a própria
 * chave (assim um texto esquecido aparece na tela em vez de sumir).
 */
export function traduzir(dic: unknown, reserva: unknown, chave: string, vars?: Variaveis): string {
  const texto = buscar(dic, chave) ?? buscar(reserva, chave) ?? chave
  return interpolar(texto, vars)
}

const regras = new Map<Idioma, Intl.PluralRules>()

/**
 * Plural: usa <chave>.zero quando n = 0 e ele existe, senão <chave>.um ou <chave>.outros pela regra do idioma
 * (no português, 0 cai em "outros": "0 contas").
 */
export function traduzirPlural(
  dic: unknown,
  reserva: unknown,
  idioma: Idioma,
  chave: string,
  n: number,
  vars?: Variaveis
): string {
  const todas = { n, ...vars }
  if (n === 0 && (buscar(dic, `${chave}.zero`) ?? buscar(reserva, `${chave}.zero`)))
    return traduzir(dic, reserva, `${chave}.zero`, todas)
  let regra = regras.get(idioma)
  if (!regra) {
    regra = new Intl.PluralRules(idioma)
    regras.set(idioma, regra)
  }
  const forma = n !== 0 && regra.select(n) === "one" ? "um" : "outros"
  return traduzir(dic, reserva, `${chave}.${forma}`, todas)
}
