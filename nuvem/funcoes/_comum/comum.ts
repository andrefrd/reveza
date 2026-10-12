// Partes comuns das Edge Functions do Reveza (copiado para dentro de cada função na publicação).
// Sem nada do Deno aqui: roda também no Node, para os testes.

export const SITE = (globalThis as any).Deno?.env.get("REVEZA_SITE") ?? "";

export function cabecalhos(origem?: string, site: string = SITE): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (origem && site && origem === site) {
    h["Access-Control-Allow-Origin"] = site;
    h["Access-Control-Allow-Headers"] = "authorization, apikey, content-type, x-client-info";
    h["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS";
    h["Access-Control-Max-Age"] = "600";
    h["Vary"] = "Origin";
  }
  return h;
}

// 204 e 304 não podem ter corpo: com corpo, o Response quebra e a função devolve 500.
export function resposta(dados: unknown, status = 200, origem?: string): Response {
  const semCorpo = status === 204 || status === 304;
  return new Response(semCorpo ? null : JSON.stringify(dados), { status, headers: cabecalhos(origem) });
}

// Funções chamadas pelo navegador (o painel fica em outro domínio): responde a consulta prévia (OPTIONS) e põe o
// CORS em toda resposta, só para a origem do painel (REVEZA_SITE). Outra origem não recebe CORS e o navegador barra.
export function comCors(tratar: (req: Request) => Promise<Response>, site: string = SITE): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const origem = req.headers.get("origin") ?? undefined;
    const cors = Object.entries(cabecalhos(origem, site)).filter(([k]) => k.startsWith("Access-Control") || k === "Vary");
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: Object.fromEntries(cors) });
    const r = await tratar(req);
    if (!cors.length) return r;
    const h = new Headers(r.headers);
    for (const [k, v] of cors) h.set(k, v);
    return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
  };
}

export function hex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(texto: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)));
}

export function aleatorioHex(n = 32): string {
  return hex(crypto.getRandomValues(new Uint8Array(n)));
}

// Igualdade em tempo constante (resumos de mesmo tamanho).
export async function iguais(a: string, b: string): Promise<boolean> {
  if (!a || !b) return false;
  const [x, y] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}

// Lê o payload do JWT do usuário SEM confiar nele: a validade é conferida no /auth/v1/user antes.
export function payloadJwt(token: string): Record<string, unknown> {
  const parte = token.split(".")[1] ?? "";
  const b64 = parte.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((parte.length + 3) % 4);
  try {
    return JSON.parse(atob(b64));
  } catch {
    return {};
  }
}

export function bearer(req: Request): string {
  const h = req.headers.get("authorization") ?? "";
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
}

export interface Ambiente {
  url: string;      // https://<ref>.supabase.co
  anon: string;
  servico: string;
  fetch?: typeof fetch;
}

// Quem chama (token do usuário conferido no Auth) e se fez a verificação em duas etapas.
export async function usuario(amb: Ambiente, token: string): Promise<{ id: string; email: string; aal2: boolean } | null> {
  if (!token) return null;
  const f = amb.fetch ?? fetch;
  const r = await f(`${amb.url}/auth/v1/user`, { headers: { apikey: amb.anon, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  if (!u?.id) return null;
  return { id: u.id, email: String(u.email ?? "").toLowerCase(), aal2: payloadJwt(token).aal === "aal2" };
}

// Chamada de função do banco: como serviço (chave de serviço) ou como o usuário (o token dele).
export async function rpc(amb: Ambiente, funcao: string, args: Record<string, unknown>, tokenUsuario?: string): Promise<any> {
  const f = amb.fetch ?? fetch;
  const chave = tokenUsuario ? amb.anon : amb.servico;
  const r = await f(`${amb.url}/rest/v1/rpc/${funcao}`, {
    method: "POST",
    headers: { apikey: chave, Authorization: `Bearer ${tokenUsuario ?? amb.servico}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) {
    const e = new Error(String(d?.message ?? `falha em ${funcao}`));
    (e as any).status = r.status;
    throw e;
  }
  return d;
}

export function ambiente(): Ambiente {
  const env = (globalThis as any).Deno.env;
  return { url: env.get("SUPABASE_URL"), anon: env.get("SUPABASE_ANON_KEY"), servico: env.get("SUPABASE_SERVICE_ROLE_KEY") };
}

/**
 * Endereço que a nuvem vai chamar (webhook, servidor do ntfy): https, nome público, sem porta estranha, sem usuário
 * na URL e sem IP escrito (127.0.0.1, 169.254.169.254, 0x7f.1, 2130706433...). Mesma regra de rvz_url_externa no banco.
 */
export function urlExterna(endereco: string): boolean {
  if (typeof endereco !== "string" || endereco.length > 500 || !/^https:\/\/[^/\s?#@]+(\/\S*)?$/.test(endereco)) return false;
  let host = endereco.slice("https://".length).split(/[/?#]/)[0]!.toLowerCase();
  if (host.includes(":")) {
    if (!/^[^:[\]]+:443$/.test(host)) return false;
    host = host.replace(/:443$/, "");
  }
  // Só o que o fetch lê igual ao texto: %2e, ponto ideográfico e outros truques viram "127.0.0.1" no parser de URL.
  if (!/^[a-z0-9.-]+$/.test(host)) return false;
  try {
    if (new URL(endereco).hostname !== host) return false;
  } catch {
    return false;
  }
  if (!host.includes(".") || host.endsWith(".") || host.startsWith(".") || host.includes("..")) return false;
  if (/^(0x[0-9a-f]+|[0-9]+)(\.(0x[0-9a-f]+|[0-9]+))*$/.test(host)) return false;
  if (/(^|\.)(localhost|local|internal|lan|home|arpa|corp|intranet)$/.test(host)) return false;
  return true;
}

/**
 * Duas etapas valem para quem chamou? A sessão passou pelo código (aal2), ou a pessoa não ativou e a instalação não
 * exige (a mesma regra de rvz_aal2 no banco, perguntada pela chave de serviço).
 */
export async function duasEtapasOk(amb: Ambiente, quem: { id: string; aal2: boolean }): Promise<boolean> {
  if (quem.aal2) return true;
  return (await rpc(amb, "servico_aal_ok", { p_user: quem.id, p_aal: "aal1" }).catch(() => false)) === true;
}
