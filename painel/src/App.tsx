import * as React from "react"
import { CloudOffIcon, FlaskConicalIcon, LogOutIcon, RefreshCwIcon, UserXIcon } from "lucide-react"

import { AuthDemo, type Autenticacao } from "@/auth/auth"
import { SessaoProvider, useSessao } from "@/auth/sessao"
import { AppSidebar } from "@/components/app-sidebar"
import { Logo } from "@/components/painel/logo"
import { SiteHeader } from "@/components/site-header"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { DadosProvider, useDados } from "@/dados/contexto"
import { FonteDemo } from "@/dados/demo"
import { ErroPainel, type Fonte } from "@/dados/fonte"
import { idiomaGuardado, useT } from "@/i18n"
import { comDemo, emDemo, temNuvem } from "@/lib/demo"
import { useRota } from "@/lib/rota"
import { ROTAS_AUTH, secaoDoCaminho, type IdSecao } from "@/secoes/rotas"

const SECOES: Record<IdSecao, React.LazyExoticComponent<React.ComponentType>> = {
  visao: React.lazy(() => import("@/secoes/visao-geral")),
  contas: React.lazy(() => import("@/secoes/contas")),
  computadores: React.lazy(() => import("@/secoes/computadores")),
  uso: React.lazy(() => import("@/secoes/uso")),
  plano: React.lazy(() => import("@/secoes/plano")),
  troca: React.lazy(() => import("@/secoes/troca")),
  alertas: React.lazy(() => import("@/secoes/alertas")),
  integracoes: React.lazy(() => import("@/secoes/integracoes")),
  time: React.lazy(() => import("@/secoes/time")),
  minhaConta: React.lazy(() => import("@/secoes/minha-conta")),
  comoFunciona: React.lazy(() => import("@/secoes/como-funciona")),
  saude: React.lazy(() => import("@/secoes/saude")),
}

const TelasAuth = React.lazy(() => import("@/auth/telas"))

export default function App() {
  const demo = emDemo()
  const [nucleo, setNucleo] = React.useState<{ auth: Autenticacao; fonte: Fonte } | null>(() =>
    demo ? { auth: new AuthDemo(), fonte: new FonteDemo({ idioma: idiomaGuardado() }) } : null
  )

  React.useEffect(() => {
    if (demo || !temNuvem()) return
    // O cliente do Supabase só carrega quando há nuvem (a demonstração não baixa nada dele).
    void Promise.all([import("@/auth/auth-supabase"), import("@/dados/supabase")]).then(([a, f]) =>
      setNucleo({ auth: new a.AuthSupabase(), fonte: new f.FonteSupabase() })
    )
  }, [demo])

  return <ComNucleo nucleo={nucleo} demo={demo} />
}

function ComNucleo({ nucleo, demo }: { nucleo: { auth: Autenticacao; fonte: Fonte } | null; demo: boolean }) {
  if (!demo && !temNuvem()) return <SemNuvem />
  if (!nucleo) return <Carregando />
  return (
    <SessaoProvider auth={nucleo.auth}>
      <Portao fonte={nucleo.fonte} />
    </SessaoProvider>
  )
}

/** Decide entre as telas de entrada e o painel, pelo estado da sessão e pelo endereço. */
function Portao({ fonte }: { fonte: Fonte }) {
  const { estado } = useSessao()
  const { caminho } = useRota()
  const demo = emDemo()
  const rotaAuth = (ROTAS_AUTH as readonly string[]).includes(caminho)

  if (!estado) return <Carregando />
  // Na demonstração as telas de entrada abrem pelo endereço, para ver como são.
  if (demo && rotaAuth)
    return (
      <React.Suspense fallback={<Carregando />}>
        <TelasAuth />
      </React.Suspense>
    )
  if (!estado.logado || estado.recuperacao || estado.falta2fa || (rotaAuth && caminho !== "/ativar-duas-etapas"))
    return (
      <React.Suspense fallback={<Carregando />}>
        <TelasAuth />
      </React.Suspense>
    )
  return (
    <DadosProvider fonte={fonte}>
      <Painel />
    </DadosProvider>
  )
}

