// Contas: a lista (tabela do shadcn/ui no computador, cartões no celular), as regras de cada uma numa gaveta lateral
// (Sheet) e o pedido de login a um computador.

import * as React from "react"
import {
  CalendarClockIcon,
  KeyRoundIcon,
  LifeBuoyIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  Settings2Icon,
} from "lucide-react"

import { BarraUso, NomeConta, SeloEstado } from "@/components/painel/conta"
import { DialogoLogin } from "@/components/painel/dialogo-login"
import { EditorAgenda, resumoFaixa, useDias } from "@/components/painel/editor-agenda"
import { AvisoPermissao, Pagina } from "@/components/painel/pagina"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Slider } from "@/components/ui/slider"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAcao, useAgora, useDados, useEstado, usePermissao } from "@/dados/contexto"
import { estadoConta, nomePlano, p5, p7, resetDe } from "@/dados/derivados"
import type { CamposConta } from "@/dados/fonte"
import type { Conta, Instantaneo } from "@/dados/tipos"
import { useT } from "@/i18n"
import { N_CORES, corConta, indiceCor } from "@/lib/cores"
import { fmtFuturo, fmtPct, fmtRelativo } from "@/lib/formato"
import { cn } from "@/lib/utils"
import { useDialogo } from "@/hooks/use-dialogo"

