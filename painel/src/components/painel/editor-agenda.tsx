// Editor da agenda de uma conta: faixas de dias e horário em que a nuvem pode escolher a conta
// ({dias:[1..7], de:"08:00", ate:"18:00"}, 1 = segunda), no fuso da configuração.

import { PlusIcon, Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { FaixaAgenda } from "@/dados/tipos"
import { useT } from "@/i18n"

export function useDias() {
  const { t } = useT()
  return {
    curtos: t("contas.agenda.dias").split(","),
    longos: t("contas.agenda.diasLongos").split(","),
  }
}

/** "seg a sex, 08:00 às 18:00" */
export function resumoFaixa(f: FaixaAgenda, curtos: string[], ate: string): string {
  const dias = [...f.dias].sort((a, b) => a - b)
  const seguidos = dias.every((d, i) => i === 0 || d === dias[i - 1] + 1)
  const nomes =
    dias.length === 7
      ? `${curtos[0]}–${curtos[6]}`
      : seguidos && dias.length > 2
        ? `${curtos[dias[0] - 1]}–${curtos[dias[dias.length - 1] - 1]}`
        : dias.map((d) => curtos[d - 1]).join(", ")
  return `${nomes}, ${f.de} ${ate} ${f.ate}`
}

export function EditorAgenda({
  valor,
  aoMudar,
  desligado,
}: {
  valor: FaixaAgenda[]
  aoMudar: (v: FaixaAgenda[]) => void
  desligado?: boolean
}) {
  const { t } = useT()
  const { curtos, longos } = useDias()
  const mudar = (i: number, f: Partial<FaixaAgenda>) => aoMudar(valor.map((x, j) => (j === i ? { ...x, ...f } : x)))
  return (
    <div className="flex flex-col gap-3">
      {valor.map((f, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-lg border p-3">
          <ToggleGroup
            type="multiple"
            variant="outline"
            size="sm"
            spacing={1}
            className="flex-wrap"
            value={f.dias.map(String)}
            onValueChange={(v) => mudar(i, { dias: v.map(Number).sort((a, b) => a - b) })}
            disabled={desligado}
          >
            {curtos.map((d, k) => (
              <ToggleGroupItem key={k} value={String(k + 1)} aria-label={longos[k]} className="min-w-10">
                {d}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t("contas.agenda.de")}</span>
            <Input
              type="time"
              value={f.de}
              onChange={(e) => mudar(i, { de: e.target.value })}
              className="w-28"
              disabled={desligado}
              aria-label={t("contas.agenda.de")}
            />
            <span className="text-muted-foreground">{t("contas.agenda.ate")}</span>
            <Input
              type="time"
              value={f.ate}
              onChange={(e) => mudar(i, { ate: e.target.value })}
              className="w-28"
              disabled={desligado}
              aria-label={t("contas.agenda.ate")}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="ml-auto"
              aria-label={t("contas.agenda.remover")}
              onClick={() => aoMudar(valor.filter((_, j) => j !== i))}
              disabled={desligado}
            >
              <Trash2Icon />
            </Button>
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={desligado}
        onClick={() => aoMudar([...valor, { dias: [1, 2, 3, 4, 5], de: "08:00", ate: "18:00" }])}
      >
        <PlusIcon />
        {t("contas.agenda.adicionar")}
      </Button>
    </div>
  )
}
