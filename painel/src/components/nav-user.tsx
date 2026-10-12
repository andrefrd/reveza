// Quem está logado, no pé do menu. Adaptado do "nav-user" do bloco sidebar-07 do shadcn/ui: avatar com iniciais (sem
// foto de fora), papel, e o menu com Minha conta, tema, idioma e sair.

import { ChevronsUpDownIcon, LanguagesIcon, LogOutIcon, MoonIcon, SunMoonIcon, UserCogIcon } from "lucide-react"

import { useSessao } from "@/auth/sessao"
import { useTheme, type Tema } from "@/components/theme-provider"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar"
import { useDados } from "@/dados/contexto"
import type { Eu, Idioma } from "@/dados/tipos"
import { useT } from "@/i18n"
import { comDemo } from "@/lib/demo"
import { iniciais } from "@/lib/formato"
import { navegar } from "@/lib/rota"

export function NavUser({ eu }: { eu: Eu }) {
  const { t, idioma, setIdioma } = useT()
  const { theme, setTheme } = useTheme()
  const { isMobile, setOpenMobile } = useSidebar()
  const { fonte } = useDados()
  const { sair } = useSessao()
  const nome = eu.nome || eu.email
  const mudarIdioma = (i: string) => {
    setIdioma(i as Idioma)
    void fonte.meuIdioma(i as Idioma).catch(() => undefined)
  }
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarFallback className="rounded-lg">{iniciais(nome)}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{nome}</span>
                <span className="truncate text-xs text-muted-foreground">{t(`usuario.papel.${eu.papel}`)}</span>
              </div>
              <ChevronsUpDownIcon className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarFallback className="rounded-lg">{iniciais(nome)}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{nome}</span>
                  <span className="truncate text-xs text-muted-foreground">{eu.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                onSelect={() => {
                  if (isMobile) setOpenMobile(false)
                  navegar(comDemo("/conta"))
                }}
              >
                <UserCogIcon />
                {t("usuario.minhaConta")}
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  {theme === "dark" ? <MoonIcon /> : <SunMoonIcon />}
                  {t("usuario.tema")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Tema)}>
                    <DropdownMenuRadioItem value="light">{t("usuario.claro")}</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="dark">{t("usuario.escuro")}</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="system">{t("usuario.sistema")}</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <LanguagesIcon />
                  {t("usuario.idioma")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup value={idioma} onValueChange={mudarIdioma}>
                    <DropdownMenuRadioItem value="pt-BR">Português</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="en">English</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void sair()}>
              <LogOutIcon />
              {t("usuario.sair")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
