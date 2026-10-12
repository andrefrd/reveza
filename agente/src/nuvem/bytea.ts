// Binário pela nuvem: as funções do agente recebem e devolvem base64 (rvz_b64 no banco).

export function paraB64(b: Buffer): string {
  return b.toString("base64");
}

export function deB64(v: unknown): Buffer {
  if (Buffer.isBuffer(v)) return v;
  if (typeof v !== "string") throw new Error("binário inválido vindo da nuvem");
  if (v.startsWith("\\x")) return Buffer.from(v.slice(2), "hex");
  return Buffer.from(v, "base64");
}
