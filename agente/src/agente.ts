// O agente de cada computador: junta a troca local, a leitura de uso, o cofre, a posse, a nuvem, o registro de uso
// das transcrições e a ponte com o mod.
//
// Com nuvem: a cada busca (5 s) chama `agente_ola`, aplica a atribuição que a nuvem decidiu, roda os comandos do
// painel e mantém as posses. Sem internet, mantém a conta atual e segue tentando.
// Sem nuvem (`--sem-nuvem`): decide sozinho, com as regras do roteador (limiar, limite ou rodízio).
// Modo sombra: lê e decide, mas não grava credencial, não pega posse e não responde comando; registra o que faria.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ApiContas } from "./anthropic.js";
import type { Cli } from "./claudecli.js";
import { ClaudeJson } from "./claudejson.js";
import { tocarSom } from "./som.js";
import { pedirConfirmacao } from "./confirmar.js";
import type { Executor } from "./util/executor.js";
import { CICLO_S, COMANDO_VALIDO_S, FATOR_LEITURA_SOMBRA, FILA_VALIDA_S, LER_ATIVA_PERTO_S, LER_ATIVA_S, LER_ESTACIONADA_AVISO_S, LER_ESTACIONADA_S, MEDIDA_FRESCA_S, POSSE_S, VERSAO, VENCIDO_EM_S, type Caminhos, type Sistema } from "./config.js";
import { expiraEm } from "./credenciais/blob.js";
import { CredenciaisSombra } from "./credenciais/sombra.js";
import type { Credenciais } from "./credenciais/tipos.js";
import { agendarRodizio, candidata, decidir, gatilhoDeTroca, pctEfetivo, sorteioReal } from "./decisao.js";
import { carregarEstado, salvarEstado, type EstadoLocal, type Modo } from "./estado.js";
import { cifrarParaNavegador, chavePublicaDoNavegador, codigoDeConfirmacao, impressaoDaChave, publicarLigacao } from "./ligar.js";
import { Logins, EMAIL_VALIDO, type Login } from "./logins.js";
import { ErroNuvem, TIPOS_EVENTO_NUVEM, type Atribuicao, type ComandoNuvem, type JanelaNuvem, type Nuvem, type PontoNuvem } from "./nuvem/tipos.js";
import { PosseCofre } from "./posse.js";
import { chaveDaPonte, criarPonte, type Resposta } from "./ponte.js";
import { Contador } from "./registro/contador.js";
import { Trocador } from "./troca.js";
import { isoParaEpoch, epochParaIso, type Relogio } from "./util/tempo.js";
import type { Log } from "./util/log.js";
import type { Guarda } from "./cofre/guarda.js";
import { SEGREDO_COFRE } from "./cofre/guarda.js";
import type { Server } from "node:http";

export interface Dependencias {
  c: Caminhos;
  sistema: Sistema;
  cred: Credenciais;
  api: ApiContas;
  cli: Cli;
  relogio: Relogio;
  log: Log;
  guarda: Guarda;
  nuvem: Nuvem | null;
  sombra: boolean;
  porta: number;
  sorteio?: (xs: string[]) => string;
  aleatorio?: () => number;
  diagnostico?: () => Promise<Record<string, unknown>>;
  /** Para tocar o som da troca (sem ele, não toca). */
  exec?: Executor;
}

const ACOES = new Set(["conectar", "entrar_de_novo", "cancelar_login", "codigo_login", "atualizar", "diagnostico", "retomar_sessao", "ligar"]);

export class Agente {
  estado: EstadoLocal;
  trocador: Trocador;
  contador: Contador;
  logins: Logins;
  posse: PosseCofre | null = null;
  cred: Credenciais;
  cj: ClaudeJson;
  chave: Buffer | null = null;
  online: boolean | null = null;
  ultimaFalhaNuvem: string | null = null;
  ponte: Server | null = null;
  private parado = false;
  private emCiclo = false;
  private emBusca = false;
  private emRegistro = false;
  private aviso: string | null = null;
  private semLivre: string | null = null;
  private pastasEm = 0;
  private comandosVistos = new Set<number>();
  private usoEnviado = "";
  private usoEnviadoEm = 0;
  private historicoEnviado = new Map<string, number>();
  private diagnosticoEm = 0;
  private sombraAtribuicao = "";
  private ligacaoAvisada = false;
  private falhaAtribuicao = new Map<string, number>();
  private emFundo = new Set<Promise<unknown>>();
  private possesLimpas = false;
  private impressaoConferida = false;
  private chaveDaInstalacao: boolean | null = null;
  private chaveLidaEm = 0;
  private registroTentado = new Map<string, number>();
  /** Quanto levou a última conversa com a nuvem (o painel mostra em Saúde). */
  ultimaBuscaMs: number | null = null;
  /** O que a nuvem já sabe de cada conta sobre precisar de login (e quando foi a última tentativa recusada). */
  private loginInformado = new Map<string, boolean>();
  private loginTentado = new Map<string, number>();

  constructor(private d: Dependencias) {
    this.estado = carregarEstado(d.c.estado);
    this.cred = d.sombra ? new CredenciaisSombra(d.cred, d.log) : d.cred;
    this.cj = new ClaudeJson(d.relogio, d.sombra, d.log);
    this.trocador = new Trocador(this.estado, this.cred, d.api, d.cli, this.cj, d.c, d.relogio, d.log, {
      podeRenovar: (id) => !d.sombra && (!d.nuvem || !!this.posse?.temPosse(id)),
      aoConectar: (id) => this.fundo(this.registrarNaNuvem(id)),
      aoEvento: (tipo, texto, dados) => {
        // A nuvem gera os próprios alertas; daqui vai o resto (alerta local chega lá como aviso).
        const t = tipo === "alerta" ? "aviso" : tipo;
        if (d.nuvem && !d.sombra && tipo !== "info" && TIPOS_EVENTO_NUVEM.has(t)) void d.nuvem.evento(t, texto, dados).catch(() => undefined);
        if (tipo === "troca") this.somDaTroca(); // em sombra o trocador não troca, então não chega aqui
      },
      aoRenovarPrincipal: () => {
        if (this.posse) this.posse.subirAtiva = true;
      },
    }, () => this.salvar());
    this.trocador.sombra = d.sombra;
    this.contador = new Contador(d.c.registro, d.c.projetos, (ts) => this.trocador.contaEm(ts), () => d.relogio.agora());
    this.logins = new Logins(this.trocador, this.cred, d.cli, d.relogio, (login, id) => this.loginTerminou(login, id));
    if (d.nuvem) {
      this.posse = new PosseCofre(() => this.estado, this.trocador, this.cred, d.nuvem, () => this.chave, this.cj, d.relogio, d.log, () =>
        this.salvar(),
      );
    }
  }

