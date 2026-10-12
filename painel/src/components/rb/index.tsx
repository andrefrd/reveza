// As peças do painel que ganham animação com o React Bits grátis (quando baixado) e têm uma versão simples própria.
// Cada uma lista o componente do React Bits que usa. As cores vão em hexadecimal porque esses componentes leem a cor
// num canvas (variável CSS não serve lá).

import * as React from "react"
import { CheckIcon, CircleDashedIcon, LoaderIcon, XIcon } from "lucide-react"

import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { useT } from "@/i18n"
import { indiceCor } from "@/lib/cores"
import { fmtNumero } from "@/lib/formato"
import { cn } from "@/lib/utils"
import { ReactBits } from "./carregar"

export const CORES_TEMA = {
  light: { texto: "#171717", suave: "#7a7a7a", cartao: "#ffffff", borda: "#e5e5e5", fundo: "#fcfcfc" },
  dark: { texto: "#fafafa", suave: "#9a9a9a", cartao: "#1c1c1c", borda: "#333333", fundo: "#0a0a0a" },
} as const

/** As mesmas 7 cores das contas do index.css, para os componentes que pedem cor concreta. */
export const CORES_CONTA = {
  light: ["#2a78d6", "#b08a1e", "#1f9e74", "#804699", "#6e9a1f", "#4b4fb8", "#3f8f2f"],
  dark: ["#3987e5", "#b38f22", "#1aa37a", "#9e62ad", "#7aa62a", "#7478e0", "#4a9a38"],
} as const

export function useCoresTema() {
  const { resolvido } = useTheme()
  return { tema: resolvido, ...CORES_TEMA[resolvido], conta: (cor: number) => CORES_CONTA[resolvido][indiceCor(cor)] }
}

/** Número inteiro que conta até o valor (React Bits: CountUp). */
export function NumeroAnimado({ valor, className }: { valor: number; className?: string }) {
  const { idioma } = useT()
  const inteiro = Math.round(valor)
  const reserva = <span className={className}>{fmtNumero(inteiro, idioma)}</span>
  return (
    <ReactBits
      nome="CountUp"
      reserva={reserva}
      props={{ to: inteiro, from: 0, duration: 1, separator: idioma === "en" ? "," : ".", className }}
    />
  )
}

/** Texto com um brilho que passa (React Bits: ShinyText). */
export function TextoBrilho({ children, className }: { children: string; className?: string }) {
  const c = useCoresTema()
  return (
    <ReactBits
      nome="ShinyText"
      reserva={<span className={className}>{children}</span>}
      props={{ text: children, color: c.suave, shineColor: c.texto, speed: 3, className }}
    />
  )
}

/** Nome do produto em degradê com as cores das contas (React Bits: GradientText). */
export function TextoGradiente({ children, className }: { children: string; className?: string }) {
  const c = useCoresTema()
  return (
    <ReactBits
      nome="GradientText"
      reserva={<span className={className}>{children}</span>}
      props={{ children, colors: [c.conta(0), c.conta(2), c.conta(5), c.conta(0)], animationSpeed: 10, className }}
    />
  )
}

/** Parágrafo que entra desfocando palavra a palavra (React Bits: BlurText). */
export function TextoDesfocado({ texto, className }: { texto: string; className?: string }) {
  return (
    <ReactBits
      nome="BlurText"
      reserva={<p className={className}>{texto}</p>}
      props={{ text: texto, animateBy: "words", direction: "top", delay: 35, className }}
    />
  )
}

/** Texto que aparece embaralhado e se decifra (React Bits: DecryptedText). */
export function TextoCifrado({
  texto,
  className,
  repetir,
}: {
  texto: string
  className?: string
  /** Muda para recomeçar a animação. */
  repetir?: number
}) {
  return (
    <ReactBits
      key={repetir}
      nome="DecryptedText"
      reserva={<span className={className}>{texto}</span>}
      props={{
        text: texto,
        animateOn: "view",
        sequential: true,
        speed: 35,
        maxIterations: 14,
        revealDirection: "start",
        characters: "0123456789abcdef",
        className,
        parentClassName: className,
        encryptedClassName: "text-muted-foreground",
      }}
    />
  )
}

/** Cartão com uma luz que segue o ponteiro (React Bits: SpotlightCard). Sem ele, um cartão comum. */
export function CartaoLuz({ children, className }: { children: React.ReactNode; className?: string }) {
  const c = useCoresTema()
  const base = cn("rounded-xl border bg-card p-4 text-card-foreground", className)
  return (
    <ReactBits
      nome="SpotlightCard"
      mesmoComMenosMovimento
      reserva={<div className={base}>{children}</div>}
      props={{
        children,
        theme: c.tema,
        intensity: c.tema === "dark" ? 0.12 : 0.2,
        spotlightSize: 220,
        className: cn("!rounded-xl !p-4 text-card-foreground", className),
        style: {
          "--spotlight-card-surface": "var(--card)",
          "--spotlight-card-border": "var(--border)",
          "--spotlight-card-shadow": "none",
        },
      }}
    />
  )
}

/**
 * Nível de uso que a pessoa arrasta, 0 a 100 (React Bits: SloshGauge, um tanque de líquido). Sem ele, um slider.
 */
