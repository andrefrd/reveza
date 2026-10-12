// As 12 seções do painel (docs/ARQUITETURA.md, seção 9), na ordem do menu.

import {
  ActivityIcon,
  BellIcon,
  CalendarRangeIcon,
  ChartColumnIcon,
  LaptopIcon,
  LayoutDashboardIcon,
  PlugIcon,
  RouteIcon,
  ShuffleIcon,
  UserCogIcon,
  UsersIcon,
  WalletCardsIcon,
  type LucideIcon,
} from "lucide-react"

export type IdSecao =
  | "visao"
  | "contas"
  | "computadores"
  | "uso"
  | "plano"
  | "troca"
  | "alertas"
  | "integracoes"
  | "time"
  | "minhaConta"
  | "comoFunciona"
  | "saude"

export type Grupo = "operacao" | "consumo" | "configuracao" | "ajuda"

export interface Secao {
  id: IdSecao
  caminho: string
  icone: LucideIcon
  grupo: Grupo
}

export const SECOES: Secao[] = [
  { id: "visao", caminho: "/", icone: LayoutDashboardIcon, grupo: "operacao" },
  { id: "contas", caminho: "/contas", icone: WalletCardsIcon, grupo: "operacao" },
  { id: "computadores", caminho: "/computadores", icone: LaptopIcon, grupo: "operacao" },
  { id: "troca", caminho: "/troca", icone: ShuffleIcon, grupo: "operacao" },
  { id: "uso", caminho: "/uso", icone: ChartColumnIcon, grupo: "consumo" },
  { id: "plano", caminho: "/plano", icone: CalendarRangeIcon, grupo: "consumo" },
  { id: "alertas", caminho: "/alertas", icone: BellIcon, grupo: "configuracao" },
  { id: "integracoes", caminho: "/integracoes", icone: PlugIcon, grupo: "configuracao" },
  { id: "time", caminho: "/time", icone: UsersIcon, grupo: "configuracao" },
  { id: "minhaConta", caminho: "/conta", icone: UserCogIcon, grupo: "configuracao" },
  { id: "comoFunciona", caminho: "/como-funciona", icone: RouteIcon, grupo: "ajuda" },
  { id: "saude", caminho: "/saude", icone: ActivityIcon, grupo: "ajuda" },
]

export const GRUPOS: Grupo[] = ["operacao", "consumo", "configuracao", "ajuda"]

export function secaoDoCaminho(caminho: string): Secao | undefined {
  const limpo = caminho.replace(/\/+$/, "") || "/"
  return SECOES.find((s) => s.caminho === limpo)
}

/** Telas fora do menu: entrada, convite, senha e verificação em duas etapas. */
export const ROTAS_AUTH = [
  "/entrar",
  "/esqueci",
  "/nova-senha",
  "/aceitar",
  "/convite",
  "/duas-etapas",
  "/ativar-duas-etapas",
] as const
