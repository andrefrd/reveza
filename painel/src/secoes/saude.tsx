// Saúde: o diagnóstico de cada computador (itens do `reveza doctor`), o atraso da busca, as versões e o estado do
// próprio painel.

import * as React from "react"
import { ActivityIcon, PlayIcon } from "lucide-react"

import { Pagina } from "@/components/painel/pagina"
import { MarcaEstado } from "@/components/rb"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAcao, useAgora, useDados, useEstado, usePermissao } from "@/dados/contexto"
import { compararVersao, estadoComputador, versaoMaisNova } from "@/dados/derivados"
import type { Computador } from "@/dados/tipos"
import { useT } from "@/i18n"
import { emDemo } from "@/lib/demo"
import { fmtNumero, fmtRelativo } from "@/lib/formato"
import { cn } from "@/lib/utils"
import { jaInstalado } from "@/pwa/registrar"
import { useComando } from "@/components/painel/dialogo-login"
import { ICONE_SISTEMA } from "./visao-geral"

export default function Saude() {
  const { t } = useT()
  const estado = useEstado()
  const ativos = estado.computadores.filter((c) => !c.revogado)
  const nova = versaoMaisNova(ativos.map((c) => c.versao))
  return (
    <Pagina titulo={t("menu.secoes.saude")} descricao={t("saude.descricao")}>
      <div className="grid gap-4 lg:grid-cols-2">
        {ativos.map((pc) => (
          <CartaoSaude key={pc.id} pc={pc} nova={nova} />
        ))}
        <Painel />
      </div>
    </Pagina>
  )
}

function CartaoSaude({ pc, nova }: { pc: Computador; nova: string | null }) {
  const { t, tx, idioma } = useT()
  const agora = useAgora(5000)
  const { fonte } = useDados()
  const acao = useAcao()
  const { pode } = usePermissao()
  const [cmdId, setCmdId] = React.useState<number | null>(null)
  const cmd = useComando(cmdId)
  const rodando = cmdId !== null && (!cmd || cmd.estado === "pendente" || cmd.estado === "reservado")
  const situacao = estadoComputador(pc, agora)
  const Sistema = ICONE_SISTEMA[pc.sistema]
  const d = pc.diagnostico
  const atrasada = nova && compararVersao(pc.versao, nova) < 0
  const atraso = d?.atrasoBuscaMs ?? null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="inline-flex size-8 items-center justify-center rounded-lg bg-muted">
            <Sistema className="size-4" aria-hidden />
          </span>
          {pc.nome}
        </CardTitle>
        <CardDescription
          className={cn(
            "flex items-center gap-1.5",
            situacao === "online" ? "text-ok" : situacao === "atrasado" ? "text-atencao" : "text-erro"
          )}
        >
          <span className="size-1.5 rounded-full bg-current" aria-hidden />
          {t(`estadoComputador.${situacao}`)}
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            disabled={!pode || rodando}
            onClick={async () => {
              const [ok, c] = await acao(
                () => fonte.comando(pc.id, "diagnostico"),
                t("saude.pedido", { computador: pc.nome })
              )
              if (ok) setCmdId(c.id)
            }}
          >
            <PlayIcon />
            {rodando ? t("saude.rodando") : t("saude.rodar")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          <div className="rounded-lg border p-2.5">
            <dt className="text-xs text-muted-foreground">{t("saude.visto")}</dt>
            <dd className="tabular-nums">{fmtRelativo(pc.vistoEm, agora, idioma)}</dd>
          </div>
          <div className="rounded-lg border p-2.5" title={t("saude.atrasoDica")}>
            <dt className="text-xs text-muted-foreground">{t("saude.atraso")}</dt>
            <dd className={cn("tabular-nums", atraso !== null && atraso > 1500 && "text-atencao")}>
              {atraso === null ? "–" : `${fmtNumero(atraso, idioma)} ms`}
            </dd>
          </div>
          <div className="col-span-2 rounded-lg border p-2.5 sm:col-span-1">
            <dt className="text-xs text-muted-foreground">{t("saude.versao")}</dt>
            <dd className="flex flex-wrap items-center gap-1">
              <span className="font-mono">{pc.versao}</span>
              {atrasada ? (
                <Badge
                  variant="outline"
                  className="border-atencao-borda bg-atencao-fundo text-[10px] whitespace-normal text-atencao"
                >
                  {t("saude.desatualizada", { versao: nova ?? "" })}
                </Badge>
              ) : null}
            </dd>
          </div>
        </dl>
        <div>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium">{t("saude.diagnostico")}</p>
            {d ? (
              <span className="text-xs text-muted-foreground">
                {t("saude.diagnosticoEm", { quando: fmtRelativo(d.em, agora, idioma) })}
              </span>
            ) : null}
          </div>
          {!d ? (
            <p className="text-sm text-muted-foreground">{t("saude.semDiagnostico")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {d.itens.map((it) => {
                const chave = `saude.itens.${it.id}`
                const nome = tx(chave) === chave ? it.id : tx(chave)
                return (
                  <li key={it.id}>
                    <MarcaEstado
                      estado={
                        rodando
                          ? "rodando"
                          : it.ok === true
                            ? "feito"
                            : it.ok === false
                              ? it.id === "versao"
                                ? "atencao"
                                : "falhou"
                              : "pendente"
                      }
                      rotulo={
                        <>
                          {nome}
                          {it.detalhe ? <span className="text-muted-foreground"> · {it.detalhe}</span> : null}
                        </>
                      }
                    />
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function Painel() {
  const { t, idioma } = useT()
  const { latenciaMs } = useDados()
  const estado = useEstado()
  const demo = emDemo()
  const cacheado = typeof navigator !== "undefined" && !!navigator.serviceWorker?.controller
  const linhas: [string, React.ReactNode][] = [
    [t("saude.painel.versao"), <span className="font-mono">{__VERSAO_PAINEL__}</span>],
    [t("saude.painel.fonte"), demo ? t("saude.painel.demo") : t("saude.painel.nuvem")],
    [t("saude.painel.latencia"), latenciaMs === null ? "–" : `${fmtNumero(latenciaMs, idioma)} ms`],
    [t("saude.painel.intervalo"), t("saude.painel.segundos", { n: estado.config.intervaloS })],
    [t("saude.painel.app"), jaInstalado() ? t("saude.painel.appInstalado") : t("saude.painel.appNavegador")],
    [t("saude.painel.offline"), cacheado ? t("saude.painel.sim") : t("saude.painel.nao")],
  ]
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="inline-flex size-8 items-center justify-center rounded-lg bg-muted">
            <ActivityIcon className="size-4" aria-hidden />
          </span>
          {t("saude.painel.titulo")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="divide-y text-sm">
          {linhas.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-3 py-2">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-right">{v}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}