  /** Trabalho que roda solto (registro na nuvem, avisos): guardado para os testes e o desligamento esperarem. */
  fundo(p: Promise<unknown>): void {
    const q = p.catch((e) => this.d.log.erro(`tarefa: ${(e as Error).message}`)).finally(() => this.emFundo.delete(q));
    this.emFundo.add(q);
  }

  async esperar(): Promise<void> {
    while (this.emFundo.size) await Promise.all([...this.emFundo]);
  }

  get comNuvem(): boolean {
    return !!this.d.nuvem;
  }

  /** Toca o som de troca, se estiver ligado. Solto: a troca não espera o som. */
  somDaTroca(forcar = false): Promise<boolean> {
    if (!this.d.exec || (!forcar && this.estado.config.som === false)) return Promise.resolve(false);
    return tocarSom(this.d.exec, this.d.sistema).then(
      (ok) => {
        if (!ok) this.d.log.info("som da troca: nenhum tocador de som neste sistema");
        return ok;
      },
      () => false,
    );
  }

  salvar(): void {
    try {
      salvarEstado(this.d.c.estado, this.estado);
    } catch (e) {
      this.d.log.erro(`não consegui salvar o estado: ${(e as Error).message}`);
    }
  }

  // ------------------------------------------------------------------------------------------------ partida

  async iniciar(opcoes: { laços?: boolean; ponte?: boolean } = {}): Promise<void> {
    fs.mkdirSync(this.d.c.contas, { recursive: true, mode: 0o700 });
    const k = await this.d.guarda.ler(SEGREDO_COFRE).catch(() => null);
    this.chave = k ? Buffer.from(k, "base64") : null;
    if (this.chave && this.chave.length !== 32) this.chave = null;
    this.d.log.info(`agente ${VERSAO} ${this.d.sombra ? "em modo sombra " : ""}${this.comNuvem ? "com nuvem" : "sem nuvem"}`);
    if (opcoes.ponte !== false) await this.abrirPonte();
    if (opcoes.laços === false) return;
    this.laco(() => this.ciclo(), CICLO_S * 1000);
    if (this.comNuvem) this.laco(() => this.busca(), () => Math.max(2, Math.min(60, this.estado.config.intervaloS || 5)) * 1000);
    this.laco(() => this.registro(), 60_000);
  }

  parar(): void {
    this.parado = true;
    this.logins.encerrar();
    this.ponte?.close();
  }

  private laco(fn: () => Promise<void>, intervalo: number | (() => number)): void {
    const proximo = () => (typeof intervalo === "number" ? intervalo : intervalo());
    const rodar = async () => {
      if (this.parado) return;
      try {
        await fn();
      } catch (e) {
        this.d.log.erro(`laço: ${(e as Error).message}`);
      }
      if (!this.parado) this.d.relogio.agendar(() => void rodar(), proximo());
    };
    this.d.relogio.agendar(() => void rodar(), 10);
  }

  private abrirPonte(): Promise<void> {
    return new Promise((resolve) => {
      const s = criarPonte(this.alvoPonte(), this.d.porta, chaveDaPonte(this.d.c.ponteChave));
      s.on("error", (e: NodeJS.ErrnoException) => {
        this.d.log.erro(`ponte local não abriu na porta ${this.d.porta}: ${e.code ?? e.message}`);
        resolve();
        // outro programa na porta: tenta de novo daqui a pouco (a chave não vaza: quem pede manda só a prova dela)
        if (!this.ponte && !this.parado) this.d.relogio.agendar(() => void this.abrirPonte(), 15_000);
      });
      s.listen(this.d.porta, "127.0.0.1", () => {
        this.ponte = s;
        resolve();
      });
    });
  }

  // ------------------------------------------------------------------------------------------------ ciclo local

  async ciclo(): Promise<void> {
    if (this.emCiclo) return;
    this.emCiclo = true;
    try {
      const pendentes = await this.trocador.geral.com(async () => {
        const t = this.d.relogio.agora();
        if (t - this.pastasEm >= 60) {
          this.pastasEm = t;
          await this.trocador.arrumarPastas(this.logins.pastas());
        }
        this.trocador.registrarHistorico(t);
        if (!this.comNuvem && this.estado.config.modo === "rodizio" && !this.estado.proximoRodizioEm) {
          agendarRodizio(this.estado, t, this.d.aleatorio);
        }
        const ativa = await this.trocador.conferirPrincipalDentro();
        const lista: string[] = [];
        // Na sombra, outro gestor já lê as mesmas contas: ler 5 vezes menos não dobra o pedido no serviço de uso.
        const fator = this.d.sombra ? FATOR_LEITURA_SOMBRA : 1;
        for (const [id, c] of Object.entries(this.estado.contas)) {
          const ultima = this.trocador.ultimaLeitura[id] ?? 0;
          if (id === ativa) {
            const fresca = c.fonte === "sessao" && t - (c.lidoEm ?? 0) < MEDIDA_FRESCA_S;
            // Perto do gatilho a leitura não espera: agentes em paralelo gastam vários pontos por minuto, e a troca
            // precisa acontecer antes de a conta esgotar (11/10/2026: a conta foi de 95% a 100% entre duas leituras).
            const pct = pctEfetivo(c, t) ?? 0;
            const perto = pct >= Math.min(this.estado.config.aviso, gatilhoDeTroca(this.estado) - 10);
            if (perto ? t - ultima >= LER_ATIVA_PERTO_S * fator : !fresca && t - ultima >= LER_ATIVA_S * fator) lista.push(id);
          } else if (!c.pausada && t - ultima >= LER_ESTACIONADA_S * fator) lista.push(id);
        }
        return lista;
      });
      for (const id of pendentes) await this.lerUsoConta(id);
      if (!this.comNuvem || this.d.sombra) await this.agir();
      this.salvar();
    } finally {
      this.emCiclo = false;
    }
  }

