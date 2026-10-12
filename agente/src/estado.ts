// O registro local do agente (~/.reveza/estado.json). Só e-mail, organização, números e caminhos: segredo nunca
// entra aqui (fica nas credenciais do sistema).

import { gravarJson, lerJson, clonar } from "./util/arquivos.js";
import type { Janela, Perfil } from "./anthropic.js";

export type Fonte = "sessao" | "api" | null;

export interface ContaLocal {
  id: string;
  /** Id da conta na nuvem (uuid), quando a nuvem existe. */
  contaId: string | null;
  email: string;
  org: string | null;
  accountUuid: string | null;
  orgUuid: string | null;
  plano: string | null;
  tier: string | null;
  /** ~/.reveza/contas/<id>: o CLAUDE_CONFIG_DIR da conta. */
  pasta: string;
  pausada: boolean;
  precisaLogin: boolean;
  conectadaEm: number;
  janelas: Janela[];
  lidoEm: number | null;
  fonte: Fonte;
  tokenExpiraEm: number | null;
  erro: string | null;
  /** Versão do cofre a que a cópia local corresponde (null: a cópia local nunca foi ao cofre). */
  versaoCofre: number | null;
}

export type TipoEvento = "troca" | "aviso" | "limite" | "retomada" | "conexao" | "erro" | "info" | "alerta";

export interface Evento {
  em: number;
  tipo: TipoEvento;
  texto: string;
  dados?: Record<string, unknown>;
}

export interface ItemFila {
  sessao: string;
  cwd: string;
  tipo: "interativa" | "headless";
  em: number;
  estado: "aguardando" | "retomada" | "descartada";
  conta: string | null;
}

export type Modo = "limiar" | "limite" | "rodizio";
export type OrdemRodizio = "aleatoria" | "menor_uso";

export interface ConfigLocal {
  auto: boolean;
  aviso: number;
  troca: number;
  modo: Modo;
  rodizio: { minutos: number; ordem: OrdemRodizio };
  retomarHeadless: boolean;
  esperaEntreTrocasS: number;
  intervaloS: number;
  /** Som do sistema quando este computador troca de conta. */
  som: boolean;
}

export interface PontoHistorico {
  t: number;
  p5: number | null;
  p7: number | null;
}

export interface EstadoLocal {
  formato: 1;
  ativa: string | null;
  proxima: string | null;
  versao: number;
  trocadaEm: number;
  contas: Record<string, ContaLocal>;
  eventos: Evento[];
  fila: ItemFila[];
  identidades: Record<string, Perfil>;
  config: ConfigLocal;
  proximoRodizioEm: number | null;
  historico: Record<string, PontoHistorico[]>;
  /** Linha do tempo de qual conta estava em uso: [desde, id]. É ela que diz de quem foi cada resposta. */
  linhaContas: [number, string][];
  nuvem: { computadorId: string | null; atribuicaoVersao: number; atribuicaoConta: string | null };
}

export const CONFIG_INICIAL: ConfigLocal = {
  auto: true,
  aviso: 90,
  troca: 95,
  modo: "limiar",
  rodizio: { minutos: 90, ordem: "aleatoria" },
  retomarHeadless: false,
  esperaEntreTrocasS: 90,
  intervaloS: 5,
  som: true,
};

export function estadoInicial(): EstadoLocal {
  return {
    formato: 1,
    ativa: null,
    proxima: null,
    versao: 0,
    trocadaEm: 0,
    contas: {},
    eventos: [],
    fila: [],
    identidades: {},
    config: clonar(CONFIG_INICIAL),
    proximoRodizioEm: null,
    historico: {},
    linhaContas: [],
    nuvem: { computadorId: null, atribuicaoVersao: 0, atribuicaoConta: null },
  };
}

export function carregarEstado(caminho: string): EstadoLocal {
  const base = estadoInicial();
  const lido = lerJson<Partial<EstadoLocal>>(caminho);
  if (!lido || typeof lido !== "object") return base;
  return {
    ...base,
    ...lido,
    config: { ...base.config, ...(lido.config ?? {}) },
    nuvem: { ...base.nuvem, ...(lido.nuvem ?? {}) },
  };
}

export function salvarEstado(caminho: string, estado: EstadoLocal): void {
  gravarJson(caminho, estado);
}

export function novaConta(id: string, perfil: Perfil, pasta: string, agora: number): ContaLocal {
  return {
    id,
    contaId: null,
    email: (perfil.email ?? "").toLowerCase(),
    org: perfil.org,
    accountUuid: perfil.accountUuid,
    orgUuid: perfil.orgUuid,
    plano: null,
    tier: perfil.tier,
    pasta,
    pausada: false,
    precisaLogin: false,
    conectadaEm: agora,
    janelas: [],
    lidoEm: null,
    fonte: null,
    tokenExpiraEm: null,
    erro: null,
    versaoCofre: null,
  };
}
