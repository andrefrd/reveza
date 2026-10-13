// O `oauthAccount` do ~/.claude.json diz às sessões de quem é o login. Ele acompanha a troca: a conta que sai leva o
// dela para a pasta da conta, a que entra traz o dela. O arquivo é do assistente e tem muito mais coisa: só a chave
// `oauthAccount` muda, com a mesma trava de diretório que o assistente usa (`<arquivo>.lock`).

import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import type { Relogio } from "./util/tempo.js";
import type { Log } from "./util/log.js";
import { apagarSemErro } from "./util/arquivos.js";

export class ClaudeJson {
  constructor(
    private relogio: Relogio,
    private somenteLeitura = false,
    private log?: Log,
  ) {}

  private async travar(caminho: string): Promise<string | null> {
    const trava = caminho + ".lock";
    for (let i = 0; i < 100; i++) {
      try {
        fs.mkdirSync(trava);
        return trava;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") return null;
        try {
          if (this.relogio.agoraMs() - fs.statSync(trava).mtimeMs > 10_000) {
            fs.rmdirSync(trava);
            continue;
          }
        } catch {
          // sumiu entre uma olhada e outra
        }
        await this.relogio.dormir(100);
      }
    }
    return null;
  }

  lerConta(caminho: string): Record<string, unknown> | null {
    try {
      const v = JSON.parse(fs.readFileSync(caminho, "utf8")).oauthAccount;
      return v && typeof v === "object" ? v : null;
    } catch {
      return null;
    }
  }

  async gravarConta(caminho: string, conta: Record<string, unknown>): Promise<void> {
    if (this.somenteLeitura) {
      this.log?.faria(`gravar o oauthAccount em ${caminho}`);
      return;
    }
    const trava = await this.travar(caminho);
    try {
      let dados: Record<string, unknown> = {};
      let bruto: string | null = null;
      try {
        bruto = fs.readFileSync(caminho, "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      if (bruto !== null) {
        // Arquivo existe e não se lê (o assistente no meio de uma gravação?): não regravar por cima, senão o resto
        // da configuração se perderia. Quem chamou tenta de novo depois.
        const v = JSON.parse(bruto);
        if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${caminho} não é um objeto JSON`);
        dados = v;
      }
      dados.oauthAccount = conta;
      const tmp = `${caminho}.tmp.reveza.${process.pid}.${randomBytes(8).toString("hex")}`;
      try {
        fs.writeFileSync(tmp, JSON.stringify(dados, null, 2), { mode: 0o600, flag: "wx" });
        try {
          fs.chmodSync(tmp, 0o600);
        } catch {
          // Windows
        }
        fs.renameSync(tmp, caminho);
      } catch (e) {
        apagarSemErro(tmp);
        throw e;
      }
    } finally {
      if (trava) {
        try {
          fs.rmdirSync(trava);
        } catch {
          // já saiu
        }
      }
    }
  }

  async copiar(de: string, para: string): Promise<void> {
    const conta = this.lerConta(de);
    if (conta) await this.gravarConta(para, conta);
  }
}
