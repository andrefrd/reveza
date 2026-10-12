// O conteúdo de uma entrada de credencial do assistente e as regras sobre ele.

import { createHash } from "node:crypto";

export interface Oauth {
  accessToken?: string;
  refreshToken?: string;
  /** Epoch em milissegundos. */
  expiresAt?: number;
  subscriptionType?: string;
  rateLimitTier?: string;
  scopes?: string[];
  [k: string]: unknown;
}

export type Blob = Record<string, unknown> & { claudeAiOauth?: Oauth; organizationUuid?: string };

/** O que é da CONTA na entrada. O resto (mcpOAuth, os logins dos servidores MCP) é da máquina e fica onde está. */
export const CHAVES_DO_LOGIN = ["claudeAiOauth", "organizationUuid"] as const;

export function soLogin(blob: Blob | null | undefined): Blob {
  const saida: Blob = {};
  if (!blob || typeof blob !== "object") return saida;
  for (const k of CHAVES_DO_LOGIN) if (k in blob) (saida as Record<string, unknown>)[k] = blob[k];
  return saida;
}

/** A entrada `base` com o login trocado pelo de `login`; o resto de `base` fica. */
export function comLogin(base: Blob | null | undefined, login: Blob): Blob {
  const novo: Blob = base && typeof base === "object" ? { ...base } : {};
  for (const k of CHAVES_DO_LOGIN) delete novo[k];
  return { ...novo, ...soLogin(login) };
}

export function oauth(blob: Blob | null | undefined): Oauth {
  const o = blob?.claudeAiOauth;
  return o && typeof o === "object" ? o : {};
}

export function hashToken(blob: Blob | null | undefined): string | null {
  const tok = oauth(blob).accessToken;
  return tok ? createHash("sha256").update(tok).digest("hex").slice(0, 16) : null;
}

/** Validade do token de acesso, em epoch segundos (0 quando não há). */
export function expiraEm(blob: Blob | null | undefined): number {
  const e = oauth(blob).expiresAt;
  return typeof e === "number" ? Math.floor(e / 1000) : 0;
}

export function temRenovacao(blob: Blob | null | undefined): boolean {
  return !!oauth(blob).refreshToken;
}

/** Nome da entrada do chaveiro que o assistente usa para uma pasta de configuração (macOS). */
export const SERVICO_PRINCIPAL = "Claude Code-credentials";

export function servicoDaPasta(pasta: string): string {
  return `${SERVICO_PRINCIPAL}-${createHash("sha256").update(pasta).digest("hex").slice(0, 8)}`;
}
