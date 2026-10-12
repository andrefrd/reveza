// O Corrigir de um computador (tela Saúde e cartão em Computadores): o botão, que só administrador usa, e o resultado
// item a item. O painel só pede ({ corrigir: true }); o que o computador conserta é uma lista fechada dele.

import * as React from "react"
import { WrenchIcon } from "lucide-react"

import { useComando } from "@/components/painel/dialogo-login"
import { MarcaEstado } from "@/components/rb"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useAcao, useDados, usePermissao } from "@/dados/contexto"
import type { Computador, ItemDiagnostico } from "@/dados/tipos"
import { useT } from "@/i18n"
import {
  andamentoDoConserto,
  consertaveis,
  diagnosticoAtual,
  diagnosticoDoComando,
  maisNovo,
  PEDIDO_CORRIGIR,
  type AndamentoConserto,
} from "@/lib/conserto"
import { comDemo } from "@/lib/demo"
import { Link } from "@/lib/rota"
import { cn } from "@/lib/utils"

/** O nome de uma conferência: a tradução pelo id, senão o nome que o agente deu. */
export function nomeDoItem(it: ItemDiagnostico, tx: (chave: string) => string): string {
  const chave = `saude.itens.${it.id}`
  const traduzido = tx(chave)
  return traduzido === chave ? (it.nome ?? it.id) : traduzido
}

export function useCorrigir(pc: Computador) {
  const { t } = useT()
  const { fonte } = useDados()
  const acao = useAcao()
  const { pode } = usePermissao()
  const [cmdId, setCmdId] = React.useState<number | null>(null)
  const cmd = useComando(cmdId)
  const andamento: AndamentoConserto | null = cmdId === null ? null : andamentoDoConserto(cmd, pc.versao)
  const rodando = andamento?.fase === "pedido" || andamento?.fase === "consertando"
  const diagnostico = diagnosticoAtual(pc.diagnostico, andamento)
  const pedir = async () => {
    const [ok, c] = await acao(
      () => fonte.comando(pc.id, "diagnostico", { ...PEDIDO_CORRIGIR }),
      t("saude.conserto.pedido", { computador: pc.nome })
    )
    if (ok) setCmdId(c.id)
  }
  return {
    pode,
    pedir,
    andamento,
    rodando,
    /** O diagnóstico a mostrar (o da resposta do conserto, enquanto for o mais novo). */
    diagnostico,
    /** Quantos problemas têm conserto automático agora (sem nenhum, sem botão). */
    quantos: consertaveis(diagnostico).length,
  }
}

/**
 * O "Rodar agora" de um computador: pede o diagnóstico e, quando ele volta, a tela mostra o que voltou (o guardado na
 * nuvem só fica novo na busca seguinte do agente). `diagnostico` é o mais novo entre o guardado, o do Corrigir e este.
 */
export function useDiagnostico(pc: Computador, corrigir: ReturnType<typeof useCorrigir>) {
  const { t } = useT()
  const { fonte } = useDados()
  const acao = useAcao()
  const [cmdId, setCmdId] = React.useState<number | null>(null)
  const cmd = useComando(cmdId)
  const rodando = cmdId !== null && (!cmd || cmd.estado === "pendente" || cmd.estado === "reservado")
  const rodado = diagnosticoDoComando(cmd, pc.versao)
  const conserto = corrigir.andamento?.fase === "feito" ? corrigir.andamento.diagnostico : null
  const diagnostico = maisNovo(pc.diagnostico, conserto, rodado)
  const pedir = async () => {
    const [ok, c] = await acao(() => fonte.comando(pc.id, "diagnostico"), t("saude.pedido", { computador: pc.nome }))
    if (ok) setCmdId(c.id)
  }
  return {
    pedir,
    rodando,
    diagnostico,
    /** De onde veio o que a tela mostra: a conferência automática, o Rodar agora ou o Corrigir. */
    origem: (diagnostico && diagnostico === rodado ? "rodado" : diagnostico && diagnostico === conserto ? "corrigir" : "automatico") as
      | "rodado"
      | "corrigir"
      | "automatico",
  }
}

export function BotaoCorrigir({
  corrigir,
  variant = "default",
}: {
  corrigir: ReturnType<typeof useCorrigir>
  variant?: "default" | "outline"
}) {
  const { t } = useT()
  return (
    <Button
      size="sm"
      variant={variant}
      disabled={!corrigir.pode || corrigir.rodando}
      title={corrigir.pode ? t("saude.conserto.dica") : t("saude.conserto.soAdmin")}
      onClick={() => void corrigir.pedir()}
    >
      {corrigir.rodando ? <Spinner /> : <WrenchIcon />}
      {corrigir.rodando ? t("saude.conserto.corrigindo") : t("saude.conserto.corrigir")}
    </Button>
  )
}

/** O resultado do conserto. `compacto`: só o resumo, com o link para a Saúde (no cartão do computador). */
export function ResultadoConserto({
  andamento,
  compacto = false,
  className,
}: {
  andamento: AndamentoConserto | null
  compacto?: boolean
  className?: string
}) {
  const { t, tx } = useT()
  if (!andamento) return null
  if (andamento.fase === "pedido" || andamento.fase === "consertando") {
    return (
      <p className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)} role="status">
        <Spinner />
        {andamento.fase === "pedido" ? t("saude.conserto.esperando") : t("saude.conserto.consertando")}
      </p>
    )
  }
  if (andamento.fase === "falhou") {
    return (
      <p className={cn("text-sm text-atencao", className)} role="status">
        {andamento.motivo === "sem_conserto"
          ? t("saude.conserto.semConserto")
          : t("saude.conserto.falhou", { motivo: andamento.motivo })}
      </p>
    )
  }
  const resumo =
    andamento.corrigidos || andamento.naoDeu
      ? t("saude.conserto.resumo", { corrigidos: andamento.corrigidos, naoDeu: andamento.naoDeu })
      : t("saude.conserto.nada")
  if (compacto) {
    return (
      <p className={cn("text-xs", andamento.naoDeu ? "text-atencao" : "text-ok", className)} role="status">
        {resumo} ·{" "}
        <Link href={comDemo("/saude")} className="underline underline-offset-4">
          {t("saude.conserto.verDetalhe")}
        </Link>
      </p>
    )
  }
  return (
    <div className={cn("flex flex-col gap-2 rounded-lg border p-3", className)} role="status">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-medium">{t("saude.conserto.titulo")}</p>
        <span className={cn("text-xs", andamento.naoDeu ? "text-atencao" : "text-ok")}>{resumo}</span>
      </div>
      <ul className="flex flex-col gap-2">
        {andamento.itens.map((it) => {
          const r = it.consertado?.resultado
          return (
            <li key={it.id}>
              <MarcaEstado
                estado={r === "corrigido" ? "feito" : r === "nao_deu" ? "falhou" : "atencao"}
                rotulo={
                  <span className="flex min-w-0 flex-col">
                    <span>{nomeDoItem(it, tx)}</span>
                    <span className="text-xs break-words text-muted-foreground">
                      {r === "corrigido"
                        ? t("saude.conserto.corrigido", { texto: it.consertado!.texto })
                        : r === "nao_deu"
                          ? t("saude.conserto.naoDeu", { texto: it.consertado!.texto })
                          : t("saude.conserto.oQueFazer", { texto: it.fazer ?? "" })}
                    </span>
                  </span>
                }
              />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
