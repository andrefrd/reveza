// Telas de entrada: entrar, código de duas etapas, esqueci a senha, senha nova, aceitar convite e ligar a verificação
// em duas etapas (obrigatória para administrador). Moldura adaptada do bloco oficial "login-03" do shadcn/ui
// (cartão centralizado sobre fundo neutro), com o formulário do "login-form" do mesmo bloco, sem login social.

import * as React from "react"
import { REGEXP_ONLY_DIGITS } from "input-otp"

import { BotaoCopiar } from "@/components/painel/copiar"
import { Logo } from "@/components/painel/logo"
import { CodigoQR } from "@/components/painel/qr"
import { FundoAurora, TextoDesfocado, TextoGradiente } from "@/components/rb"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"
import { Spinner } from "@/components/ui/spinner"
import { useT } from "@/i18n"
import { comDemo, emDemo } from "@/lib/demo"
import { navegar, useRota } from "@/lib/rota"
import { cn } from "@/lib/utils"
import { problemaSenha, type InicioTotp } from "./auth"
import { useSessao } from "./sessao"

function useErroTraduzido() {
  const { tx, t } = useT()
  return (e: unknown) => {
    const codigo = e instanceof Error ? e.message : "falha"
    const chave = `erros.${codigo}`
    const msg = tx(chave)
    return msg === chave ? t("erros.falha") : msg
  }
}

function destinoDepois(parametros: URLSearchParams) {
  const voltar = parametros.get("voltar")
  // só caminhos internos: nada de redirecionar para fora do painel ("/\\host" e "/<tab>/host" também saem)
  let seguro = "/"
  if (voltar && voltar.startsWith("/") && !voltar.startsWith("//")) {
    try {
      const u = new URL(voltar, window.location.origin)
      if (u.origin === window.location.origin) seguro = u.pathname + u.search + u.hash
    } catch {
      /* fica na raiz */
    }
  }
  return comDemo(seguro)
}

