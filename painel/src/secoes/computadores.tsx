// Computadores: cada um com estado, versão, conta em uso e ações (trocar agora, diagnóstico, atualizar, revogar), e o
// passo a passo de ligar um computador novo pela frase de 6 palavras (ou QR).

import * as React from "react"
import {
  ActivityIcon,
  ChevronDownIcon,
  DownloadIcon,
  LaptopIcon,
  PlusIcon,
  ShieldOffIcon,
  ShuffleIcon,
} from "lucide-react"

import { BarraUso, NomeConta, SeloEstado } from "@/components/painel/conta"
import { BotaoCorrigir, ResultadoConserto, useCorrigir } from "@/components/painel/conserto"
import { Codigo } from "@/components/painel/copiar"
import { Confirmar } from "@/components/painel/confirmar"
import { AvisoPermissao, Pagina } from "@/components/painel/pagina"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldLabel } from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { useAcao, useAgora, useDados, useEstado, usePermissao } from "@/dados/contexto"
import { compararVersao, estadoComputador, estadoConta, p5, p7, versaoMaisNova } from "@/dados/derivados"
import type { Computador, Instantaneo } from "@/dados/tipos"
import { useDialogo } from "@/hooks/use-dialogo"
import { useT } from "@/i18n"
import { fmtDuracao, fmtPct, fmtRelativo } from "@/lib/formato"
import { comDemo } from "@/lib/demo"
import { comandoInstalador, sistemaDoNavegador, type SistemaDoNavegador } from "@/lib/instalador"
import { codigoDeLigacao, lerCodigoDeAcesso } from "@/lib/ligacao"
import { Link } from "@/lib/rota"
import { cn } from "@/lib/utils"
import { ICONE_SISTEMA } from "./visao-geral"

