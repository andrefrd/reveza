// Como funciona: o diagrama animado do caminho de um login (SVG + motion, parado para quem pede menos movimento) e o
// simulador da regra de alternar, que roda a mesma lógica da função decidir() do banco (src/lib/regra.ts).
// O diagrama é desenho próprio: não há bloco do shadcn/ui nem componente grátis do React Bits para esse fluxo.

import * as React from "react"
import { motion, useInView, useReducedMotion } from "motion/react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloudCogIcon,
  DatabaseIcon,
  DownloadIcon,
  LockKeyholeIcon,
  LogInIcon,
  PauseIcon,
  PlayIcon,
  ShuffleIcon,
  TerminalIcon,
} from "lucide-react"

import { PontoConta } from "@/components/painel/conta"
import { Pagina } from "@/components/painel/pagina"
import { CartaoLuz, NivelArrastavel, TextoCifrado } from "@/components/rb"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useIsMobile } from "@/hooks/use-mobile"
import type { Modo, OrdemRodizio } from "@/dados/tipos"
import { useT } from "@/i18n"
import { criarSorteio } from "@/dados/demo"
import { corConta } from "@/lib/cores"
import { fmtDuracao, fmtPct } from "@/lib/formato"
import { decidir, type ContaRegra, type MotivoConta } from "@/lib/regra"
import { cn } from "@/lib/utils"

export default function ComoFunciona() {
  const { t } = useT()
  return (
    <Pagina titulo={t("menu.secoes.comoFunciona")} descricao={t("comoFunciona.descricao")}>
      <Diagrama />
      <Simulador />
    </Pagina>
  )
}

// ─────────────────────────────────────────────────────────────── diagrama

const ICONES = [LogInIcon, LockKeyholeIcon, DatabaseIcon, CloudCogIcon, DownloadIcon, TerminalIcon]
const ETAPAS = ["e1", "e2", "e3", "e4", "e5", "e6"] as const
const PACOTES = ["p1", "p2", "p3", "p4", "p5"] as const
const ZONAS = ["seuComputador", "nuvem", "outroComputador"] as const

