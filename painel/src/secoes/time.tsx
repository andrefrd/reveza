// Time: membros e papéis (administrador ou leitura), convites e a auditoria.

import * as React from "react"
import { MailIcon, SearchIcon, UserMinusIcon, UserPlusIcon, XIcon } from "lucide-react"

import { BotaoCopiar } from "@/components/painel/copiar"
import { Confirmar } from "@/components/painel/confirmar"
import { AvisoPermissao, Pagina, PedidoDuasEtapas, useFalta2fa } from "@/components/painel/pagina"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAcao, useAgora, useConsulta, useDados, useEstado, usePermissao } from "@/dados/contexto"
import type { Instantaneo, Membro, Papel } from "@/dados/tipos"
import { useDialogo } from "@/hooks/use-dialogo"
import { useT } from "@/i18n"
import { fmtDataHora, fmtFuturo, fmtRelativo, iniciais } from "@/lib/formato"

export default function Time() {
  const { t } = useT()
  const { pode } = usePermissao()
  const convidar = useDialogo()
  return (
    <Pagina
      titulo={t("menu.secoes.time")}
      descricao={t("time.descricao")}
      acoes={
        <Button onClick={() => convidar.abrir()} disabled={!pode}>
          <UserPlusIcon />
          {t("time.convidar")}
        </Button>
      }
    >
      <AvisoPermissao />
      <div className="grid gap-4 xl:grid-cols-5">
        <Membros className="xl:col-span-3" />
        <Convites className="xl:col-span-2" />
      </div>
      <Auditoria />
      <Convidar key={convidar.chave} aberto={convidar.aberto} aoFechar={convidar.fechar} />
    </Pagina>
  )
}

function nomeMembro(m: Membro, t: ReturnType<typeof useT>["t"]) {
  return m.nome || m.email || t("time.membros.semNome", { id: m.userId.slice(0, 6) })
}