export default function Computadores() {
  const { t } = useT()
  const estado = useEstado()
  const agora = useAgora(5000)
  const { pode } = usePermissao()
  const ligar = useDialogo()
  const ativos = estado.computadores.filter((c) => !c.revogado)
  const revogados = estado.computadores.filter((c) => c.revogado)

  return (
    <Pagina
      titulo={t("menu.secoes.computadores")}
      descricao={t("computadores.descricao")}
      acoes={
        <Button onClick={() => ligar.abrir()} disabled={!pode}>
          <PlusIcon />
          {t("computadores.ligar")}
        </Button>
      }
    >
      <AvisoPermissao />
      {ativos.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LaptopIcon />
            </EmptyMedia>
            <EmptyTitle>{t("computadores.vazio.titulo")}</EmptyTitle>
            <EmptyDescription>{t("computadores.vazio.texto")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => ligar.abrir()} disabled={!pode}>
              {t("computadores.ligar")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {ativos.map((pc) => (
            <CartaoComputador key={pc.id} pc={pc} estado={estado} agora={agora} />
          ))}
        </div>
      )}
      {revogados.length ? (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="group/revogados -ml-2 self-start">
              <ChevronDownIcon className="transition-transform group-data-[state=open]/revogados:rotate-180" />
              {t("computadores.revogados", { n: revogados.length })}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 grid gap-2 lg:grid-cols-2">
            {revogados.map((pc) => {
              const Sistema = ICONE_SISTEMA[pc.sistema]
              return (
                <div
                  key={pc.id}
                  className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground"
                >
                  <Sistema className="size-4" aria-hidden />
                  <span className="truncate">{pc.nome}</span>
                  <Badge variant="outline" className="ml-auto">
                    {t("estadoComputador.revogado")}
                  </Badge>
                </div>
              )
            })}
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      <DialogoLigar key={ligar.chave} aberto={ligar.aberto} aoFechar={ligar.fechar} />
    </Pagina>
  )
}

function CartaoComputador({ pc, estado, agora }: { pc: Computador; estado: Instantaneo; agora: Date }) {
  const { t, idioma } = useT()
  const { fonte } = useDados()
  const acao = useAcao()
  const { pode } = usePermissao()
  const trocar = useDialogo()
  const [revogar, setRevogar] = React.useState(false)
  const situacao = estadoComputador(pc, agora)
  const Sistema = ICONE_SISTEMA[pc.sistema]
  const conta = estado.contas.find((c) => c.id === pc.atribuicao?.contaId)
  const outras = estado.contas.filter((c) => c.posse?.computadorId === pc.id && c.id !== conta?.id)
  const nova = versaoMaisNova(estado.computadores.filter((c) => !c.revogado).map((c) => c.versao))
  const desatualizado = !!nova && compararVersao(pc.versao, nova) < 0
  const corrigir = useCorrigir(pc)
  const itens = corrigir.diagnostico?.itens ?? []
  const okItens = itens.filter((i) => i.ok === true).length
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="inline-flex size-8 items-center justify-center rounded-lg bg-muted">
            <Sistema className="size-4" aria-hidden />
          </span>
          <span className="truncate">{pc.nome}</span>
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={cn(
              "inline-flex items-center gap-1.5",
              situacao === "online" ? "text-ok" : situacao === "atrasado" ? "text-atencao" : "text-erro"
            )}
          >
            <span className="size-1.5 rounded-full bg-current" aria-hidden />
            {t(`estadoComputador.${situacao}`)}
          </span>
          <span>· {t(`sistema.${pc.sistema}`)}</span>
          <span>· {t("computadores.versao", { versao: pc.versao })}</span>
          {desatualizado ? (
            <Badge variant="outline" className="border-atencao-borda bg-atencao-fundo text-atencao">
              {t("saude.desatualizada", { versao: nova ?? "" })}
            </Badge>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">{t("computadores.contaEmUso")}</span>
          {conta ? (
            <>
              <div className="flex min-w-0 items-center justify-between gap-2">
                <NomeConta conta={conta} className="font-medium" />
                <SeloEstado estado={estadoConta(conta, estado.config, agora)} />
              </div>
              <BarraUso
                pct={p5(conta, agora)}
                cor={conta.cor}
                aviso={estado.config.aviso}
                troca={estado.config.modo === "limite" ? undefined : estado.config.troca}
                rotulo={t("janela.five_hour")}
                compacta
              />
              <BarraUso pct={p7(conta, agora)} cor={conta.cor} rotulo={t("janela.seven_day")} compacta />
            </>
          ) : (
            <span className="text-muted-foreground">{t("computadores.semConta")}</span>
          )}
        </div>
        {outras.length ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t("computadores.outrasPosses")}</span>
            {outras.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2">
                <NomeConta conta={c} />
                <span className="text-xs text-muted-foreground">{t(`computadores.posse.${c.posse!.motivo}`)}</span>
              </div>
            ))}
          </div>
        ) : null}
        <dl className="grid grid-cols-3 gap-2 border-t pt-3 text-xs">
          <div>
            <dt className="text-muted-foreground">{t("computadores.ultimaBusca")}</dt>
            <dd className="tabular-nums">{fmtRelativo(pc.vistoEm, agora, idioma)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("computadores.ligadoEm")}</dt>
            <dd>{fmtRelativo(pc.criadoEm, agora, idioma)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("saude.diagnostico")}</dt>
            <dd>
              <Link
                href={comDemo("/saude")}
                className={cn("underline-offset-4 hover:underline", okItens < itens.length && "text-atencao")}
              >
                {itens.length ? t("computadores.diagnosticoResumo", { ok: okItens, total: itens.length }) : "–"}
              </Link>
            </dd>
          </div>
        </dl>
        <ResultadoConserto andamento={corrigir.andamento} compacto />
      </CardContent>
      <CardFooter className="flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={!pode} onClick={() => trocar.abrir()}>
          <ShuffleIcon />
          {t("computadores.acoes.trocar")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!pode}
          onClick={() =>
            void acao(
              () => fonte.comando(pc.id, "diagnostico"),
              t("computadores.diagnosticoPedido", { computador: pc.nome })
            )
          }
        >
          <ActivityIcon />
          {t("computadores.acoes.diagnostico")}
        </Button>
        {corrigir.quantos ? <BotaoCorrigir corrigir={corrigir} variant="outline" /> : null}
        {desatualizado ? (
          <Button
            variant="outline"
            size="sm"
            disabled={!pode}
            onClick={() =>
              void acao(
                () => fonte.comando(pc.id, "atualizar"),
                t("computadores.atualizarPedido", { computador: pc.nome })
              )
            }
          >
            <DownloadIcon />
            {t("computadores.acoes.atualizar")}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-destructive hover:text-destructive"
          disabled={!pode}
          onClick={() => setRevogar(true)}
        >
          <ShieldOffIcon />
          {t("computadores.acoes.revogar")}
        </Button>
      </CardFooter>
      <DialogoTrocar key={trocar.chave} pc={pc} aberto={trocar.aberto} aoFechar={trocar.fechar} />
      <Confirmar
        aberto={revogar}
        aoFechar={() => setRevogar(false)}
        titulo={t("computadores.revogar.titulo", { computador: pc.nome })}
        texto={t("computadores.revogar.texto")}
        botao={t("computadores.revogar.botao")}
        botaoSegurar={t("computadores.revogar.botaoSegurar")}
        aoConfirmar={() =>
          acao(() => fonte.revogarComputador(pc.id), t("computadores.revogar.feito", { computador: pc.nome }))
        }
      />
    </Card>
  )
}

function DialogoTrocar({ pc, aberto, aoFechar }: { pc: Computador; aberto: boolean; aoFechar: () => void }) {
  // quem abre passa key={chave da abertura}: a escolha nasce vazia a cada vez
  const { t, idioma } = useT()
  const { fonte } = useDados()
  const estado = useEstado()
  const agora = useAgora(15_000)
  const acao = useAcao()
  const [escolha, setEscolha] = React.useState("")
  const [enviando, setEnviando] = React.useState(false)
  const opcoes = estado.contas.filter((c) => c.id !== pc.atribuicao?.contaId)
  const ocupada = (id: string) =>
    estado.computadores.some((x) => x.id !== pc.id && !x.revogado && x.atribuicao?.contaId === id)
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("computadores.trocar.titulo", { computador: pc.nome })}</DialogTitle>
          <DialogDescription>{t("computadores.trocar.descricao")}</DialogDescription>
        </DialogHeader>
        <RadioGroup value={escolha} onValueChange={setEscolha} aria-label={t("computadores.trocar.conta")}>
          {opcoes.map((c) => {
            const bloqueada = ocupada(c.id) || c.precisaLogin
            return (
              <FieldLabel key={c.id} htmlFor={`trocar-${c.id}`} className={cn(bloqueada && "opacity-60")}>
                <Field orientation="horizontal">
                  <RadioGroupItem id={`trocar-${c.id}`} value={c.id} disabled={bloqueada} />
                  <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                    <NomeConta conta={c} />
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {ocupada(c.id)
                        ? t("computadores.trocar.ocupada")
                        : c.precisaLogin
                          ? t("estadoConta.precisa_login")
                          : `${t(`estadoConta.${estadoConta(c, estado.config, agora)}`)} · ${fmtPct(p5(c, agora), idioma)}`}
                    </span>
                  </div>
                </Field>
              </FieldLabel>
            )
          })}
        </RadioGroup>
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar}>
            {t("comum.cancelar")}
          </Button>
          <Button
            disabled={!escolha || enviando}
            onClick={async () => {
              setEnviando(true)
              const conta = estado.contas.find((c) => c.id === escolha)
              const [ok] = await acao(
                () => fonte.trocarAgora(pc.id, escolha),
                t("computadores.trocar.feito", { computador: pc.nome, conta: conta?.email ?? "" })
              )
              setEnviando(false)
              if (ok) aoFechar()
            }}
          >
            {enviando ? <Spinner /> : null}
            {t("computadores.trocar.botao")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DialogoLigar({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const { t } = useT()
  const { fonte } = useDados()
  const estado = useEstado()
  // quem abre passa key={chave da abertura}: conta os computadores no momento em que a caixa abriu
  const [quantosAntes] = React.useState(() => estado.computadores.filter((c) => c.sistema !== "pendente").length)
  const registrados = estado.computadores.filter((c) => c.sistema !== "pendente")
  const novo = registrados.length > quantosAntes ? registrados[registrados.length - 1] : null

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("computadores.ligacao.titulo")}</DialogTitle>
          <DialogDescription>{t("computadores.ligacao.umPasso.descricao")}</DialogDescription>
        </DialogHeader>
        {fonte.recursos.ligacaoNoPainel ? <LigarEmUmPasso /> : <LigarPeloTerminal />}
        <div className="flex items-center gap-2 rounded-lg bg-muted/60 p-3 text-sm" role="status" aria-live="polite">
          {novo ? (
            <span className="text-ok">{t("computadores.ligacao.apareceu", { computador: novo.nome })}</span>
          ) : (
            <>
              <Spinner className="text-muted-foreground" />
              <span className="text-muted-foreground">{t("computadores.ligacao.esperando")}</span>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar}>
            {t("comum.fechar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** O caminho sem o painel: a frase sai no terminal do computador que já tem a chave. */
function LigarPeloTerminal({ codigoAcesso }: { codigoAcesso?: string | null }) {
  const { t } = useT()
  return (
    <ol className="flex flex-col gap-4 text-sm">
      <li className="flex flex-col gap-2">
        <span>
          <strong className="mr-1">1.</strong>
          {t("computadores.ligacao.passo1")}
        </span>
        <Codigo texto="reveza ligar" />
        <span className="text-xs text-muted-foreground">{t("computadores.ligacao.passo1Dica")}</span>
      </li>
      <li className="flex flex-col gap-2">
        <span>
          <strong className="mr-1">2.</strong>
          {t("computadores.ligacao.passo2")}
        </span>
        <ComandoPorSistema extra="--ligar" />
        {codigoAcesso ? (
          <>
            <span className="text-xs text-muted-foreground">{t("computadores.ligacao.codigo")}</span>
            <Codigo texto={codigoAcesso} className="[&_pre]:break-all [&_pre]:whitespace-pre-wrap" />
          </>
        ) : null}
      </li>
      <li>
        <strong className="mr-1">3.</strong>
        {t("computadores.ligacao.passo3")}
      </li>
    </ol>
  )
}

type EtapaLigar =
  | { tipo: "inicio" }
  | { tipo: "criando" }
  | { tipo: "confirmar"; codigo: string; computador: string }
  | { tipo: "pronto"; codigo: string; expiraEm: string }
  | { tipo: "falhou"; acesso: string | null }

/**
 * Ligar um computador novo em um passo: o painel cria o acesso do computador novo, pede a frase a um computador que
 * já tem a chave do cofre (que pergunta na tela dele, com o código que aparece aqui) e junta tudo num código só. No
 * computador novo, o instalador pede só esse código.
 */
function LigarEmUmPasso() {
  const { t, idioma } = useT()
  const { fonte } = useDados()
  const estado = useEstado()
  const agora = useAgora(1000)
  const acao = useAcao()
  const ligados = estado.computadores.filter((c) => !c.revogado && c.sistema !== "pendente" && estadoComputador(c, agora) === "online")
  const [pc, setPc] = React.useState(ligados[0]?.id ?? "")
  const [etapa, setEtapa] = React.useState<EtapaLigar>({ tipo: "inicio" })
  const pendente = React.useRef<string | null>(null)

  const gerar = async () => {
    setEtapa({ tipo: "criando" })
    // um código novo invalida o anterior que não chegou a ser usado
    if (pendente.current) await acao(() => fonte.revogarComputador(pendente.current!))
    const [okAcesso, acesso] = await acao(() => fonte.criarAcessoComputador())
    if (!okAcesso) return setEtapa({ tipo: "inicio" })
    pendente.current = acesso.computadorId
    const escolhido = ligados.find((c) => c.id === pc) ?? ligados[0]
    if (!escolhido) return setEtapa({ tipo: "falhou", acesso: acesso.codigo })
    const [ok, lig] = await acao(() =>
      fonte.pedirLigacao(escolhido.id, (codigo) => setEtapa({ tipo: "confirmar", codigo, computador: escolhido.nome }))
    )
    const dados = lerCodigoDeAcesso(acesso.codigo)
    if (!ok || !dados) return setEtapa({ tipo: "falhou", acesso: acesso.codigo })
    setEtapa({ tipo: "pronto", codigo: codigoDeLigacao(dados, lig.palavras), expiraEm: lig.expiraEm })
  }

  if (etapa.tipo === "inicio" || etapa.tipo === "criando")
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm">
          {ligados.length
            ? t("computadores.ligacao.umPasso.inicio", { computador: (ligados.find((c) => c.id === pc) ?? ligados[0])!.nome })
            : t("computadores.ligacao.semLigado")}
        </p>
        {ligados.length > 1 ? (
          <Field>
            <FieldLabel htmlFor="ligar-pc">{t("computadores.ligacao.pedirA")}</FieldLabel>
            <Select value={pc} onValueChange={setPc}>
              <SelectTrigger id="ligar-pc" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ligados.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        <Button onClick={() => void gerar()} disabled={etapa.tipo === "criando"} className="self-start">
          {etapa.tipo === "criando" ? <Spinner /> : null}
          {t("computadores.ligacao.umPasso.gerar")}
        </Button>
        <OutroJeito />
      </div>
    )

  if (etapa.tipo === "confirmar")
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border p-4 text-center" aria-live="polite">
        <Spinner />
        <p className="text-sm">{t("computadores.ligacao.umPasso.confirme", { computador: etapa.computador })}</p>
        <p className="font-mono text-3xl font-semibold tracking-[0.3em]" aria-label={etapa.codigo.split("").join(" ")}>
          {etapa.codigo}
        </p>
        <p className="text-xs text-muted-foreground">{t("computadores.ligacao.umPasso.confirmeDica")}</p>
      </div>
    )

  if (etapa.tipo === "falhou")
    return (
      <div className="flex flex-col gap-3">
        <Alert>
          <AlertDescription>{t("computadores.ligacao.umPasso.falhou")}</AlertDescription>
        </Alert>
        <LigarPeloTerminal codigoAcesso={etapa.acesso} />
        <Button variant="outline" onClick={() => void gerar()} className="self-start">
          {t("computadores.ligacao.umPasso.tentarDeNovo")}
        </Button>
      </div>
    )

  const restante = (new Date(etapa.expiraEm).getTime() - agora.getTime()) / 1000
  const venceu = restante <= 0
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        <strong className="mr-1">1.</strong>
        {t("computadores.ligacao.umPasso.rode")}
      </p>
      <ComandoPorSistema extra="--ligar" />
      <p className="text-sm">
        <strong className="mr-1">2.</strong>
        {t("computadores.ligacao.umPasso.cole")}
      </p>
      <Codigo texto={etapa.codigo} className={cn("[&_pre]:break-all [&_pre]:whitespace-pre-wrap", venceu && "opacity-40")} />
      <span className={cn("text-xs tabular-nums", venceu ? "text-erro" : "text-muted-foreground")} aria-live="polite">
        {venceu
          ? t("computadores.ligacao.expirou")
          : t("computadores.ligacao.expira", { tempo: fmtDuracao(restante, idioma) })}
      </span>
      <p className="text-xs text-muted-foreground">{t("computadores.ligacao.umPasso.segredo")}</p>
      {venceu ? (
        <Button variant="outline" onClick={() => void gerar()} className="self-start">
          {t("computadores.ligacao.umPasso.tentarDeNovo")}
        </Button>
      ) : null}
    </div>
  )
}

/** O jeito antigo, para quem prefere (ou não tem o outro computador ligado agora). */
function OutroJeito() {
  const { t } = useT()
  return (
    <Collapsible>
      <CollapsibleTrigger className="text-xs text-muted-foreground underline underline-offset-4">
        {t("computadores.ligacao.umPasso.outroJeito")}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">
        <LigarPeloTerminal />
      </CollapsibleContent>
    </Collapsible>
  )
}

/** O comando de instalar com as instruções do sistema de quem vai rodar (abre no sistema deste navegador). */
function ComandoPorSistema({ extra }: { extra: string }) {
  const { t } = useT()
  const [sistema, setSistema] = React.useState<SistemaDoNavegador>(() => sistemaDoNavegador())
  const sistemas: SistemaDoNavegador[] = ["macos", "windows", "linux"]
  return (
    <div className="flex flex-col gap-2">
      <div role="tablist" aria-label={t("computadores.ligacao.sistemas.rotulo")} className="flex gap-1 self-start rounded-lg bg-muted p-1">
        {sistemas.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={sistema === s}
            onClick={() => setSistema(s)}
            className={cn("rounded-md px-3 py-1 text-xs font-medium", sistema === s ? "bg-background shadow-sm" : "text-muted-foreground")}
          >
            {t(`computadores.ligacao.sistemas.${s}.nome`)}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t(`computadores.ligacao.sistemas.${sistema}.abrir`)}</p>
      {/* o comando com o endereço do pacote da versão é longo: quebra a linha em vez de passar da caixa */}
      <Codigo texto={comandoInstalador(extra)} className="[&_pre]:break-all [&_pre]:whitespace-pre-wrap" />
      <p className="text-xs text-muted-foreground">{t("computadores.ligacao.sistemas.requisitos")}</p>
    </div>
  )
}
