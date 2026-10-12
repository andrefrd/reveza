// Alertas do Reveza: o pg_cron chama a cada minuto ({acao: "enviar"}) e à meia-noite UTC ({acao: "resumo"}), com o
// segredo do cron. O administrador chama {acao: "testar", alerta_id} para mandar uma mensagem de teste.
// Canais: telegram, ntfy, e-mail (Resend), webhook (assinado) e push do celular (Web Push com VAPID, sem conteúdo).
import { ambiente, bearer, comCors, duasEtapasOk, hex, iguais, resposta, rpc, urlExterna, usuario, type Ambiente } from "../_comum/comum.ts";

export interface Evento { id: number; tipo: string; texto: string; dados: Record<string, any> }
export interface Canal { id: string; canal: string; destino: Record<string, any>; tem_segredo: boolean; eventos: string[] }

export function chaveDoEvento(e: Evento): string {
  if (e.tipo === "alerta") return String(e.dados?.motivo ?? "alerta");
  return e.tipo; // troca, limite
}

export async function assinatura(corpo: string, segredo: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "sha256=" + hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(corpo)));
}

function b64url(bytes: Uint8Array | ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// JWT ES256 do VAPID (a chave privada vem como JWK em VAPID_PRIVADA).
export async function vapidJwt(endpoint: string, jwkPrivada: JsonWebKey, contato: string): Promise<string> {
  const chave = await crypto.subtle.importKey("jwk", jwkPrivada, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const cab = b64url(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const carga = b64url(new TextEncoder().encode(JSON.stringify({
    aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: contato,
  })));
  const assin = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, chave, new TextEncoder().encode(`${cab}.${carga}`));
  return `${cab}.${carga}.${b64url(assin)}`;
}

async function segredo(amb: Ambiente, c: Canal): Promise<string> {
  return c.tem_segredo ? String(await rpc(amb, "servico_segredo_alerta", { p_alerta: c.id }) ?? "") : "";
}

// Um destino que cai (DNS, conexão recusada, demora) não derruba os outros nem o resto do lote: o cursor dos alertas já
// andou quando o lote sai do banco, então um erro solto aqui perdia todos os eventos seguintes (auditoria, 11/10/2026).
export const ESPERA_ENVIO_MS = 10_000;
const prazo = () => AbortSignal.timeout(ESPERA_ENVIO_MS);

export async function tentar(envio: () => Promise<boolean>): Promise<boolean> {
  try {
    return await envio();
  } catch {
    return false;
  }
}

export async function enviarCanal(amb: Ambiente, c: Canal, titulo: string, texto: string, f: typeof fetch = fetch): Promise<boolean> {
  const s = await segredo(amb, c);
  let r: Response | null = null;
  if (c.canal === "telegram") {
    r = await f(`https://api.telegram.org/bot${s}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: c.destino.chat_id, text: `${titulo}\n${texto}` }), signal: prazo(),
    });
  } else if (c.canal === "ntfy") {
    const servidor = String(c.destino.servidor ?? "https://ntfy.sh").replace(/\/+$/, "");
    if (!urlExterna(servidor)) return false;
    r = await f(`${servidor}/${encodeURIComponent(s)}`, { method: "POST", headers: { Title: titulo }, body: texto, redirect: "manual", signal: prazo() });
  } else if (c.canal === "email") {
    r = await f("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${s}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: c.destino.de, to: [c.destino.para], subject: titulo, text: texto }), signal: prazo(),
    });
  } else if (c.canal === "webhook") {
    if (!urlExterna(String(c.destino.url ?? ""))) return false;
    const corpo = JSON.stringify({ titulo, texto, em: new Date().toISOString() });
    r = await f(String(c.destino.url), {
      method: "POST", headers: { "Content-Type": "application/json", "X-Reveza-Assinatura": await assinatura(corpo, s) }, body: corpo,
      redirect: "manual", signal: prazo(),
    });
  } else if (c.canal === "push") {
    return enviarPush(amb, f);
  }
  return !!r && r.ok;
}

export async function enviarPush(amb: Ambiente, f: typeof fetch = fetch): Promise<boolean> {
  const env = (globalThis as any).Deno?.env;
  const publica = env?.get("VAPID_PUBLICA");
  const privada = env?.get("VAPID_PRIVADA");
  if (!publica || !privada) return false;
  const q = await f(`${amb.url}/rest/v1/push_inscricoes?select=id,endpoint`, {
    headers: { apikey: amb.servico, Authorization: `Bearer ${amb.servico}` },
  });
  const lista: { id: string; endpoint: string }[] = await q.json();
  let algum = false;
  for (const i of lista) {
    if (!urlExterna(i.endpoint)) continue;
    const ok = await tentar(async () => {
      const jwt = await vapidJwt(i.endpoint, JSON.parse(privada), env.get("REVEZA_SITE") ?? "mailto:reveza@exemplo.invalid");
      const r = await f(i.endpoint, {
        method: "POST", headers: { TTL: "86400", Authorization: `vapid t=${jwt}, k=${publica}` }, redirect: "manual", signal: prazo(),
      });
      if (r.status === 404 || r.status === 410) {
        await f(`${amb.url}/rest/v1/push_inscricoes?id=eq.${i.id}`, {
          method: "DELETE", headers: { apikey: amb.servico, Authorization: `Bearer ${amb.servico}` },
        });
      }
      return r.ok;
    });
    algum = algum || ok;
  }
  return algum;
}

export async function enviarPendentes(amb: Ambiente, f: typeof fetch = fetch): Promise<{ eventos: number; envios: number }> {
  const p = await rpc(amb, "alertas_pendentes", { p_limite: 50 });
  let envios = 0;
  for (const e of p.eventos as Evento[]) {
    const chave = chaveDoEvento(e);
    for (const c of p.canais as Canal[]) {
      if (c.eventos.includes(chave) && (await tentar(() => enviarCanal(amb, c, "Reveza AI", e.texto, f)))) envios++;
    }
    for (const w of p.webhooks as { id: string; url: string; eventos: string[] }[]) {
      if (!w.eventos.includes(chave) && !w.eventos.includes("*")) continue;
      if (!urlExterna(w.url)) continue;
      const enviado = await tentar(async () => {
        const s = String(await rpc(amb, "servico_segredo_webhook", { p_webhook: w.id }) ?? "");
        const corpo = JSON.stringify({ evento: chave, tipo: e.tipo, texto: e.texto, dados: e.dados, id: e.id });
        const r = await f(w.url, {
          method: "POST", headers: { "Content-Type": "application/json", "X-Reveza-Assinatura": await assinatura(corpo, s) }, body: corpo,
          redirect: "manual", signal: prazo(),
        });
        return r.ok;
      });
      if (enviado) envios++;
    }
  }
  return { eventos: p.eventos.length, envios };
}

export function textoResumo(r: any): string {
  const usd = Number(r.usd ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const contas = (r.contas ?? []).map((c: any) => `${c.email}: ${c.pct == null ? "sem leitura" : Math.round(c.pct) + "%"}`).join("\n");
  return `Hoje: US$ ${usd} equivalentes, ${r.trocas ?? 0} troca(s), ${r.agentes ?? 0} agente(s).\n${contas}`;
}

export async function tratar(req: Request, amb: Ambiente, segredoCron: string): Promise<Response> {
  if (req.method !== "POST") return resposta({ ok: false, erro: "use POST" }, 405);
  let corpo: any = {};
  try { corpo = await req.json(); } catch { /* vazio */ }
  const doCron = await iguais(req.headers.get("x-reveza-cron") ?? "", segredoCron);

  if (doCron && corpo.acao === "enviar") {
    await rpc(amb, "vigiar", {});
    return resposta({ ok: true, ...(await enviarPendentes(amb, amb.fetch ?? fetch)) });
  }
  if (doCron && corpo.acao === "resumo") {
    const r = await rpc(amb, "resumo_dia", {});
    const p = await rpc(amb, "alertas_pendentes", { p_limite: 0 });
    let envios = 0;
    for (const c of p.canais as Canal[]) {
      if (c.eventos.includes("resumo_dia") && (await tentar(() => enviarCanal(amb, c, "Reveza AI · resumo do dia", textoResumo(r), amb.fetch ?? fetch)))) envios++;
    }
    return resposta({ ok: true, envios });
  }
  if (corpo.acao === "testar_webhook") {
    const quem = await usuario(amb, bearer(req));
    if (!quem || !(await duasEtapasOk(amb, quem)) || (await rpc(amb, "servico_papel", { p_user: quem.id })) !== "admin") {
      return resposta({ ok: false, erro: "só administrador com duas etapas" }, 403);
    }
    const w = await rpc(amb, "servico_webhook", { p_id: String(corpo.webhook_id ?? "") }).catch(() => null);
    if (!w || !w.ativo || !w.tem_segredo) return resposta({ ok: false, erro: "webhook desconhecido, desligado ou sem segredo" }, 404);
    if (!urlExterna(w.url)) return resposta({ ok: false, erro: "o endereço precisa ser https e público" }, 400);
    const s = String(await rpc(amb, "servico_segredo_webhook", { p_webhook: w.id }) ?? "");
    const texto = JSON.stringify({ evento: "teste", tipo: "teste", texto: "Se chegou, o webhook está certo.", dados: {}, id: 0 });
    const r = await (amb.fetch ?? fetch)(w.url, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Reveza-Assinatura": await assinatura(texto, s) }, body: texto,
      redirect: "manual",
    }).catch(() => null);
    return resposta({ ok: !!r && r.ok, status: r ? r.status : null }, r && r.ok ? 200 : 502);
  }
  if (corpo.acao === "testar") {
    const quem = await usuario(amb, bearer(req));
    if (!quem || !(await duasEtapasOk(amb, quem)) || (await rpc(amb, "servico_papel", { p_user: quem.id })) !== "admin") {
      return resposta({ ok: false, erro: "só administrador com duas etapas" }, 403);
    }
    const p = await rpc(amb, "alertas_pendentes", { p_limite: 0 });
    const c = (p.canais as Canal[]).find((x) => x.id === corpo.alerta_id);
    if (!c) return resposta({ ok: false, erro: "alerta desconhecido ou desligado" }, 404);
    const ok = await enviarCanal(amb, c, "Reveza AI · teste", "Se chegou, o canal está certo.", amb.fetch ?? fetch);
    return resposta({ ok }, ok ? 200 : 502);
  }
  return resposta({ ok: false, erro: "não autorizado" }, 401);
}

if ((globalThis as any).Deno) {
  const env = (globalThis as any).Deno.env;
  (globalThis as any).Deno.serve(comCors((req: Request) => tratar(req, ambiente(), env.get("REVEZA_CRON") ?? "")));
}