  /**
   * Lê o uso de uma conta. Com nuvem, conta parada só é lida com a posse (curta): a nuvem só aceita o número de quem
   * tem a conta em mãos, e só quem tem a posse renova. Sem posse (a conta está com outro computador), quem lê é ele.
   */
  async lerUsoConta(id: string, forcar = false): Promise<void> {
    const c = this.estado.contas[id];
    if (!c) return;
    if (!this.posse || this.d.sombra || id === this.estado.ativa || !c.contaId) return this.trocador.lerUso(id, forcar);
    if (this.posse.temPosse(id)) {
      await this.trocador.lerUso(id, forcar);
      return this.relatarUso(true).catch(() => undefined);
    }
    if (!this.online) return;
    const blob = await this.cred.ler(c.pasta);
    const motivo = blob && expiraEm(blob) > this.d.relogio.agora() + VENCIDO_EM_S + 60 ? "leitura" : "renovacao";
    const r = await this.posse
      .com(id, motivo, async () => {
        await this.trocador.lerUso(id, true);
        await this.relatarUso(true);
        return true;
      })
      .catch((e) => {
        this.d.log.erro(`leitura de ${c.email} com posse: ${(e as Error).message}`);
        return null;
      });
    if (r === null) this.trocador.ultimaLeitura[id] = this.d.relogio.agora();
  }

  /**
   * Decisão local: sem nuvem, é ela que troca; no modo sombra roda sempre (com a configuração local, que a importação
   * traz do roteador antigo) para o log dizer o que o agente faria.
   */
  async agir(limite = false): Promise<void> {
    if (this.comNuvem && !this.d.sombra) return;
    await this.trocador.geral.com(async () => {
      const t = this.d.relogio.agora();
      const [acao, alvo] = decidir(this.estado, t, limite, this.d.sorteio ?? sorteioReal);
      const ativa = this.estado.ativa;
      if (acao === "aviso") {
        this.estado.proxima = alvo;
        const chave = `${ativa}>${alvo}`;
        if (this.aviso !== chave && ativa) {
          this.aviso = chave;
          const p = pctEfetivo(this.estado.contas[ativa]!, t) ?? 0;
          const prox = alvo ? this.estado.contas[alvo]!.email : "nenhuma livre";
          this.trocador.evento("aviso", `${this.estado.contas[ativa]!.email} chegou a ${p.toFixed(0)}%. Próxima: ${prox}.`);
          for (const id of Object.keys(this.estado.contas)) {
            const fator = this.d.sombra ? FATOR_LEITURA_SOMBRA : 1;
            if (id !== ativa && t - (this.trocador.ultimaLeitura[id] ?? 0) > LER_ESTACIONADA_AVISO_S * fator) await this.trocador.lerUso(id);
          }
        }
      } else if (acao === "trocar" || acao === "rodizio") {
        const motivo =
          acao === "rodizio" ? "rodízio" : limite ? "a sessão bateu o limite" : `chegou a ${gatilhoDeTroca(this.estado).toFixed(0)}%`;
        const r = await this.trocador.trocarDentro(alvo, motivo);
        if (r.ok) {
          this.aviso = null;
          this.retomarHeadless();
        }
        agendarRodizio(this.estado, t, this.d.aleatorio);
      } else if (acao === "reagendar") {
        agendarRodizio(this.estado, t, this.d.aleatorio);
        this.trocador.evento("info", "Rodízio: nenhuma outra conta livre agora; tento de novo mais tarde.");
      } else if (acao === "sem_livre") {
        this.estado.proxima = null;
        if (this.semLivre !== ativa) {
          this.semLivre = ativa;
          this.trocador.evento("erro", "Nenhuma conta livre para trocar; as sessões esperam o reset.");
        }
      } else {
        this.estado.proxima = this.estado.ativa ? candidata(this.estado, t) : null;
        this.semLivre = null;
      }
      this.salvar();
    });
  }

  retomarHeadless(): void {
    if (!this.estado.config.retomarHeadless) return;
    const t = this.d.relogio.agora();
    for (const f of this.estado.fila) {
      if (f.tipo !== "headless" || f.estado !== "aguardando") continue;
      // entrada velha (de antes de ligar a opção, ou importada) não volta a rodar sozinha
      if (t - f.em > FILA_VALIDA_S) {
        f.estado = "descartada";
        continue;
      }
      const cwd = this.retomar(f.sessao);
      f.estado = cwd ? "retomada" : "descartada";
      if (cwd) this.trocador.evento("retomada", `Retomei a sessão de terminal ${f.sessao.slice(0, 8)} em ${path.basename(cwd)}.`, { sessao: f.sessao });
    }
  }

  /**
   * Retoma a sessão na pasta em que ela rodou, lida da transcrição que o próprio assistente gravou: a pasta que veio
   * pela ponte local não vale (qualquer programa do computador fala com a ponte). Devolve a pasta, ou null.
   */
  private retomar(sessao: string): string | null {
    const cwd = cwdDaSessao(this.d.c.projetos, sessao);
    if (!cwd || !fs.existsSync(cwd)) {
      this.d.log.erro(`sessão ${sessao.slice(0, 8)}: não achei a transcrição dela; não retomo`);
      return null;
    }
    if (this.d.sombra) {
      this.d.log.faria(`retomar a sessão ${sessao.slice(0, 8)}`);
      return cwd;
    }
    fs.mkdirSync(this.d.c.logs, { recursive: true, mode: 0o700 });
    const fd = fs.openSync(path.join(this.d.c.logs, `retomada-${sessao.slice(0, 40)}.log`), "a", 0o600);
    try {
      this.d.cli.retomar(sessao, cwd, "A conta anterior bateu o limite de uso e o Reveza trocou de conta. Continue a tarefa de onde parou.", fd);
    } finally {
      fs.closeSync(fd);
    }
    return cwd;
  }

