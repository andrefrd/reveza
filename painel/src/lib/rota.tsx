// Roteador mínimo por history API: o painel tem poucas rotas fixas, e o Vercel devolve o index.html para todas.

import * as React from "react"

const EVENTO = "reveza:rota"

function lerLocal() {
  return { caminho: window.location.pathname, busca: window.location.search }
}

export function navegar(destino: string, opcoes: { substituir?: boolean } = {}) {
  const url = new URL(destino, window.location.origin)
  if (url.origin !== window.location.origin) return
  const atual = window.location.pathname + window.location.search
  const novo = url.pathname + url.search + url.hash
  if (novo !== atual) {
    if (opcoes.substituir) window.history.replaceState(null, "", novo)
    else window.history.pushState(null, "", novo)
  }
  window.dispatchEvent(new Event(EVENTO))
  if (!url.hash) window.scrollTo({ top: 0 })
}

export function useRota() {
  const [local, setLocal] = React.useState(lerLocal)
  React.useEffect(() => {
    const ao = () => setLocal(lerLocal())
    window.addEventListener("popstate", ao)
    window.addEventListener(EVENTO, ao)
    return () => {
      window.removeEventListener("popstate", ao)
      window.removeEventListener(EVENTO, ao)
    }
  }, [])
  const parametros = React.useMemo(() => new URLSearchParams(local.busca), [local.busca])
  return { caminho: local.caminho, parametros }
}

/** Link interno: navega sem recarregar; com Ctrl/Cmd ou botão do meio, deixa o navegador abrir outra aba. */
export const Link = React.forwardRef<
  HTMLAnchorElement,
  React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }
>(function Link({ href, onClick, ...props }, ref) {
  return (
    <a
      ref={ref}
      href={href}
      onClick={(e) => {
        onClick?.(e)
        if (
          e.defaultPrevented ||
          e.button !== 0 ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey ||
          props.target === "_blank"
        )
          return
        e.preventDefault()
        navegar(href)
      }}
      {...props}
    />
  )
})
