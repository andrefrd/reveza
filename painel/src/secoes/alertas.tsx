// Alertas: canais (Telegram, e-mail, webhook, notificação no celular), os eventos de cada um e o botão de teste.

import * as React from "react"
import { BellIcon, MailIcon, PlusIcon, SendIcon, SmartphoneIcon, Trash2Icon, WebhookIcon } from "lucide-react"

import { Confirmar } from "@/components/painel/confirmar"
import { AvisoPermissao, Pagina, PedidoDuasEtapas, useFalta2fa } from "@/components/painel/pagina"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { mensagemErro, useAcao, useDados, useEstado, usePermissao } from "@/dados/contexto"
import { ErroPainel } from "@/dados/fonte"
import type { Alerta, CanalAlerta, EventoAlerta } from "@/dados/tipos"
import { useDialogo } from "@/hooks/use-dialogo"
import { useT } from "@/i18n"
import { toast } from "sonner"
import { inscreverPush } from "@/pwa/registrar"

export const ICONE_CANAL: Record<CanalAlerta, typeof BellIcon> = {
  telegram: SendIcon,
  email: MailIcon,
  webhook: WebhookIcon,
  push: SmartphoneIcon,
}

const CANAIS: CanalAlerta[] = ["push", "telegram", "email", "webhook"]
export const EVENTOS: EventoAlerta[] = [
  "sem_livre",
  "precisa_login",
  "computador_parado",
  "limite",
  "login_vence",
  "resumo_dia",
  "troca",
]

// Os campos de cada canal, como a Edge Function "alertas" usa: os de destino ficam na tabela; o de segredo vai só
// para o Vault (painel_alerta_segredo) e nunca volta para a tela.
const CAMPOS: Record<
  CanalAlerta,
  { nome: string; tipo?: string; obrigatorio?: boolean; segredo?: boolean; padrao?: string }[]
> = {
  telegram: [
    { nome: "chat_id", obrigatorio: true },
    { nome: "bot_token", tipo: "password", obrigatorio: true, segredo: true },
  ],
  email: [
    { nome: "para", tipo: "email", obrigatorio: true },
    { nome: "de", tipo: "email", obrigatorio: true },
    { nome: "chave_email", tipo: "password", obrigatorio: true, segredo: true },
  ],
  webhook: [
    { nome: "url", tipo: "url", obrigatorio: true },
    { nome: "segredo", tipo: "password", obrigatorio: true, segredo: true },
  ],
  push: [],
}

