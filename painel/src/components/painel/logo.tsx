// A marca do Reveza AI: duas setas que se revezam num círculo (as mesmas de public/icones/icone.svg).

import { cn } from "@/lib/utils"

export function Logo({ className, fundo = true }: { className?: string; fundo?: boolean }) {
  return (
    <svg viewBox="0 0 512 512" className={cn("size-8 shrink-0", className)} aria-hidden focusable="false">
      {fundo ? <rect width="512" height="512" rx="112" className="fill-foreground dark:fill-[#232323]" /> : null}
      <path
        d="M145.7 275.4A112 112 0 0 1 312 159"
        fill="none"
        stroke="var(--conta-1)"
        strokeWidth="44"
        strokeLinecap="round"
      />
      <path
        d="M353.6 183L332 124.4L292 193.6Z"
        fill="var(--conta-1)"
        stroke="var(--conta-1)"
        strokeWidth="10"
        strokeLinejoin="round"
      />
      <path
        d="M366.3 236.6A112 112 0 0 1 200 353"
        fill="none"
        stroke="var(--conta-3)"
        strokeWidth="44"
        strokeLinecap="round"
      />
      <path
        d="M158.4 329L180 387.6L220 318.4Z"
        fill="var(--conta-3)"
        stroke="var(--conta-3)"
        strokeWidth="10"
        strokeLinejoin="round"
      />
    </svg>
  )
}