  // ------------------------------------------------------------------------------------------------ nuvem

  /**
   * A chave deste computador é a da instalação? A primeira chave registra a impressão; com outra, este computador não
   * responde a pedido de ligação (passaria adiante uma chave que divide o cofre).
   */
  private async conferirImpressao(nuvem: Nuvem, config: Record<string, unknown> | null | undefined): Promise<void> {
    if (!this.chave || this.impressaoConferida) return;
    const minha = impressaoDaChave(this.chave);
    const daNuvem = typeof config?.cofre_impressao === "string" ? config.cofre_impressao : await nuvem.cofreImpressao(minha).catch(() => null);
    if (!daNuvem) return;
    this.impressaoConferida = true;
    this.chaveDaInstalacao = daNuvem === minha;
    if (!this.chaveDaInstalacao) this.trocador.evento("erro", "A chave do cofre deste computador não é a da instalação; ligue-o de novo com `reveza ligar`.");
  }

  /** A chave do cofre pode chegar depois de o agente ligar (`reveza ligar` roda em outro processo). */
  private async recarregarChave(): Promise<void> {
    if (this.chave || this.d.relogio.agora() - this.chaveLidaEm < 60) return;
    this.chaveLidaEm = this.d.relogio.agora();
    const k = await this.d.guarda.ler(SEGREDO_COFRE).catch(() => null);
    const b = k ? Buffer.from(k, "base64") : null;
    if (b && b.length === 32) {
      this.chave = b;
      this.d.log.info("chave do cofre carregada");
    }
  }

  async busca(): Promise<void> {
    const nuvem = this.d.nuvem;
    if (!nuvem || !this.posse || this.emBusca) return;
    this.emBusca = true;
    try {
      await this.recarregarChave();
      if (!this.estado.nuvem.computadorId) {
        const r = await nuvem.registrar(os.hostname().slice(0, 60), this.d.sistema, VERSAO);
        this.estado.nuvem.computadorId = r.computador_id;
        this.salvar();
      }
      let diagnostico: Record<string, unknown> | null = null;
      if (this.d.diagnostico && this.d.relogio.agora() - this.diagnosticoEm > 600) {
        this.diagnosticoEm = this.d.relogio.agora();
        diagnostico = await this.d.diagnostico().catch(() => null);
      }
      const ativa = this.estado.ativa ? this.estado.contas[this.estado.ativa] : null;
      const inicio = Date.now();
      const r = await nuvem.ola(VERSAO, diagnostico, ativa?.email ?? null);
      this.ultimaBuscaMs = Date.now() - inicio;
      if (r.computador_id && r.computador_id !== this.estado.nuvem.computadorId) this.estado.nuvem.computadorId = r.computador_id;
      if (this.online === false) this.d.log.info("nuvem de volta");
      this.online = true;
      this.ultimaFalhaNuvem = null;
      if (!this.d.sombra) this.aplicarConfig(r.config);
      await this.conferirImpressao(nuvem, r.config);
      this.estado.nuvem.atribuicaoConta = r.atribuicao?.conta_id ?? null;
      if (r.ligacao_pendente && !this.ligacaoAvisada) {
        this.ligacaoAvisada = true;
        this.d.log.info("há uma ligação de computador novo aberta (frase de 6 palavras válida por 10 minutos)");
      } else if (!r.ligacao_pendente) this.ligacaoAvisada = false;
      if (!this.d.sombra) {
        if (!this.possesLimpas) await this.limparPossesAntigas();
        await this.registrarPendentes();
        await this.informarLogins();
        await this.garantirPosseDaAtiva();
        await this.posse.processarSaidas();
        await this.posse.subirAtivaSePreciso();
      }
      if (r.atribuicao) await this.aplicarAtribuicao(r.atribuicao);
      for (const cmd of r.comandos) await this.comando(cmd.id);
      await this.relatarUso();
    } catch (e) {
      const msg = (e as Error).message;
      if (this.online !== false || this.ultimaFalhaNuvem !== msg) this.d.log.erro(`nuvem: ${msg}; mantenho a conta atual e tento de novo`);
      this.online = e instanceof ErroNuvem && !e.semRede ? true : false;
      this.ultimaFalhaNuvem = msg;
    } finally {
      this.emBusca = false;
    }
  }

  aplicarConfig(cfg: Record<string, unknown>): void {
    const k = this.estado.config;
    const num = (v: unknown, min: number, max: number) => (typeof v === "number" && v >= min && v <= max ? v : null);
    if (typeof cfg.auto === "boolean") k.auto = cfg.auto;
    if (cfg.modo === "limite" || cfg.modo === "limiar" || cfg.modo === "rodizio") k.modo = cfg.modo as Modo;
    k.aviso = num(cfg.aviso, 1, 100) ?? k.aviso;
    k.troca = num(cfg.troca, 1, 100) ?? k.troca;
    k.intervaloS = num(cfg.intervalo_s, 2, 60) ?? k.intervaloS;
    k.esperaEntreTrocasS = num(cfg.espera_entre_trocas_s, 0, 3600) ?? k.esperaEntreTrocasS;
    k.rodizio.minutos = num(cfg.rodizio_minutos, 15, 480) ?? k.rodizio.minutos;
    if (cfg.rodizio_ordem === "aleatoria" || cfg.rodizio_ordem === "menor_uso") k.rodizio.ordem = cfg.rodizio_ordem;
    if (typeof cfg.retomar_terminal === "boolean") k.retomarHeadless = cfg.retomar_terminal;
  }

