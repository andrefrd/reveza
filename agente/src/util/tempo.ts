// Relógio injetável: o agente inteiro pede a hora e agenda tarefas por aqui, para os testes controlarem o tempo.

export interface Agendado {
  cancelar(): void;
}

export interface Relogio {
  /** Epoch em segundos. */
  agora(): number;
  agoraMs(): number;
  agendar(fn: () => void, ms: number): Agendado;
  dormir(ms: number): Promise<void>;
}

export const relogioReal: Relogio = {
  agora: () => Math.floor(Date.now() / 1000),
  agoraMs: () => Date.now(),
  agendar(fn, ms) {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return { cancelar: () => clearTimeout(t) };
  },
  dormir: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export function isoParaEpoch(valor: unknown): number | null {
  if (typeof valor === "number" && Number.isFinite(valor)) return Math.floor(valor);
  if (typeof valor !== "string" || !valor) return null;
  const ms = Date.parse(valor);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

export function epochParaIso(epoch: number): string {
  return new Date(epoch * 1000).toISOString();
}
