// Falsos dos testes: relógio, API das contas, programa do assistente, executor e nuvem. Nada aqui toca chaveiro,
// rede ou processo de verdade.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { ApiContas, Janela, Perfil } from "../src/anthropic.js";
import type { Cli } from "../src/claudecli.js";
import { caminhos, type Caminhos } from "../src/config.js";
import type { Blob } from "../src/credenciais/blob.js";
import { CredenciaisFalsas } from "../src/credenciais/falsa.js";
import { GuardaFalsa } from "../src/cofre/guarda.js";
import type { Executor, Processo, Resultado } from "../src/util/executor.js";
import { LogMemoria } from "../src/util/log.js";
import type { Relogio } from "../src/util/tempo.js";
import { ErroNuvem } from "../src/nuvem/tipos.js";
import type { CofreNuvem, ComandoNuvem, JanelaNuvem, LinhaTokens, MotivoPosse, Nuvem, PontoNuvem, SessaoNuvem } from "../src/nuvem/tipos.js";
import { Agente } from "../src/agente.js";
import type { Sistema } from "../src/config.js";
import { novaChave } from "../src/cofre/cifra.js";
import { SEGREDO_COFRE } from "../src/cofre/guarda.js";

export const T0 = 1_800_000_000;

/** Token falso: a primeira letra diz de quem é ("A1" é da conta A). */
export function blob(tok: string, refresh = true, expiraEmS = 3600, agora = T0): Blob {
  const o: Record<string, unknown> = {
    accessToken: tok,
    expiresAt: (agora + expiraEmS) * 1000,
    subscriptionType: "max",
    rateLimitTier: "default_max_5x",
    scopes: ["user:inference"],
  };
  if (refresh) o.refreshToken = "r-" + tok;
  return { claudeAiOauth: o, organizationUuid: "org" } as Blob;
}

export class RelogioFalso implements Relogio {
  t = T0;
  ms = 0;
  tarefas: { quando: number; fn: () => void; cancelada: boolean }[] = [];

  agora() {
    return this.t;
  }
  agoraMs() {
    return this.t * 1000 + this.ms;
  }
  agendar(fn: () => void, ms: number) {
    const tarefa = { quando: this.agoraMs() + ms, fn, cancelada: false };
    this.tarefas.push(tarefa);
    return { cancelar: () => void (tarefa.cancelada = true) };
  }
  /** Dormir no relógio falso faz o tempo passar (sem esperar de verdade). */
  async dormir(ms = 0): Promise<void> {
    const alvo = this.agoraMs() + ms;
    this.t = Math.floor(alvo / 1000);
    this.ms = alvo % 1000;
    await new Promise((r) => setImmediate(r));
  }
  /** Avança o relógio e roda o que venceu (uma rodada). */
  async avancar(ms: number): Promise<void> {
    const alvo = this.agoraMs() + ms;
    this.t = Math.floor(alvo / 1000);
    this.ms = alvo % 1000;
    const vencidas = this.tarefas.filter((x) => !x.cancelada && x.quando <= alvo);
    this.tarefas = this.tarefas.filter((x) => !vencidas.includes(x));
    for (const x of vencidas) x.fn();
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  }
}

export class ApiFalsa implements ApiContas {
  usos: Record<string, number> = {};
  statusUso: Record<string, number> = {};
  perfisPedidos = 0;
  usosPedidos: string[] = [];
  semRede = false;
  /** Tokens que a API recusa (login que não vale mais). */
  recusados = new Set<string>();

  async perfil(token: string) {
    this.perfisPedidos += 1;
    if (this.semRede) return { status: 0 };
    if (this.recusados.has(token)) return { status: 401 };
    const l = token[0]!;
    const perfil: Perfil = {
      accountUuid: `acc-${l}`,
      email: `${l.toLowerCase()}@exemplo.com`,
      orgUuid: `org-${l}`,
      org: `Org ${l}`,
      orgTipo: "x",
      tier: "default_max_5x",
    };
    return { status: 200, perfil };
  }

  async uso(token: string) {
    const l = token[0]!;
    this.usosPedidos.push(token);
    if (this.statusUso[l]) return { status: this.statusUso[l]! };
    const janelas: Janela[] = [{ tipo: "five_hour", pct: this.usos[l] ?? 10, resetEm: T0 + 3600 }];
    return { status: 200, janelas };
  }
}

