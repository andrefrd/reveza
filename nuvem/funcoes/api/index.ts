// API pública do Reveza, para script, n8n e integrações. Autentica pela chave pessoal (rvz_...), criada no painel.
//   GET  /api/estado                         escopo ler
//   GET  /api/uso?dias=7                     escopo ler
//   POST /api/trocar   {computador, conta}   escopo trocar (dono administrador)
//   POST /api/config   {chave, valor}        escopo config (só auto e modo; dono administrador)
import { ambiente, bearer, resposta, rpc, type Ambiente } from "../_comum/comum.ts";

export function rota(url: string): string {
  const p = new URL(url).pathname.replace(/\/+$/, "");
  const i = p.indexOf("/api/");
  return i >= 0 ? p.slice(i + 4) : p.endsWith("/api") ? "/" : p;
}

export async function tratar(req: Request, amb: Ambiente): Promise<Response> {
  const chave = bearer(req);
  if (!/^rvz_[a-z0-9]{6}_[0-9a-f]{64}$/.test(chave)) return resposta({ ok: false, erro: "chave de API ausente ou inválida" }, 401);
  const conf = await rpc(amb, "api_conferir_chave", { p_chave: chave });
  if (!conf.ok) return resposta({ ok: false, erro: "chave de API inválida ou revogada" }, 401);
  const escopos: string[] = conf.escopos ?? [];
  const r = rota(req.url);
  const precisa = (e: string) => (escopos.includes(e) ? null : resposta({ ok: false, erro: `a chave não tem o escopo ${e}` }, 403));

  try {
    if (req.method === "GET" && r === "/estado") return precisa("ler") ?? resposta(await rpc(amb, "api_estado", { p_user: conf.user_id }));
    if (req.method === "GET" && r === "/uso") {
      const negado = precisa("ler");
      if (negado) return negado;
      const dias = Math.min(Math.max(Number(new URL(req.url).searchParams.get("dias") ?? 7) || 7, 1), 90);
      const f = amb.fetch ?? fetch;
      const desde = new Date(Date.now() - dias * 86400_000).toISOString();
      const q = await f(`${amb.url}/rest/v1/uso_tokens?select=hora,conta_id,modelo,respostas,entrada,saida,cache_escrita,cache_leitura,usd&hora=gte.${encodeURIComponent(desde)}`, {
        headers: { apikey: amb.servico, Authorization: `Bearer ${amb.servico}` },
      });
      await rpc(amb, "api_estado", { p_user: conf.user_id }); // confere que o dono ainda é membro
      return resposta({ ok: true, dias, linhas: await q.json() });
    }
    if (req.method === "POST" && r === "/trocar") {
      const negado = precisa("trocar");
      if (negado) return negado;
      const c = await req.json();
      return resposta(await rpc(amb, "api_trocar", { p_user: conf.user_id, p_computador: c.computador, p_conta: c.conta }));
    }
    if (req.method === "POST" && r === "/config") {
      const negado = precisa("config");
      if (negado) return negado;
      const c = await req.json();
      return resposta(await rpc(amb, "api_config", { p_user: conf.user_id, p_chave: c.chave, p_valor: c.valor }));
    }
  } catch (e) {
    // a mensagem do banco fica no log da função; quem chama recebe só o tipo do erro
    console.error(`api ${r}: ${(e as Error).message}`);
    const status = (e as any).status === 400 ? 400 : 403;
    return resposta({ ok: false, erro: status === 400 ? "pedido inválido" : "sem permissão para isso" }, status);
  }
  return resposta({ ok: false, erro: "rota desconhecida" }, 404);
}

if ((globalThis as any).Deno) (globalThis as any).Deno.serve((req: Request) => tratar(req, ambiente()));
