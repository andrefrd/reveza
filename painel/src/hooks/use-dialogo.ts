import * as React from "react"

/**
 * Estado de uma caixa de diálogo com formulário: cada abertura ganha uma chave nova, e o formulário (com key={chave})
 * nasce limpo, sem efeito para "zerar" campos. Fechar mantém a chave, para a animação de saída acontecer.
 */
export function useDialogo<T = undefined>() {
  const [estado, setEstado] = React.useState<{ aberto: boolean; chave: number; valor: T | undefined }>({
    aberto: false,
    chave: 0,
    valor: undefined,
  })
  const abrir = React.useCallback((valor?: T) => setEstado((e) => ({ aberto: true, chave: e.chave + 1, valor })), [])
  const fechar = React.useCallback(() => setEstado((e) => ({ ...e, aberto: false })), [])
  return { ...estado, abrir, fechar }
}
