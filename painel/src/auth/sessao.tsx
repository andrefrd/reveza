import * as React from "react"

import { comDemo } from "@/lib/demo"
import { navegar } from "@/lib/rota"
import type { Autenticacao, EstadoAuth } from "./auth"

interface ContextoSessao {
  auth: Autenticacao
  estado: EstadoAuth | null
  recarregar: () => Promise<EstadoAuth>
  sair: (todas?: boolean) => Promise<void>
}

const Contexto = React.createContext<ContextoSessao | null>(null)

export function SessaoProvider({ auth, children }: { auth: Autenticacao; children: React.ReactNode }) {
  const [estado, setEstado] = React.useState<EstadoAuth | null>(null)

  const recarregar = React.useCallback(async () => {
    try {
      const e = await auth.estado()
      setEstado(e)
      return e
    } catch {
      const vazio: EstadoAuth = { logado: false, email: null, aal: null, falta2fa: false, recuperacao: false }
      setEstado(vazio)
      return vazio
    }
  }, [auth])

  React.useEffect(() => {
    let vivo = true
    auth
      .estado()
      .then((e) => vivo && setEstado(e))
      .catch(() => vivo && setEstado({ logado: false, email: null, aal: null, falta2fa: false, recuperacao: false }))
    const cancelar = auth.aoMudar(() => void recarregar())
    return () => {
      vivo = false
      cancelar()
    }
  }, [auth, recarregar])

  const sair = React.useCallback(
    async (todas = false) => {
      await auth.sair(todas)
      await recarregar()
      navegar(comDemo("/entrar"))
    },
    [auth, recarregar]
  )

  const valor = React.useMemo(() => ({ auth, estado, recarregar, sair }), [auth, estado, recarregar, sair])
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export function useSessao() {
  const c = React.useContext(Contexto)
  if (!c) throw new Error("useSessao fora do SessaoProvider")
  return c
}
