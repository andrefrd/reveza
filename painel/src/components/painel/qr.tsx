import * as React from "react"
import { encode } from "uqr"

import { cn } from "@/lib/utils"

/** QR desenhado aqui mesmo, em SVG (sem imagem de fora e sem HTML injetado). */
export function CodigoQR({ texto, className, rotulo }: { texto: string; className?: string; rotulo: string }) {
  const caminho = React.useMemo(() => {
    const qr = encode(texto, { ecc: "M", border: 2 })
    const partes: string[] = []
    qr.data.forEach((linha, y) => {
      linha.forEach((escuro, x) => {
        if (escuro) partes.push(`M${x} ${y}h1v1h-1z`)
      })
    })
    return { d: partes.join(""), tamanho: qr.size }
  }, [texto])
  return (
    <svg
      role="img"
      aria-label={rotulo}
      viewBox={`0 0 ${caminho.tamanho} ${caminho.tamanho}`}
      className={cn("size-44 rounded-lg bg-white p-1", className)}
      shapeRendering="crispEdges"
    >
      <path d={caminho.d} fill="#111111" />
    </svg>
  )
}
