// Interface única das credenciais locais. Uma "entrada" é PRINCIPAL (a que as sessões usam) ou o caminho absoluto da
// pasta de uma conta (~/.reveza/contas/<id>).

import type { Blob } from "./blob.js";

export const PRINCIPAL = "principal";

export interface Credenciais {
  readonly tipo: "chaveiro" | "arquivo" | "falsa" | "sombra";
  ler(entrada: string): Promise<Blob | null>;
  /**
   * Como `ler`, mas só devolve null quando a entrada não existe: falha de leitura (chaveiro que não respondeu, arquivo
   * ilegível) vira erro. Usado na troca, para não sobrescrever a principal achando que ela estava vazia.
   */
  lerEstrito?(entrada: string): Promise<Blob | null>;
  /** Grava e confere lendo de volta; erro quando não ficou igual. */
  gravar(entrada: string, blob: Blob): Promise<void>;
  apagar(entrada: string): Promise<void>;
  /** Nome legível da entrada (serviço do chaveiro ou caminho do arquivo), para log e diagnóstico. */
  nome(entrada: string): string;
}
