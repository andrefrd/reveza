// Confirmação de ação que não tem volta (revogar, sair de todas as sessões): caixa de diálogo do shadcn/ui com o
// botão de segurar do React Bits quando ele está baixado (senão, um botão comum).

import * as React from "react"

import { BotaoSegurar } from "@/components/rb"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useT } from "@/i18n"

export function Confirmar({
  aberto,
  aoFechar,
  titulo,
  texto,
  botao,
  botaoSegurar,
  aoConfirmar,
}: {
  aberto: boolean
  aoFechar: () => void
  titulo: string
  texto: React.ReactNode
  botao: string
  /** O mesmo rótulo para quando o botão é de segurar ("Segure para revogar"). */
  botaoSegurar: string
  aoConfirmar: () => Promise<unknown> | void
}) {
  const { t } = useT()
  const [ocupado, setOcupado] = React.useState(false)
  return (
    <AlertDialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{titulo}</AlertDialogTitle>
          <AlertDialogDescription>{texto}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="items-center">
          <AlertDialogCancel>{t("comum.cancelar")}</AlertDialogCancel>
          <BotaoSegurar
            rotulo={botao}
            rotuloSegurar={botaoSegurar}
            rotuloFeito={t("comum.feito")}
            desligado={ocupado}
            aoConfirmar={async () => {
              setOcupado(true)
              try {
                await aoConfirmar()
              } finally {
                setOcupado(false)
                aoFechar()
              }
            }}
          />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