function Moldura({ titulo, descricao, children }: { titulo: string; descricao?: string; children: React.ReactNode }) {
  const { t, idioma, setIdioma } = useT()
  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center gap-6 overflow-hidden bg-background p-4 sm:p-6 md:p-10">
      <FundoAurora />
      <div className="relative flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <a href={comDemo("/")} className="flex items-center gap-2 self-center font-medium">
            <Logo className="size-8 rounded-lg" />
            <TextoGradiente className="text-lg font-semibold">{t("app.nome")}</TextoGradiente>
          </a>
          <TextoDesfocado texto={t("auth.lema")} className="justify-center text-sm text-muted-foreground" />
        </div>
        <Card className="bg-card/90 backdrop-blur">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">{titulo}</CardTitle>
            {descricao ? <CardDescription>{descricao}</CardDescription> : null}
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
        <div
          className="flex items-center justify-center gap-1 text-xs text-muted-foreground"
          aria-label={t("auth.idioma")}
        >
          {(["pt-BR", "en"] as const).map((i) => (
            <Button
              key={i}
              variant="ghost"
              size="xs"
              aria-pressed={idioma === i}
              className={cn(idioma === i && "text-foreground")}
              onClick={() => setIdioma(i)}
            >
              {i === "pt-BR" ? "Português" : "English"}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function CampoCodigo({
  valor,
  aoMudar,
  aoCompletar,
  invalido,
  id,
  alinhar = "centro",
}: {
  valor: string
  aoMudar: (v: string) => void
  aoCompletar?: (v: string) => void
  invalido?: boolean
  id?: string
  alinhar?: "centro" | "inicio"
}) {
  const { t } = useT()
  return (
    <InputOTP
      id={id}
      maxLength={6}
      pattern={REGEXP_ONLY_DIGITS}
      value={valor}
      onChange={aoMudar}
      onComplete={aoCompletar}
      inputMode="numeric"
      autoComplete="one-time-code"
      aria-label={t("auth.codigo.rotulo")}
      aria-invalid={invalido || undefined}
      containerClassName={alinhar === "centro" ? "justify-center" : "justify-start"}
    >
      <InputOTPGroup className="*:data-[slot=input-otp-slot]:size-11 *:data-[slot=input-otp-slot]:text-lg">
        {Array.from({ length: 6 }, (_, i) => (
          <InputOTPSlot key={i} index={i} aria-invalid={invalido || undefined} />
        ))}
      </InputOTPGroup>
    </InputOTP>
  )
}

function Entrar() {
  const { t } = useT()
  const { auth, recarregar } = useSessao()
  const { parametros } = useRota()
  const traduzir = useErroTraduzido()
  const [email, setEmail] = React.useState("")
  const [senha, setSenha] = React.useState("")
  const [erro, setErro] = React.useState<string | null>(null)
  const [enviando, setEnviando] = React.useState(false)
  return (
    <Moldura titulo={t("auth.entrar.titulo")} descricao={t("auth.entrar.descricao")}>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          setErro(null)
          setEnviando(true)
          try {
            const estado = await auth.entrar(email, senha)
            await recarregar()
            const voltar = parametros.get("voltar")
            navegar(
              estado.falta2fa
                ? comDemo(`/duas-etapas${voltar ? `?voltar=${encodeURIComponent(voltar)}` : ""}`)
                : destinoDepois(parametros)
            )
          } catch (e) {
            setErro(traduzir(e))
          } finally {
            setEnviando(false)
          }
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email">{t("auth.email")}</FieldLabel>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              placeholder={t("auth.emailExemplo")}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field>
            <div className="flex items-center">
              <FieldLabel htmlFor="senha">{t("auth.senha")}</FieldLabel>
              <a
                href={comDemo("/esqueci")}
                onClick={(e) => {
                  e.preventDefault()
                  navegar(comDemo("/esqueci"))
                }}
                className="ml-auto text-sm underline-offset-4 hover:underline"
              >
                {t("auth.entrar.esqueci")}
              </a>
            </div>
            <Input
              id="senha"
              type="password"
              autoComplete="current-password"
              required
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
            />
          </Field>
          {erro ? <FieldError>{erro}</FieldError> : null}
          <Field>
            <Button type="submit" size="lg" disabled={enviando}>
              {enviando ? <Spinner /> : null}
              {t("auth.entrar.botao")}
            </Button>
            <FieldDescription className="text-center">{t("auth.entrar.soConvite")}</FieldDescription>
          </Field>
        </FieldGroup>
      </form>
    </Moldura>
  )
}

function DuasEtapas() {
  const { t } = useT()
  const { auth, recarregar, sair } = useSessao()
  const { parametros } = useRota()
  const traduzir = useErroTraduzido()
  const [codigo, setCodigo] = React.useState("")
  const [erro, setErro] = React.useState<string | null>(null)
  const [enviando, setEnviando] = React.useState(false)
  const confirmar = async (c: string) => {
    setErro(null)
    setEnviando(true)
    try {
      await auth.verificarCodigo(c)
      await recarregar()
      navegar(destinoDepois(parametros))
    } catch (e) {
      setErro(traduzir(e))
      setCodigo("")
    } finally {
      setEnviando(false)
    }
  }
  return (
    <Moldura titulo={t("auth.codigo.titulo")} descricao={t("auth.codigo.descricao")}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void confirmar(codigo)
        }}
      >
        <FieldGroup>
          <Field>
            <CampoCodigo valor={codigo} aoMudar={setCodigo} aoCompletar={(v) => void confirmar(v)} invalido={!!erro} />
            {erro ? <FieldError className="text-center">{erro}</FieldError> : null}
          </Field>
          <Field>
            <Button type="submit" size="lg" disabled={codigo.length !== 6 || enviando}>
              {enviando ? <Spinner /> : null}
              {t("auth.codigo.botao")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => void sair()}>
              {t("auth.codigo.outraConta")}
            </Button>
          </Field>
        </FieldGroup>
      </form>
    </Moldura>
  )
}

function Esqueci() {
  const { t } = useT()
  const { auth } = useSessao()
  const traduzir = useErroTraduzido()
  const [email, setEmail] = React.useState("")
  const [enviado, setEnviado] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)
  const [enviando, setEnviando] = React.useState(false)
  return (
    <Moldura titulo={t("auth.esqueci.titulo")} descricao={t("auth.esqueci.descricao")}>
      {enviado ? (
        <div className="flex flex-col gap-4">
          <Alert>
            <AlertDescription>{t("auth.esqueci.enviado")}</AlertDescription>
          </Alert>
          <Button variant="outline" onClick={() => navegar(comDemo("/entrar"))}>
            {t("auth.esqueci.voltar")}
          </Button>
        </div>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            setErro(null)
            setEnviando(true)
            try {
              await auth.esqueci(email)
              setEnviado(true)
            } catch (e) {
              setErro(traduzir(e))
            } finally {
              setEnviando(false)
            }
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="email">{t("auth.email")}</FieldLabel>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            {erro ? <FieldError>{erro}</FieldError> : null}
            <Field>
              <Button type="submit" size="lg" disabled={enviando}>
                {enviando ? <Spinner /> : null}
                {t("auth.esqueci.botao")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => navegar(comDemo("/entrar"))}>
                {t("auth.esqueci.voltar")}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      )}
    </Moldura>
  )
}

/** Senha nova + repetição, com a regra de senha conferida antes de mandar. */
function CamposSenha({
  senha,
  setSenha,
  repetir,
  setRepetir,
}: {
  senha: string
  setSenha: (v: string) => void
  repetir: string
  setRepetir: (v: string) => void
}) {
  const { t } = useT()
  return (
    <>
      <Field>
        <FieldLabel htmlFor="senha-nova">{t("auth.novaSenha")}</FieldLabel>
        <Input
          id="senha-nova"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
        />
        <FieldDescription>{t("auth.dicaSenha")}</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="senha-repetir">{t("auth.repetirSenha")}</FieldLabel>
        <Input
          id="senha-repetir"
          type="password"
          autoComplete="new-password"
          required
          value={repetir}
          onChange={(e) => setRepetir(e.target.value)}
        />
      </Field>
    </>
  )
}

function validarSenhas(senha: string, repetir: string): string | null {
  if (senha !== repetir) return "senhas_diferentes"
  const p = problemaSenha(senha)
  return p ? `senha_${p}` : null
}

function NovaSenha() {
  const { t, tx } = useT()
  const { auth, recarregar } = useSessao()
  const traduzir = useErroTraduzido()
  const [senha, setSenha] = React.useState("")
  const [repetir, setRepetir] = React.useState("")
  const [erro, setErro] = React.useState<string | null>(null)
  const [enviando, setEnviando] = React.useState(false)
  return (
    <Moldura titulo={t("auth.nova.titulo")} descricao={t("auth.nova.descricao")}>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          const problema = validarSenhas(senha, repetir)
          if (problema) return setErro(tx(`erros.${problema}`))
          setErro(null)
          setEnviando(true)
          try {
            await auth.definirSenha(senha)
            await recarregar()
            navegar(comDemo("/"))
          } catch (e) {
            setErro(traduzir(e))
          } finally {
            setEnviando(false)
          }
        }}
      >
        <FieldGroup>
          <CamposSenha senha={senha} setSenha={setSenha} repetir={repetir} setRepetir={setRepetir} />
          {erro ? <FieldError>{erro}</FieldError> : null}
          <Field>
            <Button type="submit" size="lg" disabled={enviando}>
              {enviando ? <Spinner /> : null}
              {t("auth.nova.botao")}
            </Button>
          </Field>
        </FieldGroup>
      </form>
    </Moldura>
  )
}

