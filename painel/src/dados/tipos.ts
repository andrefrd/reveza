// Tipos que o painel usa. Espelham as tabelas e funções de nuvem/contrato.sql, já em camelCase.

export type Idioma = "pt-BR" | "en"
export type Papel = "admin" | "leitura"
export type Modo = "limite" | "limiar" | "rodizio"
export type OrdemRodizio = "aleatoria" | "menor_uso"
/** "pendente": o código de acesso foi criado e o computador ainda não fez o primeiro contato (dá para revogar). */
export type Sistema = "macos" | "linux" | "windows" | "pendente"
export type TipoJanela = "five_hour" | "seven_day" | "seven_day_opus" | "seven_day_sonnet"

export interface Janela {
  tipo: TipoJanela
  pct: number | null
  resetEm: string | null
}

/** Faixa de horário em que a conta pode ser usada. dias: 1 = segunda ... 7 = domingo. */
export interface FaixaAgenda {
  dias: number[]
  de: string
  ate: string
}

export interface Posse {
  computadorId: string
  motivo: "uso" | "leitura" | "renovacao" | "login"
  expiraEm: string
}

export interface Conta {
  id: string
  email: string
  organizacao: string | null
  plano: string | null
  nivel: string | null
  /**
   * No banco, a cor gravada da conta. Nas telas, a cor do workspace dela: o painel troca ao carregar
   * (lib/cores, pintarPorWorkspace), junto com os campos abaixo.
   */
  cor: number
  /** Tom da conta dentro do workspace, para os gráficos (0 = cor cheia, a conta mais antiga). */
  tom?: number
  /** Chave do workspace (organização, domínio ou a própria conta). */
  workspace?: string
  /** Nome do workspace para a tela; null quando a conta está sozinha (e-mail de provedor público, sem organização). */
  nomeWorkspace?: string | null
  contasNoWorkspace?: number
  prioridade: number
  reserva: boolean
  pausada: boolean
  agenda: FaixaAgenda[]
  tetoSemana: number | null
  precisaLogin: boolean
  criadaEm: string
  janelas: Janela[]
  lidoEm: string | null
  fonte: "sessao" | "api" | null
  loginExpiraEm: string | null
  posse: Posse | null
}

export interface ItemDiagnostico {
  id: string
  ok: boolean | null
  detalhe?: string
}

export interface Diagnostico {
  em: string
  versao: string
  atrasoBuscaMs: number | null
  itens: ItemDiagnostico[]
}

export interface Atribuicao {
  contaId: string | null
  motivo: string
  decididoEm: string
}

export interface Computador {
  id: string
  nome: string
  sistema: Sistema
  versao: string
  vistoEm: string | null
  revogado: boolean
  criadoEm: string
  diagnostico: Diagnostico | null
  atribuicao: Atribuicao | null
}

export interface ConfigTroca {
  auto: boolean
  modo: Modo
  aviso: number
  troca: number
  rodizioMinutos: number
  rodizioOrdem: OrdemRodizio
  intervaloS: number
  retomarTerminal: boolean
  esperaEntreTrocasS: number
  /** Fuso em que a agenda das contas vale (IANA, ex.: America/Sao_Paulo). */
  fuso: string
  /** Toda pessoa administradora precisa da verificação em duas etapas (desligado: cada uma escolhe). */
  exigirDuasEtapas: boolean
  /** Só leitura: quando o banco marcou o próximo rodízio. */
  proximoRodizioEm: string | null
}

export type TipoEvento = "troca" | "aviso" | "limite" | "retomada" | "conexao" | "erro" | "info" | "alerta"

export interface Evento {
  id: number
  em: string
  tipo: TipoEvento
  texto: string
  dados: {
    de?: string | null
    para?: string | null
    conta?: string | null
    computador?: string | null
    motivo?: string | null
    pct?: number | null
    [k: string]: unknown
  }
}