function Painel() {
  const { t } = useT()
  const { estado, erro, recarregar } = useDados()
  const { caminho } = useRota()
  const { sair } = useSessao()

  if (!estado) {
    if (erro instanceof ErroPainel && erro.codigo === "nao_membro")
      return (
        <TelaCheia>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UserXIcon />
              </EmptyMedia>
              <EmptyTitle>{t("app.naoMembroTitulo")}</EmptyTitle>
              <EmptyDescription>{t("app.naoMembroTexto")}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" onClick={() => void sair()}>
                <LogOutIcon />
                {t("app.sair")}
              </Button>
            </EmptyContent>
          </Empty>
        </TelaCheia>
      )
    if (erro)
      return (
        <TelaCheia>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CloudOffIcon />
              </EmptyMedia>
              <EmptyTitle>{t("app.erroCarregar")}</EmptyTitle>
              <EmptyDescription>{erro.message}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => void recarregar()}>
                <RefreshCwIcon />
                {t("app.tentarDeNovo")}
              </Button>
            </EmptyContent>
          </Empty>
        </TelaCheia>
      )
    return <Carregando />
  }

  // Admin sem verificação em duas etapas: obrigatória quando a instalação exige; senão, oferecida uma vez, com "pular".
  if (
    estado.eu.papel === "admin" &&
    !estado.eu.totp &&
    (estado.config.exigirDuasEtapas || !pulouDuasEtapas(estado.eu.userId))
  )
    return (
      <React.Suspense fallback={<Carregando />}>
        <TelasAuth
          obrigarTotp
          pular={estado.config.exigirDuasEtapas ? undefined : () => pularDuasEtapas(estado.eu.userId)}
        />
      </React.Suspense>
    )

  const secao = secaoDoCaminho(caminho) ?? secaoDoCaminho("/")!
  const Secao = SECOES[secao.id]
  return (
    <SidebarProvider>
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
      >
        {t("app.pularConteudo")}
      </a>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <SiteHeader titulo={t(`menu.secoes.${secao.id}`)} />
        <main id="conteudo" className="min-w-0 flex-1">
          <ProtecaoSecao key={secao.id}>
            <React.Suspense fallback={<EsqueletoSecao />}>
              <Secao />
            </React.Suspense>
          </ProtecaoSecao>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

/** Uma tela que quebra (por um dado inesperado vindo de um computador, por exemplo) não derruba o painel inteiro. */
class ProtecaoSecao extends React.Component<{ children: React.ReactNode }, { quebrou: boolean }> {
  state = { quebrou: false }
  static getDerivedStateFromError() {
    return { quebrou: true }
  }
  componentDidCatch(erro: unknown) {
    console.error("tela do painel", erro)
  }
  render() {
    return this.state.quebrou ? (
      <SecaoQuebrou aoTentar={() => this.setState({ quebrou: false })} />
    ) : (
      this.props.children
    )
  }
}

function SecaoQuebrou({ aoTentar }: { aoTentar: () => void }) {
  const { t } = useT()
  return (
    <Empty className="m-4 border md:m-6">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CloudOffIcon />
        </EmptyMedia>
        <EmptyTitle>{t("app.secaoQuebrou")}</EmptyTitle>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onClick={aoTentar}>
          <RefreshCwIcon data-icon="inline-start" />
          {t("app.tentarDeNovo")}
        </Button>
      </EmptyContent>
    </Empty>
  )
}

function TelaCheia({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-svh items-center justify-center p-6">{children}</div>
}

function Carregando() {
  const { t } = useT()
  return (
    <TelaCheia>
      <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground" role="status">
        <Logo className="size-10 animate-pulse rounded-xl motion-reduce:animate-none" />
        {t("app.carregando")}
      </div>
    </TelaCheia>
  )
}

function EsqueletoSecao() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 lg:px-6" aria-hidden>
      <Skeleton className="h-8 w-56" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  )
}

function SemNuvem() {
  const { t } = useT()
  return (
    <TelaCheia>
      <Empty className="max-w-lg">
        <EmptyHeader>
          <EmptyMedia>
            <Logo className="size-12 rounded-xl" />
          </EmptyMedia>
          <EmptyTitle>{t("app.semNuvemTitulo")}</EmptyTitle>
          <EmptyDescription>{t("app.semNuvemTexto")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild>
            <a href="/?demo=1">
              <FlaskConicalIcon />
              {t("app.verDemo")}
            </a>
          </Button>
        </EmptyContent>
      </Empty>
    </TelaCheia>
  )
}

// "Pular por agora" na oferta das duas etapas: lembrado neste navegador (dá para ligar depois em Minha conta).
function pulouDuasEtapas(userId: string): boolean {
  try {
    return localStorage.getItem(`reveza-pulou-duas-etapas-${userId}`) === "1"
  } catch {
    return false
  }
}

function pularDuasEtapas(userId: string) {
  try {
    localStorage.setItem(`reveza-pulou-duas-etapas-${userId}`, "1")
  } catch {
    /* sem armazenamento: a oferta volta no próximo carregamento */
  }
  window.location.assign(comDemo("/"))
}