  /**
   * Primeira conversa com a nuvem depois de ligar: posse que ficou de antes (o agente caiu com uma conta parada na
   * mão) volta ao cofre com a cópia daqui e é solta; senão a nuvem renovaria essa posse para sempre a cada busca.
   */
  private async limparPossesAntigas(): Promise<void> {
    this.possesLimpas = true;
    for (const c of Object.values(this.estado.contas)) {
      if (!c.contaId || c.id === this.estado.ativa || this.posse!.temPosse(c.id)) continue;
      this.posse!.posses.set(c.id, "renovacao");
      await this.posse!.devolver(c.id, { silencioso: true }).catch(() => false);
      await this.posse!.soltar(c.id).catch(() => undefined);
      this.posse!.posses.delete(c.id);
    }
  }

  /** Conta com login aqui e ainda fora da nuvem (a nuvem estava fora quando ela apareceu): tenta de 5 em 5 min. */
  private async registrarPendentes(): Promise<void> {
    if (!this.chave) return;
    const t = this.d.relogio.agora();
    for (const c of Object.values(this.estado.contas)) {
      if (c.contaId || c.precisaLogin || t - (this.registroTentado.get(c.id) ?? 0) < 300) continue;
      this.registroTentado.set(c.id, t);
      await this.registrarNaNuvem(c.id);
    }
  }

  /**
   * Conta que perdeu o login aqui (ou voltou a ter) avisa a nuvem, para o decidir() não mandá-la de novo a este ou a
   * outro computador. A nuvem só aceita para conta na mão; recusada, tenta de novo em 5 min.
   */
  private async informarLogins(): Promise<void> {
    const nuvem = this.d.nuvem;
    if (!nuvem || !this.posse) return;
    const t = this.d.relogio.agora();
    for (const c of Object.values(this.estado.contas)) {
      if (!c.contaId) continue;
      const sabido = this.loginInformado.get(c.id);
      const naMao = this.posse!.temPosse(c.id) || this.estado.nuvem.atribuicaoConta === c.contaId;
      if (sabido === c.precisaLogin || (sabido === undefined && !c.precisaLogin && !naMao)) continue;
      if (t - (this.loginTentado.get(c.id) ?? 0) < 300) continue;
      const r = await nuvem.marcarLogin(c.contaId, c.precisaLogin).catch(() => ({ ok: false }));
      if (r.ok) {
        this.loginInformado.set(c.id, c.precisaLogin);
        this.loginTentado.delete(c.id);
      } else this.loginTentado.set(c.id, t);
    }
  }

  /**
   * Desligamento do serviço: a conta em uso sobe ao cofre (se outro computador assumir, pega um login válido) e as
   * contas paradas que estão na mão voltam e são soltas. A posse de uso fica e vence sozinha em 2 min.
   */
  async desligar(prazoMs = 8000): Promise<void> {
    const trabalho = (async () => {
      if (!this.posse || this.d.sombra || this.online === false) return;
      for (const [id] of [...this.posse.posses]) {
        await this.posse.devolver(id).catch(() => false);
        if (id !== this.estado.ativa) await this.posse.soltar(id).catch(() => undefined);
      }
    })();
    await Promise.race([trabalho, new Promise((r) => this.d.relogio.agendar(() => r(undefined), prazoMs))]);
    this.salvar();
    this.parar();
  }

  /** A conta em uso precisa estar com a posse deste computador. */
  private async garantirPosseDaAtiva(): Promise<void> {
    const ativa = this.estado.ativa;
    const c = ativa ? this.estado.contas[ativa] : null;
    if (!ativa || !c?.contaId || this.posse!.posses.get(ativa) === "uso") return;
    // A nuvem só dá posse de uso da conta que ela atribuiu a este computador; se atribuiu outra, a troca vem já.
    if (this.estado.nuvem.atribuicaoConta && this.estado.nuvem.atribuicaoConta !== c.contaId) return;
    const r = await this.posse!.pegar(ativa, "uso");
    if (r.ok) this.posse!.posses.set(ativa, "uso");
    else if (this.semLivre !== `posse:${ativa}`) {
      this.semLivre = `posse:${ativa}`;
      this.trocador.evento("alerta", `${c.email} está em uso aqui, mas a nuvem não deu a posse (${r.erro ?? "sem motivo"}).`, { conta: ativa });
    }
  }

  async aplicarAtribuicao(a: Atribuicao): Promise<void> {
    if (!a.conta_id) return;
    this.estado.nuvem.atribuicaoConta = a.conta_id;
    const destino = this.posse!.porContaId(a.conta_id);
    const ativa = this.estado.ativa;
    if (destino && destino === ativa) {
      this.estado.nuvem.atribuicaoVersao = Math.max(this.estado.nuvem.atribuicaoVersao, a.versao);
      this.estado.nuvem.atribuicaoConta = a.conta_id;
      return;
    }
    if (this.d.sombra) {
      const chave = `${a.conta_id}#${a.versao}`;
      if (this.sombraAtribuicao !== chave) {
        this.sombraAtribuicao = chave;
        const email = destino ? this.estado.contas[destino]!.email : a.conta_id;
        this.d.log.faria(`pegar a posse e trocar para ${email} (${a.motivo || "atribuição da nuvem"})`);
      }
      return;
    }
    const chave = `${a.conta_id}#${a.versao}`;
    if ((this.falhaAtribuicao.get(chave) ?? 0) > this.d.relogio.agora()) return;
    const nuvem = this.d.nuvem!;
    const r = await nuvem.pegarPosse(a.conta_id, "uso", POSSE_S);
    if (!r.ok) {
      this.d.log.info(`a conta atribuída (${a.email ?? a.conta_id}) não veio: ${r.erro ?? "sem motivo"}; espero a nuvem`);
      return;
    }
    let id = destino;
    if (!id) {
      id = await this.posse!.materializar(a.conta_id, a.email, r.cofre, (pasta) => this.d.cli.renovar(pasta, 0));
      if (!id) {
        await nuvem.soltarPosse(a.conta_id).catch(() => undefined);
        return;
      }
    } else {
      await this.posse!.sincronizar(id, r.cofre);
    }
    const ja = this.posse!.posses.get(id);
    this.posse!.posses.set(id, "uso");
    const res = await this.trocador.trocar(id, a.motivo || "decisão da nuvem");
    if (!res.ok) {
      // Não trocou (conta sem login guardado, rede fora na hora de identificar a principal...): solta a conta e
      // tenta de novo em 1 min, sem martelar a cada busca.
      this.falhaAtribuicao.set(chave, this.d.relogio.agora() + 60);
      if (ja !== "uso") {
        await this.posse!.devolver(id).catch(() => false);
        await this.posse!.soltar(id).catch(() => undefined);
      }
      return;
    }
    this.falhaAtribuicao.delete(chave);
    this.estado.nuvem.atribuicaoVersao = a.versao;
    this.estado.nuvem.atribuicaoConta = a.conta_id;
    if (res.de && res.de !== id && this.estado.contas[res.de]?.contaId) {
      // A que saiu volta ao cofre depois da conferência da troca (5 s, até 3 refeitas).
      this.posse!.soltarDepois.set(res.de, this.d.relogio.agora() + 20);
    }
    this.retomarHeadless();
    this.salvar();
  }

