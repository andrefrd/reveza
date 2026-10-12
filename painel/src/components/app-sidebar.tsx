// Menu lateral. Adaptado do bloco oficial "sidebar-07" do shadcn/ui (barra que recolhe para ícones; no celular vira
// gaveta): a troca de time virou a marca da instalação, o menu virou os 4 grupos das 12 seções, e o usuário ganhou
// tema, idioma e sair.

import * as React from "react"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { Logo } from "@/components/painel/logo"
import { TextoGradiente } from "@/components/rb"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { useEstado } from "@/dados/contexto"
import { useT } from "@/i18n"
import { comDemo, emDemo } from "@/lib/demo"
import { Link } from "@/lib/rota"

function nomeDaInstalacao(): string {
  try {
    const url = new URL(import.meta.env.VITE_SUPABASE_URL ?? "")
    return url.hostname.split(".")[0]
  } catch {
    return ""
  }
}

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const { t } = useT()
  const { eu } = useEstado()
  const demo = emDemo()
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip={t("app.nome")}>
              <Link href={comDemo("/")}>
                <div className="flex aspect-square size-8 shrink-0 items-center justify-center">
                  <Logo className="!size-8 rounded-lg" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <TextoGradiente className="!justify-start truncate font-semibold">{t("app.nome")}</TextoGradiente>
                  <span className="truncate text-xs text-muted-foreground">
                    {demo ? t("app.demo") : nomeDaInstalacao() || t("app.descricao")}
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain />
      </SidebarContent>
      <SidebarFooter>
        <NavUser eu={eu} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
