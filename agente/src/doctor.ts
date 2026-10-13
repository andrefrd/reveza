// `reveza doctor`: confere serviço, mod, credenciais, chaveiro, nuvem, relógio e a versão do assistente.
// Aqui só se lê: cada problema sai com o conserto seguro que existe para ele (`conserto`, da lista fechada de
// conserto.ts) ou com o que a pessoa faz (`fazer`, uma linha). Quem conserta é o `consertar()` de conserto.ts.
// Saída legível e `--json` (o mesmo resultado, só lido, vai à nuvem no `agente_ola`, para a tela Saúde do painel).

import * as fs from "node:fs";
import * as path from "node:path";
import type { ApiContas } from "./anthropic.js";
import type { Cli } from "./claudecli.js";
import { VERSAO, type Caminhos } from "./config.js";
import { expiraEm, oauth } from "./credenciais/blob.js";
import { PRINCIPAL, type Credenciais } from "./credenciais/tipos.js";
import type { Guarda } from "./cofre/guarda.js";
import { lerChave } from "./ligar.js";
import type { StatusServico } from "./servico.js";
import { carregarEstado } from "./estado.js";

export type Situacao = "ok" | "aviso" | "falha";

/** Os únicos consertos automáticos que existem (lista fechada; nada vindo da nuvem entra aqui). */
export type IdConserto = "servico" | "mod" | "credenciais";

export interface Conferencia {
  id: string;
  nome: string;
  situacao: Situacao;
  detalhe: string;
  /** Problema com conserto automático seguro: qual. */
  conserto?: IdConserto;
  /** Problema sem conserto automático: o que fazer, em uma linha. */
  fazer?: string;
  /** Depois de um conserto (`reveza doctor`, ou o Corrigir do painel): o que aconteceu com este problema. */
  consertado?: { resultado: "corrigido" | "nao_deu"; texto: string };
}

export interface DepsDoctor {
  c: Caminhos;
  cred: Credenciais;
  guarda: Guarda;
  cli: Cli;
  api: ApiContas;
  statusServico: () => Promise<StatusServico>;
  ponte: () => Promise<Record<string, unknown> | null>;
  nuvemConfigurada: () => Promise<{ url: string } | null>;
  horaNuvem: () => Promise<number | null>;
  agora: () => number;
  versaoNode?: string;
  /** Versão mínima do assistente com a qual o agente foi provado. */
  versaoMinimaCli?: string;
  /**
   * Onde a conferência roda: no terminal (`reveza doctor`, que pode reinstalar o serviço) ou dentro do próprio agente
   * (o Corrigir do painel: o agente não reinicia a si mesmo, então serviço, ponte e nuvem ficam só explicados).
   */
  onde?: "terminal" | "agente";
  /** Instalação em modo sombra: o mod fica de fora de propósito. */
  sombra?: boolean;
  /** Instalação feita com `--sem-servico`: o serviço não é instalado sozinho. */
  semServico?: boolean;
  /** Bytes livres no disco da pasta do usuário (testes); de fábrica, lido do sistema. */
  espacoLivre?: () => number;
}

/** Abaixo disto o disco vira aviso, e abaixo de DISCO_FALHA, falha: com o disco cheio nada do agente se grava. */
export const DISCO_AVISO = 5 * 1024 ** 3;
export const DISCO_FALHA = 2 * 1024 ** 3;

