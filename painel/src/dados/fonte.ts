// A camada de dados do painel. Duas implementações: FonteDemo (dados falsos gerados no navegador) e FonteSupabase
// (o banco da instalação: nuvem/migracoes, leitura direta com RLS e escrita só pelas funções painel_*).
// As telas só conhecem esta interface.

import type {
  AcaoComando,
  Alerta,
  Comando,
  Conta,
  ConfigTroca,
  EscopoChave,
  EventoAlerta,
  Idioma,
  Instantaneo,
  Intervalo,
  EstadoLigacao,
  LinhaUso,
  NovoAlerta,
  Papel,
  PontoHistorico,
  RegistroAuditoria,
  SessaoAberta,
  SessaoUso,
  WebhookSaida,
} from "./tipos"

export type CamposConta = Partial<Pick<Conta, "cor" | "prioridade" | "reserva" | "pausada" | "agenda" | "tetoSemana">>

/** O que cada fonte sabe fazer. A tela esconde ou desliga o que a nuvem ainda não oferece. */
export interface Recursos {
  testarAlerta: boolean
  testarWebhook: boolean
  cancelarConvite: boolean
  /** Lista das sessões abertas de quem está logado. "Sair de todas" funciona sempre. */
  listarSessoes: boolean
  /** Inscrição de push do celular (precisa da chave pública de push da instalação). */
  push: boolean
}

export interface Fonte {
  readonly demo: boolean
  readonly recursos: Recursos

  // leitura
  carregar(): Promise<Instantaneo>
  uso(intervalo: Intervalo): Promise<LinhaUso[]>
  sessoes(intervalo: Intervalo): Promise<SessaoUso[]>
  historico(desde: Date): Promise<PontoHistorico[]>
  auditoria(limite: number): Promise<RegistroAuditoria[]>
  minhasSessoes(): Promise<SessaoAberta[]>
  /** Avisa quando algo mudou na nuvem (ou no relógio da demonstração). Devolve a função que cancela. */
  assinar(aoMudar: () => void): () => void

  // escrita (no banco: admin + aal2; cada função grava a auditoria)
  salvarConfig(campos: Partial<ConfigTroca>): Promise<void>
  salvarConta(id: string, campos: CamposConta): Promise<void>
  /** Grava a ordem de preferência: a primeira da lista é a preferida. */
  ordenarContas(ids: string[]): Promise<void>
  trocarAgora(computadorId: string, contaId: string): Promise<void>
  comando(computadorId: string, acao: AcaoComando, corpo?: Record<string, unknown>): Promise<Comando>
  lerComando(id: number): Promise<Comando | null>
  /**
   * Cria a identidade pendente de um computador novo (administrador com duas etapas) e devolve o código de acesso que
   * o instalador pede (--ligar, rvzc_). O código só deixa o computador novo pedir para entrar: não abre o cofre.
   * `computadorId` é a linha pendente (revogável) que ele criou.
   */
  criarAcessoComputador(): Promise<{ codigo: string; computadorId: string | null }>
  /** O computador (que já tem a chave do cofre) onde a janela de liberar abre, na língua do painel. De novo: abre de novo. */
  escolherAprovador(computadorNovoId: string, aprovadorId: string): Promise<void>
  /** O andamento da ligação de um computador novo (o painel pergunta de tempos em tempos). */
  estadoLigacao(computadorNovoId: string): Promise<EstadoLigacao>
  revogarComputador(id: string): Promise<void>

  criarAlerta(alerta: NovoAlerta): Promise<void>
  mudarAlerta(alerta: Alerta, campos: { ativo?: boolean; eventos?: EventoAlerta[] }): Promise<void>
  removerAlerta(id: string): Promise<void>
  testarAlerta(id: string): Promise<void>

  criarChave(nome: string, escopos: EscopoChave[]): Promise<{ chave: string }>
  revogarChave(id: string): Promise<void>
  /** Cria o webhook e devolve o segredo da assinatura, que aparece uma vez só. */
  criarWebhook(url: string, eventos: string[]): Promise<{ segredo: string | null }>
  mudarWebhook(webhook: WebhookSaida, campos: { ativo?: boolean; eventos?: string[] }): Promise<void>
  testarWebhook(id: string): Promise<void>

  convidar(email: string, papel: Papel): Promise<{ link: string | null }>
  cancelarConvite(id: string): Promise<void>
  mudarPapel(userId: string, papel: Papel): Promise<void>
  revogarMembro(userId: string): Promise<void>

  meuIdioma(idioma: Idioma): Promise<void>
  chavePushPublica(): Promise<string | null>
  inscreverPush(inscricao: PushSubscriptionJSON): Promise<void>
  /** A nuvem tem a inscrição deste aparelho (o endereço dela) em nome de quem está logado? */
  pushRegistrado(endpoint: string): Promise<boolean>
}

/** Erro com código conhecido, para a tela traduzir a mensagem. */
export class ErroPainel extends Error {
  readonly codigo: string
  constructor(codigo: string, mensagem?: string) {
    super(mensagem ?? codigo)
    this.codigo = codigo
    this.name = "ErroPainel"
  }
}
