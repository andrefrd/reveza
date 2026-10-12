// Quem pode pedir a atualização da nuvem e o que volta (a parte que roda no Node, nos testes). A entrada da função, com
// a conexão do banco, é o index.ts.
import { bearer, duasEtapasOk, iguais, resposta, rpc, usuario, type Ambiente } from "../_comum/comum.ts";
import { atualizarNuvem, type Banco, type Resultado } from "./logica.ts";

export interface Dependencias {
  comBanco: <T>(fn: (b: Banco) => Promise<T>) => Promise<T>;
  fetch: typeof fetch;
  cron: string;
}

export async function tratar(req: Request, amb: Ambiente, d: Dependencias): Promise<Response> {
  if (req.method !== "POST") return resposta({ ok: false, erro: "use POST" }, 405);
  const corpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const segredo = req.headers.get("x-reveza-cron") ?? "";
  let por: "painel" | "sozinho";
  if (segredo) {
    if (!(await iguais(segredo, d.cron))) return resposta({ ok: false, erro: "não autorizado" }, 401);
    por = "sozinho";
  } else {
    const quem = await usuario(amb, bearer(req));
    if (!quem) return resposta({ ok: false, erro: "entre de novo" }, 401);
    if (!(await duasEtapasOk(amb, quem))) return resposta({ ok: false, erro: "confirme a verificação em duas etapas" }, 403);
    const papel = await rpc(amb, "servico_papel", { p_user: quem.id });
    if (papel !== "admin") return resposta({ ok: false, erro: "só administrador" }, 403);
    if (corpo.acao !== "atualizar") return resposta({ ok: false, erro: "pedido desconhecido" }, 400);
    por = "painel";
  }
  let r: Resultado;
  try {
    r = await d.comBanco((banco) => atualizarNuvem({ banco, fetch: d.fetch, por }));
  } catch (e) {
    // sem banco (a conexão não abriu) não há onde marcar o estado: o painel recebe o motivo
    r = { ok: false, estado: "falhou", motivo: `não consegui falar com o banco (${String((e as Error).message ?? e).slice(0, 150)})` };
  }
  return resposta(r, 200);
}