function Convite() {
  const { t, tx } = useT()
  const { auth, recarregar } = useSessao()
  const { parametros } = useRota()
  const traduzir = useErroTraduzido()
  // O e-mail do convite volta para /aceitar?convite=<token> já com a sessão aberta pelo Auth.
  const convite = parametros.get("convite") ?? parametros.get("token") ?? ""
  const [senha, setSenha] = React.useState("")
  const [repetir, setRepetir] = React.useState("")
  const [erro, setErro] = React.useState<string | null>(null)
  const [enviando, setEnviando] = React.useState(false)
  return (
    <Moldura titulo={t("auth.convite.titulo")} descricao={t("auth.convite.descricao")}>
      {!convite ? (
        <Alert>
          <AlertDescription>{t("auth.convite.semToken")}</AlertDescription>
        </Alert>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            const problema = validarSenhas(senha, repetir)
            if (problema) return setErro(tx(`erros.${problema}`))
            setErro(null)
            setEnviando(true)
            try {
              await auth.aceitarConvite({ convite, senha })
              await recarregar()
              navegar(comDemo("/"))
            } catch (e) {
              setErro(traduzir(e))
            } finally {
              setEnviando(false)
            }
          }}
        >
          <FieldGroup>
            <CamposSenha senha={senha} setSenha={setSenha} repetir={repetir} setRepetir={setRepetir} />
            {erro ? <FieldError>{erro}</FieldError> : null}
            <Field>
              <Button type="submit" size="lg" disabled={enviando}>
                {enviando ? <Spinner /> : null}
                {t("auth.convite.botao")}
              </Button>
              <FieldDescription className="text-center">{t("auth.convite.depois")}</FieldDescription>
            </Field>
          </FieldGroup>
        </form>
      )}
    </Moldura>
  )
}