export function espacoLivreEm(pasta: string): number {
  const s = fs.statfsSync(pasta);
  return Number(s.bavail) * Number(s.bsize);
}

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1).replace(".", ",")} GB`;
}

/** O comando de instalar o assistente de código (a única menção ao nome fica na instalação e nos requisitos). */
export const INSTALAR_ASSISTENTE = "npm install -g @anthropic-ai/claude-code (ou https://claude.com/claude-code)";

export function compararVersao(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** O mod está carregado? Por CLAUDE_CODE_PLUGIN_DIRS no settings.json ou instalado como plugin. */
export function acharMod(home: string): string | null {
  const nomeDoMod = (pasta: string) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(pasta, ".claude-plugin", "plugin.json"), "utf8")).name === "reveza";
    } catch {
      return false;
    }
  };
  try {
    const s = JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));
    const dirs = String(s?.env?.CLAUDE_CODE_PLUGIN_DIRS ?? "")
      .split(path.delimiter)
      .map((d) => d.replace(/^~/, home))
      .filter(Boolean);
    const achado = dirs.find(nomeDoMod);
    if (achado) return achado;
  } catch {
    // sem settings
  }
  try {
    const inst = JSON.parse(fs.readFileSync(path.join(home, ".claude", "plugins", "installed_plugins.json"), "utf8"));
    const chaves = Object.keys(inst?.plugins ?? inst ?? {});
    const k = chaves.find((x) => x === "reveza" || x.startsWith("reveza@"));
    if (k) return `plugin instalado (${k})`;
  } catch {
    // nenhum plugin instalado
  }
  return null;
}

export async function doctor(d: DepsDoctor): Promise<Conferencia[]> {
  const r: Conferencia[] = [];
  const add = (id: string, nome: string, situacao: Situacao, detalhe: string, extra: { conserto?: IdConserto; fazer?: string } = {}) => {
    const c: Conferencia = { id, nome, situacao, detalhe };
    // ok não precisa de conserto nem de explicação
    if (situacao !== "ok") {
      if (extra.conserto) c.conserto = extra.conserto;
      else if (extra.fazer) c.fazer = extra.fazer;
    }
    r.push(c);
  };
  const noTerminal = (d.onde ?? "terminal") === "terminal";
  // serviço, ponte e nuvem se consertam reiniciando o serviço: só pelo terminal, e nunca numa instalação sem serviço
  const peloServico = (fazerSemServico: string): { conserto?: IdConserto; fazer?: string } =>
    d.semServico
      ? { fazer: "esta instalação roda sem serviço (--sem-servico): rode reveza rodar, ou reveza servico instalar para o agente subir sozinho" }
      : noTerminal
        ? { conserto: "servico" }
        : { fazer: fazerSemServico };

  const node = d.versaoNode ?? process.versions.node;
  add("agente", "Agente", compararVersao(node, "18.17.0") >= 0 ? "ok" : "falha", `versão ${VERSAO}, Node ${node}`, {
    fazer: "instale um Node mais novo (20.19 ou depois, https://nodejs.org) e rode o instalador com --atualizar",
  });

  try {
    const livre = d.espacoLivre ? d.espacoLivre() : espacoLivreEm(d.c.home);
    add("disco", "Disco", livre < DISCO_FALHA ? "falha" : livre < DISCO_AVISO ? "aviso" : "ok", `${gb(livre)} livres`, {
      fazer: "libere espaço neste computador: com o disco cheio, o agente não grava o estado nem o uso das contas, e o assistente de código também para",
    });
  } catch (e) {
    add("disco", "Disco", "aviso", `não consegui conferir: ${(e as Error).message}`, { fazer: "confira o espaço livre do disco deste computador" });
  }

  try {
    const s = await d.statusServico();
    add(
      "servico",
      "Serviço",
      s.rodando ? "ok" : s.instalado ? "aviso" : "falha",
      s.instalado ? s.detalhe : "não instalado (reveza servico instalar)",
      peloServico("o agente roda fora do serviço: no terminal deste computador, rode reveza doctor (ou reveza servico instalar)"),
    );
  } catch (e) {
    add("servico", "Serviço", "aviso", `não consegui conferir: ${(e as Error).message}`, peloServico("no terminal deste computador, rode reveza doctor"));
  }

  const resposta = await d.ponte().catch(() => null);
  // outro programa na mesma porta (um gestor de contas antigo, por exemplo) responde, mas não é o agente
  const ehAgente = !!resposta && "cofre" in resposta && "nuvem" in resposta;
  const ponte = ehAgente ? resposta : null;
  add(
    "ponte",
    "Ponte local",
    ponte ? "ok" : "falha",
    ponte ? "o agente responde na porta local" : resposta ? "outro programa responde na porta do agente (use --porta, ou o modo sombra)" : "o agente não responde (está rodando?)",
    resposta
      ? { fazer: "pare o outro programa que usa a porta do agente, ou instale o Reveza em modo sombra (--sombra)" }
      : peloServico("no terminal deste computador, rode reveza doctor"),
  );

  const mod = acharMod(d.c.home);
  const assistente = await d.cli.versao().catch(() => null);
  add(
    "mod",
    "Mod das sessões",
    mod ? "ok" : "aviso",
    mod ? mod : d.sombra ? "fora no modo sombra (dois mods nas mesmas sessões disputariam a linha de status)" : "o mod não está carregado nas sessões (uso ao vivo e retomada ficam sem)",
    d.sombra
      ? { fazer: "o mod entra quando sair do modo sombra: rode o instalador com --atualizar --sair-da-sombra" }
      : !assistente
        ? { fazer: `instale o assistente de código primeiro: ${INSTALAR_ASSISTENTE}` }
        : { conserto: "mod" },
  );

  const estado = carregarEstado(d.c.estado);
  const contas = Object.values(estado.contas);
  const nuvem = await d.nuvemConfigurada().catch(() => null);
  // tem para onde trocar: com nuvem, a conta que ela atribuir (vem do cofre); sem nuvem, uma conta daqui com login
  const temConta = !!nuvem || contas.some((c) => !c.precisaLogin && !c.pausada);
  const credencialConserto: { conserto?: IdConserto; fazer?: string } = temConta
    ? { conserto: "credenciais" }
    : contas.length
      ? { fazer: "nenhuma conta com login neste computador: entre de novo numa delas (reveza contas conectar <email>)" }
      : { fazer: "conecte uma conta neste computador: reveza contas conectar <email>" };
  try {
    const blob = await d.cred.ler(PRINCIPAL);
    const o = oauth(blob);
    // a conta que a nuvem mandou está para chegar (o agente acabou de subir, ou a troca vem na próxima busca): aviso,
    // não falha; o conserto (pedir a troca agora) segue valendo
    const esperando = (ponte?.credencial as { esperandoConta?: unknown } | undefined)?.esperandoConta === true;
    if (!o.accessToken && esperando) {
      add("credenciais", "Credencial em uso", "aviso", `nenhum login em ${d.cred.nome(PRINCIPAL)}; esperando a conta que a nuvem mandou chegar`, credencialConserto);
    } else if (!o.accessToken) add("credenciais", "Credencial em uso", "falha", `nenhum login em ${d.cred.nome(PRINCIPAL)}`, credencialConserto);
    else {
      const falta = expiraEm(blob) - d.agora();
      const perfil = await d.api.perfil(o.accessToken);
      const quem = perfil.perfil?.email ?? (perfil.status ? `perfil respondeu ${perfil.status}` : "sem rede para conferir o perfil");
      // dentro da validade e recusado: o login foi revogado (vencido, a API recusa sempre: não diz nada)
      const recusado = falta > 0 && (perfil.status === 401 || perfil.status === 403);
      // vencido e sem renovação: o assistente não consegue usá-lo de jeito nenhum
      const morto = falta <= 0 && !o.refreshToken;
      add(
        "credenciais",
        "Credencial em uso",
        morto ? "falha" : falta > 0 && !recusado ? "ok" : "aviso",
        `${quem}; token ${falta > 0 ? `vence em ${Math.round(falta / 60)} min` : morto ? "vencido e sem conserto pelas sessões" : "vencido (as sessões renovam na próxima chamada)"}`,
        morto
          ? credencialConserto
          : recusado
            ? { fazer: "o login em uso foi recusado: entre de novo nessa conta pelo painel (Contas, Entrar de novo)" }
            : { fazer: "nada a fazer agora: a próxima chamada das sessões renova o login" },
      );
    }
  } catch (e) {
    add("credenciais", "Credencial em uso", "falha", `não consegui ler: ${(e as Error).message}`, {
      fazer: "o chaveiro do sistema não respondeu: destrave-o (ou reinicie a sessão do usuário) e confira de novo",
    });
  }

  const semLogin: string[] = [];
  for (const c of contas) if (!(await d.cred.ler(c.pasta).catch(() => null)) && c.id !== estado.ativa) semLogin.push(c.email);
  const precisam = contas.filter((c) => c.precisaLogin).map((c) => c.email);
  add(
    "contas",
    "Contas",
    !contas.length ? "aviso" : semLogin.length || precisam.length ? "aviso" : "ok",
    !contas.length
      ? "nenhuma conta conectada"
      : `${contas.length} conta(s)` +
          (precisam.length ? `; precisam entrar de novo: ${precisam.join(", ")}` : "") +
          (semLogin.length ? `; sem login guardado: ${semLogin.join(", ")}` : ""),
    {
      fazer: !contas.length
        ? nuvem
          ? "as contas chegam pela nuvem quando ela atribuir uma a este computador; para uma nova: Contas, Conectar, no painel"
          : "conecte uma conta: reveza contas conectar <email>"
        : "entre de novo nessas contas pelo painel (Contas, Entrar de novo) ou com reveza contas conectar <email>",
    },
  );

  try {
    const k = await lerChave(d.guarda);
    add(
      "chaveiro",
      "Chaveiro e cofre",
      d.guarda.aviso ? "aviso" : k ? "ok" : "aviso",
      `${d.guarda.tipo}${k ? ", chave do cofre presente" : ", sem a chave do cofre (reveza ligar)"}${d.guarda.aviso ? `. ${d.guarda.aviso}` : ""}`,
      {
        fazer: !k
          ? "ligue este computador ao cofre pelo painel (Computadores, Ligar computador novo) ou com reveza ligar"
          : (d.guarda.aviso ?? undefined),
      },
    );
  } catch (e) {
    add("chaveiro", "Chaveiro e cofre", "falha", `não consegui ler: ${(e as Error).message}`, {
      fazer: "o chaveiro do sistema não respondeu: destrave-o (ou reinicie a sessão do usuário) e confira de novo",
    });
  }

  let horaServidor: number | null = null;
  if (!nuvem) {
    add("nuvem", "Nuvem", "aviso", "sem nuvem configurada: o agente decide sozinho neste computador", {
      fazer: "para ter o painel: rode o instalador com --com-nuvem (ou --ligar, para entrar numa instalação que já existe)",
    });
  } else {
    horaServidor = await d.horaNuvem().catch(() => null);
    const online = (ponte?.nuvem as Record<string, unknown> | undefined)?.online;
    add(
      "nuvem",
      "Nuvem",
      horaServidor !== null && online !== false ? "ok" : "falha",
      `${nuvem.url}${horaServidor === null ? " não responde" : " responde"}${online === false ? "; o agente está sem falar com ela" : ""}`,
      horaServidor === null
        ? { fazer: "confira a internet deste computador; com ela funcionando, veja se o projeto no Supabase está ativo" }
        : peloServico("no terminal deste computador, rode reveza doctor"),
    );
  }

  if (horaServidor !== null) {
    const desvio = Math.abs(horaServidor - d.agora());
    add("relogio", "Relógio", desvio <= 120 ? "ok" : "falha", `diferença de ${desvio} s para o servidor${desvio > 120 ? " (acerte o relógio: comandos expiram e o login confere a hora)" : ""}`, {
      fazer: "acerte a data e a hora do sistema (ligue o acerto automático pela internet); o Reveza não mexe nisso",
    });
  } else {
    add("relogio", "Relógio", "aviso", "sem servidor para comparar", { fazer: "confere quando a nuvem responder" });
  }

  const minima = d.versaoMinimaCli ?? "2.1.0";
  const v = assistente;
  add(
    "assistente",
    "Assistente de código",
    !v ? "falha" : compararVersao(v, minima) >= 0 ? "ok" : "aviso",
    v ? `versão ${v}${compararVersao(v, minima) < 0 ? ` (o agente foi provado a partir da ${minima})` : ""}` : `não achei o programa em ${d.cli.binario()}`,
    { fazer: v ? `atualize o assistente de código: claude update (ou ${INSTALAR_ASSISTENTE})` : `instale o assistente de código: ${INSTALAR_ASSISTENTE}` },
  );
  return r;
}

export function textoDoctor(r: Conferencia[]): string {
  const marca: Record<Situacao, string> = { ok: "ok   ", aviso: "aviso", falha: "FALHA" };
  const linhas = r.map((c) => {
    const depois = c.consertado
      ? c.consertado.resultado === "corrigido"
        ? ` → corrigido: ${c.consertado.texto}`
        : ` → não deu: ${c.consertado.texto}`
      : c.situacao !== "ok" && c.fazer
        ? ` → o que fazer: ${c.fazer}`
        : c.situacao !== "ok" && c.conserto
          ? " → tem conserto: rode reveza doctor (sem --so-ver)"
          : "";
    return `${marca[c.situacao]}  ${c.nome.padEnd(22)} ${c.detalhe}${depois}`;
  });
  const falhas = r.filter((c) => c.situacao === "falha").length;
  const avisos = r.filter((c) => c.situacao === "aviso").length;
  const corrigidos = r.filter((c) => c.consertado?.resultado === "corrigido").length;
  const naoDeu = r.filter((c) => c.consertado?.resultado === "nao_deu").length;
  linhas.push("", falhas ? `${falhas} falha(s), ${avisos} aviso(s).` : avisos ? `Tudo funcionando, com ${avisos} aviso(s).` : "Tudo certo.");
  if (corrigidos || naoDeu) linhas.push(`Conserto: ${corrigidos} corrigido(s), ${naoDeu} não deu.`);
  return linhas.join("\n");
}
