// Trava assíncrona (fila): quem chega espera quem está dentro terminar. Não é reentrante: quem já está dentro chama
// as versões internas, nunca a pública que pega a trava de novo.

export class Trava {
  private cauda: Promise<void> = Promise.resolve();
  private dentro = 0;

  get ocupada(): boolean {
    return this.dentro > 0;
  }

  async com<T>(fn: () => Promise<T> | T): Promise<T> {
    this.dentro += 1;
    const anterior = this.cauda;
    let soltar!: () => void;
    this.cauda = new Promise<void>((r) => (soltar = r));
    try {
      await anterior;
      return await fn();
    } finally {
      this.dentro -= 1;
      soltar();
    }
  }
}

/** Uma trava por chave (uma por conta). */
export class Travas {
  private mapa = new Map<string, Trava>();

  de(chave: string): Trava {
    let t = this.mapa.get(chave);
    if (!t) {
      t = new Trava();
      this.mapa.set(chave, t);
    }
    return t;
  }
}