/** Passo a passo do TOTP (usado aqui, obrigatório para admin, e em Minha conta). */
export function AtivarTotp({ aoConcluir }: { aoConcluir: () => void }) {
  const { t } = useT()
  const { auth } = useSessao()
  const traduzir = useErroTraduzido()
  const [inicio, setInicio] = React.useState<InicioTotp | null>(null)
  const [codigo, setCodigo] = React.useState("")
  const [erro, setErro] = React.useState<string | null>(null)
  const [enviando, setEnviando] = React.useState(false)

  React.useEffect(() => {
    let vivo = true
    auth
      .totpIniciar()
      .then((i) => vivo && setInicio(i))
      .catch((e) => vivo && setErro(traduzir(e)))
    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth])

  const confirmar = async (c: string) => {
    if (!inicio) return
    setErro(null)
    setEnviando(true)
    try {
      await auth.totpConfirmar(inicio.fatorId, c)
      aoConcluir()
    } catch (e) {
      setErro(traduzir(e))
      setCodigo("")
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void confirmar(codigo)
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel>1. {t("auth.ativar.passo1")}</FieldLabel>
          <div className="flex justify-center py-1">
            {inicio ? (
              <CodigoQR texto={inicio.uri} rotulo={t("auth.ativar.qr")} />
            ) : (
              <div className="flex size-44 items-center justify-center rounded-lg bg-muted">
                <Spinner />
              </div>
            )}
          </div>
        </Field>
        <Field>
          <FieldLabel>2. {t("auth.ativar.passo2")}</FieldLabel>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/50 px-2 py-1.5 font-mono text-xs">
              {inicio?.segredo ?? "…"}
            </code>
            {inicio ? <BotaoCopiar texto={inicio.segredo} /> : null}
          </div>
        </Field>
        <Field>
          <FieldLabel>3. {t("auth.ativar.passo3")}</FieldLabel>
          <CampoCodigo valor={codigo} aoMudar={setCodigo} aoCompletar={(v) => void confirmar(v)} invalido={!!erro} />
          {erro ? <FieldError className="text-center">{erro}</FieldError> : null}
        </Field>
        <Button type="submit" size="lg" disabled={!inicio || codigo.length !== 6 || enviando}>
          {enviando ? <Spinner /> : null}
          {t("auth.ativar.botao")}
        </Button>
      </FieldGroup>
    </form>
  )
}

function AtivarObrigatorio({ pular }: { pular?: () => void }) {
  const { t } = useT()
  const { recarregar } = useSessao()
  return (
    <Moldura
      titulo={t("auth.ativar.titulo")}
      descricao={t(pular ? "auth.ativar.descricaoOpcional" : "auth.ativar.descricao")}
    >
      <AtivarTotp
        aoConcluir={async () => {
          await recarregar()
          // relê o painel inteiro: a sessão agora é aal2 e o fator aparece em "eu"
          window.location.assign(comDemo("/"))
        }}
      />
      {pular ? (
        <Button variant="ghost" className="mt-2 w-full" onClick={pular}>
          {t("auth.ativar.pular")}
        </Button>
      ) : null}
    </Moldura>
  )
}

export default function TelasAuth({ obrigarTotp = false, pular }: { obrigarTotp?: boolean; pular?: () => void }) {
  const { estado } = useSessao()
  const { caminho } = useRota()
  const demo = emDemo()

  React.useEffect(() => {
    // Quem já entrou e abriu /entrar volta para o painel.
    if (!demo && estado?.logado && !estado.falta2fa && !estado.recuperacao && caminho === "/entrar") navegar("/")
  }, [demo, estado, caminho])

  if (obrigarTotp || caminho === "/ativar-duas-etapas") return <AtivarObrigatorio pular={pular} />
  if (estado?.recuperacao || caminho === "/nova-senha") return <NovaSenha />
  if (estado?.falta2fa || caminho === "/duas-etapas") return <DuasEtapas />
  if (caminho === "/esqueci") return <Esqueci />
  if (caminho === "/aceitar" || caminho === "/convite") return <Convite />
  return <Entrar />
}
