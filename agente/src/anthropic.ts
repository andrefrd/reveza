// Os dois endereços de conta que o agente lê com o token de acesso: perfil (de quem é o login) e uso (as janelas).
// São os mesmos que o assistente lê no /usage. Nenhum deles gira o token: ler não queima login.

import { isoParaEpoch } from "./util/tempo.js";

export const TIPOS_JANELA = ["five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet"] as const;
export type TipoJanela = (typeof TIPOS_JANELA)[number];

export const ROTULOS: Record<TipoJanela, string> = {
  five_hour: "5 horas",
  seven_day: "Semana",
  seven_day_opus: "Semana, modelo maior",
  seven_day_sonnet: "Semana, modelo médio",
};

export interface Janela {
  tipo: TipoJanela;
  pct: number | null;
  resetEm: number | null;
}

export interface Perfil {
  accountUuid: string | null;
  email: string | null;
  orgUuid: string | null;
  org: string | null;
  orgTipo: string | null;
  tier: string | null;
}

export interface ApiContas {
  perfil(token: string): Promise<{ status: number; perfil?: Perfil }>;
  uso(token: string): Promise<{ status: number; janelas?: Janela[] }>;
}

const BETA = "oauth-2025-04-20";

export class ApiAnthropic implements ApiContas {
  constructor(
    private versaoCli = "2.1.293",
    private base = "https://api.anthropic.com",
    private f: typeof fetch = fetch,
  ) {}

  private async get(caminho: string, token: string): Promise<{ status: number; j: unknown }> {
    try {
      const r = await this.f(this.base + caminho, {
        headers: {
          Authorization: `Bearer ${token}`,
          "anthropic-beta": BETA,
          "User-Agent": `claude-code/${this.versaoCli}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (r.status !== 200) return { status: r.status, j: null };
      return { status: 200, j: await r.json() };
    } catch {
      return { status: 0, j: null };
    }
  }

  async perfil(token: string) {
    const { status, j } = await this.get("/api/oauth/profile", token);
    if (status !== 200 || !j || typeof j !== "object") return { status };
    return { status: 200, perfil: perfilDaResposta(j as Record<string, unknown>) };
  }

  async uso(token: string) {
    const { status, j } = await this.get("/api/oauth/usage", token);
    if (status !== 200 || !j || typeof j !== "object") return { status };
    return { status: 200, janelas: janelasDaResposta(j as Record<string, unknown>) };
  }
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

export function perfilDaResposta(j: Record<string, unknown>): Perfil {
  const a = (j.account ?? {}) as Record<string, unknown>;
  const o = (j.organization ?? {}) as Record<string, unknown>;
  return {
    accountUuid: texto(a.uuid),
    email: texto(a.email)?.toLowerCase() ?? null,
    orgUuid: texto(o.uuid),
    org: texto(o.name),
    orgTipo: texto(o.organization_type),
    tier: texto(o.rate_limit_tier),
  };
}

export function janelasDaResposta(j: Record<string, unknown>): Janela[] {
  const saida: Janela[] = [];
  for (const tipo of TIPOS_JANELA) {
    const v = j[tipo];
    if (v && typeof v === "object") {
      const pct = (v as Record<string, unknown>).utilization;
      saida.push({
        tipo,
        pct: typeof pct === "number" ? Math.round(pct * 10) / 10 : null,
        resetEm: isoParaEpoch((v as Record<string, unknown>).resets_at),
      });
    }
  }
  return saida;
}
