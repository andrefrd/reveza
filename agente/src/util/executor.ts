// Executor de programas: o agente roda `security`, o assistente, o PowerShell etc. só por aqui, para os testes
// trocarem por um falso e nada de verdade rodar.

import { spawn } from "node:child_process";

export interface Resultado {
  codigo: number;
  saida: string;
  erro: string;
}

export interface OpcoesRodar {
  entrada?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  timeoutMs?: number;
}

export interface Processo {
  readonly vivo: boolean;
  escrever(texto: string): boolean;
  aoLinha(fn: (linha: string) => void): void;
  aoFim(fn: (codigo: number) => void): void;
  terminar(): void;
}

export interface OpcoesIniciar {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Processo solto (sobrevive ao agente) com saída num arquivo. */
  solto?: { saida: number };
}

export interface Executor {
  rodar(argv: string[], op?: OpcoesRodar): Promise<Resultado>;
  iniciar(argv: string[], op?: OpcoesIniciar): Processo;
}

/** Programa JavaScript roda com o próprio Node; script de lote do Windows (.cmd/.bat) nunca (precisaria de shell). */
export function semShell(argv: string[]): string[] | null {
  const [bin, ...args] = argv;
  if (!bin) return argv;
  if (/\.(cmd|bat)$/i.test(bin)) return null;
  if (/\.(c?js|mjs)$/i.test(bin)) return [process.execPath, bin, ...args];
  return argv;
}

export const executorReal: Executor = {
  rodar(argvBruto, op = {}) {
    return new Promise((resolve) => {
      const argv = semShell(argvBruto);
      if (!argv) return resolve({ codigo: 126, saida: "", erro: "script de lote (.cmd/.bat) não é executado: precisa de shell" });
      const [bin, ...args] = argv;
      if (!bin) return resolve({ codigo: 127, saida: "", erro: "comando vazio" });
      let saida = "";
      let erro = "";
      let filho;
      try {
        filho = spawn(bin, args, { env: op.env ?? process.env, cwd: op.cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      } catch (e) {
        return resolve({ codigo: 127, saida: "", erro: String(e) });
      }
      const limite = setTimeout(() => filho.kill("SIGKILL"), op.timeoutMs ?? 20_000);
      filho.stdout.on("data", (d: Buffer) => (saida += d.toString("utf8")));
      filho.stderr.on("data", (d: Buffer) => (erro += d.toString("utf8")));
      filho.on("error", (e) => {
        clearTimeout(limite);
        resolve({ codigo: 127, saida, erro: erro + String(e) });
      });
      filho.on("close", (codigo) => {
        clearTimeout(limite);
        resolve({ codigo: codigo ?? 1, saida, erro });
      });
      filho.stdin.on("error", () => undefined);
      if (op.entrada !== undefined) filho.stdin.end(op.entrada);
      else filho.stdin.end();
    });
  },

  iniciar(argvBruto, op = {}) {
    const argv = semShell(argvBruto) ?? [process.execPath, "-e", "process.exit(126)"];
    const [bin, ...args] = argv;
    if (op.solto) {
      const filho = spawn(bin ?? "", args, {
        env: op.env ?? process.env,
        cwd: op.cwd,
        detached: true,
        stdio: ["ignore", op.solto.saida, op.solto.saida],
        windowsHide: true,
      });
      filho.on("error", () => undefined);
      filho.unref();
      return { vivo: false, escrever: () => false, aoLinha: () => undefined, aoFim: () => undefined, terminar: () => undefined };
    }
    const filho = spawn(bin ?? "", args, { env: op.env ?? process.env, cwd: op.cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let vivo = true;
    let resto = "";
    const linhas: ((l: string) => void)[] = [];
    const fins: ((c: number) => void)[] = [];
    const receber = (d: Buffer) => {
      resto += d.toString("utf8");
      const partes = resto.split(/\r?\n/);
      resto = partes.pop() ?? "";
      for (const p of partes) for (const fn of linhas) fn(p);
    };
    filho.stdout?.on("data", receber);
    filho.stderr?.on("data", receber);
    filho.stdin?.on("error", () => undefined);
    const fim = (codigo: number) => {
      if (!vivo) return;
      vivo = false;
      if (resto) for (const fn of linhas) fn(resto);
      for (const fn of fins) fn(codigo);
    };
    filho.on("error", () => fim(127));
    filho.on("close", (c) => fim(c ?? 1));
    return {
      get vivo() {
        return vivo;
      },
      escrever: (texto) => (vivo && filho.stdin ? filho.stdin.write(texto) : false),
      aoLinha: (fn) => void linhas.push(fn),
      aoFim: (fn) => void fins.push(fn),
      terminar: () => void filho.kill("SIGTERM"),
    };
  },
};

/** O ambiente para rodar o assistente numa pasta de conta: sem as variáveis de sessão que vazariam a conta em uso. */
export function envDaPasta(pasta: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    if (k.startsWith("CLAUDE_CODE_") || k.startsWith("ANTHROPIC_") || k === "CLAUDE_CONFIG_DIR") continue;
    env[k] = v;
  }
  env.CLAUDE_CONFIG_DIR = pasta;
  return env;
}