function Diagrama() {
  const { t } = useT()
  const movel = useIsMobile()
  const reduz = useReducedMotion() ?? false
  const ref = React.useRef<HTMLDivElement>(null)
  const visivel = useInView(ref, { amount: 0.3 })
  const [passo, setPasso] = React.useState(0)
  const [pausado, setPausado] = React.useState(false)
  const anda = !pausado && !reduz && visivel

  React.useEffect(() => {
    if (!anda) return
    const id = setInterval(() => setPasso((p) => (p + 1) % 6), 3200)
    return () => clearInterval(id)
  }, [anda])

  const escolher = (i: number) => {
    setPasso(((i % 6) + 6) % 6)
    setPausado(true)
  }
  const etapa = ETAPAS[passo]

  return (
    <Card ref={ref}>
      <CardHeader>
        <CardTitle>{t("comoFunciona.diagrama.titulo")}</CardTitle>
        <CardDescription>{t("comoFunciona.diagrama.etapa", { n: passo + 1 })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {movel ? (
          <DesenhoVertical passo={passo} anda={anda} reduz={reduz} aoEscolher={escolher} />
        ) : (
          <DesenhoHorizontal passo={passo} anda={anda} reduz={reduz} aoEscolher={escolher} />
        )}
        <CartaoLuz className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            {t("comoFunciona.diagrama.etapa", { n: passo + 1 })}
          </p>
          <p className="font-medium">{t(`comoFunciona.diagrama.etapas.${etapa}.titulo`).replace("|", " ")}</p>
          <p className="text-sm text-muted-foreground">{t(`comoFunciona.diagrama.etapas.${etapa}.texto`)}</p>
          <div className="min-w-0 overflow-hidden rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs break-all">
            {etapa === "e3" ? (
              <TextoCifrado texto={t("comoFunciona.diagrama.etapas.e3.dado")} repetir={passo} />
            ) : (
              <span>{t(`comoFunciona.diagrama.etapas.${etapa}.dado`)}</span>
            )}
          </div>
        </CartaoLuz>
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1.5" role="tablist" aria-label={t("comoFunciona.diagrama.titulo")}>
            {ETAPAS.map((e, i) => (
              <button
                key={e}
                role="tab"
                aria-selected={i === passo}
                aria-label={t("comoFunciona.diagrama.etapa", { n: i + 1 })}
                onClick={() => escolher(i)}
                className={cn(
                  "h-2 rounded-full transition-all",
                  i === passo ? "w-6 bg-foreground" : "w-2 bg-muted-foreground/30 hover:bg-muted-foreground/60"
                )}
              />
            ))}
          </div>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => escolher(passo - 1)}
              aria-label={t("comoFunciona.diagrama.anterior")}
            >
              <ChevronLeftIcon />
            </Button>
            {!reduz ? (
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => setPausado((p) => !p)}
                aria-label={pausado ? t("comoFunciona.diagrama.continuar") : t("comoFunciona.diagrama.pausar")}
              >
                {pausado ? <PlayIcon /> : <PauseIcon />}
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => escolher(passo + 1)}
              aria-label={t("comoFunciona.diagrama.proxima")}
            >
              <ChevronRightIcon />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

interface PropsDesenho {
  passo: number
  anda: boolean
  reduz: boolean
  aoEscolher: (i: number) => void
}

function No({
  i,
  cx,
  cy,
  ativo,
  feito,
  reduz,
  aoEscolher,
}: {
  i: number
  cx: number
  cy: number
  ativo: boolean
  feito: boolean
  reduz: boolean
  aoEscolher: (i: number) => void
}) {
  const { t } = useT()
  const Icone = ICONES[i]
  const titulo = t(`comoFunciona.diagrama.etapas.${ETAPAS[i]}.titulo`).replace("|", " ")
  return (
    <motion.g
      role="button"
      tabIndex={0}
      aria-label={titulo}
      aria-current={ativo ? "step" : undefined}
      onClick={() => aoEscolher(i)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && aoEscolher(i)}
      className="cursor-pointer outline-none [&:focus-visible>circle]:stroke-ring"
      style={{ transformOrigin: `${cx}px ${cy}px`, transformBox: "view-box" }}
      animate={{ scale: ativo && !reduz ? 1.1 : 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 20 }}
    >
      {ativo && !reduz ? (
        <motion.circle
          cx={cx}
          cy={cy}
          r={34}
          className="fill-none stroke-foreground/30"
          strokeWidth={2}
          initial={{ r: 34, opacity: 0.6 }}
          animate={{ r: 48, opacity: 0 }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
        />
      ) : null}
      <circle
        cx={cx}
        cy={cy}
        r={32}
        strokeWidth={2}
        className={cn(
          "transition-colors duration-300",
          ativo
            ? "fill-foreground stroke-foreground"
            : feito
              ? "fill-card stroke-foreground/50"
              : "fill-card stroke-border"
        )}
      />
      <Icone
        x={cx - 13}
        y={cy - 13}
        width={26}
        height={26}
        className={cn("transition-colors duration-300", ativo ? "text-background" : "text-foreground")}
        aria-hidden
      />
    </motion.g>
  )
}

function Conector({
  x1,
  y1,
  x2,
  y2,
  ativo,
  feito,
  anda,
  rotulo,
  rotuloX,
  rotuloY,
  ancora = "middle",
}: {
  x1: number
  y1: number
  x2: number
  y2: number
  ativo: boolean
  feito: boolean
  anda: boolean
  rotulo: string
  rotuloX: number
  rotuloY: number
  ancora?: "middle" | "start"
}) {
  return (
    <g aria-hidden>
      <line x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={2} strokeDasharray="5 6" className="stroke-border" />
      <motion.line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        strokeWidth={2.5}
        strokeLinecap="round"
        className="stroke-foreground"
        initial={false}
        animate={{ pathLength: ativo || feito ? 1 : 0, opacity: ativo ? 1 : feito ? 0.35 : 0 }}
        transition={{ duration: 0.6, ease: "easeInOut" }}
      />
      {ativo && anda ? (
        <motion.circle
          r={6}
          className="fill-[var(--conta-1)] stroke-card"
          strokeWidth={2}
          initial={{ cx: x1, cy: y1 }}
          animate={{ cx: [x1, x2], cy: [y1, y2] }}
          transition={{ duration: 1.4, repeat: Infinity, repeatDelay: 0.3, ease: "easeInOut" }}
        />
      ) : null}
      {ativo ? (
        <motion.text
          x={rotuloX}
          y={rotuloY}
          textAnchor={ancora}
          className="fill-foreground font-mono text-[12px] font-medium"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          {rotulo}
        </motion.text>
      ) : null}
    </g>
  )
}

function Rotulo({
  texto,
  x,
  y,
  ancora,
  ativo,
}: {
  texto: string
  x: number
  y: number
  ancora: "middle" | "start"
  ativo: boolean
}) {
  const [l1, l2] = texto.split("|")
  return (
    <text
      x={x}
      y={y}
      textAnchor={ancora}
      className={cn("text-[13px] transition-colors", ativo ? "fill-foreground font-semibold" : "fill-muted-foreground")}
      aria-hidden
    >
      <tspan x={x}>{l1}</tspan>
      {l2 ? (
        <tspan x={x} dy={17}>
          {l2}
        </tspan>
      ) : null}
    </text>
  )
}

function DesenhoHorizontal({ passo, anda, reduz, aoEscolher }: PropsDesenho) {
  const { t } = useT()
  const cx = (i: number) => 90 + i * 164
  const cy = 112
  return (
    <svg viewBox="0 0 1000 230" className="w-full" role="group" aria-label={t("comoFunciona.diagrama.titulo")}>
      {ZONAS.map((z, k) => (
        <g key={z} aria-hidden>
          <rect
            x={15 + k * 328}
            y={14}
            width={314}
            height={208}
            rx={18}
            className="fill-muted/40 stroke-border"
            strokeDasharray="4 5"
          />
          <text
            x={33 + k * 328}
            y={40}
            className="fill-muted-foreground text-[12px] font-medium tracking-wide uppercase"
          >
            {t(`comoFunciona.diagrama.${z}`)}
          </text>
        </g>
      ))}
      {PACOTES.map((p, i) => (
        <Conector
          key={p}
          x1={cx(i) + 36}
          y1={cy}
          x2={cx(i + 1) - 36}
          y2={cy}
          ativo={i === passo}
          feito={i < passo}
          anda={anda}
          rotulo={t(`comoFunciona.diagrama.pacotes.${p}`)}
          rotuloX={(cx(i) + cx(i + 1)) / 2}
          rotuloY={cy - 14}
        />
      ))}
      {ETAPAS.map((e, i) => (
        <g key={e}>
          <No i={i} cx={cx(i)} cy={cy} ativo={i === passo} feito={i < passo} reduz={reduz} aoEscolher={aoEscolher} />
          <Rotulo
            texto={t(`comoFunciona.diagrama.etapas.${e}.titulo`)}
            x={cx(i)}
            y={cy + 60}
            ancora="middle"
            ativo={i === passo}
          />
        </g>
      ))}
    </svg>
  )
}

function DesenhoVertical({ passo, anda, reduz, aoEscolher }: PropsDesenho) {
  const { t } = useT()
  const cx = 46
  const cy = (i: number) => 74 + i * 108
  return (
    <svg
      viewBox={`0 0 340 ${cy(5) + 64}`}
      className="w-full"
      role="group"
      aria-label={t("comoFunciona.diagrama.titulo")}
    >
      {ZONAS.map((z, k) => (
        <g key={z} aria-hidden>
          <rect
            x={4}
            y={cy(2 * k) - 66}
            width={332}
            height={208}
            rx={16}
            className="fill-muted/40 stroke-border"
            strokeDasharray="4 5"
          />
          <text
            x={322}
            y={cy(2 * k) - 46}
            textAnchor="end"
            className="fill-muted-foreground text-[11px] font-medium tracking-wide uppercase"
          >
            {t(`comoFunciona.diagrama.${z}`)}
          </text>
        </g>
      ))}
      {PACOTES.map((p, i) => (
        <Conector
          key={p}
          x1={cx}
          y1={cy(i) + 36}
          x2={cx}
          y2={cy(i + 1) - 36}
          ativo={i === passo}
          feito={i < passo}
          anda={anda}
          rotulo={t(`comoFunciona.diagrama.pacotes.${p}`)}
          rotuloX={cx + 14}
          rotuloY={(cy(i) + cy(i + 1)) / 2 + 4}
          ancora="start"
        />
      ))}
      {ETAPAS.map((e, i) => (
        <g key={e}>
          <No i={i} cx={cx} cy={cy(i)} ativo={i === passo} feito={i < passo} reduz={reduz} aoEscolher={aoEscolher} />
          <Rotulo
            texto={t(`comoFunciona.diagrama.etapas.${e}.titulo`)}
            x={cx + 50}
            y={cy(i) - 3}
            ancora="start"
            ativo={i === passo}
          />
        </g>
      ))}
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────── simulador

interface ContaSim {
  id: string
  cor: number
  p5: number
  p7: number
  pausada: boolean
  reserva: boolean
  precisaLogin: boolean
  ocupada: boolean
  foraDaAgenda: boolean
}

const INICIAIS: ContaSim[] = [
  {
    id: "a",
    cor: 0,
    p5: 93,
    p7: 48,
    pausada: false,
    reserva: false,
    precisaLogin: false,
    ocupada: false,
    foraDaAgenda: false,
  },
  {
    id: "b",
    cor: 1,
    p5: 35,
    p7: 62,
    pausada: false,
    reserva: false,
    precisaLogin: false,
    ocupada: false,
    foraDaAgenda: false,
  },
  {
    id: "c",
    cor: 2,
    p5: 100,
    p7: 81,
    pausada: false,
    reserva: false,
    precisaLogin: false,
    ocupada: false,
    foraDaAgenda: false,
  },
  {
    id: "d",
    cor: 3,
    p5: 0,
    p7: 12,
    pausada: false,
    reserva: true,
    precisaLogin: false,
    ocupada: false,
    foraDaAgenda: false,
  },
]

const BANDEIRAS = ["pausada", "reserva", "precisaLogin", "ocupada", "foraDaAgenda"] as const

function Simulador() {
  const { t, idioma } = useT()
  const nomes = t("comoFunciona.simulador.nomes").split(",")
  const [contas, setContas] = React.useState(INICIAIS)
  const [modo, setModo] = React.useState<Modo>("limiar")
  const [auto, setAuto] = React.useState(true)
  const [aviso, setAviso] = React.useState(90)
  const [troca, setTroca] = React.useState(95)
  const [atual, setAtual] = React.useState<string>("a")
  const [sessaoLimite, setSessaoLimite] = React.useState(false)
  const [rodizioVenceu, setRodizioVenceu] = React.useState(false)
  const [trocouAgora, setTrocouAgora] = React.useState(false)
  const [ordem, setOrdem] = React.useState<OrdemRodizio>("aleatoria")
  const [semente, setSemente] = React.useState(1)
  const espera = 90

  const nome = (id: string | null) =>
    id ? (nomes["abcd".indexOf(id)] ?? id) : t("comoFunciona.simulador.resultado.nenhuma")
  const mudarConta = (id: string, campos: Partial<ContaSim>) =>
    setContas((lista) => lista.map((c) => (c.id === id ? { ...c, ...campos } : c)))

  const decisao = React.useMemo(() => {
    const regra: ContaRegra[] = contas.map((c, i) => ({
      id: c.id,
      nome: nome(c.id),
      p5: c.p5,
      p7: c.p7,
      prioridade: (i + 1) * 10,
      reserva: c.reserva,
      pausada: c.pausada,
      precisaLogin: c.precisaLogin,
      ocupada: c.ocupada,
      foraDaAgenda: c.foraDaAgenda,
    }))
    return decidir({
      auto,
      modo,
      aviso,
      troca,
      contas: regra,
      atualId: atual === "nenhuma" ? null : atual,
      rodizioVenceu,
      ordemRodizio: ordem,
      sessaoBateuLimite: sessaoLimite,
      segundosDesdeUltimaTroca: trocouAgora ? 30 : 3600,
      esperaMinimaS: espera,
      sorteio: criarSorteio(semente),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contas, modo, auto, aviso, troca, atual, sessaoLimite, rodizioVenceu, trocouAgora, ordem, semente])

  const escolhida = contas.find((c) => c.id === decisao.contaId)
  const motivoVars = {
    aviso: fmtPct(aviso, idioma),
    troca: fmtPct(troca, idioma),
    ordem: t(`troca.rodizio.${ordem}`).toLowerCase(),
  }
  const motivoTexto = (m: MotivoConta | "livre") => t(`comoFunciona.simulador.porConta.${m}`)

  return (
    <Card className="overflow-visible">
      <CardHeader>
        <CardTitle>{t("comoFunciona.simulador.titulo")}</CardTitle>
        <CardDescription>{t("comoFunciona.simulador.descricao")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-col gap-3">
            <ToggleGroup
              type="single"
              variant="outline"
              value={modo}
              onValueChange={(v) => v && setModo(v as Modo)}
              className="flex-wrap"
            >
              {(["limite", "limiar", "rodizio"] as const).map((m) => (
                <ToggleGroupItem key={m} value={m}>
                  {t(`modo.${m}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <div className="flex justify-between text-sm">
                  <FieldLabel>{t("troca.limiares.aviso")}</FieldLabel>
                  <span className="tabular-nums">{fmtPct(aviso, idioma)}</span>
                </div>
                <Slider
                  value={[aviso]}
                  min={50}
                  max={troca - 1}
                  step={1}
                  onValueChange={(v) => setAviso(v[0] ?? aviso)}
                  aria-label={t("troca.limiares.aviso")}
                />
              </Field>
              <Field data-disabled={modo === "limite" || undefined}>
                <div className="flex justify-between text-sm">
                  <FieldLabel>{t("troca.limiares.troca")}</FieldLabel>
                  <span className="tabular-nums">{fmtPct(modo === "limite" ? 100 : troca, idioma)}</span>
                </div>
                <Slider
                  value={[modo === "limite" ? 100 : troca]}
                  min={aviso + 1}
                  max={100}
                  step={1}
                  disabled={modo === "limite"}
                  onValueChange={(v) => setTroca(v[0] ?? troca)}
                  aria-label={t("troca.limiares.troca")}
                />
              </Field>
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">{t("comoFunciona.simulador.contas")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {contas.map((c) => {
                const av = decisao.avaliacoes.find((a) => a.id === c.id)!
                const ehAtual = c.id === atual
                return (
                  <div
                    key={c.id}
                    className={cn(
                      "flex flex-col gap-3 rounded-xl border p-3",
                      decisao.contaId === c.id && "ring-2 ring-foreground/70"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 font-medium">
                        <PontoConta cor={c.cor} />
                        {nome(c.id)}
                      </span>
                      {ehAtual ? <Badge variant="secondary">{t("comoFunciona.simulador.porConta.atual")}</Badge> : null}
                    </div>
                    <div className="flex flex-wrap items-end gap-4">
                      <div className="flex min-w-[9rem] flex-1 flex-col gap-1">
                        <span className="text-xs text-muted-foreground">{t("comoFunciona.simulador.cinco")}</span>
                        <NivelArrastavel
                          valor={c.p5}
                          aoMudar={(p5) => mudarConta(c.id, { p5 })}
                          rotulo={`${nome(c.id)}: ${t("comoFunciona.simulador.cinco")}`}
                          cor={c.cor}
                          altura={112}
                        />
                      </div>
                      <div className="flex min-w-[8rem] flex-1 flex-col gap-1">
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>{t("comoFunciona.simulador.semana")}</span>
                          <span className="tabular-nums">{Math.round(c.p7)}%</span>
                        </div>
                        <Slider
                          value={[c.p7]}
                          min={0}
                          max={100}
                          step={1}
                          onValueChange={(v) => mudarConta(c.id, { p7: v[0] ?? c.p7 })}
                          aria-label={`${nome(c.id)}: ${t("comoFunciona.simulador.semana")}`}
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {BANDEIRAS.map((b) => (
                        <button
                          key={b}
                          type="button"
                          aria-pressed={c[b]}
                          onClick={() => mudarConta(c.id, { [b]: !c[b] })}
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                            c[b]
                              ? "border-foreground bg-foreground text-background"
                              : "text-muted-foreground hover:bg-muted"
                          )}
                        >
                          {t(`comoFunciona.simulador.${b}`)}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {av.motivos.length ? av.motivos.map((m) => motivoTexto(m)).join(" · ") : motivoTexto("livre")}
                      {av.posicao ? ` · #${av.posicao}` : ""}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>

          {/* No celular, a escolha fica presa no pé da tela enquanto se mexe nas contas. */}
          <div
            className="sticky bottom-3 z-10 flex items-center gap-2 rounded-xl border bg-popover/95 p-3 text-sm shadow-lg backdrop-blur lg:hidden"
            aria-hidden
          >
            {escolhida ? (
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: corConta(escolhida.cor) }} />
            ) : null}
            <span className="font-medium">
              {decisao.contaId === null
                ? t("comoFunciona.simulador.resultado.nenhuma")
                : decisao.trocou
                  ? t("comoFunciona.simulador.resultado.troca", { conta: nome(decisao.contaId) })
                  : t("comoFunciona.simulador.resultado.fica", { conta: nome(decisao.contaId) })}
            </span>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-xl border p-4">
            <p className="mb-3 text-sm font-medium">{t("comoFunciona.simulador.situacao")}</p>
            <FieldGroup className="gap-3">
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="sim-auto">{t("comoFunciona.simulador.auto")}</FieldLabel>
                </FieldContent>
                <Switch id="sim-auto" checked={auto} onCheckedChange={setAuto} />
              </Field>
              <Field>
                <FieldLabel htmlFor="sim-atual">{t("comoFunciona.simulador.atual")}</FieldLabel>
                <Select value={atual} onValueChange={setAtual}>
                  <SelectTrigger id="sim-atual" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nenhuma">{t("comoFunciona.simulador.nenhuma")}</SelectItem>
                    {contas.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {nome(c.id)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="sim-limite">{t("comoFunciona.simulador.sessaoLimite")}</FieldLabel>
                </FieldContent>
                <Switch id="sim-limite" checked={sessaoLimite} onCheckedChange={setSessaoLimite} />
              </Field>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="sim-espera">
                    {t("comoFunciona.simulador.trocouAgora", { espera: fmtDuracao(espera, idioma) })}
                  </FieldLabel>
                </FieldContent>
                <Switch id="sim-espera" checked={trocouAgora} onCheckedChange={setTrocouAgora} />
              </Field>
              {modo === "rodizio" ? (
                <>
                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldLabel htmlFor="sim-rodizio">{t("comoFunciona.simulador.rodizioVenceu")}</FieldLabel>
                    </FieldContent>
                    <Switch id="sim-rodizio" checked={rodizioVenceu} onCheckedChange={setRodizioVenceu} />
                  </Field>
                  <Field>
                    <FieldLabel>{t("comoFunciona.simulador.ordemRodizio")}</FieldLabel>
                    <div className="flex flex-wrap items-center gap-2">
                      <ToggleGroup
                        type="single"
                        variant="outline"
                        size="sm"
                        value={ordem}
                        onValueChange={(v) => v && setOrdem(v as OrdemRodizio)}
                      >
                        <ToggleGroupItem value="aleatoria">{t("troca.rodizio.aleatoria")}</ToggleGroupItem>
                        <ToggleGroupItem value="menor_uso">{t("troca.rodizio.menor_uso")}</ToggleGroupItem>
                      </ToggleGroup>
                      {ordem === "aleatoria" ? (
                        <Button variant="ghost" size="sm" onClick={() => setSemente((s) => s + 1)}>
                          <ShuffleIcon />
                          {t("comoFunciona.simulador.sortearDeNovo")}
                        </Button>
                      ) : null}
                    </div>
                  </Field>
                </>
              ) : null}
            </FieldGroup>
          </div>

          <div className="rounded-xl border bg-muted/30 p-4" aria-live="polite">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t("comoFunciona.simulador.resultado.titulo")}
            </p>
            <p className="mt-1 flex items-center gap-2 text-xl font-semibold">
              {escolhida ? (
                <span className="size-3 rounded-full" style={{ background: corConta(escolhida.cor) }} aria-hidden />
              ) : null}
              {decisao.contaId === null
                ? t("comoFunciona.simulador.resultado.nenhuma")
                : decisao.trocou
                  ? t("comoFunciona.simulador.resultado.troca", { conta: nome(decisao.contaId) })
                  : t("comoFunciona.simulador.resultado.fica", { conta: nome(decisao.contaId) })}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {t(`comoFunciona.simulador.motivos.${decisao.motivo}`, motivoVars)}
            </p>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {decisao.aviso ? (
                <li className="text-atencao">{t("comoFunciona.simulador.resultado.avisoGerado")}</li>
              ) : null}
              {decisao.alertaSemLivre ? (
                <li className="text-erro">{t("comoFunciona.simulador.resultado.alertaSemLivre")}</li>
              ) : null}
              {decisao.usouReserva ? (
                <li className="text-atencao">{t("comoFunciona.simulador.resultado.usouReserva")}</li>
              ) : null}
            </ul>
            <FieldDescription className="mt-3">
              {t("comoFunciona.simulador.resultado.fila")}:{" "}
              {decisao.fila.length
                ? decisao.fila.map((id) => nome(id)).join(" → ")
                : t("comoFunciona.simulador.resultado.filaVazia")}
            </FieldDescription>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