export class ProcessoFalso implements Processo {
  vivo = true;
  escrito: string[] = [];
  linhas: ((l: string) => void)[] = [];
  fins: ((c: number) => void)[] = [];
  escrever(t: string) {
    this.escrito.push(t);
    return this.vivo;
  }
  aoLinha(fn: (l: string) => void) {
    this.linhas.push(fn);
  }
  aoFim(fn: (c: number) => void) {
    this.fins.push(fn);
  }
  terminar() {
    this.fim(0);
  }
  emitir(l: string) {
    for (const fn of this.linhas) fn(l);
  }
  fim(c = 0) {
    if (!this.vivo) return;
    this.vivo = false;
    for (const fn of this.fins) fn(c);
  }
}

export class CliFalsa implements Cli {
  renovacoes: string[] = [];
  aoRenovar: ((pasta: string, tentativa: number) => void) | null = null;
  logins: { pasta: string; email: string | null; proc: ProcessoFalso }[] = [];
  retomadas: { sessao: string; cwd: string }[] = [];
  binario() {
    return "/falso/assistente";
  }
  async versao() {
    return "2.1.293";
  }
  async renovar(pasta: string, tentativa: 0 | 1) {
    this.renovacoes.push(pasta);
    this.aoRenovar?.(pasta, tentativa);
  }
  login(pasta: string, email: string | null) {
    const proc = new ProcessoFalso();
    this.logins.push({ pasta, email, proc });
    return proc;
  }
  retomar(sessao: string, cwd: string) {
    this.retomadas.push({ sessao, cwd });
  }
}

export class ExecutorFalso implements Executor {
  chamadas: { argv: string[]; entrada?: string }[] = [];
  responder: (argv: string[], entrada?: string) => Resultado = () => ({ codigo: 0, saida: "", erro: "" });
  async rodar(argv: string[], op: { entrada?: string } = {}) {
    this.chamadas.push({ argv, entrada: op.entrada });
    return this.responder(argv, op.entrada);
  }
  iniciar(): Processo {
    return new ProcessoFalso();
  }
}

