// O programa do assistente, chamado pelo agente: versão, login oficial numa pasta de conta, renovação de conta
// parada e retomada de sessão de terminal. Sempre com o ambiente limpo (sem variáveis da sessão de quem chamou).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { envDaPasta, type Executor, type Processo } from "./util/executor.js";

export interface Cli {
  binario(): string;
  versao(): Promise<string | null>;
  /** Tenta renovar o login da pasta: `auth status` e, se precisar, um `-p` curto. Quem confere se renovou é quem chama. */
  renovar(pasta: string, tentativa: 0 | 1): Promise<void>;
  login(pasta: string, email: string | null): Processo;
  retomar(sessao: string, cwd: string, texto: string, saida: number): void;
}

// No Windows, o "claude.cmd" do npm é um script de lote: rodá-lo exigiria o interpretador de comandos (e o Node novo
// recusa). Em vez disso, achamos o programa que ele chama e o rodamos sem shell: o .exe direto (o pacote do npm de hoje
// traz o binário nativo, `bin/claude.exe`) ou o .js com o próprio Node (o pacote antigo, `cli.js`).
export function programaDoCmd(cmd: string): string | null {
  try {
    const texto = fs.readFileSync(cmd, "utf8");
    const m = /"%~?dp0%?\\([^"%]+?\.(?:c?js|mjs|exe))"/i.exec(texto);
    if (!m) return null;
    const alvo = path.join(path.dirname(cmd), ...m[1]!.split("\\"));
    return fs.statSync(alvo).isFile() ? alvo : null;
  } catch {
    return null;
  }
}

export function acharBinario(env: NodeJS.ProcessEnv = process.env, home = os.homedir(), plataforma = process.platform): string {
  const nomes = plataforma === "win32" ? ["claude.exe", "claude.cmd"] : ["claude"];
  for (const dir of (env.PATH || "").split(path.delimiter)) {
    for (const n of nomes) {
      const c = path.join(dir, n);
      try {
        if (!fs.statSync(c).isFile()) continue;
        if (n.endsWith(".cmd")) {
          const alvo = programaDoCmd(c);
          if (alvo) return alvo;
          continue;
        }
        return c;
      } catch {
        // segue
      }
    }
  }
  return path.join(home, ".local", "bin", plataforma === "win32" ? "claude.exe" : "claude");
}

export class ClaudeCli implements Cli {
  private bin: string;
  constructor(
    private exec: Executor,
    bin?: string,
  ) {
    this.bin = bin ?? acharBinario();
  }

  binario(): string {
    return this.bin;
  }

  async versao(): Promise<string | null> {
    const r = await this.exec.rodar([this.bin, "--version"], { timeoutMs: 20_000 });
    const m = /(\d+\.\d+\.\d+)/.exec(r.saida);
    return r.codigo === 0 && m ? m[1]! : null;
  }

  async renovar(pasta: string, tentativa: 0 | 1): Promise<void> {
    const argv =
      tentativa === 0
        ? [this.bin, "auth", "status", "--json"]
        : [this.bin, "-p", "--model", "haiku", "--max-turns", "1", "--strict-mcp-config", "--output-format", "json", "Responda apenas: ok"];
    await this.exec.rodar(argv, { cwd: pasta, env: envDaPasta(pasta), timeoutMs: 120_000 });
  }

  login(pasta: string, email: string | null): Processo {
    const argv = [this.bin, "auth", "login", "--claudeai"];
    if (email) argv.push("--email", email);
    return this.exec.iniciar(argv, { cwd: pasta, env: envDaPasta(pasta) });
  }

  retomar(sessao: string, cwd: string, texto: string, saida: number): void {
    // ambiente limpo como o da renovação (sem ANTHROPIC_* nem CLAUDE_CODE_* de quem rodou o agente) e sem
    // CLAUDE_CONFIG_DIR: a sessão continua na conta que acabou de entrar, com a configuração padrão do usuário
    const env = envDaPasta("", process.env);
    delete env.CLAUDE_CONFIG_DIR;
    this.exec.iniciar([this.bin, "--resume", sessao, "-p", texto], { cwd, env, solto: { saida } });
  }
}
