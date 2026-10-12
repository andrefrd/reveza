// O agente como serviço do usuário: launchd no macOS, systemd de usuário no Linux, Agendador de Tarefas no Windows.
// Só do usuário (nada de root/administrador): o agente mexe nas credenciais de quem está logado.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Sistema } from "./config.js";
import type { Executor } from "./util/executor.js";

export const ROTULO = "ai.reveza.agente";
export const UNIDADE = "reveza-agente.service";
export const TAREFA = "Reveza AI agente";

export interface OpcoesServico {
  sistema: Sistema;
  home: string;
  exec: Executor;
  node: string;
  script: string;
  logs: string;
  sombra?: boolean;
  porta?: number;
  uid?: number;
  /** Espera entre tentativas (os testes passam uma que não espera). */
  dormir?: (ms: number) => Promise<void>;
}

export interface StatusServico {
  instalado: boolean;
  rodando: boolean;
  detalhe: string;
}

function argumentos(o: OpcoesServico): string[] {
  const a = [o.script, "rodar"];
  if (o.sombra) a.push("--sombra");
  if (o.porta) a.push("--porta", String(o.porta));
  return a;
}

function caminhoPath(o: OpcoesServico): string {
  const dirs = [path.dirname(o.node), path.join(o.home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
  return [...new Set(dirs)].join(":");
}

function xml(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function arquivoPlist(o: OpcoesServico): string {
  return path.join(o.home, "Library", "LaunchAgents", `${ROTULO}.plist`);
}

export function plist(o: OpcoesServico): string {
  const args = [o.node, ...argumentos(o)].map((a) => `    <string>${xml(a)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${ROTULO}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(caminhoPath(o))}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xml(path.join(o.logs, "servico.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(path.join(o.logs, "servico.log"))}</string>
</dict>
</plist>
`;
}

export function arquivoUnidade(o: OpcoesServico): string {
  return path.join(o.home, ".config", "systemd", "user", UNIDADE);
}

function aspasSystemd(a: string): string {
  return `"${a.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function unidade(o: OpcoesServico): string {
  return `[Unit]
Description=Reveza AI: agente de contas
After=network-online.target

[Service]
Type=simple
ExecStart=${[o.node, ...argumentos(o)].map(aspasSystemd).join(" ")}
Environment=${aspasSystemd(`PATH=${caminhoPath(o)}`)}
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
`;
}

export function comandoTarefa(o: OpcoesServico): string[] {
  const tr = [o.node, ...argumentos(o)].map((a) => `"${a}"`).join(" ");
  return ["schtasks", "/Create", "/F", "/TN", TAREFA, "/SC", "ONLOGON", "/RL", "LIMITED", "/TR", tr];
}

function uid(o: OpcoesServico): number {
  return o.uid ?? (typeof process.getuid === "function" ? process.getuid() : 0);
}

export async function instalar(o: OpcoesServico): Promise<string> {
  fs.mkdirSync(o.logs, { recursive: true, mode: 0o700 });
  if (o.sistema === "macos") {
    const arq = arquivoPlist(o);
    const dormir = o.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    fs.mkdirSync(path.dirname(arq), { recursive: true });
    const alvo = `gui/${uid(o)}/${ROTULO}`;
    const fora = await o.exec.rodar(["launchctl", "bootout", alvo]);
    // o bootout termina em segundo plano: carregar de novo antes de o rótulo sair dá "Bootstrap failed: 5"
    if (fora.codigo === 0) {
      for (let i = 0; i < 20 && (await o.exec.rodar(["launchctl", "print", alvo])).codigo === 0; i++) await dormir(250);
    }
    fs.writeFileSync(arq, plist(o), { mode: 0o644 });
    let r = await o.exec.rodar(["launchctl", "bootstrap", `gui/${uid(o)}`, arq]);
    for (let i = 0; i < 4 && r.codigo !== 0; i++) {
      await dormir(1000);
      r = await o.exec.rodar(["launchctl", "bootstrap", `gui/${uid(o)}`, arq]);
    }
    if (r.codigo !== 0) throw new Error(`launchctl bootstrap falhou: ${r.erro.trim() || r.codigo}`);
    return `serviço ${ROTULO} instalado (${arq})`;
  }
  if (o.sistema === "linux") {
    const arq = arquivoUnidade(o);
    fs.mkdirSync(path.dirname(arq), { recursive: true });
    fs.writeFileSync(arq, unidade(o), { mode: 0o644 });
    await o.exec.rodar(["systemctl", "--user", "daemon-reload"]);
    const r = await o.exec.rodar(["systemctl", "--user", "enable", "--now", UNIDADE]);
    if (r.codigo !== 0) throw new Error(`systemctl --user enable falhou: ${r.erro.trim() || r.codigo}`);
    return `serviço ${UNIDADE} instalado (${arq}); para seguir rodando sem sessão aberta: loginctl enable-linger ${os.userInfo().username}`;
  }
  const r = await o.exec.rodar(comandoTarefa(o));
  if (r.codigo !== 0) throw new Error(`schtasks /Create falhou: ${r.erro.trim() || r.saida.trim() || r.codigo}`);
  await o.exec.rodar(["schtasks", "/Run", "/TN", TAREFA]);
  return `tarefa "${TAREFA}" criada (roda ao entrar no Windows)`;
}

export async function remover(o: OpcoesServico): Promise<string> {
  if (o.sistema === "macos") {
    await o.exec.rodar(["launchctl", "bootout", `gui/${uid(o)}/${ROTULO}`]);
    fs.rmSync(arquivoPlist(o), { force: true });
    return `serviço ${ROTULO} removido`;
  }
  if (o.sistema === "linux") {
    await o.exec.rodar(["systemctl", "--user", "disable", "--now", UNIDADE]);
    fs.rmSync(arquivoUnidade(o), { force: true });
    await o.exec.rodar(["systemctl", "--user", "daemon-reload"]);
    return `serviço ${UNIDADE} removido`;
  }
  await o.exec.rodar(["schtasks", "/End", "/TN", TAREFA]);
  await o.exec.rodar(["schtasks", "/Delete", "/F", "/TN", TAREFA]);
  return `tarefa "${TAREFA}" removida`;
}

export async function status(o: OpcoesServico): Promise<StatusServico> {
  if (o.sistema === "macos") {
    const instalado = fs.existsSync(arquivoPlist(o));
    const r = await o.exec.rodar(["launchctl", "print", `gui/${uid(o)}/${ROTULO}`]);
    const rodando = r.codigo === 0 && /state = running/.test(r.saida);
    return { instalado, rodando, detalhe: r.codigo === 0 ? (rodando ? "rodando" : "carregado, parado") : "não carregado" };
  }
  if (o.sistema === "linux") {
    const instalado = fs.existsSync(arquivoUnidade(o));
    const r = await o.exec.rodar(["systemctl", "--user", "is-active", UNIDADE]);
    const estado = r.saida.trim() || "desconhecido";
    return { instalado, rodando: estado === "active", detalhe: estado };
  }
  const r = await o.exec.rodar(["schtasks", "/Query", "/TN", TAREFA, "/FO", "LIST"]);
  const rodando = /Running|Em execu/i.test(r.saida);
  return { instalado: r.codigo === 0, rodando, detalhe: r.codigo === 0 ? (rodando ? "rodando" : "pronta") : "não instalada" };
}