export function pastaTemporaria(): { dir: string; c: Caminhos; limpar: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reveza-teste-"));
  const c = caminhos(path.join(dir, "home"), { REVEZA_HOME: path.join(dir, "home", ".reveza") });
  fs.mkdirSync(c.principalDir, { recursive: true });
  fs.writeFileSync(c.claudeJson, JSON.stringify({ oauthAccount: { emailAddress: "a@exemplo.com" }, outra: 1 }));
  return { dir, c, limpar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// ------------------------------------------------------------------------------------------------ nuvem falsa

interface ContaNuvemF {
  id: string;
  email: string;
  cofre: { cifrado: Buffer; nonce: Buffer; versao: number; expira_em: string | null } | null;
  precisaLogin?: boolean;
}

/** O banco em memória, com as mesmas regras das funções agente_* (posse, atribuição, versão do cofre, comandos). */
export class BancoFalso {
  contas = new Map<string, ContaNuvemF>();
  posse = new Map<string, { pc: string; motivo: MotivoPosse; expira: number }>();
  atribuicao = new Map<string, { conta: string | null; versao: number; motivo: string }>();
  computadores = new Map<string, { nome: string }>();
  comandos: (ComandoNuvem & { pc: string; estado: string; http?: number; resposta?: unknown })[] = [];
  eventos: { tipo: string; texto: string; dados: unknown; pc: string }[] = [];
  janelas: (JanelaNuvem & { pc: string })[] = [];
  tokens = new Map<string, LinhaTokens>();
  sessoes = new Map<string, SessaoNuvem>();
  ligacoes: { embrulho: Buffer; sal: Buffer; por: string; usada: boolean; expira: number }[] = [];
  cofreImpressao: string | null = null;
  config: Record<string, unknown> = { auto: false, modo: "limiar", aviso: 90, troca: 95, intervalo_s: 5, retomar_terminal: false };
  chamadas: { pc: string; fn: string; args: unknown[] }[] = [];
  agora = () => T0;
  foraDoAr = false;

  conta(email: string): ContaNuvemF {
    let c = [...this.contas.values()].find((x) => x.email === email);
    if (!c) {
      c = { id: randomUUID(), email, cofre: null };
      this.contas.set(c.id, c);
    }
    return c;
  }

  atribuir(pc: string, conta: string | null, motivo = "teste") {
    const a = this.atribuicao.get(pc);
    this.atribuicao.set(pc, { conta, versao: (a?.versao ?? 0) + 1, motivo });
  }

  donoDaPosse(conta: string): string | null {
    const p = this.posse.get(conta);
    return p && p.expira > this.agora() ? p.pc : null;
  }
}

export class NuvemFalsa implements Nuvem {
  constructor(
    public banco: BancoFalso,
    public pc: string = randomUUID(),
  ) {}

  private registrarChamada(fn: string, ...args: unknown[]) {
    if (this.banco.foraDoAr) throw new ErroNuvem("fetch failed", true);
    this.banco.chamadas.push({ pc: this.pc, fn, args });
  }

  async registrar(nome: string) {
    this.registrarChamada("registrar", nome);
    this.banco.computadores.set(this.pc, { nome });
    return { computador_id: this.pc };
  }

  async ola(versao: string, diagnostico: Record<string, unknown> | null, contaLocal: string | null) {
    this.registrarChamada("ola", versao, diagnostico, contaLocal);
    const b = this.banco;
    for (const p of b.posse.values()) if (p.pc === this.pc && p.motivo === "uso") p.expira = b.agora() + 120;
    if (!b.atribuicao.has(this.pc) && contaLocal) {
      const c = [...b.contas.values()].find((x) => x.email === contaLocal.toLowerCase());
      if (c && ![...b.atribuicao.values()].some((a) => a.conta === c.id)) b.atribuicao.set(this.pc, { conta: c.id, versao: 1, motivo: "conta que já estava no computador" });
    }
    const a = b.atribuicao.get(this.pc);
    return {
      computador_id: this.pc,
      atribuicao: a && a.conta ? { conta_id: a.conta, email: b.contas.get(a.conta)?.email ?? null, versao: a.versao, motivo: a.motivo } : null,
      config: { ...b.config },
      comandos: b.comandos.filter((c) => c.pc === this.pc && c.estado === "pendente").map(({ id, acao, corpo }) => ({ id, acao, corpo })),
      ligacao_pendente: b.ligacoes.some((l) => !l.usada && l.expira > b.agora()),
    };
  }

  async pegarPosse(contaId: string, motivo: MotivoPosse, segundos: number) {
    this.registrarChamada("pegarPosse", contaId, motivo, segundos);
    const b = this.banco;
    if (motivo === "uso" && b.atribuicao.get(this.pc)?.conta !== contaId) {
      return { ok: false, erro: "a nuvem não atribuiu esta conta a este computador", cofre: null };
    }
    if (motivo !== "uso" && [...b.atribuicao.entries()].some(([pc, a]) => pc !== this.pc && a.conta === contaId)) {
      return { ok: false, erro: "conta em uso por outro computador", cofre: null };
    }
    const dono = b.donoDaPosse(contaId);
    if (dono && dono !== this.pc) return { ok: false, erro: "conta com outro computador", cofre: null };
    b.posse.set(contaId, { pc: this.pc, motivo, expira: b.agora() + segundos });
    const c = b.contas.get(contaId);
    const cofre: CofreNuvem | null = c?.cofre ? { ...c.cofre } : null;
    return { ok: true, erro: null, cofre };
  }

  async devolverCofre(contaId: string, cifrado: Buffer, nonce: Buffer, versaoAnterior: number, expiraEm: string | null) {
    this.registrarChamada("devolverCofre", contaId, versaoAnterior);
    const b = this.banco;
    if (b.donoDaPosse(contaId) !== this.pc) return { ok: false, versao: null, erro: "sem posse da conta" };
    const c = b.contas.get(contaId)!;
    const atual = c.cofre?.versao ?? 0;
    if (atual !== versaoAnterior) return { ok: false, versao: atual, erro: "versão do cofre mudou" };
    c.cofre = { cifrado, nonce, versao: versaoAnterior + 1, expira_em: expiraEm };
    return { ok: true, versao: versaoAnterior + 1, erro: null };
  }

  async soltarPosse(contaId: string) {
    this.registrarChamada("soltarPosse", contaId);
    if (this.banco.posse.get(contaId)?.pc === this.pc) this.banco.posse.delete(contaId);
    return { ok: true };
  }

  async registrarConta(email: string, _o: string | null, _p: string | null, _n: string | null, cifrado: Buffer, nonce: Buffer, expiraEm: string | null) {
    this.registrarChamada("registrarConta", email);
    const b = this.banco;
    const c = b.conta(email.toLowerCase());
    const dono = b.donoDaPosse(c.id);
    if (dono && dono !== this.pc) return { ok: false, conta_id: null, versao: null, erro: "conta com outro computador agora" };
    const versao = (c.cofre?.versao ?? 0) + 1;
    c.cofre = { cifrado, nonce, versao, expira_em: expiraEm };
    return { ok: true, conta_id: c.id, versao, erro: null };
  }

  async relatarUso(janelas: JanelaNuvem[], _historico: PontoNuvem[]) {
    this.registrarChamada("relatarUso", janelas);
    for (const j of janelas) {
      const p = this.banco.posse.get(j.conta_id);
      if (p?.pc === this.pc && p.expira > this.banco.agora() - 60) this.banco.janelas.push({ ...j, pc: this.pc });
    }
    return { ok: true };
  }

  async relatarTokens(linhas: LinhaTokens[], sessoes: SessaoNuvem[]) {
    this.registrarChamada("relatarTokens", linhas.length, sessoes.length);
    for (const l of linhas) this.banco.tokens.set(`${l.hora}|${l.conta_id}|${this.pc}|${l.projeto}|${l.modelo}`, l);
    for (const s of sessoes) this.banco.sessoes.set(s.id, s);
    return { ok: true };
  }

  async limite(contaId: string, sessao: string | null) {
    this.registrarChamada("limite", contaId, sessao);
    const a = this.banco.atribuicao.get(this.pc);
    return { ok: true, trocou: a?.conta !== contaId, versao: a?.versao ?? null };
  }

  async reservarComando(id: number) {
    this.registrarChamada("reservarComando", id);
    const c = this.banco.comandos.find((x) => x.id === id && x.pc === this.pc && x.estado === "pendente");
    if (!c) return { ok: false, comando: null };
    c.estado = "reservado";
    return { ok: true, comando: { id: c.id, acao: c.acao, corpo: c.corpo } };
  }

  async responderComando(id: number, http: number, resposta: Record<string, unknown>) {
    this.registrarChamada("responderComando", id, http);
    const c = this.banco.comandos.find((x) => x.id === id && x.estado === "reservado");
    if (!c) return { ok: false };
    Object.assign(c, { estado: http >= 200 && http < 300 ? "feito" : "recusado", http, resposta });
    return { ok: true };
  }

  async evento(tipo: string, texto: string, dados: Record<string, unknown>) {
    this.registrarChamada("evento", tipo);
    if (!["troca", "aviso", "limite", "retomada", "conexao", "erro", "info", "alerta"].includes(tipo)) throw new Error("tipo inválido");
    this.banco.eventos.push({ tipo, texto, dados, pc: this.pc });
    return { ok: true };
  }

  async marcarLogin(contaId: string, precisa: boolean) {
    this.registrarChamada("marcarLogin", contaId, precisa);
    const b = this.banco;
    const naMao = b.donoDaPosse(contaId) === this.pc || b.atribuicao.get(this.pc)?.conta === contaId;
    const c = b.contas.get(contaId);
    if (!naMao || !c) return { ok: false };
    c.precisaLogin = precisa;
    return { ok: true };
  }

  async ligacaoPublicar(embrulho: Buffer, sal: Buffer) {
    this.registrarChamada("ligacaoPublicar");
    for (const l of this.banco.ligacoes) l.usada = true;
    this.banco.ligacoes.push({ embrulho, sal, por: this.pc, usada: false, expira: this.banco.agora() + 600 });
    return { ok: true, expira_em: new Date((this.banco.agora() + 600) * 1000).toISOString() };
  }

  async cofreImpressao(impressao: string | null) {
    this.registrarChamada("cofreImpressao");
    if (impressao && !this.banco.cofreImpressao) this.banco.cofreImpressao = impressao;
    return this.banco.cofreImpressao ?? null;
  }

  async ligacaoBuscar() {
    this.registrarChamada("ligacaoBuscar");
    const l = this.banco.ligacoes.find((x) => !x.usada && x.expira > this.banco.agora() && x.por !== this.pc);
    if (!l) return null;
    l.usada = true;
    return { embrulho: l.embrulho, sal: l.sal };
  }

  async horaDoServidor() {
    return this.banco.agora();
  }
}

// ------------------------------------------------------------------------------------------------ agente montado

export interface Montado {
  agente: Agente;
  cred: CredenciaisFalsas;
  api: ApiFalsa;
  cli: CliFalsa;
  relogio: RelogioFalso;
  log: LogMemoria;
  guarda: GuardaFalsa;
  c: Caminhos;
  limpar: () => void;
}

export async function montar(
  opcoes: { nuvem?: Nuvem | null; sombra?: boolean; chave?: Buffer | null; cred?: CredenciaisFalsas; sistema?: Sistema; relogio?: RelogioFalso; exec?: Executor } = {},
): Promise<Montado> {
  const tmp = pastaTemporaria();
  const cred = opcoes.cred ?? new CredenciaisFalsas();
  const api = new ApiFalsa();
  const cli = new CliFalsa();
  const relogio = opcoes.relogio ?? new RelogioFalso();
  const log = new LogMemoria();
  const guarda = new GuardaFalsa();
  const chave = opcoes.chave === undefined ? novaChave() : opcoes.chave;
  if (chave) await guarda.gravar(SEGREDO_COFRE, chave.toString("base64"));
  const agente = new Agente({
    c: tmp.c,
    sistema: opcoes.sistema ?? "macos",
    cred,
    api,
    cli,
    relogio,
    log,
    guarda,
    nuvem: opcoes.nuvem ?? null,
    sombra: !!opcoes.sombra,
    porta: 0,
    sorteio: (xs) => xs[xs.length - 1]!,
    aleatorio: () => 0.5,
    exec: opcoes.exec,
  });
  await agente.iniciar({ laços: false, ponte: false });
  const limpar = () => {
    agente.parar();
    tmp.limpar();
  };
  return { agente, cred, api, cli, relogio, log, guarda, c: tmp.c, limpar };
}

/** Conta estacionada pronta: pasta, credencial guardada e leitura de uso. */
export function contaEstacionada(m: Montado, letra: string, pct = 10, opcoes: { contaId?: string } = {}): string {
  const t = m.agente.trocador;
  const pasta = t.novaPasta();
  fs.writeFileSync(path.join(pasta, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: `${letra.toLowerCase()}@exemplo.com` } }));
  const b = blob(letra + "1", true, 3600, m.relogio.agora());
  const perfil: Perfil = {
    accountUuid: `acc-${letra}`,
    email: `${letra.toLowerCase()}@exemplo.com`,
    orgUuid: `org-${letra}`,
    org: `Org ${letra}`,
    orgTipo: "x",
    tier: "default_max_5x",
  };
  const id = t.registrar(perfil, pasta, b);
  m.cred.d.set(pasta, b);
  Object.assign(m.agente.estado.contas[id]!, {
    janelas: [{ tipo: "five_hour", pct, resetEm: m.relogio.agora() + 3600 }],
    lidoEm: m.relogio.agora(),
    fonte: "api",
    contaId: opcoes.contaId ?? null,
  });
  return id;
}

/** A conta em uso: principal com o login dela, adotada pelo agente. */
export async function ativaEm(m: Montado, letra: string, pct: number, contaId?: string): Promise<string> {
  m.cred.d.set("principal", blob(letra + "1", true, 3600, m.relogio.agora()));
  const id = (await m.agente.trocador.conferirPrincipal())!;
  Object.assign(m.agente.estado.contas[id]!, {
    janelas: [{ tipo: "five_hour", pct, resetEm: m.relogio.agora() + 3600 }],
    lidoEm: m.relogio.agora(),
    fonte: "sessao",
    contaId: contaId ?? m.agente.estado.contas[id]!.contaId,
  });
  m.agente.estado.trocadaEm = 0;
  return id;
}