  // ------------------------------------------------------------------------------------------------ comandos

  async comando(id: number): Promise<void> {
    if (this.comandosVistos.has(id)) return;
    this.comandosVistos.add(id);
    if (this.comandosVistos.size > 500) this.comandosVistos = new Set([...this.comandosVistos].slice(-200));
    if (this.d.sombra) {
      this.d.log.faria(`reservar e responder o comando ${id}`);
      return;
    }
    const nuvem = this.d.nuvem!;
    const r = await nuvem.reservarComando(id);
    if (!r.ok || !r.comando) return;
    const cmd = r.comando;
    const tratar = async (): Promise<void> => {
      let resposta: Resposta;
      try {
        resposta = await this.executar(cmd);
      } catch (e) {
        this.d.log.erro(`comando ${cmd.acao}: ${(e as Error).message}`);
        resposta = { status: 500, corpo: { ok: false, erro: "falha interna no computador; veja o log do agente" } };
      }
      await nuvem.responderComando(id, resposta.status, resposta.corpo as Record<string, unknown>).catch(() => undefined);
      this.d.log.info(`comando ${cmd.acao} (${id}) -> ${resposta.status}`);
    };
    // a ligação espera a pessoa clicar na janela (até 90 s): roda à parte, para a busca e a troca não pararem
    if (cmd.acao === "ligar") {
      this.emEspera = tratar().finally(() => (this.emEspera = null));
      return;
    }
    await tratar();
  }

  /** Comando que roda à parte (a ligação esperando o clique); os testes esperam por ele. */
  emEspera: Promise<void> | null = null;

