// Componentes grátis do React Bits que estiverem nesta máquina. Eles NÃO vêm no repositório (a licença, MIT +
// Commons Clause, não deixa redistribuir): `npm run react-bits` baixa do registro oficial para src/components/react-bits/,
// que o git ignora. Sem eles, cada peça usa a versão simples dela; com eles, fica animada.
// Cada componente vira um pedaço separado do build, carregado só quando a tela precisa.

import * as React from "react"

type Modulo = { default: React.ComponentType<Record<string, unknown>> }

const arquivos = import.meta.glob<Modulo>("../react-bits/*.tsx")

/** Um componente preguiçoso por arquivo baixado, criado uma vez só, ao carregar o módulo. */
const COMPONENTES: Record<
  string,
  React.LazyExoticComponent<React.ComponentType<Record<string, unknown>>>
> = Object.fromEntries(
  Object.entries(arquivos).map(([caminho, carregar]) => [
    caminho
      .split("/")
      .pop()!
      .replace(/\.tsx$/, ""),
    React.lazy(carregar),
  ])
)

export function temReactBits(nome: string): boolean {
  return nome in COMPONENTES
}

export function usePrefereMenosMovimento(): boolean {
  const [reduz, setReduz] = React.useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const ao = () => setReduz(mq.matches)
    mq.addEventListener("change", ao)
    return () => mq.removeEventListener("change", ao)
  }, [])
  return reduz
}

class Protecao extends React.Component<{ reserva: React.ReactNode; children: React.ReactNode }, { quebrou: boolean }> {
  state = { quebrou: false }
  static getDerivedStateFromError() {
    return { quebrou: true }
  }
  render() {
    return this.state.quebrou ? this.props.reserva : this.props.children
  }
}

/**
 * Mostra o componente do React Bits quando ele foi baixado (e a pessoa não pediu menos movimento); senão, a reserva.
 * Se o componente baixado quebrar, a reserva assume sem derrubar a tela.
 */
export function ReactBits({
  nome,
  props,
  reserva,
  mesmoComMenosMovimento = false,
}: {
  nome: string
  props: Record<string, unknown>
  reserva: React.ReactNode
  /** Componentes sem animação contínua (que já respeitam a preferência) podem aparecer mesmo assim. */
  mesmoComMenosMovimento?: boolean
}) {
  const reduz = usePrefereMenosMovimento()
  const C = COMPONENTES[nome]
  if (!C || (reduz && !mesmoComMenosMovimento)) return <>{reserva}</>
  return (
    <Protecao reserva={reserva}>
      <React.Suspense fallback={reserva}>
        <C {...props} />
      </React.Suspense>
    </Protecao>
  )
}
