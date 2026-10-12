// O que o instalador faz no banco depois de provisionar: configuração da troca, canal de alerta e o comando de prova.
// `consultar(sql)` é a Management API do Supabase (ou, nos testes, um Postgres local com as mesmas migrações).
import { comoAdmin, jsonb, texto, textos, uuid, valor } from "./sql.mjs";

export const MODOS = ["limite", "limiar", "rodizio"];
export const EVENTOS_PADRAO = ["sem_livre", "precisa_login", "computador_parado", "login_vence"];

async function chamar(consultar, adminId, expressao, parametros) {
  const r = valor(await consultar(comoAdmin(adminId, expressao), parametros));
  if (r && r.ok === false) throw new Error(r.erro || "o banco recusou");
  return r;
}

/** Troca automática e modo, pelas mesmas regras do painel (painel_config). */
export async function salvarTroca(consultar, adminId, { auto, modo, aviso, troca, fuso }) {
  if (!MODOS.includes(modo)) throw new Error("modo desconhecido");
  const pares = [["modo", modo]];
  if (modo === "limiar") {
    if (!(aviso >= 1 && troca <= 100 && aviso < troca)) throw new Error("o aviso precisa ser menor que a troca (1 a 100)");
    // o banco exige aviso < troca a cada gravação: a troca vai a 100 antes, e nenhum passo fica invertido
    pares.push(["troca", 100], ["aviso", aviso], ["troca", troca]);
  }
  if (fuso) pares.push(["fuso", fuso]);
  pares.push(["auto", !!auto]);
  for (const [k, v] of pares) await chamar(consultar, adminId, `public.painel_config(${texto(k)}, ${jsonb(v)})`);
}

/** Canal de alerta: o destino vai na tabela e o segredo (token, tópico, chave) no Vault. Devolve o id. */
export async function salvarAlerta(consultar, adminId, { canal, destino, eventos = EVENTOS_PADRAO, segredo }) {
  const r = await chamar(consultar, adminId, `public.painel_alerta(${texto(canal)}, ${jsonb(destino)}, ${textos(eventos)})`);
  if (!r || !r.id) throw new Error("o alerta não foi salvo");
  // o segredo vai como parâmetro, fora do texto do SQL (que pode ficar no histórico de consultas do banco)
  if (segredo) await chamar(consultar, adminId, `public.painel_alerta_segredo(${uuid(r.id)}, $1::text)`, [String(segredo)]);
  return r.id;
}

/** O computador que entrou com esta identidade (depois da primeira busca do agente). */
export async function computadorDoEmail(consultar, email) {
  const r = await consultar(
    `select c.id from public.computadores c join auth.users u on u.id = c.user_id where u.email = ${texto(String(email).toLowerCase())} and not c.revogado`,
  );
  return Array.isArray(r) && r[0] ? r[0].id : null;
}

export async function pedirComando(consultar, adminId, computadorId, acao, corpo = {}) {
  const r = await chamar(consultar, adminId, `public.painel_comando(${uuid(computadorId)}, ${texto(acao)}, ${jsonb(corpo)})`);
  return r.id;
}

export async function estadoComando(consultar, id) {
  if (!Number.isInteger(Number(id))) throw new Error("comando inválido");
  const r = await consultar(`select estado::text as estado, http from public.comandos where id = ${Number(id)}`);
  return Array.isArray(r) && r[0] ? r[0] : null;
}

/** Espera o computador buscar o comando e responder (a busca roda a cada 5 s). */
export async function esperarComando(consultar, id, { tentativas = 15, esperar = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let i = 0; i < tentativas; i++) {
    const e = await estadoComando(consultar, id);
    if (e && e.estado !== "pendente" && e.estado !== "reservado") return e;
    await esperar(2000);
  }
  return null;
}
