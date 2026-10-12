import * as React from "react"
import { CheckIcon, CopyIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useT } from "@/i18n"
import { cn } from "@/lib/utils"

/** Botão de copiar para a área de transferência, com confirmação de 2 segundos. */
export function BotaoCopiar({ texto, className, rotulo }: { texto: string; className?: string; rotulo?: string }) {
  const { t } = useT()
  const [copiou, setCopiou] = React.useState(false)
  React.useEffect(() => {
    if (!copiou) return
    const id = setTimeout(() => setCopiou(false), 2000)
    return () => clearTimeout(id)
  }, [copiou])
  return (
    <Button
      type="button"
      variant="outline"
      size={rotulo ? "sm" : "icon-sm"}
      className={cn("shrink-0", className)}
      aria-label={copiou ? t("comum.copiado") : (rotulo ?? t("comum.copiar"))}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(texto)
          setCopiou(true)
        } catch {
          // sem permissão de área de transferência: o texto continua selecionável na tela
        }
      }}
    >
      {copiou ? <CheckIcon /> : <CopyIcon />}
      {rotulo ? <span>{copiou ? t("comum.copiado") : rotulo}</span> : null}
    </Button>
  )
}

/** Bloco de código com botão de copiar. */
export function Codigo({ texto, className }: { texto: string; className?: string }) {
  return (
    <div className={cn("relative min-w-0 rounded-lg border bg-muted/50", className)}>
      <pre className="overflow-x-auto p-3 pr-12 font-mono text-xs leading-relaxed whitespace-pre">
        <code>{texto}</code>
      </pre>
      <BotaoCopiar texto={texto} className="absolute top-2 right-2 bg-background" />
    </div>
  )
}
