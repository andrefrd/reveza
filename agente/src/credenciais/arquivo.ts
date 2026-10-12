// Linux e Windows: o assistente guarda o login em `<pasta de configuração>/.credentials.json`.
// A principal é ~/.claude/.credentials.json; a de cada conta, ~/.reveza/contas/<id>/.credentials.json.
// Gravação atômica, modo 600 no Linux (no Windows vale a ACL do perfil do usuário).

import * as fs from "node:fs";
import * as path from "node:path";
import { gravarJson, igualJson, lerJson } from "../util/arquivos.js";
import type { Blob } from "./blob.js";
import { PRINCIPAL, type Credenciais } from "./tipos.js";

export class CredenciaisArquivo implements Credenciais {
  readonly tipo = "arquivo" as const;
  constructor(private principalDir: string) {}

  nome(entrada: string): string {
    return path.join(entrada === PRINCIPAL ? this.principalDir : entrada, ".credentials.json");
  }

  async ler(entrada: string): Promise<Blob | null> {
    const v = lerJson<Blob>(this.nome(entrada));
    return v && typeof v === "object" ? v : null;
  }

  async lerEstrito(entrada: string): Promise<Blob | null> {
    let texto: string;
    try {
      texto = fs.readFileSync(this.nome(entrada), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
    const v = JSON.parse(texto);
    if (!v || typeof v !== "object") throw new Error(`arquivo ilegível (${this.nome(entrada)})`);
    return v as Blob;
  }

  async gravar(entrada: string, blob: Blob): Promise<void> {
    const arq = this.nome(entrada);
    gravarJson(arq, blob, 0o600);
    if (!igualJson(await this.ler(entrada), blob)) throw new Error(`não consegui gravar ${arq}`);
  }

  async apagar(entrada: string): Promise<void> {
    try {
      fs.unlinkSync(this.nome(entrada));
    } catch {
      // já não existia
    }
  }
}
