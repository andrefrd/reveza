import * as React from "react"

import type { Idioma } from "@/dados/tipos"
import { en, pt, type Chave } from "./dicionario"
import { traduzir, traduzirPlural, type Variaveis } from "./traduzir"

const CHAVE_LOCAL = "reveza.idioma"

export function idiomaGuardado(): Idioma {
  try {
    const v = localStorage.getItem(CHAVE_LOCAL)
    if (v === "en" || v === "pt-BR") return v
  } catch {
    // sem armazenamento (janela privada, prévia): fica o padrão
  }
  return "pt-BR"
}

interface ContextoI18n {
  idioma: Idioma
  setIdioma: (i: Idioma) => void
  t: (chave: Chave, vars?: Variaveis) => string
  tn: (chave: string, n: number, vars?: Variaveis) => string
  /** Chave montada em tempo de execução (ex.: "erros." + código). Sem conferência de tipo. */
  tx: (chave: string, vars?: Variaveis) => string
}

const Contexto = React.createContext<ContextoI18n | null>(null)

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [idioma, setIdiomaEstado] = React.useState<Idioma>(idiomaGuardado)

  const setIdioma = React.useCallback((i: Idioma) => {
    setIdiomaEstado(i)
    try {
      localStorage.setItem(CHAVE_LOCAL, i)
    } catch {
      // ignora: a escolha vale só nesta aba
    }
  }, [])

  React.useEffect(() => {
    document.documentElement.lang = idioma
  }, [idioma])

  const valor = React.useMemo<ContextoI18n>(() => {
    const dic = idioma === "en" ? en : pt
    return {
      idioma,
      setIdioma,
      t: (chave, vars) => traduzir(dic, pt, chave, vars),
      tn: (chave, n, vars) => traduzirPlural(dic, pt, idioma, chave, n, vars),
      tx: (chave, vars) => traduzir(dic, pt, chave, vars),
    }
  }, [idioma, setIdioma])

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export function useT() {
  const c = React.useContext(Contexto)
  if (!c) throw new Error("useT fora do I18nProvider")
  return c
}

export type { Chave }