export function NivelArrastavel({
  valor,
  aoMudar,
  rotulo,
  cor,
  altura = 132,
}: {
  valor: number
  aoMudar: (v: number) => void
  rotulo: string
  cor: number
  altura?: number
}) {
  const c = useCoresTema()
  const reserva = (
    <div className="flex w-full items-center gap-3">
      <Slider
        value={[valor]}
        min={0}
        max={100}
        step={1}
        onValueChange={(v) => aoMudar(v[0] ?? 0)}
        aria-label={rotulo}
        className="flex-1"
      />
      <span className="w-10 text-right text-sm tabular-nums">{Math.round(valor)}%</span>
    </div>
  )
  return (
    <ReactBits
      nome="SloshGauge"
      reserva={reserva}
      props={{
        value: valor,
        onChange: aoMudar,
        interactive: true,
        liquidColor: c.conta(cor),
        glassColor: c.tema === "dark" ? "#262626" : "#ececec",
        width: 64,
        height: altura,
        radius: 14,
        ticks: 4,
        ariaLabel: rotulo,
        className: c.tema === "dark" ? "text-neutral-100" : "text-neutral-800",
      }}
    />
  )
}

/**
 * Botão de confirmação por segurar (React Bits: HoldButton). Sem ele (ou pedindo menos movimento), um botão comum,
 * que já fica dentro de uma caixa de confirmação.
 */
export function BotaoSegurar({
  rotulo,
  rotuloSegurar,
  aoConfirmar,
  desligado,
  rotuloFeito,
}: {
  rotulo: string
  rotuloSegurar: string
  aoConfirmar: () => void
  desligado?: boolean
  rotuloFeito: string
}) {
  const reserva = (
    <Button variant="destructive" onClick={aoConfirmar} disabled={desligado}>
      {rotulo}
    </Button>
  )
  return (
    <ReactBits
      nome="HoldButton"
      reserva={reserva}
      props={{
        children: rotuloSegurar,
        doneLabel: rotuloFeito,
        onHold: aoConfirmar,
        disabled: desligado,
        size: "sm",
        radius: 8,
        holdTime: 1100,
        backgroundColor: "color-mix(in oklch, var(--destructive) 14%, transparent)",
        fillColor: "var(--destructive)",
        textColor: "var(--destructive)",
        fillTextColor: "var(--background)",
      }}
    />
  )
}

/** Sinal de estado de um item (React Bits: StatusMark, só o desenho). Sem ele, ícones. */
export function MarcaEstado({
  estado,
  rotulo,
  className,
}: {
  estado: "feito" | "atencao" | "falhou" | "rodando" | "pendente"
  rotulo: React.ReactNode
  className?: string
}) {
  const c = useCoresTema()
  const icone = (
    <span
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-full",
        estado === "feito" && "bg-ok-fundo text-ok",
        estado === "atencao" && "bg-atencao-fundo text-atencao",
        estado === "falhou" && "bg-erro-fundo text-erro",
        estado === "rodando" && "bg-muted text-muted-foreground",
        estado === "pendente" && "text-muted-foreground"
      )}
      aria-hidden
    >
      {estado === "feito" ? (
        <CheckIcon className="size-3.5" />
      ) : estado === "falhou" || estado === "atencao" ? (
        <XIcon className="size-3.5" />
      ) : estado === "rodando" ? (
        <LoaderIcon className="size-3.5 animate-spin" />
      ) : (
        <CircleDashedIcon className="size-4" />
      )}
    </span>
  )
  const status = { feito: "done", atencao: "failed", falhou: "failed", rodando: "running", pendente: "pending" }[estado]
  // laranja = atenção; vermelho clarinho = erro
  const corErro =
    estado === "atencao" ? (c.tema === "dark" ? "#fdba74" : "#b45309") : c.tema === "dark" ? "#f2a7a0" : "#c4554e"
  return (
    <span className={cn("inline-flex min-w-0 items-start gap-2 text-sm", className)}>
      <span className="mt-px inline-flex">
        <ReactBits
          nome="StatusMark"
          mesmoComMenosMovimento
          reserva={icone}
          props={{
            status,
            label: null,
            size: 20,
            color: c.suave,
            doneColor: c.tema === "dark" ? "#4ade80" : "#15803d",
            errorColor: corErro,
            strike: false,
          }}
        />
      </span>
      <span className="min-w-0">{rotulo}</span>
    </span>
  )
}

/** Fundo de aurora para as telas de entrada (React Bits: Aurora, WebGL). Sem ele, um degradê parado. */
export function FundoAurora() {
  const c = useCoresTema()
  const reserva = (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-60 [background:radial-gradient(60%_50%_at_20%_0%,color-mix(in_oklch,var(--conta-1)_22%,transparent),transparent),radial-gradient(50%_40%_at_90%_10%,color-mix(in_oklch,var(--conta-3)_18%,transparent),transparent)]"
    />
  )
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-[60vh] overflow-hidden opacity-60 dark:opacity-100"
    >
      <ReactBits
        nome="Aurora"
        reserva={reserva}
        props={{
          colorStops: [c.conta(0), c.conta(5), c.conta(2)],
          amplitude: 0.9,
          blend: 0.6,
          speed: 0.6,
          lightMode: c.tema === "light",
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/40 to-background" />
    </div>
  )
}