  permitidas(): Set<string> | null {
    try {
      const linhas = fs.readFileSync(this.d.c.permitidas, "utf8").split(/\r?\n/);
      return new Set(linhas.map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith("#")));
    } catch {
      return null;
    }
  }

  async executar(cmd: ComandoNuvem): Promise<Resposta> {
    const recusa = (status: number, erro: string): Resposta => ({ status, corpo: { ok: false, erro } });
    if (!ACOES.has(cmd.acao)) return recusa(403, "ação não permitida");
    if (JSON.stringify(cmd.corpo).length > 4096) return recusa(413, "pedido grande demais");
    // Quem expira comando velho é a nuvem (2 min); se ela mandar a hora, confere aqui também.
    const criado = cmd.criado_em ? isoParaEpoch(cmd.criado_em) : null;
    if (criado && this.d.relogio.agora() - criado > COMANDO_VALIDO_S) return recusa(410, "pedido expirado");
    const corpo = cmd.corpo;
    switch (cmd.acao) {
      case "conectar":
      case "entrar_de_novo": {
        let email = typeof corpo.email === "string" ? corpo.email.trim().toLowerCase() : "";
        if (cmd.acao === "entrar_de_novo" && typeof corpo.conta_id === "string") {
          const id = this.posse?.porContaId(corpo.conta_id);
          if (id) email = this.estado.contas[id]!.email;
        }
        if (!EMAIL_VALIDO.test(email)) return recusa(400, "e-mail inválido");
        const lista = this.permitidas();
        if (lista && !lista.has(email)) return recusa(403, "este computador só conecta as contas da lista dele (contas-permitidas.txt)");
        const l = this.logins.iniciar(email);
        for (let i = 0; i < 30 && !l.url && l.estado === "aguardando"; i++) await this.d.relogio.dormir(500);
        return { status: 200, corpo: { ok: true, login_id: l.id, url: l.url, estado: l.estado, mensagem: l.mensagem } };
      }
      case "codigo_login": {
        const r = this.logins.codigo(String(corpo.login_id ?? ""), String(corpo.codigo ?? ""));
        return { status: r.ok ? 200 : 400, corpo: r };
      }
      case "cancelar_login": {
        const r = this.logins.cancelar(String(corpo.login_id ?? ""));
        return { status: r.ok ? 200 : 400, corpo: r };
      }
      case "atualizar":
        await this.atualizarTudo();
        return { status: 200, corpo: { ok: true } };
      case "diagnostico": {
        const diag = this.d.diagnostico ? await this.d.diagnostico() : {};
        return { status: 200, corpo: { ok: true, diagnostico: diag } };
      }
      case "ligar": {
        // frase de computador novo pedida pelo painel: volta cifrada para a chave efêmera daquele navegador
        const publica = chavePublicaDoNavegador(corpo.publica);
        if (!publica) return recusa(400, "pedido de ligação inválido");
        if (this.d.sombra) return recusa(409, "modo sombra: o agente não abre ligação");
        if (!this.chave) return recusa(409, "este computador não tem a chave do cofre");
        if (this.chaveDaInstalacao === false) return recusa(409, "a chave do cofre deste computador não é a da instalação");
        // Pelo painel, quem pede é a nuvem (um administrador, ou quem controla o projeto inteiro no Supabase). Quem
        // libera é a pessoa, aqui: uma janela com o código que o painel mostra (som junto, para chamar a atenção). Sem
        // tela para perguntar, só com a liberação permanente deste computador (reveza ligar --painel ligar).
        const idioma = corpo.idioma === "en" ? "en" : "pt-BR";
        if (!fs.existsSync(this.d.c.ligarPeloPainel)) {
          const sem = "este computador não tem tela para confirmar: rode reveza ligar no terminal dele (ou libere sem perguntar: reveza ligar --painel ligar)";
          if (!this.d.exec) return recusa(403, sem);
          void this.somDaTroca(true);
          const r = await pedirConfirmacao(this.d.exec, this.d.sistema, codigoDeConfirmacao(publica), idioma);
          if (r === "sem_tela") return recusa(403, sem);
          if (r === "recusou") {
            this.trocador.evento("info", "Pedido de ligação de computador novo recusado na tela deste computador.");
            return recusa(403, "a ligação foi recusada na tela do computador");
          }
        }
        const r = await publicarLigacao(this.d.guarda, this.d.nuvem!, idioma);
        const envelope = await cifrarParaNavegador(publica, { palavras: r.frase.split(" "), expiraEm: r.expiraEm });
        this.trocador.evento("info", "Ligação de computador novo aberta pelo painel (10 minutos).");
        return { status: 200, corpo: { ok: true, envelope } };
      }
      case "retomar_sessao": {
        const sessao = String(corpo.sessao ?? "");
        const f = this.estado.fila.find((x) => x.sessao === sessao);
        if (!f) return recusa(404, "sessão desconhecida neste computador");
        if (f.estado !== "aguardando") return recusa(409, `a sessão já foi ${f.estado}`);
        // sessão com tela continua sozinha pelo mod; retomar no terminal por cima dela daria duas conversas ao mesmo tempo
        if (f.tipo !== "headless") return recusa(409, "sessão com tela: ela continua sozinha quando a conta troca");
        if (!this.retomar(f.sessao)) return recusa(404, "a transcrição da sessão não está neste computador");
        f.estado = "retomada";
        this.trocador.evento("retomada", `Retomei a sessão ${f.sessao.slice(0, 8)} pelo painel.`, { sessao: f.sessao });
        this.salvar();
        return { status: 200, corpo: { ok: true } };
      }
    }
    return recusa(403, "ação não permitida");
  }

  async atualizarTudo(): Promise<void> {
    await this.trocador.conferirPrincipal();
    for (const id of Object.keys(this.estado.contas)) await this.lerUsoConta(id, true);
    if (!this.comNuvem) await this.agir();
    else await this.relatarUso(true);
    this.salvar();
  }

  // ------------------------------------------------------------------------------------------------ contas novas

  private async loginTerminou(login: Login, id: string | null): Promise<void> {
    if (this.d.nuvem && !this.d.sombra) {
      void this.d.nuvem
        .evento("conexao", login.mensagem, { login_id: login.id, estado: login.estado, email: login.email })
        .catch(() => undefined);
    }
    if (!id) return;
    this.salvar();
    await this.registrarNaNuvem(id);
    await this.lerUsoConta(id, true);
    this.salvar();
  }

  async registrarNaNuvem(id: string): Promise<void> {
    if (!this.posse || this.d.sombra) return;
    if (!this.chave) {
      this.trocador.evento("alerta", "Conta conectada só neste computador: falta a chave do cofre (`reveza ligar`).", { conta: id });
      return;
    }
    await this.posse.registrarNaNuvem(id).catch((e) => this.d.log.erro(`registrar conta na nuvem: ${(e as Error).message}`));
  }

  // ------------------------------------------------------------------------------------------------ relatos

  /** Janelas e histórico das contas que este computador tem em mãos (a nuvem ignora as outras). */
  async relatarUso(forcar = false): Promise<void> {
    const nuvem = this.d.nuvem;
    if (!nuvem || !this.posse) return;
    const t = this.d.relogio.agora();
    const janelas: JanelaNuvem[] = [];
    const historico: PontoNuvem[] = [];
    for (const c of Object.values(this.estado.contas)) {
      if (!c.contaId || !c.lidoEm || !this.posse.temPosse(c.id)) continue;
      for (const j of c.janelas) {
        janelas.push({
          conta_id: c.contaId,
          tipo: j.tipo,
          pct: j.pct,
          reset_em: j.resetEm ? epochParaIso(j.resetEm) : null,
          fonte: c.fonte === "sessao" ? "sessao" : "api",
        });
      }
      const ultimo = this.historicoEnviado.get(c.id) ?? 0;
      for (const p of this.estado.historico[c.id] ?? []) {
        if (p.t > ultimo) historico.push({ conta_id: c.contaId, em: epochParaIso(p.t), p5: p.p5, p7: p.p7 });
      }
    }
    const assinatura = JSON.stringify(janelas);
    if (!forcar && assinatura === this.usoEnviado && !historico.length && t - this.usoEnviadoEm < 60) return;
    if (!janelas.length && !historico.length) return;
    await nuvem.relatarUso(janelas.slice(0, 100), historico.slice(-500));
    this.usoEnviado = assinatura;
    this.usoEnviadoEm = t;
    for (const c of Object.values(this.estado.contas)) {
      const pontos = this.estado.historico[c.id] ?? [];
      if (pontos.length && this.posse.temPosse(c.id)) this.historicoEnviado.set(c.id, pontos[pontos.length - 1]!.t);
    }
  }

  /** Varre as transcrições e manda os agregados que mudaram. */
  async registro(orcamentoMs = 20_000): Promise<void> {
    if (this.emRegistro) return;
    this.emRegistro = true;
    try {
      await this.contador.varrer(orcamentoMs);
      const nuvem = this.d.nuvem;
      if (!nuvem || this.online === false) return;
      const contaNuvem = (id: string) => this.estado.contas[id]?.contaId ?? null;
      for (let i = 0; i < 20; i++) {
        const lote = this.contador.paraNuvem(contaNuvem);
        if (!lote.linhas.length && !lote.sessoes.length) break;
        const r = await nuvem.relatarTokens(lote.linhas, lote.sessoes);
        if (!r.ok) break;
        this.contador.confirmarEnvio(lote.chaves, lote.ids);
      }
      this.contador.salvar();
    } catch (e) {
      this.d.log.erro(`registro de uso: ${(e as Error).message}`);
    } finally {
      this.emRegistro = false;
    }
  }

  // ------------------------------------------------------------------------------------------------ ponte

  publico(): Record<string, unknown> {
    return this.trocador.publico({
      sombra: this.d.sombra,
      nuvem: { ligada: this.comNuvem, online: this.online, computadorId: this.estado.nuvem.computadorId },
      cofre: !!this.chave,
      conexoes: this.logins.publico(),
    });
  }

  alvoPonte() {
    return {
      ativa: () => {
        const e = this.estado;
        const c = e.ativa ? e.contas[e.ativa] : undefined;
        return { slug: e.ativa, email: c?.email ?? null, versao: e.versao, trocadaEm: e.trocadaEm };
      },
      estado: () => this.publico(),
      medida: (corpo: Record<string, unknown>): Resposta => {
        const entrou = this.trocador.medidaDaSessao(corpo);
        if (entrou) this.fundo(this.comNuvem ? this.relatarUso() : this.agir());
        return { status: 200, corpo: { ok: true } };
      },
      limite: (corpo: Record<string, unknown>): Resposta => {
        const r = this.trocador.limiteDaSessao(corpo);
        const sessao = String(corpo.sessao ?? "").slice(0, 80);
        if (sessao) this.contador.marcarParada(sessao);
        this.salvar();
        if (r.anotado) this.fundo(this.limiteDepois(sessao));
        return { status: 200, corpo: { ok: true, versao: r.versao } };
      },
      fila: (sessao: string, acao: string): Resposta => {
        for (const f of this.estado.fila) {
          if (f.sessao !== sessao) continue;
          f.estado = acao === "descartar" ? "descartada" : "retomada";
          if (acao === "retomada") this.trocador.evento("retomada", `A sessão ${sessao.slice(0, 8)} voltou a trabalhar na conta nova.`, { sessao });
        }
        this.salvar();
        return { status: 200, corpo: { ok: true } };
      },
      trocar: async (corpo: Record<string, unknown>): Promise<Resposta> => {
        const email = String(corpo.email ?? "").trim().toLowerCase();
        const id = this.trocador.contaPorEmail(email);
        if (!id) return { status: 404, corpo: { ok: false, erro: "conta desconhecida neste computador" } };
        if (this.comNuvem && corpo.local !== true) {
          return { status: 409, corpo: { ok: false, erro: "com a nuvem ligada, quem decide a conta é o painel (Trocar agora); use --local para forçar" } };
        }
        if (this.d.sombra) return { status: 409, corpo: { ok: false, erro: "modo sombra: o agente não troca" } };
        const r = await this.trocador.trocar(id, "pedido pela linha de comando");
        return { status: r.ok ? 200 : 400, corpo: { ok: r.ok, erro: r.erro ?? null } };
      },
      atualizar: async (): Promise<Resposta> => {
        await this.atualizarTudo();
        return { status: 200, corpo: { ok: true } };
      },
      conectar: (corpo: Record<string, unknown>): Resposta => {
        if (this.d.sombra) return { status: 409, corpo: { ok: false, erro: "modo sombra: o agente não conecta conta" } };
        const email = typeof corpo.email === "string" && corpo.email.trim() ? corpo.email.trim().toLowerCase() : null;
        if (email !== null && !EMAIL_VALIDO.test(email)) return { status: 400, corpo: { ok: false, erro: "e-mail inválido" } };
        const l = this.logins.iniciar(email);
        return { status: 200, corpo: { ok: true, id: l.id } };
      },
      adotar: async (): Promise<Resposta> => {
        const id = await this.trocador.conferirPrincipal();
        this.salvar();
        return { status: 200, corpo: { ok: !!id, conta: id ? this.estado.contas[id]!.email : null } };
      },
      som: async (corpo: Record<string, unknown>): Promise<Resposta> => {
        if (typeof corpo.ligado === "boolean") {
          this.estado.config.som = corpo.ligado;
          this.salvar();
        }
        const tocou = corpo.testar === true ? await this.somDaTroca(true) : null;
        return { status: 200, corpo: { ok: true, ligado: this.estado.config.som !== false, tocou } };
      },
    };
  }

  /** O limite de uma sessão decide na hora: na nuvem (agente_limite) ou aqui, sem nuvem. */
  private async limiteDepois(sessao: string): Promise<void> {
    if (this.d.sombra) {
      this.d.log.faria(`avisar o limite da sessão ${sessao.slice(0, 8)} e trocar de conta`);
      return;
    }
    if (!this.comNuvem) return this.agir(true);
    const ativa = this.estado.ativa;
    const contaId = ativa ? this.estado.contas[ativa]?.contaId : null;
    if (!contaId) return;
    try {
      await this.d.nuvem!.limite(contaId, sessao || null);
      await this.busca();
    } catch (e) {
      this.d.log.erro(`avisar o limite à nuvem: ${(e as Error).message}`);
    }
  }
}

const SESSAO_VALIDA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A pasta em que a sessão rodou, pelo campo `cwd` da transcrição em ~/.claude/projects/<pasta>/<sessão>.jsonl. */
export function cwdDaSessao(projetos: string, sessao: string): string | null {
  if (!SESSAO_VALIDA.test(sessao)) return null;
  let pastas: string[];
  try {
    pastas = fs.readdirSync(projetos);
  } catch {
    return null;
  }
  for (const p of pastas) {
    const arq = path.join(projetos, p, `${sessao}.jsonl`);
    if (!fs.existsSync(arq)) continue;
    const fd = fs.openSync(arq, "r");
    try {
      const buf = Buffer.alloc(256 * 1024);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      for (const linha of buf.subarray(0, n).toString("utf8").split("\n")) {
        try {
          const j = JSON.parse(linha) as { cwd?: unknown; sessionId?: unknown };
          if (typeof j.cwd === "string" && path.isAbsolute(j.cwd) && (j.sessionId === sessao)) return j.cwd;
        } catch {
          /* linha cortada no fim do pedaço lido */
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  }
  return null;
}
