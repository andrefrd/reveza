// Convite para o time: o administrador (com duas etapas) convida; a pessoa aceita depois de entrar pelo link.
import { aleatorioHex, ambiente, bearer, comCors, resposta, rpc, sha256Hex, usuario, type Ambiente } from "../_comum/comum.ts";

export async function tratar(req: Request, amb: Ambiente, site: string): Promise<Response> {
  const origem = req.headers.get("origin") ?? undefined;
  if (req.method === "OPTIONS") return resposta({}, 204, origem);
  if (req.method !== "POST") return resposta({ ok: false, erro: "use POST" }, 405, origem);
  const token = bearer(req);
  const quem = await usuario(amb, token);
  if (!quem) return resposta({ ok: false, erro: "entre de novo" }, 401, origem);
  let corpo: any = {};
  try { corpo = await req.json(); } catch { /* vazio */ }

  if (corpo.acao === "enviar") {
    const email = String(corpo.email ?? "").trim().toLowerCase();
    const papel = corpo.papel === "admin" ? "admin" : "leitura";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return resposta({ ok: false, erro: "e-mail inválido" }, 400, origem);
    const segredo = aleatorioHex(32);
    try {
      // Como o próprio administrador: a função do banco confere o papel e a verificação em duas etapas.
      await rpc(amb, "painel_convidar", { p_email: email, p_papel: papel, p_token_hash: await sha256Hex(segredo) }, token);
    } catch (e) {
      return resposta({ ok: false, erro: (e as Error).message }, 403, origem);
    }
    const f = amb.fetch ?? fetch;
    const r = await f(`${amb.url}/auth/v1/invite`, {
      method: "POST",
      headers: { apikey: amb.servico, Authorization: `Bearer ${amb.servico}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email, redirect_to: `${site}/aceitar?convite=${segredo}` }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      return resposta({ ok: false, erro: `o e-mail não saiu: ${d.msg ?? d.message ?? r.status}` }, 502, origem);
    }
    return resposta({ ok: true }, 200, origem);
  }

  if (corpo.acao === "aceitar") {
    const segredo = String(corpo.convite ?? "");
    if (!/^[0-9a-f]{64}$/.test(segredo)) return resposta({ ok: false, erro: "convite inválido" }, 400, origem);
    const r = await rpc(amb, "convite_aceitar", { p_user: quem.id, p_email: quem.email, p_token_hash: await sha256Hex(segredo) });
    return resposta(r, r.ok ? 200 : 400, origem);
  }

  return resposta({ ok: false, erro: "ação desconhecida" }, 400, origem);
}

if ((globalThis as any).Deno) {
  (globalThis as any).Deno.serve(comCors((req: Request) => tratar(req, ambiente(), (globalThis as any).Deno.env.get("REVEZA_SITE") ?? "")));
}
