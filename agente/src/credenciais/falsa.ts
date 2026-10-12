// Credenciais em memória, para os testes. Nada aqui toca chaveiro ou arquivo de verdade.

import { clonar } from "../util/arquivos.js";
import type { Blob } from "./blob.js";
import { PRINCIPAL, type Credenciais } from "./tipos.js";

export class CredenciaisFalsas implements Credenciais {
  readonly tipo = "falsa" as const;
  d = new Map<string, Blob>();
  gravacoes: string[] = [];
  falharGravacao = false;

  nome(entrada: string): string {
    return entrada === PRINCIPAL ? "principal" : `pasta:${entrada}`;
  }

  async ler(entrada: string): Promise<Blob | null> {
    const v = this.d.get(entrada);
    return v ? clonar(v) : null;
  }

  async gravar(entrada: string, blob: Blob): Promise<void> {
    if (this.falharGravacao) throw new Error("falha simulada");
    this.gravacoes.push(entrada);
    this.d.set(entrada, clonar(blob));
  }

  async apagar(entrada: string): Promise<void> {
    this.d.delete(entrada);
  }

  /** Atalho dos testes: lê na hora, sem promessa. */
  agora(entrada: string): Blob | undefined {
    return this.d.get(entrada);
  }

  token(entrada: string): string | undefined {
    return this.d.get(entrada)?.claudeAiOauth?.accessToken;
  }
}

