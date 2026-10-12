// `reveza doctor`: confere serviço, mod, credenciais, chaveiro, nuvem, relógio e a versão do assistente.
// Só lê. Saída legível e `--json` (o mesmo resultado vai à nuvem no `agente_ola`, para a tela Saúde do painel).

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

export interface Conferencia {
  id: string;
  nome: string;
  situacao: Situacao;
  detalhe: string;
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
}

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
  const add = (id: string, nome: string, situacao: Situacao, detalhe: string) => r.push({ id, nome, situacao, detalhe });

  const node = d.versaoNode ?? process.versions.node;
  add("agente", "Agente", compararVersao(node, "18.17.0") >= 0 ? "ok" : "falha", `versão ${VERSAO}, Node ${node}`);

  try {
    const s = await d.statusServico();
    add("servico", "Serviço", s.rodando ? "ok" : s.instalado ? "aviso" : "falha", s.instalado ? s.detalhe : "não instalado (reveza servico instalar)");
  } catch (e) {
    add("servico", "Serviço", "aviso", `não consegui conferir: ${(e as Error).message}`);
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
  );

  const mod = acharMod(d.c.home);
  add("mod", "Mod das sessões", mod ? "ok" : "aviso", mod ? mod : "o mod não está carregado nas sessões (uso ao vivo e retomada ficam sem)");

  try {
    const blob = await d.cred.ler(PRINCIPAL);
    const o = oauth(blob);
    if (!o.accessToken) add("credenciais", "Credencial em uso", "falha", `nenhum login em ${d.cred.nome(PRINCIPAL)}`);
    else {
      const falta = expiraEm(blob) - d.agora();
      const perfil = await d.api.perfil(o.accessToken);
      const quem = perfil.perfil?.email ?? (perfil.status ? `perfil respondeu ${perfil.status}` : "sem rede para conferir o perfil");
      add(
        "credenciais",
        "Credencial em uso",
        falta > 0 ? "ok" : "aviso",
        `${quem}; token ${falta > 0 ? `vence em ${Math.round(falta / 60)} min` : "vencido (as sessões renovam na próxima chamada)"}`,
      );
    }
  } catch (e) {
    add("credenciais", "Credencial em uso", "falha", `não consegui ler: ${(e as Error).message}`);
  }

  const estado = carregarEstado(d.c.estado);
  const contas = Object.values(estado.contas);
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
  );

  try {
    const k = await lerChave(d.guarda);
    add(
      "chaveiro",
      "Chaveiro e cofre",
      d.guarda.aviso ? "aviso" : k ? "ok" : "aviso",
      `${d.guarda.tipo}${k ? ", chave do cofre presente" : ", sem a chave do cofre (reveza ligar)"}${d.guarda.aviso ? `. ${d.guarda.aviso}` : ""}`,
    );
  } catch (e) {
    add("chaveiro", "Chaveiro e cofre", "falha", `não consegui ler: ${(e as Error).message}`);
  }

  const nuvem = await d.nuvemConfigurada().catch(() => null);
  let horaServidor: number | null = null;
  if (!nuvem) add("nuvem", "Nuvem", "aviso", "sem nuvem configurada: o agente decide sozinho neste computador");
  else {
    horaServidor = await d.horaNuvem().catch(() => null);
    const online = (ponte?.nuvem as Record<string, unknown> | undefined)?.online;
    add(
      "nuvem",
      "Nuvem",
      horaServidor !== null && online !== false ? "ok" : "falha",
      `${nuvem.url}${horaServidor === null ? " não responde" : " responde"}${online === false ? "; o agente está sem falar com ela" : ""}`,
    );
  }

  if (horaServidor !== null) {
    const desvio = Math.abs(horaServidor - d.agora());
    add("relogio", "Relógio", desvio <= 120 ? "ok" : "falha", `diferença de ${desvio} s para o servidor${desvio > 120 ? " (acerte o relógio: comandos expiram e o login confere a hora)" : ""}`);
  } else {
    add("relogio", "Relógio", "aviso", "sem servidor para comparar");
  }

  const v = await d.cli.versao().catch(() => null);
  const minima = d.versaoMinimaCli ?? "2.1.0";
  add(
    "assistente",
    "Assistente de código",
    !v ? "falha" : compararVersao(v, minima) >= 0 ? "ok" : "aviso",
    v ? `versão ${v}${compararVersao(v, minima) < 0 ? ` (o agente foi provado a partir da ${minima})` : ""}` : `não achei o programa em ${d.cli.binario()}`,
  );
  return r;
}

export function textoDoctor(r: Conferencia[]): string {
  const marca: Record<Situacao, string> = { ok: "ok   ", aviso: "aviso", falha: "FALHA" };
  const linhas = r.map((c) => `${marca[c.situacao]}  ${c.nome.padEnd(22)} ${c.detalhe}`);
  const falhas = r.filter((c) => c.situacao === "falha").length;
  const avisos = r.filter((c) => c.situacao === "aviso").length;
  linhas.push("", falhas ? `${falhas} falha(s), ${avisos} aviso(s).` : avisos ? `Tudo funcionando, com ${avisos} aviso(s).` : "Tudo certo.");
  return linhas.join("\n");
}
