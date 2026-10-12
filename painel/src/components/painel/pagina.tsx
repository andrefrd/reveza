import * as React from "react"
import { ShieldAlertIcon, EyeIcon } from "lucide-react"

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { usePermissao } from "@/dados/contexto"
import { useT } from "@/i18n"
import { comDemo } from "@/lib/demo"
import { navegar } from "@/lib/rota"
import { cn } from "@/lib/utils"

/** Moldura de cada seção: título, frase de apoio, ações à direita e o conteúdo. */
export function Pagina({
  titulo,
  descricao,
  acoes,
  children,
  className,
}: {
  titulo: string
  descricao?: React.ReactNode
  acoes?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5 md:gap-6 md:py-6 lg:px-6", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight md:text-2xl">{titulo}</h2>
          {descricao ? <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{descricao}</p> : null}
        </div>
        {acoes ? <div className="flex shrink-0 flex-wrap items-center gap-2">{acoes}</div> : null}
      </div>
      {children}
    </div>
  )
}

/** Faixa que explica por que os controles estão travados (modo leitura ou falta a verificação em duas etapas). */
export function AvisoPermissao() {
  const { t } = useT()
  const { pode, motivo } = usePermissao()
  if (pode) return null
  if (motivo === "leitura")
    return (
      <Alert>
        <EyeIcon />
        <AlertTitle>{t("permissao.leituraTitulo")}</AlertTitle>
        <AlertDescription>{t("permissao.leituraTexto")}</AlertDescription>
      </Alert>
    )
  return (
    <Alert className="border-atencao-borda bg-atencao-fundo text-atencao has-data-[slot=alert-action]:pr-2.5 *:data-[slot=alert-description]:text-atencao/90 sm:has-data-[slot=alert-action]:pr-44">
      <ShieldAlertIcon />
      <AlertTitle>{t("permissao.aal1Titulo")}</AlertTitle>
      <AlertDescription>{t("permissao.aal1Texto")}</AlertDescription>
      <AlertAction className="static col-start-2 mt-2 justify-self-start sm:absolute sm:top-2 sm:right-2 sm:mt-0">
        <Button
          size="sm"
          variant="outline"
          onClick={() => navegar(comDemo(`/duas-etapas?voltar=${encodeURIComponent(window.location.pathname)}`))}
        >
          {t("permissao.aal1Botao")}
        </Button>
      </AlertAction>
    </Alert>
  )
}

/** Título de bloco dentro de uma página. */
export function Subtitulo({ children, acoes }: { children: React.ReactNode; acoes?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-sm font-medium text-muted-foreground">{children}</h3>
      {acoes}
    </div>
  )
}

/**
 * No lugar de uma lista que a nuvem só entrega com a verificação em duas etapas feita na sessão (convites, alertas,
 * webhooks e auditoria): explica e leva ao código, em vez de parecer vazia.
 */
export function PedidoDuasEtapas() {
  const { t } = useT()
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed p-4 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <ShieldAlertIcon className="size-4 text-atencao" aria-hidden />
        {t("permissao.aal1Titulo")}
      </p>
      <p className="text-muted-foreground">{t("permissao.aal1Lista")}</p>
      <Button
        size="sm"
        variant="outline"
        onClick={() => navegar(comDemo(`/duas-etapas?voltar=${encodeURIComponent(window.location.pathname)}`))}
      >
        {t("permissao.aal1Botao")}
      </Button>
    </div>
  )
}

export function useFalta2fa(): boolean {
  return usePermissao().motivo === "aal1"
}
