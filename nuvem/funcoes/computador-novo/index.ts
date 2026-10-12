// Identidade de um computador novo: o administrador (com duas etapas) pede; volta e-mail e senha UMA vez, que o
// instalador guarda no chaveiro do computador. A chave do cofre não passa por aqui (vai pela frase de ligação).
import { ambiente, bearer, comCors, duasEtapasOk, resposta, rpc, usuario, type Ambiente } from "../_comum/comum.ts";

function senhaAleatoria(): string {
  const b = crypto.getRandomValues(new Uint8Array(36));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function tratar(req: Request, amb: Ambiente): Promise<Response> {
  if (req.method !== "POST") return resposta({ ok: false, erro: "use POST" }, 405);
  const quem = await usuario(amb, bearer(req));
  if (!quem) return resposta({ ok: false, erro: "entre de novo" }, 401);
  if (!(await duasEtapasOk(amb, quem))) return resposta({ ok: false, erro: "confirme a verificação em duas etapas" }, 403);
  const papel = await rpc(amb, "servico_papel", { p_user: quem.id });
  if (papel !== "admin") return resposta({ ok: false, erro: "só administrador" }, 403);

  const email = `pc-${crypto.getRandomValues(new Uint32Array(2)).join("")}@computadores.reveza.invalid`;
  const senha = senhaAleatoria();
  const f = amb.fetch ?? fetch;
  const r = await f(`${amb.url}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: amb.servico, Authorization: `Bearer ${amb.servico}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: senha, email_confirm: true }),
  });
  const u = await r.json().catch(() => ({}));
  if (!r.ok || !u.id) return resposta({ ok: false, erro: "não consegui criar a identidade do computador" }, 502);
  const reg = await rpc(amb, "servico_registrar_computador", { p_user: u.id, p_criado_por: quem.id });
  return resposta({ ok: true, email, senha, computador_id: reg?.computador_id ?? null });
}

if ((globalThis as any).Deno) (globalThis as any).Deno.serve(comCors((req: Request) => tratar(req, ambiente())));
