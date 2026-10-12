// Cliente das funções `agente_*`: traduz cada chamada para o nome e os parâmetros `p_*` exatos do banco
// (nuvem/migracoes/0002_agente.sql). O transporte (`Rpc`) é o supabase-js na vida real e um falso nos testes.

import type { Sistema } from "../config.js";
import { deB64, paraB64 } from "./bytea.js";
import {
  ErroNuvem,
  type Atribuicao,
  type ComandoNuvem,
  type CofreNuvem,
  type JanelaNuvem,
  type LinhaTokens,
  type MotivoPosse,
  type Nuvem,
  type PontoNuvem,
  type RespostaOla,
  type SessaoNuvem,
} from "./tipos.js";

export interface Rpc {
  chamar(funcao: string, args: Record<string, unknown>): Promise<unknown>;
  horaDoServidor(): Promise<number | null>;
}

function obj(v: unknown, funcao: string): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  throw new ErroNuvem(`${funcao}: resposta fora do formato`, false, "formato");
}

const texto = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const numero = (v: unknown): number | null => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));

function cofreDe(v: unknown): CofreNuvem | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  if (c.cifrado == null || c.nonce == null) return null;
  return { cifrado: deB64(c.cifrado), nonce: deB64(c.nonce), versao: Number(c.versao ?? 0), expira_em: texto(c.expira_em) };
}

function atribuicaoDe(v: unknown): Atribuicao | null {
  if (!v || typeof v !== "object") return null;
  const a = v as Record<string, unknown>;
  return { conta_id: texto(a.conta_id), email: texto(a.email), motivo: String(a.motivo ?? ""), versao: Number(a.versao ?? 0) };
}

function comandoDe(v: unknown): ComandoNuvem | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  const id = Number(c.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return {
    id,
    acao: String(c.acao ?? ""),
    corpo: c.corpo && typeof c.corpo === "object" && !Array.isArray(c.corpo) ? (c.corpo as Record<string, unknown>) : {},
    criado_em: texto(c.criado_em) ?? undefined,
  };
}

export class NuvemRpc implements Nuvem {
  constructor(private rpc: Rpc) {}

  private async chamar(funcao: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    return obj(await this.rpc.chamar(funcao, args), funcao);
  }

  async registrar(nome: string, sistema: Sistema, versao: string) {
    const r = await this.chamar("agente_registrar", { p_nome: nome, p_sistema: sistema, p_versao: versao });
    return { computador_id: String(r.computador_id) };
  }

  async ola(versao: string, diagnostico: Record<string, unknown> | null, contaLocal: string | null): Promise<RespostaOla> {
    const r = await this.chamar("agente_ola", { p_versao: versao, p_diagnostico: diagnostico, p_conta_local: contaLocal });
    return {
      computador_id: texto(r.computador_id),
      atribuicao: atribuicaoDe(r.atribuicao),
      config: r.config && typeof r.config === "object" ? (r.config as Record<string, unknown>) : {},
      comandos: (Array.isArray(r.comandos) ? r.comandos : []).map(comandoDe).filter((c): c is ComandoNuvem => !!c),
      ligacao_pendente: r.ligacao_pendente === true,
    };
  }

  async pegarPosse(contaId: string, motivo: MotivoPosse, segundos: number) {
    const r = await this.chamar("agente_pegar_posse", { p_conta: contaId, p_motivo: motivo, p_segundos: segundos });
    return { ok: r.ok === true, erro: texto(r.erro), cofre: cofreDe(r.cofre) };
  }

  async devolverCofre(contaId: string, cifrado: Buffer, nonce: Buffer, versaoAnterior: number, expiraEm: string | null) {
    const r = await this.chamar("agente_devolver_cofre", {
      p_conta: contaId,
      p_cifrado: paraB64(cifrado),
      p_nonce: paraB64(nonce),
      p_versao_anterior: versaoAnterior,
      p_expira_em: expiraEm,
    });
    return { ok: r.ok === true, versao: numero(r.versao), erro: texto(r.erro) };
  }