export default function Contas() {
  const { t } = useT()
  const estado = useEstado()
  const agora = useAgora(15_000)
  const { pode } = usePermissao()
  const editar = useDialogo<Conta>()
  const login = useDialogo<Conta>()
  const contas = [...estado.contas].sort((a, b) => a.prioridade - b.prioridade || a.email.localeCompare(b.email))

  return (
    <Pagina
      titulo={t("menu.secoes.contas")}
      descricao={t("contas.descricao")}
      acoes={
        <Button onClick={() => login.abrir()} disabled={!pode}>
          <PlusIcon />
          {t("contas.conectar")}
        </Button>
      }
    >
      <AvisoPermissao />
      {contas.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <KeyRoundIcon />
            </EmptyMedia>
            <EmptyTitle>{t("contas.vazio.titulo")}</EmptyTitle>
            <EmptyDescription>{t("contas.vazio.texto")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => login.abrir()} disabled={!pode}>
              <PlusIcon />
              {t("contas.conectar")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <Card className="hidden py-0 lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">{t("contas.colunas.conta")}</TableHead>
                  <TableHead>{t("contas.colunas.estado")}</TableHead>
                  <TableHead className="w-44">{t("contas.colunas.cinco")}</TableHead>
                  <TableHead className="w-44">{t("contas.colunas.semana")}</TableHead>
                  <TableHead>{t("contas.colunas.regras")}</TableHead>
                  <TableHead className="w-12 pr-4 text-right">
                    <span className="sr-only">{t("contas.colunas.acoes")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contas.map((c) => (
                  <TableRow key={c.id} id={`conta-${c.id}`}>
                    <TableCell className="max-w-72 pl-4">
                      <InfoConta conta={c} estado={estado} agora={agora} />
                    </TableCell>
                    <TableCell>
                      <SeloEstado estado={estadoConta(c, estado.config, agora)} />
                    </TableCell>
                    <TableCell>
                      <Janela conta={c} tipo="five_hour" estado={estado} agora={agora} />
                    </TableCell>
                    <TableCell>
                      <Janela conta={c} tipo="seven_day" estado={estado} agora={agora} />
                    </TableCell>
                    <TableCell>
                      <Regras conta={c} />
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <MenuConta conta={c} aoEditar={() => editar.abrir(c)} aoEntrar={() => login.abrir(c)} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <div className="grid gap-3 sm:grid-cols-2 lg:hidden">
            {contas.map((c) => (
              <Card key={c.id} className="gap-3 py-4">
                <CardContent className="flex flex-col gap-3 px-4">
                  <div className="flex items-start justify-between gap-2">
                    <InfoConta conta={c} estado={estado} agora={agora} />
                    <MenuConta conta={c} aoEditar={() => editar.abrir(c)} aoEntrar={() => login.abrir(c)} />
                  </div>
                  <SeloEstado estado={estadoConta(c, estado.config, agora)} className="self-start" />
                  <Janela conta={c} tipo="five_hour" estado={estado} agora={agora} comRotulo />
                  <Janela conta={c} tipo="seven_day" estado={estado} agora={agora} comRotulo />
                  <Regras conta={c} />
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
      <EditarConta key={editar.chave} conta={editar.valor ?? null} aberto={editar.aberto} aoFechar={editar.fechar} />
      <DialogoLogin key={`login-${login.chave}`} aberto={login.aberto} conta={login.valor} aoFechar={login.fechar} />
    </Pagina>
  )
}

function InfoConta({ conta, estado, agora }: { conta: Conta; estado: Instantaneo; agora: Date }) {
  const { t, idioma } = useT()
  const plano = nomePlano(conta)
  const pc = conta.posse ? estado.computadores.find((c) => c.id === conta.posse?.computadorId) : undefined
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <NomeConta conta={conta} mostrarOrg className="font-medium" />
      <div className="flex flex-wrap items-center gap-1.5 pl-[18px] text-xs text-muted-foreground">
        {plano ? (
          <Badge variant="outline" className="h-4.5 px-1.5 text-[11px]">
            {plano}
          </Badge>
        ) : null}
        <span>
          {conta.lidoEm
            ? t("contas.lido", { quando: fmtRelativo(conta.lidoEm, agora, idioma) })
            : t("contas.semLeitura")}
        </span>
        {pc && conta.posse?.motivo === "uso" ? <span>· {t("contas.emUsoEm", { computador: pc.nome })}</span> : null}
      </div>
    </div>
  )
}

function Janela({
  conta,
  tipo,
  estado,
  agora,
  comRotulo,
}: {
  conta: Conta
  tipo: "five_hour" | "seven_day"
  estado: Instantaneo
  agora: Date
  comRotulo?: boolean
}) {
  const { t, idioma } = useT()
  const pct = tipo === "five_hour" ? p5(conta, agora) : p7(conta, agora)
  const reset = resetDe(conta, tipo)
  if (pct === null && !comRotulo) return <span className="text-xs text-muted-foreground">–</span>
  return (
    <BarraUso
      pct={pct}
      cor={conta.cor}
      aviso={tipo === "five_hour" ? estado.config.aviso : undefined}
      troca={tipo === "five_hour" && estado.config.modo !== "limite" ? estado.config.troca : undefined}
      rotulo={
        comRotulo
          ? t(`janela.${tipo}`)
          : reset
            ? t("visao.emUso.renova", { quando: fmtFuturo(reset, agora, idioma) })
            : ""
      }
      detalhe={comRotulo && reset ? t("visao.emUso.renova", { quando: fmtFuturo(reset, agora, idioma) }) : undefined}
    />
  )
}

function Regras({ conta }: { conta: Conta }) {
  const { t, idioma } = useT()
  const { curtos } = useDias()
  const itens: { icone: typeof LifeBuoyIcon; texto: string }[] = []
  if (conta.reserva) itens.push({ icone: LifeBuoyIcon, texto: t("contas.reservaRegra") })
  if (conta.pausada) itens.push({ icone: PauseIcon, texto: t("estadoConta.pausada") })
  if (conta.tetoSemana != null)
    itens.push({ icone: Settings2Icon, texto: t("contas.teto", { pct: fmtPct(conta.tetoSemana, idioma) }) })
  itens.push({
    icone: CalendarClockIcon,
    texto: conta.agenda.length
      ? conta.agenda.map((f) => resumoFaixa(f, curtos, t("contas.agenda.ate"))).join("; ")
      : t("contas.agendaSempre"),
  })
  return (
    <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
      <li className="text-foreground">
        {t("contas.colunas.prioridade")} {conta.prioridade}
      </li>
      {itens.map((it, i) => (
        <li key={i} className="flex items-center gap-1.5">
          <it.icone className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{it.texto}</span>
        </li>
      ))}
    </ul>
  )
}

function MenuConta({ conta, aoEditar, aoEntrar }: { conta: Conta; aoEditar: () => void; aoEntrar: () => void }) {
  const { t } = useT()
  const { fonte } = useDados()
  const acao = useAcao()
  const { pode } = usePermissao()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`${t("contas.colunas.acoes")}: ${conta.email}`}>
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem onSelect={aoEditar} disabled={!pode}>
          <Settings2Icon />
          {t("contas.menu.editar")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={aoEntrar} disabled={!pode}>
          <KeyRoundIcon />
          {t("contas.menu.entrarDeNovo")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!pode}
          onSelect={() =>
            void acao(
              () => fonte.salvarConta(conta.id, { pausada: !conta.pausada }),
              t(conta.pausada ? "contas.retomada" : "contas.pausada", { conta: conta.email })
            )
          }
        >
          {conta.pausada ? <PlayIcon /> : <PauseIcon />}
          {conta.pausada ? t("contas.menu.retomar") : t("contas.menu.pausar")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Seletor das 7 cores da paleta das contas. */
export function SeletorCor({
  valor,
  aoMudar,
  desligado,
}: {
  valor: number
  aoMudar: (v: number) => void
  desligado?: boolean
}) {
  const { t } = useT()
  return (
    <div role="radiogroup" aria-label={t("contas.editar.cor")} className="flex flex-wrap gap-2">
      {Array.from({ length: N_CORES }, (_, i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={indiceCor(valor) === i}
          aria-label={`${t("contas.editar.cor")} ${i + 1}`}
          disabled={desligado}
          onClick={() => aoMudar(i)}
          className={cn(
            "size-8 rounded-full ring-offset-2 ring-offset-background transition outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
            indiceCor(valor) === i && "ring-2 ring-foreground"
          )}
          style={{ background: corConta(i) }}
        />
      ))}
    </div>
  )
}

export function EditarConta({
  conta,
  aberto,
  aoFechar,
}: {
  conta: Conta | null
  aberto: boolean
  aoFechar: () => void
}) {
  const { t, idioma } = useT()
  const { fonte } = useDados()
  const estado = useEstado()
  const acao = useAcao()
  const { pode } = usePermissao()
  // quem abre passa key={chave da abertura}: o rascunho nasce da conta a cada vez
  const [rascunho, setRascunho] = React.useState<Required<CamposConta> | null>(() =>
    conta
      ? {
          cor: conta.cor,
          prioridade: conta.prioridade,
          reserva: conta.reserva,
          pausada: conta.pausada,
          agenda: conta.agenda,
          tetoSemana: conta.tetoSemana,
        }
      : null
  )
  const [salvando, setSalvando] = React.useState(false)

  const r = rascunho
  const mudar = (campos: Partial<Required<CamposConta>>) => setRascunho((x) => (x ? { ...x, ...campos } : x))
  return (
    <Sheet open={aberto && !!conta} onOpenChange={(v) => !v && aoFechar()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {conta && r ? (
          <>
            <SheetHeader>
              <SheetTitle className="pr-8 break-all">{t("contas.editar.titulo", { conta: conta.email })}</SheetTitle>
              <SheetDescription>{t("contas.editar.descricao")}</SheetDescription>
            </SheetHeader>
            <div className="px-4">
              <FieldGroup>
                <Field>
                  <FieldLabel>{t("contas.editar.cor")}</FieldLabel>
                  <SeletorCor valor={r.cor} aoMudar={(cor) => mudar({ cor })} desligado={!pode} />
                  <FieldDescription>{t("contas.editar.corDica")}</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="prioridade">{t("contas.editar.prioridade")}</FieldLabel>
                  <Input
                    id="prioridade"
                    type="number"
                    min={0}
                    max={1000}
                    className="w-28"
                    value={r.prioridade}
                    disabled={!pode}
                    onChange={(e) => mudar({ prioridade: Math.max(0, Math.min(1000, Number(e.target.value) || 0)) })}
                  />
                  <FieldDescription>{t("contas.editar.prioridadeDica")}</FieldDescription>
                </Field>
                <FieldSeparator />
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="reserva">{t("contas.editar.reserva")}</FieldLabel>
                    <FieldDescription>{t("contas.editar.reservaDica")}</FieldDescription>
                  </FieldContent>
                  <Switch
                    id="reserva"
                    checked={r.reserva}
                    disabled={!pode}
                    onCheckedChange={(reserva) => mudar({ reserva })}
                  />
                </Field>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="pausada">{t("contas.editar.pausada")}</FieldLabel>
                    <FieldDescription>{t("contas.editar.pausadaDica")}</FieldDescription>
                  </FieldContent>
                  <Switch
                    id="pausada"
                    checked={r.pausada}
                    disabled={!pode}
                    onCheckedChange={(pausada) => mudar({ pausada })}
                  />
                </Field>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="teto">{t("contas.editar.teto")}</FieldLabel>
                    <FieldDescription>{t("contas.editar.tetoDica")}</FieldDescription>
                  </FieldContent>
                  <Switch
                    id="teto"
                    checked={r.tetoSemana != null}
                    disabled={!pode}
                    onCheckedChange={(v) => mudar({ tetoSemana: v ? 80 : null })}
                  />
                </Field>
                {r.tetoSemana != null ? (
                  <div className="flex items-center gap-3">
                    <Slider
                      value={[r.tetoSemana]}
                      min={10}
                      max={100}
                      step={5}
                      disabled={!pode}
                      onValueChange={(v) => mudar({ tetoSemana: v[0] ?? 80 })}
                      aria-label={t("contas.editar.teto")}
                    />
                    <span className="w-12 text-right text-sm tabular-nums">{fmtPct(r.tetoSemana, idioma)}</span>
                  </div>
                ) : null}
                <FieldSeparator />
                <Field>
                  <FieldLabel>{t("contas.editar.agenda")}</FieldLabel>
                  <FieldDescription>
                    {t("contas.editar.agendaDica")} {t("contas.agenda.fuso", { fuso: estado.config.fuso })}
                  </FieldDescription>
                  <EditorAgenda valor={r.agenda} aoMudar={(agenda) => mudar({ agenda })} desligado={!pode} />
                </Field>
              </FieldGroup>
            </div>
            <SheetFooter className="flex-row justify-end gap-2 border-t">
              <Button variant="outline" onClick={aoFechar}>
                {t("comum.cancelar")}
              </Button>
              <Button
                disabled={!pode || salvando}
                onClick={async () => {
                  setSalvando(true)
                  const [ok] = await acao(
                    () => fonte.salvarConta(conta.id, { ...r, agenda: r.agenda.filter((f) => f.dias.length > 0) }),
                    t("contas.editar.salvo", { conta: conta.email })
                  )
                  setSalvando(false)
                  if (ok) aoFechar()
                }}
              >
                {salvando ? <Spinner /> : null}
                {t("comum.salvar")}
              </Button>
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