export default function Alertas() {
  const { t } = useT()
  const estado = useEstado()
  const { pode } = usePermissao()
  const novo = useDialogo()
  const falta2fa = useFalta2fa()
  return (
    <Pagina
      titulo={t("menu.secoes.alertas")}
      descricao={t("alertas.descricao")}
      acoes={
        <Button onClick={() => novo.abrir()} disabled={!pode}>
          <PlusIcon />
          {t("alertas.novo")}
        </Button>
      }
    >
      <AvisoPermissao />
      {falta2fa ? (
        <PedidoDuasEtapas />
      ) : estado.alertas.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BellIcon />
            </EmptyMedia>
            <EmptyTitle>{t("alertas.vazio.titulo")}</EmptyTitle>
            <EmptyDescription>{t("alertas.vazio.texto")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => novo.abrir()} disabled={!pode}>
              {t("alertas.novo")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {estado.alertas.map((a) => (
            <CartaoAlerta key={a.id} alerta={a} />
          ))}
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t("alertas.dialogo.eventos")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            {EVENTOS.map((e) => (
              <div key={e}>
                <dt className="font-medium">{t(`alertas.eventos.${e}`)}</dt>
                <dd className="text-muted-foreground">{t(`alertas.eventosDica.${e}`)}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      <NovoAlerta key={novo.chave} aberto={novo.aberto} aoFechar={novo.fechar} />
    </Pagina>
  )
}

/** Nome do canal para a tela; canal que a tela não conhece (o ntfy, que saiu) aparece como veio do banco. */
function useNomeCanal() {
  const { tx } = useT()
  return (canal: string) => {
    const chave = `alertas.canais.${canal}`
    const nome = tx(chave)
    return nome === chave ? canal : nome
  }
}

function CartaoAlerta({ alerta }: { alerta: Alerta }) {
  const { t } = useT()
  const nomeCanal = useNomeCanal()
  const { fonte } = useDados()
  const acao = useAcao()
  const { pode: podeMudar } = usePermissao()
  const [remover, setRemover] = React.useState(false)
  // canal que saiu ou que a tela não conhece: só dá para remover
  const conhecido = Object.hasOwn(ICONE_CANAL, alerta.canal)
  const pode = podeMudar && conhecido
  const Icone = conhecido ? ICONE_CANAL[alerta.canal] : BellIcon
  const destino = alerta.destino || nomeCanal(alerta.canal)
  return (
    <Card className={alerta.ativo ? undefined : "opacity-70"}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="inline-flex size-8 items-center justify-center rounded-lg bg-muted">
            <Icone className="size-4" aria-hidden />
          </span>
          {nomeCanal(alerta.canal)}
        </CardTitle>
        <CardDescription className="truncate">{destino}</CardDescription>
        <CardAction>
          <Switch
            checked={alerta.ativo}
            disabled={!pode}
            aria-label={t("alertas.ativo")}
            onCheckedChange={(ativo) => void acao(() => fonte.mudarAlerta(alerta, { ativo }))}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-1.5">
        {alerta.eventos.map((e) => (
          <Badge key={e} variant="secondary">
            {t(`alertas.eventos.${e}`)}
          </Badge>
        ))}
      </CardContent>
      <CardFooter className="mt-auto justify-between gap-2">
        {fonte.recursos.testarAlerta ? (
          <Button
            variant="outline"
            size="sm"
            disabled={!pode || !alerta.ativo}
            onClick={() => void acao(() => fonte.testarAlerta(alerta.id), t("alertas.testado", { destino }))}
          >
            <SendIcon />
            {t("alertas.testar")}
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>
                <Button variant="outline" size="sm" disabled>
                  <SendIcon />
                  {t("alertas.testar")}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{t("comum.indisponivel")}</TooltipContent>
          </Tooltip>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!podeMudar}
          onClick={() => setRemover(true)}
          aria-label={t("comum.remover")}
        >
          <Trash2Icon />
        </Button>
      </CardFooter>
      <Confirmar
        aberto={remover}
        aoFechar={() => setRemover(false)}
        titulo={t("alertas.remover.titulo", { canal: nomeCanal(alerta.canal) })}
        texto={t("alertas.remover.texto")}
        botao={t("alertas.remover.botao")}
        botaoSegurar={t("alertas.remover.botaoSegurar")}
        aoConfirmar={() => acao(() => fonte.removerAlerta(alerta.id), t("alertas.remover.feito"))}
      />
    </Card>
  )
}

function NovoAlerta({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const { t, tx } = useT()
  const { fonte } = useDados()
  const { recarregar } = useDados()
  const [canal, setCanal] = React.useState<CanalAlerta>("telegram")
  const [campos, setCampos] = React.useState<Record<string, string>>({})
  const [eventos, setEventos] = React.useState<EventoAlerta[]>(["sem_livre", "precisa_login", "computador_parado"])
  const [enviando, setEnviando] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)
  const mudarCanal = (c: CanalAlerta) => {
    setCanal(c)
    setCampos({})
    setErro(null)
  }

  const pushSemChave = canal === "push" && !fonte.recursos.push

  const criar = async () => {
    setEnviando(true)
    const valor = (c: (typeof CAMPOS)[CanalAlerta][number]) => (campos[c.nome] ?? c.padrao ?? "").trim()
    const destino = Object.fromEntries(
      CAMPOS[canal]
        .filter((c) => !c.segredo)
        .map((c) => [c.nome, valor(c)])
        .filter(([, v]) => v)
    )
    const campoSegredo = CAMPOS[canal].find((c) => c.segredo)
    const segredo = campoSegredo ? valor(campoSegredo) || null : null
    // O banco confere o destino de cada canal; a mensagem dele aparece aqui no formulário.
    setErro(null)
    try {
      if (canal === "push") {
        const chave = await fonte.chavePushPublica()
        if (!chave) throw new ErroPainel("indisponivel")
        await fonte.inscreverPush(await inscreverPush(chave))
      }
      await fonte.criarAlerta({ canal, eventos, destino, segredo })
      toast.success(t("alertas.dialogo.criado"))
      void recarregar()
      aoFechar()
    } catch (e) {
      setErro(mensagemErro(e, t, tx))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("alertas.dialogo.titulo")}</DialogTitle>
          <DialogDescription>{t("alertas.dialogo.descricao")}</DialogDescription>
        </DialogHeader>
        <form
          id="form-alerta"
          onSubmit={(e) => {
            e.preventDefault()
            void criar()
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel>{t("alertas.dialogo.canal")}</FieldLabel>
              <ToggleGroup
                type="single"
                variant="outline"
                spacing={1}
                className="flex-wrap"
                value={canal}
                onValueChange={(v) => v && mudarCanal(v as CanalAlerta)}
              >
                {CANAIS.map((c) => {
                  const Icone = ICONE_CANAL[c]
                  return (
                    <ToggleGroupItem key={c} value={c} className="gap-1.5">
                      <Icone />
                      {t(`alertas.canais.${c}`)}
                    </ToggleGroupItem>
                  )
                })}
              </ToggleGroup>
            </Field>
            {CAMPOS[canal].map((c) => {
              const dica = `alertas.campos.${c.nome}Dica`
              return (
                <Field key={`${canal}-${c.nome}`}>
                  <FieldLabel htmlFor={`campo-${c.nome}`}>
                    {tx(`alertas.campos.${c.nome}`)}
                    {!c.obrigatorio ? (
                      <span className="font-normal text-muted-foreground"> ({t("comum.opcional")})</span>
                    ) : null}
                  </FieldLabel>
                  <Input
                    id={`campo-${c.nome}`}
                    type={c.tipo ?? "text"}
                    required={c.obrigatorio}
                    autoComplete={c.segredo ? "new-password" : "off"}
                    placeholder={c.padrao}
                    value={campos[c.nome] ?? ""}
                    onChange={(e) => setCampos((x) => ({ ...x, [c.nome]: e.target.value }))}
                    pattern={c.tipo === "url" ? "https://.+" : undefined}
                  />
                  <DicaCampo chave={dica} />
                </Field>
              )
            })}
            {erro ? <FieldError>{erro}</FieldError> : null}
            {canal === "push" ? (
              <Alert>
                <SmartphoneIcon />
                <AlertDescription>
                  {pushSemChave ? t("alertas.campos.pushIndisponivel") : t("alertas.campos.pushDica")}
                </AlertDescription>
              </Alert>
            ) : null}
            <FieldSet>
              <FieldLegend variant="label">{t("alertas.dialogo.eventos")}</FieldLegend>
              <FieldGroup className="gap-3">
                {EVENTOS.map((e) => (
                  <Field key={e} orientation="horizontal">
                    <Checkbox
                      id={`evento-${e}`}
                      checked={eventos.includes(e)}
                      onCheckedChange={(v) => setEventos((x) => (v ? [...x, e] : x.filter((y) => y !== e)))}
                    />
                    <FieldContent>
                      <FieldLabel htmlFor={`evento-${e}`} className="font-normal">
                        {t(`alertas.eventos.${e}`)}
                      </FieldLabel>
                    </FieldContent>
                  </Field>
                ))}
              </FieldGroup>
            </FieldSet>
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar}>
            {t("comum.cancelar")}
          </Button>
          <Button type="submit" form="form-alerta" disabled={enviando || !eventos.length || pushSemChave}>
            {enviando ? <Spinner /> : null}
            {t("alertas.dialogo.criar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DicaCampo({ chave }: { chave: string }) {
  const { tx } = useT()
  const texto = tx(chave)
  return texto === chave ? null : <FieldDescription>{texto}</FieldDescription>
}
