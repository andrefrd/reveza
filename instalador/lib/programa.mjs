// O programa no computador: cópia do agente e do mod, build, o comando `reveza`, o mod no Claude Code e o serviço.
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";

const WIN = process.platform === "win32";

// Segredos que o instalador pode ter no próprio ambiente (--sim): nunca descem para npm, build ou outro programa.
// REVEZA_CODIGO é o código de acesso do computador (traz a senha da identidade dele) e REVEZA_TELEGRAM_TOKEN, o do bot.
export const SEGREDOS_DO_AMBIENTE = ["SUPABASE_ACCESS_TOKEN", "VERCEL_TOKEN", "REVEZA_ADMIN_SENHA", "REVEZA_SENHA", "REVEZA_RESEND_CHAVE",
  "REVEZA_FRASE", "REVEZA_CODIGO", "REVEZA_TELEGRAM_TOKEN"];

/** O ambiente do instalador sem os segredos, mais o que este filho precisa de verdade. */
export function ambienteLimpo(extra = {}) {
  const e = { ...process.env };
  for (const k of SEGREDOS_DO_AMBIENTE) delete e[k];
  return { ...e, ...extra };
}

/** Roda um programa sem shell (argumentos não passam por interpretação). No Windows, .cmd precisa do shell. */
export function rodar(cmd, args = [], { cwd, mostrar = false, env } = {}) {
  const precisaShell = WIN && !/\.exe$/i.test(cmd);
  const aspas = (a) => (/[\s"&|<>^]/.test(a) ? `"${String(a).replaceAll('"', '\\"')}"` : a);
  const r = precisaShell
    ? spawnSync([cmd, ...args].map(aspas).join(" "), { cwd, shell: true, stdio: mostrar ? "inherit" : "pipe", env: env ?? ambienteLimpo(), encoding: "utf8" })
    : spawnSync(cmd, args, { cwd, stdio: mostrar ? "inherit" : "pipe", env: env ?? ambienteLimpo(), encoding: "utf8" });
  return { ok: r.status === 0, saida: `${r.stdout ?? ""}`, erro: `${r.stderr ?? ""}${r.error ? r.error.message : ""}` };
}

export const existe = (cmd) => (WIN ? rodar("where", [cmd]) : rodar("sh", ["-c", `command -v "$0"`, cmd])).ok;
export const npm = WIN ? "npm.cmd" : "npm";

/** Alguém já escuta na porta (outro gestor de contas, ou o próprio agente)? */
export function portaOcupada(porta, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const s = net.connect({ port: porta, host });
    const fim = (v) => { s.destroy(); resolve(v); };
    s.once("connect", () => fim(true));
    s.once("error", () => fim(false));
    s.setTimeout(800, () => fim(false));
  });
}

// O que vai do repositório para o computador (e o que nunca vai: dependências, builds, capturas, React Bits).
const PECAS = ["agente", "mod", ".claude-plugin", "LICENSE"];
const FORA = ["node_modules", "dist", path.join("mod", ".claude-plugin", "types"), "capturas", ".DS_Store"];

/**
 * Copia o programa para `<app>.novo`, compila o agente e só então troca de lugar com o `<app>` atual (que fica como
 * `<app>.anterior` até a próxima atualização). Instalação que falha no meio não estraga a que estava rodando.
 */
export function instalarPrograma(raiz, app, { log = () => {} } = {}) {
  const novo = `${app}.novo`;
  rmSync(novo, { recursive: true, force: true });
  mkdirSync(novo, { recursive: true });
  for (const p of PECAS) {
    const origem = path.join(raiz, p);
    if (!existsSync(origem)) continue;
    cpSync(origem, path.join(novo, p), {
      recursive: true,
      filter: (f) => !FORA.some((x) => f.split(path.sep).includes(x) || f.endsWith(path.sep + x)),
    });
  }
  const agente = path.join(novo, "agente");
  // Só as versões travadas no package-lock.json (com o resumo de cada pacote) e sem script de instalação de terceiros:
  // o agente guarda a chave do cofre e os logins (auditoria de segurança de 11/10/2026).
  if (!existsSync(path.join(agente, "package-lock.json"))) throw new Error("agente/package-lock.json ausente: a instalação só usa versões travadas");
  log("instalando as dependências do agente (versões travadas)");
  let r = rodar(npm, ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: agente });
  if (!r.ok) throw new Error(`npm install do agente falhou: ${r.erro.slice(-400)}`);
  log("compilando o agente");
  r = rodar(npm, ["run", "build"], { cwd: agente });
  if (!r.ok) throw new Error(`build do agente falhou: ${(r.saida + r.erro).slice(-400)}`);
  if (!existsSync(path.join(agente, "dist", "src", "cli.js"))) throw new Error("o build do agente não gerou dist/src/cli.js");
  const anterior = `${app}.anterior`;
  rmSync(anterior, { recursive: true, force: true });
  if (existsSync(app)) renameSync(app, anterior);
  renameSync(novo, app);
  return path.join(app, "agente", "dist", "src", "cli.js");
}