  async soltarPosse(contaId: string) {
    const r = await this.chamar("agente_soltar_posse", { p_conta: contaId });
    return { ok: r.ok === true };
  }

  async registrarConta(
    email: string,
    organizacao: string | null,
    plano: string | null,
    nivel: string | null,
    cifrado: Buffer,
    nonce: Buffer,
    expiraEm: string | null,
  ) {
    const r = await this.chamar("agente_registrar_conta", {
      p_email: email,
      p_organizacao: organizacao,
      p_plano: plano,
      p_nivel: nivel,
      p_cifrado: paraB64(cifrado),
      p_nonce: paraB64(nonce),
      p_expira_em: expiraEm,
    });
    return { ok: r.ok === true, conta_id: texto(r.conta_id), versao: numero(r.versao), erro: texto(r.erro) };
  }

  async relatarUso(janelas: JanelaNuvem[], historico: PontoNuvem[]) {
    const r = await this.chamar("agente_relatar_uso", { p_janelas: janelas, p_historico: historico });
    return { ok: r.ok === true };
  }

  async relatarTokens(linhas: LinhaTokens[], sessoes: SessaoNuvem[]) {
    const r = await this.chamar("agente_relatar_tokens", { p_linhas: linhas, p_sessoes: sessoes });
    return { ok: r.ok === true };
  }

  async limite(contaId: string, sessao: string | null) {
    const r = await this.chamar("agente_limite", { p_conta: contaId, p_sessao: sessao });
    return { ok: r.ok === true, trocou: r.trocou === true, versao: numero(r.versao) };
  }

  async reservarComando(id: number) {
    const r = await this.chamar("agente_reservar_comando", { p_id: id });
    return { ok: r.ok === true, comando: comandoDe(r.comando) };
  }

  async responderComando(id: number, http: number, resposta: Record<string, unknown>) {
    const r = await this.chamar("agente_responder_comando", { p_id: id, p_http: http, p_resposta: resposta });
    return { ok: r.ok === true };
  }

  async evento(tipo: string, texto: string, dados: Record<string, unknown>) {
    const r = await this.chamar("agente_evento", { p_tipo: tipo, p_texto: texto, p_dados: dados });
    return { ok: r.ok === true };
  }

  async marcarLogin(contaId: string, precisa: boolean) {
    const r = await this.chamar("agente_marcar_login", { p_conta: contaId, p_precisa: precisa });
    return { ok: r.ok === true };
  }

  async ligacaoPublicar(embrulho: Buffer, sal: Buffer) {
    const r = await this.chamar("agente_ligacao_publicar", { p_embrulho: paraB64(embrulho), p_sal: paraB64(sal) });
    return { ok: r.ok === true, expira_em: texto(r.expira_em) };
  }

  async ligacaoBuscar() {
    const r = await this.chamar("agente_ligacao_buscar", {});
    if (r.ok !== true || r.embrulho == null || r.sal == null) return null;
    return { embrulho: deB64(r.embrulho), sal: deB64(r.sal) };
  }

  async cofreImpressao(impressao: string | null) {
    const r = await this.chamar("agente_cofre_impressao", { p_impressao: impressao });
    return typeof r.impressao === "string" ? r.impressao : null;
  }

  horaDoServidor() {
    return this.rpc.horaDoServidor();
  }

  async vezDeAtualizar(de: string, para: string) {
    const r = await this.chamar("agente_vez_de_atualizar", { p_de: de, p_para: para });
    return { pode: r.pode === true, motivo: texto(r.motivo) };
  }

  async resultadoAtualizacao(para: string, estado: "concluida" | "falhou" | "nao_comecou", motivo: string | null) {
    const r = await this.chamar("agente_atualizacao_resultado", { p_para: para, p_estado: estado, p_motivo: motivo });
    return { ok: r.ok === true };
  }
}