function Membros({ className }: { className?: string }) {
  const { t, idioma } = useT()
  const estado = useEstado()
  const agora = useAgora(60_000)
  const { fonte } = useDados()
  const acao = useAcao()
  const { pode } = usePermissao()
  const [revogar, setRevogar] = React.useState<Membro | null>(null)
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{t("time.membros.titulo")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {estado.membros.map((m) => {
            const voce = m.userId === estado.eu.userId
            const nome = nomeMembro(m, t)
            return (
              <li key={m.userId} className="flex flex-wrap items-center gap-3 py-3">
                <Avatar className="size-9 rounded-lg">
                  <AvatarFallback className="rounded-lg">{iniciais(nome)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 max-sm:basis-[calc(100%-3rem)]">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{nome}</span>
                    {voce ? <Badge variant="secondary">{t("time.membros.voce")}</Badge> : null}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {m.email && m.email !== nome ? `${m.email} · ` : ""}
                    {t("time.membros.desde", { quando: fmtRelativo(m.criadoEm, agora, idioma) })}
                  </p>
                </div>
                <div className="flex items-center gap-1 max-sm:ml-12">
                  <Select
                    value={m.papel}
                    disabled={!pode || voce}
                    onValueChange={(v) =>
                      void acao(
                        () => fonte.mudarPapel(m.userId, v as Papel),
                        t("time.membros.papelMudado", { nome, papel: t(`time.papeis.${v as Papel}`) })
                      )
                    }
                  >
                    <SelectTrigger size="sm" className="w-36" aria-label={t("time.membros.papel")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">{t("time.papeis.admin")}</SelectItem>
                      <SelectItem value="leitura">{t("time.papeis.leitura")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={!pode || voce}
                    onClick={() => setRevogar(m)}
                    aria-label={t("time.membros.revogar.botao")}
                  >
                    <UserMinusIcon />
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      </CardContent>
      <Confirmar
        aberto={!!revogar}
        aoFechar={() => setRevogar(null)}
        titulo={t("time.membros.revogar.titulo", { nome: revogar ? nomeMembro(revogar, t) : "" })}
        texto={t("time.membros.revogar.texto")}
        botao={t("time.membros.revogar.botao")}
        botaoSegurar={t("time.membros.revogar.botaoSegurar")}
        aoConfirmar={() =>
          revogar
            ? acao(
                () => fonte.revogarMembro(revogar.userId),
                t("time.membros.revogar.feito", { nome: nomeMembro(revogar, t) })
              )
            : undefined
        }
      />
    </Card>
  )
}

function Convites({ className }: { className?: string }) {
  const { t, idioma } = useT()
  const estado = useEstado()
  const agora = useAgora(60_000)
  const { fonte } = useDados()
  const acao = useAcao()
  const { pode } = usePermissao()
  const falta2fa = useFalta2fa()
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{t("time.convites.titulo")}</CardTitle>
      </CardHeader>
      <CardContent>
        {falta2fa ? (
          <PedidoDuasEtapas />
        ) : estado.convites.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("time.convites.vazio")}</p>
        ) : (
          <ul className="divide-y">
            {estado.convites.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-3">
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <MailIcon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{c.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {t(`time.papeis.${c.papel}`)} ·{" "}
                    {t("time.convites.expira", { quando: fmtFuturo(c.expiraEm, agora, idioma) })}
                  </p>
                </div>
                {fonte.recursos.cancelarConvite ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={!pode}
                    aria-label={t("time.convites.cancelar")}
                    onClick={() => void acao(() => fonte.cancelarConvite(c.id), t("time.convites.cancelado"))}
                  >
                    <XIcon />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function Convidar({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const { t } = useT()
  const { fonte } = useDados()
  const acao = useAcao()
  const [email, setEmail] = React.useState("")
  const [papel, setPapel] = React.useState<Papel>("leitura")
  const [link, setLink] = React.useState<string | null>(null)
  const [enviando, setEnviando] = React.useState(false)
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("time.dialogo.titulo")}</DialogTitle>
          <DialogDescription>{t("time.dialogo.descricao")}</DialogDescription>
        </DialogHeader>
        {link ? (
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-muted-foreground">{t("time.dialogo.link")}</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/50 px-2 py-2 font-mono text-xs">
                {link}
              </code>
              <BotaoCopiar texto={link} />
            </div>
          </div>
        ) : (
          <form
            id="form-convite"
            onSubmit={async (e) => {
              e.preventDefault()
              setEnviando(true)
              const [ok, r] = await acao(() => fonte.convidar(email, papel), t("time.dialogo.enviado", { email }))
              setEnviando(false)
              if (!ok) return
              if (r.link) setLink(r.link)
              else aoFechar()
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="convite-email">{t("time.dialogo.email")}</FieldLabel>
                <Input
                  id="convite-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>{t("time.dialogo.papel")}</FieldLabel>
                <RadioGroup value={papel} onValueChange={(v) => setPapel(v as Papel)}>
                  {(["leitura", "admin"] as const).map((p) => (
                    <FieldLabel key={p} htmlFor={`papel-${p}`}>
                      <Field orientation="horizontal">
                        <RadioGroupItem value={p} id={`papel-${p}`} />
                        <FieldContent>
                          <FieldTitle>{t(`time.papeis.${p}`)}</FieldTitle>
                          <FieldDescription>{t(`time.papeis.${p}Dica`)}</FieldDescription>
                        </FieldContent>
                      </Field>
                    </FieldLabel>
                  ))}
                </RadioGroup>
              </Field>
            </FieldGroup>
          </form>
        )}
        <DialogFooter>
          {link ? (
            <Button onClick={aoFechar}>{t("comum.fechar")}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={aoFechar}>
                {t("comum.cancelar")}
              </Button>
              <Button type="submit" form="form-convite" disabled={enviando}>
                {enviando ? <Spinner /> : null}
                {t("time.dialogo.enviar")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** O alvo da auditoria costuma ser um id: vira o nome atual da conta, do computador ou do membro. */
function alvoLegivel(alvo: string | null, estado: Instantaneo, t: ReturnType<typeof useT>["t"]) {
  if (!alvo) return ""
  const conta = estado.contas.find((c) => c.id === alvo)
  if (conta) return conta.email
  const pc = estado.computadores.find((c) => c.id === alvo)
  if (pc) return pc.nome
  const m = estado.membros.find((x) => x.userId === alvo)
  if (m) return nomeMembro(m, t)
  return alvo
}

function Auditoria() {
  const { t, tx, idioma } = useT()
  const estado = useEstado()
  const agora = useAgora(60_000)
  const falta2fa = useFalta2fa()
  const admin = estado.eu.papel === "admin"
  const lista = useConsulta((f) => (admin ? f.auditoria(200) : Promise.resolve([])), [admin])
  const [busca, setBusca] = React.useState("")
  const linhas = React.useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return (lista.dados ?? [])
      .map((a) => ({
        ...a,
        acaoTexto:
          tx(`time.auditoria.acoes.${a.acao}`) === `time.auditoria.acoes.${a.acao}`
            ? a.acao
            : tx(`time.auditoria.acoes.${a.acao}`),
        alvoTexto: alvoLegivel(a.alvo, estado, t),
      }))
      .filter((a) => !termo || [a.quem, a.acaoTexto, a.alvoTexto].some((x) => x.toLowerCase().includes(termo)))
  }, [lista.dados, busca, estado, t, tx])
  return (
    <Card>
      <CardHeader className="max-sm:grid-cols-1">
        <CardTitle>{t("time.auditoria.titulo")}</CardTitle>
        <CardDescription>{t("time.auditoria.descricao")}</CardDescription>
        {admin ? (
          <CardAction className="col-span-full col-start-1 row-start-3 mt-2 w-full sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:mt-0 sm:w-64">
            <InputGroup>
              <InputGroupInput
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder={t("time.auditoria.buscar")}
                aria-label={t("time.auditoria.buscar")}
              />
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
            </InputGroup>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="px-0">
        {!admin ? (
          <p className="px-6 text-sm text-muted-foreground">{t("time.auditoria.soAdmin")}</p>
        ) : falta2fa ? (
          <div className="px-6">
            <PedidoDuasEtapas />
          </div>
        ) : !lista.dados ? (
          <Skeleton className="mx-6 h-40" />
        ) : linhas.length === 0 ? (
          <p className="px-6 text-sm text-muted-foreground">{t("time.auditoria.vazio")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">{t("time.auditoria.quando")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("time.auditoria.quem")}</TableHead>
                <TableHead>{t("time.auditoria.acao")}</TableHead>
                <TableHead className="hidden pr-6 md:table-cell">{t("time.auditoria.alvo")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.slice(0, 50).map((a) => (
                <TableRow key={a.id}>
                  <TableCell
                    className="pl-6 whitespace-nowrap text-muted-foreground"
                    title={fmtDataHora(a.em, agora, idioma)}
                  >
                    {fmtRelativo(a.em, agora, idioma)}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{a.quem}</TableCell>
                  <TableCell className="whitespace-normal">
                    {a.acaoTexto}
                    <span className="block text-xs text-muted-foreground md:hidden">{a.alvoTexto}</span>
                  </TableCell>
                  <TableCell className="hidden max-w-72 truncate pr-6 text-muted-foreground md:table-cell">
                    {a.alvoTexto}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
