// Itens do menu, por grupo. Adaptado do "nav-main" do bloco sidebar-07 do shadcn/ui (sem submenus: cada seção é uma
// página; recolhido, cada ícone mostra o nome numa dica).

import { GRUPOS, SECOES } from "@/secoes/rotas"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useT } from "@/i18n"
import { comDemo } from "@/lib/demo"
import { Link, useRota } from "@/lib/rota"

export function NavMain() {
  const { t } = useT()
  const { caminho } = useRota()
  const { isMobile, setOpenMobile } = useSidebar()
  const atual = caminho.replace(/\/+$/, "") || "/"
  return (
    <>
      {GRUPOS.map((grupo) => (
        <SidebarGroup key={grupo}>
          <SidebarGroupLabel>{t(`menu.grupos.${grupo}`)}</SidebarGroupLabel>
          <SidebarMenu>
            {SECOES.filter((s) => s.grupo === grupo).map((s) => {
              const nome = t(`menu.secoes.${s.id}`)
              const Icone = s.icone
              return (
                <SidebarMenuItem key={s.id}>
                  <SidebarMenuButton asChild tooltip={nome} isActive={atual === s.caminho}>
                    <Link
                      href={comDemo(s.caminho)}
                      aria-current={atual === s.caminho ? "page" : undefined}
                      onClick={() => isMobile && setOpenMobile(false)}
                    >
                      <Icone />
                      <span>{nome}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </>
  )
}