/** O comando `reveza` em ~/.reveza/bin, apontando para o agente instalado com o Node que rodou o instalador. */
export function criarLancador(bin, cli, node = process.execPath) {
  mkdirSync(bin, { recursive: true });
  if (WIN) {
    const arq = path.join(bin, "reveza.cmd");
    writeFileSync(arq, `@echo off\r\n"${node}" "${cli}" %*\r\n`);
    return arq;
  }
  const arq = path.join(bin, "reveza");
  writeFileSync(arq, `#!/bin/sh\nexec "${node}" "${cli}" "$@"\n`);
  chmodSync(arq, 0o755);
  return arq;
}

/** Linha para o PATH, conforme o shell (o instalador mostra e, com ok da pessoa, acrescenta). */
export function linhaPath(bin, shell = process.env.SHELL || "") {
  if (WIN) return null;
  if (/fish$/.test(shell)) return { arquivo: path.join(process.env.HOME || "", ".config", "fish", "config.fish"), linha: `fish_add_path "${bin}"` };
  const arquivo = /zsh$/.test(shell) ? ".zshrc" : ".bashrc";
  return { arquivo: path.join(process.env.HOME || "", arquivo), linha: `export PATH="${bin}:$PATH"` };
}

export function acrescentarPath(bin) {
  const l = linhaPath(bin);
  if (!l) return false;
  const atual = existsSync(l.arquivo) ? readFileSync(l.arquivo, "utf8") : "";
  if (atual.includes(bin)) return true;
  mkdirSync(path.dirname(l.arquivo), { recursive: true });
  writeFileSync(l.arquivo, `${atual.replace(/\n?$/, "\n")}# Reveza AI\n${l.linha}\n`);
  return true;
}

/** O mod nas sessões: o marketplace é a pasta do programa; a porta acompanha o agente (7789 no modo sombra). */
export function instalarMod(app, { porta = 7788, env } = {}) {
  if (!existe("claude")) return { ok: false, erro: "claude não encontrado no PATH" };
  const r = rodar("claude", ["plugin", "install", "reveza", "--marketplace", app, "--scope", "user", "--config", `porta=${porta}`, "--json", "-y"], { env });
  if (r.ok) return { ok: true };
  if (/already installed|já instalad/i.test(r.saida + r.erro)) {
    const u = rodar("claude", ["plugin", "marketplace", "update", "reveza"], { env });
    const p = rodar("claude", ["plugin", "update", "reveza@reveza"], { env });
    return { ok: u.ok && p.ok, erro: (u.erro + p.erro).trim().slice(-300) };
  }
  return { ok: false, erro: (r.saida + r.erro).trim().slice(-300) };
}

export function removerMod({ env } = {}) {
  if (!existe("claude")) return false;
  const r = rodar("claude", ["plugin", "uninstall", "reveza@reveza", "--scope", "user", "--keep-data"], { env });
  rodar("claude", ["plugin", "marketplace", "remove", "reveza"], { env });
  return r.ok;
}

/** Configuração da troca no estado local (sem nuvem): só mexe na chave `config`, o resto do estado fica. */
export function gravarConfigLocal(arquivoEstado, cfg) {
  let estado = {};
  try { estado = JSON.parse(readFileSync(arquivoEstado, "utf8")); } catch { /* primeira vez */ }
  estado.config = { ...(estado.config || {}), ...cfg };
  if (!estado.formato) estado.formato = 1;
  mkdirSync(path.dirname(arquivoEstado), { recursive: true, mode: 0o700 });
  if (!WIN) chmodSync(path.dirname(arquivoEstado), 0o700);
  const tmp = `${arquivoEstado}.tmp`;
  writeFileSync(tmp, JSON.stringify(estado, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, arquivoEstado);
}

/** O que a instalação lembra para atualizar e conferir depois. Nada de segredo aqui. */
export function lerInstalacao(arquivo) {
  try { return JSON.parse(readFileSync(arquivo, "utf8")); } catch { return null; }
}

export function gravarInstalacao(arquivo, dados) {
  const proibido = /(token|senha|secret|segredo|service_role|sbp_)/i;
  for (const [k, v] of Object.entries(flat(dados))) {
    if (proibido.test(k) || (typeof v === "string" && /^(sbp_|sk-|sb_secret_)/.test(v))) throw new Error(`instalacao.json não guarda segredo (${k})`);
  }
  mkdirSync(path.dirname(arquivo), { recursive: true, mode: 0o700 });
  if (!WIN) chmodSync(path.dirname(arquivo), 0o700);
  writeFileSync(arquivo, JSON.stringify(dados, null, 2) + "\n", { mode: 0o600 });
}

function flat(o, pre = "") {
  const out = {};
  for (const [k, v] of Object.entries(o || {})) {
    if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(out, flat(v, `${pre}${k}.`));
    else out[`${pre}${k}`] = v;
  }
  return out;
}
