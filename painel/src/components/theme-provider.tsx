import * as React from "react"

export type Tema = "dark" | "light" | "system"
type TemaResolvido = "dark" | "light"

const CONSULTA = "(prefers-color-scheme: dark)"
const CHAVE = "reveza.tema"

interface ContextoTema {
  theme: Tema
  resolvido: TemaResolvido
  setTheme: (t: Tema) => void
}

const Contexto = React.createContext<ContextoTema | undefined>(undefined)

function temaGuardado(): Tema {
  try {
    const v = localStorage.getItem(CHAVE)
    if (v === "dark" || v === "light" || v === "system") return v
  } catch {
    // sem armazenamento: segue o sistema
  }
  return "system"
}

function doSistema(): TemaResolvido {
  return window.matchMedia(CONSULTA).matches ? "dark" : "light"
}

function aplicar(resolvido: TemaResolvido) {
  const raiz = document.documentElement
  const estilo = document.createElement("style")
  estilo.appendChild(document.createTextNode("*,*::before,*::after{transition:none!important}"))
  document.head.appendChild(estilo)
  raiz.classList.remove("light", "dark")
  raiz.classList.add(resolvido)
  raiz.dataset.theme = resolvido
  const meta = document.querySelector('meta[name="theme-color"]')
  meta?.setAttribute("content", resolvido === "dark" ? "#0a0a0a" : "#fcfcfc")
  window.getComputedStyle(document.body)
  requestAnimationFrame(() => requestAnimationFrame(() => estilo.remove()))
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTema] = React.useState<Tema>(temaGuardado)
  const [sistema, setSistema] = React.useState<TemaResolvido>(doSistema)
  const resolvido = theme === "system" ? sistema : theme

  React.useEffect(() => {
    const mq = window.matchMedia(CONSULTA)
    const ao = () => setSistema(mq.matches ? "dark" : "light")
    mq.addEventListener("change", ao)
    return () => mq.removeEventListener("change", ao)
  }, [])

  React.useEffect(() => aplicar(resolvido), [resolvido])

  const setTheme = React.useCallback((t: Tema) => {
    setTema(t)
    try {
      localStorage.setItem(CHAVE, t)
    } catch {
      // vale só nesta aba
    }
  }, [])

  const valor = React.useMemo(() => ({ theme, resolvido, setTheme }), [theme, resolvido, setTheme])
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export function useTheme() {
  const c = React.useContext(Contexto)
  if (!c) throw new Error("useTheme fora do ThemeProvider")
  return c
}
