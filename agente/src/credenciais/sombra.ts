// Modo sombra: lê das credenciais de verdade, mas nenhuma gravação passa. Cada tentativa vai ao log como "faria".
// É a segunda trava: a primeira é o agente nem chegar a tentar (troca e renovação recusam antes, no modo sombra).

import type { Log } from "../util/log.js";
import type { Blob } from "./blob.js";
import type { Credenciais } from "./tipos.js";

export class CredenciaisSombra implements Credenciais {
  readonly tipo = "sombra" as const;
  bloqueadas = 0;
  constructor(
    private base: Credenciais,
    private log: Log,
  ) {}

  nome(entrada: string): string {
    return this.base.nome(entrada);
  }

  ler(entrada: string): Promise<Blob | null> {
    return this.base.ler(entrada);
  }

  lerEstrito(entrada: string): Promise<Blob | null> {
    return this.base.lerEstrito ? this.base.lerEstrito(entrada) : this.base.ler(entrada);
  }

  async gravar(entrada: string): Promise<void> {
    this.bloqueadas += 1;
    this.log.faria(`gravar a credencial ${this.base.nome(entrada)}`);
  }

  async apagar(entrada: string): Promise<void> {
    this.bloqueadas += 1;
    this.log.faria(`apagar a credencial ${this.base.nome(entrada)}`);
  }
}