export interface LinhaUso {
  hora: string
  contaId: string | null
  computadorId: string
  projeto: string
  modelo: string
  respostas: number
  entrada: number
  saida: number
  cacheEscrita: number
  cacheLeitura: number
  usd: number
}

export interface SessaoUso {
  id: string
  computadorId: string
  projeto: string
  inicio: string
  fim: string | null
  respostas: number
  tokens: number
  usd: number
  agentes: number
  contas: string[]
  modelos: string[]
  paradaNoLimite: boolean
}

export interface PontoHistorico {
  contaId: string
  em: string
  p5: number | null
  p7: number | null
}

export type CanalAlerta = "telegram" | "email" | "webhook" | "push"
export type EventoAlerta =
  "sem_livre" | "precisa_login" | "computador_parado" | "login_vence" | "resumo_dia" | "troca" | "limite"

export interface Alerta {
  id: string
  canal: CanalAlerta
  /** Rótulo para a tela, montado só com os campos que não são segredo. */
  destino: string
  /**
   * O destino como está no banco (só administrador lê). Fica na memória para regravar o alerta ao ligar/desligar;
   * a tela nunca mostra os campos de segredo dele.
   */
  destinoBruto: Record<string, unknown>
  eventos: EventoAlerta[]
  ativo: boolean
}

/**
 * O que a pessoa digita ao criar um alerta. `destino` vai para a tabela (sem segredo); `segredo` (token do bot, chave
 * do serviço de e-mail, assinatura do webhook) vai só para o Vault do Supabase (painel_alerta_segredo).
 */
export interface NovoAlerta {
  canal: CanalAlerta
  eventos: EventoAlerta[]
  destino: Record<string, string>
  segredo: string | null
}

export type EscopoChave = "ler" | "trocar" | "config"

export interface ChaveApi {
  id: string
  nome: string
  prefixo: string
  escopos: EscopoChave[]
  criadaEm: string
  usadaEm: string | null
  revogada: boolean
}

export interface WebhookSaida {
  id: string
  url: string
  eventos: string[]
  ativo: boolean
}

export interface Membro {
  userId: string
  /** O banco não expõe o e-mail dos outros membros; vem preenchido só na demonstração e para você. */
  email: string | null
  nome: string | null
  papel: Papel
  criadoEm: string
}

export interface Convite {
  id: string
  email: string
  papel: Papel
  expiraEm: string
  usadoEm: string | null
}

export interface RegistroAuditoria {
  id: number
  em: string
  quem: string
  acao: string
  alvo: string | null
}

export interface Eu {
  userId: string
  email: string
  nome: string | null
  papel: Papel
  idioma: Idioma
  aal: "aal1" | "aal2"
  totp: { fatorId: string; criadoEm: string } | null
}

export interface SessaoAberta {
  id: string
  criadaEm: string
  ultimaVez: string
  aparelho: string
  atual: boolean
}

export type AcaoComando =
  "conectar" | "entrar_de_novo" | "cancelar_login" | "codigo_login" | "atualizar" | "diagnostico" | "retomar_sessao" | "ligar"

export type EstadoComando = "pendente" | "reservado" | "feito" | "recusado" | "expirado"

export interface Comando {
  id: number
  computadorId: string
  acao: AcaoComando
  estado: EstadoComando
  criadoEm: string
  resposta: Record<string, unknown> | null
}

export interface Ligacao {
  palavras: string[]
  expiraEm: string
}

/** Tudo o que as telas leem de uma vez (o resto vem sob demanda: uso, sessões, histórico, auditoria). */
export interface Instantaneo {
  agora: string
  eu: Eu
  contas: Conta[]
  computadores: Computador[]
  config: ConfigTroca
  eventos: Evento[]
  alertas: Alerta[]
  chaves: ChaveApi[]
  webhooks: WebhookSaida[]
  membros: Membro[]
  convites: Convite[]
  comandos: Comando[]
}

export interface Intervalo {
  de: Date
  ate: Date
}
