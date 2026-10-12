// Atualizar o programa dos computadores pelo painel: o botão por computador ("Versão X disponível · Atualizar"), o
// "Atualizar todos", a opção de atualizar sozinho de madrugada e o andamento (pedido, atualizando, voltou na versão
// nova, ou falhou com o motivo). Só administrador pede. O painel e a nuvem não se atualizam por aqui: são do instalador
// no computador principal.

import * as React from "react"
import { CircleAlertIcon, DownloadIcon, MoonIcon } from "lucide-react"
import { toast } from "sonner"

import { useComando } from "@/components/painel/dialogo-login"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { useAcao, useAgora, useDados, useEstado, usePermissao } from "@/dados/contexto"
import { versaoMaisNova } from "@/dados/derivados"
import type { Computador } from "@/dados/tipos"
import { useT } from "@/i18n"
import {
  andamentoDaAtualizacao,
  assinarPedidos,
  guardarPedido,
  painelAtras,
  mudancasDosPedidos,
  pedidoDe,
  pedidoRecente,
  PEDIDO_ATUALIZAR,
  versaoDisponivel,
  type AndamentoAtualizacao,
} from "@/lib/atualizar"
import { cn } from "@/lib/utils"

/** O comando que instala o painel e a nuvem (no computador principal, com os tokens). */
export const COMANDO_ATUALIZAR_PAINEL = "npx github:dantaspaulo/reveza --atualizar"

export function useAtualizar(pc: Computador) {
  const { t } = useT()
  const { fonte } = useDados()
  const estado = useEstado()
  const acao = useAcao()
  const agora = useAgora(5000)
  const { pode } = usePermissao()
  const cmdId = React.useSyncExternalStore(assinarPedidos, () => pedidoDe(pc.id), () => pedidoDe(pc.id))
  const cmd = useComando(cmdId)
  const outros = versaoMaisNova(estado.computadores.filter((c) => !c.revogado).map((c) => c.versao))
  const andamento = andamentoDaAtualizacao(pc, cmd, estado.eventos, agora)
  const ocupado = andamento?.fase === "pedido" || andamento?.fase === "atualizando"
  const pedir = async () => {
    const [ok, c] = await acao(
      () => fonte.comando(pc.id, "atualizar", { ...PEDIDO_ATUALIZAR }),
      t("computadores.atualizacao.pedido", { computador: pc.nome })
    )
    if (ok) guardarPedido(pc.id, c.id)
    return ok
  }
  return { pode, pedir, andamento, ocupado, disponivel: versaoDisponivel(pc, outros) }
}

export function BotaoAtualizar({ atualizar, className }: { atualizar: ReturnType<typeof useAtualizar>; className?: string }) {
  const { t } = useT()
  if (!atualizar.disponivel && !atualizar.ocupado) return null
  return (
    <Button
      variant="outline"
      size="sm"
      className={className}
      disabled={!atualizar.pode || atualizar.ocupado}
      title={atualizar.pode ? t("computadores.atualizacao.dica") : t("computadores.atualizacao.soAdmin")}
      onClick={() => void atualizar.pedir()}
    >
      {atualizar.ocupado ? <Spinner /> : <DownloadIcon />}
      {atualizar.ocupado
        ? t("computadores.atualizacao.atualizando")
        : t("computadores.atualizacao.botao", { versao: atualizar.disponivel ?? "" })}
    </Button>
  )
}

/** O andamento numa linha: pedido, atualizando, voltou na versão nova, ou falhou com o motivo. */
export function LinhaAtualizacao({ andamento, className }: { andamento: AndamentoAtualizacao | null; className?: string }) {
  const { t } = useT()
  if (!andamento) return null
  const texto =
    andamento.fase === "pedido"
      ? t("computadores.atualizacao.fase.pedido")
      : andamento.fase === "atualizando"
        ? andamento.para
          ? t("computadores.atualizacao.fase.atualizandoPara", { versao: andamento.para })
          : t("computadores.atualizacao.fase.atualizando")
        : andamento.fase === "concluida"
          ? t("computadores.atualizacao.fase.concluida", { versao: andamento.para })
          : andamento.fase === "sem_suporte"
            ? t("computadores.atualizacao.fase.semSuporte", { comando: COMANDO_ATUALIZAR_PAINEL })
            : t("computadores.atualizacao.fase.falhou", { motivo: andamento.motivo || "?" })
  const cor =
    andamento.fase === "concluida" ? "text-ok" : andamento.fase === "falhou" || andamento.fase === "sem_suporte" ? "text-atencao" : "text-muted-foreground"
  return (
    <p className={cn("flex items-start gap-1.5 text-xs break-words", cor, className)} role="status">
      {andamento.fase === "pedido" || andamento.fase === "atualizando" ? <Spinner className="mt-px size-3" /> : null}
      <span>{texto}</span>
    </p>
  )
}

/** O cartão de cima da tela Computadores: atualizar sozinho, atualizar todos e o aviso do painel e da nuvem. */
export function CartaoAtualizacoes() {
  const { t } = useT()
  const { fonte } = useDados()
  const estado = useEstado()
  const acao = useAcao()
  const { pode } = usePermissao()
  const [enviando, setEnviando] = React.useState(false)
  React.useSyncExternalStore(assinarPedidos, mudancasDosPedidos, mudancasDosPedidos)
  const ativos = estado.computadores.filter((c) => !c.revogado)
  const outros = versaoMaisNova(ativos.map((c) => c.versao))
  // quem já está atualizando (pedido desta aba, ou o computador contou que está) não entra de novo
  const comAtualizacao = ativos.filter((pc) => versaoDisponivel(pc, outros) && !pedidoRecente(pc.id) && !pc.diagnostico?.atualizacao)
  const atras = painelAtras(__VERSAO_PAINEL__, ativos)
  const atualizarTodos = async () => {
    setEnviando(true)
    let pedidos = 0
    for (const pc of comAtualizacao) {
      try {
        const c = await fonte.comando(pc.id, "atualizar", { ...PEDIDO_ATUALIZAR })
        guardarPedido(pc.id, c.id)
        pedidos++
      } catch {
        // segue para os outros; o aviso diz quantos foram
      }
    }
    setEnviando(false)
    if (pedidos) toast.success(t("computadores.atualizacao.todosPedido", { n: pedidos }))
    else toast.error(t("computadores.atualizacao.todosFalhou"))
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="inline-flex size-8 items-center justify-center rounded-lg bg-muted">
            <DownloadIcon className="size-4" aria-hidden />
          </span>
          {t("computadores.atualizacao.titulo")}
        </CardTitle>
        <CardDescription>{t("computadores.atualizacao.descricao")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-muted-foreground">
            {comAtualizacao.length
              ? t("computadores.atualizacao.disponiveis", { n: comAtualizacao.length })
              : t("computadores.atualizacao.emDia")}
          </span>
          {comAtualizacao.length ? (
            <Button size="sm" disabled={!pode || enviando} onClick={() => void atualizarTodos()}>
              {enviando ? <Spinner /> : <DownloadIcon />}
              {t("computadores.atualizacao.todos", { n: comAtualizacao.length })}
            </Button>
          ) : null}
        </div>
        <label className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <span className="flex min-w-0 gap-2.5">
            <MoonIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium">{t("computadores.atualizacao.sozinho.titulo")}</span>
              <span className="text-xs text-muted-foreground">
                {t("computadores.atualizacao.sozinho.texto", { fuso: estado.config.fuso })}
              </span>
            </span>
          </span>
          <Switch
            checked={estado.config.atualizarSozinho}
            disabled={!pode}
            aria-label={t("computadores.atualizacao.sozinho.titulo")}
            onCheckedChange={(v) =>
              void acao(
                () => fonte.salvarConfig({ atualizarSozinho: v }),
                v ? t("computadores.atualizacao.sozinho.ligada") : t("computadores.atualizacao.sozinho.desligada")
              )
            }
          />
        </label>
        <Alert>
          <CircleAlertIcon />
          <AlertDescription className="flex flex-col gap-1">
            <span>{t("computadores.atualizacao.painelNuvem")}</span>
            <code className="w-fit max-w-full rounded bg-muted px-1.5 py-0.5 font-mono text-xs break-words">{COMANDO_ATUALIZAR_PAINEL}</code>
            {atras ? (
              <span className="text-atencao">
                {t("computadores.atualizacao.painelAtras", { painel: __VERSAO_PAINEL__, computadores: atras })}
              </span>
            ) : null}
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  )
}
