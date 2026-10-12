// Transporte de verdade: supabase-js com a identidade própria do computador (usuário do Auth com papel `computador`,
// senha aleatória longa que só existe na guarda deste computador). Carregado só quando a nuvem está configurada.

import { randomBytes } from "node:crypto";
import type { Guarda } from "../cofre/guarda.js";
import { SEGREDO_COMPUTADOR } from "../cofre/guarda.js";
import type { Rpc } from "./rpc.js";
import { ErroNuvem } from "./tipos.js";

export interface IdentidadeComputador {
  url: string;
  chavePublica: string;
  email: string;
  senha: string;
}

export function gerarSenha(): string {
  return randomBytes(48).toString("base64url");
}

export function validarIdentidade(v: unknown): IdentidadeComputador | null {
  if (!v || typeof v !== "object") return null;
  const i = v as Record<string, unknown>;
  if (typeof i.url !== "string" || !/^https:\/\/[^\s/]+/.test(i.url)) return null;
  if (typeof i.chavePublica !== "string" || typeof i.email !== "string" || typeof i.senha !== "string") return null;
  if (i.senha.length < 32) return null;
  return { url: i.url.replace(/\/+$/, ""), chavePublica: i.chavePublica, email: i.email, senha: i.senha };
}

export async function lerIdentidade(guarda: Guarda): Promise<IdentidadeComputador | null> {
  const t = await guarda.ler(SEGREDO_COMPUTADOR);
  if (!t) return null;
  try {
    return validarIdentidade(JSON.parse(t));
  } catch {
    return null;
  }
}

export async function guardarIdentidade(guarda: Guarda, id: IdentidadeComputador): Promise<void> {
  if (!validarIdentidade(id)) throw new Error("identidade do computador inválida (url https, chave pública, e-mail e senha longa)");
  await guarda.gravar(SEGREDO_COMPUTADOR, JSON.stringify(id));
}

function semRede(mensagem: string): boolean {
  return /fetch failed|network|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|timeout|aborted/i.test(mensagem);
}

export async function rpcSupabase(id: IdentidadeComputador, manterSessao = true): Promise<Rpc> {
  const { createClient } = await import("@supabase/supabase-js");
  const cliente = createClient(id.url, id.chavePublica, {
    auth: { persistSession: false, autoRefreshToken: manterSessao, detectSessionInUrl: false },
    global: { headers: { "X-Client-Info": "reveza-agente" } },
  });
  let logado = false;

  async function entrar(): Promise<void> {
    const { error } = await cliente.auth.signInWithPassword({ email: id.email, password: id.senha });
    if (error) throw new ErroNuvem(`login do computador recusado: ${error.message}`, semRede(error.message), "auth");
    logado = true;
  }

  return {
    async chamar(funcao, args) {
      if (!logado) await entrar();
      for (let tentativa = 0; tentativa < 2; tentativa++) {
        const { data, error } = await cliente.rpc(funcao, args);
        if (!error) return data;
        const expirou = /JWT|jwt|PGRST30[0-9]/.test(`${error.code} ${error.message}`);
        if (expirou && tentativa === 0) {
          await entrar();
          continue;
        }
        throw new ErroNuvem(`${funcao}: ${error.message}`, semRede(error.message), error.code);
      }
      throw new ErroNuvem(`${funcao}: sem resposta`, true);
    },
    async horaDoServidor() {
      try {
        const r = await fetch(`${id.url}/auth/v1/health`, {
          headers: { apikey: id.chavePublica },
          signal: AbortSignal.timeout(10_000),
        });
        const data = r.headers.get("date");
        return data ? Math.floor(Date.parse(data) / 1000) : null;
      } catch {
        return null;
      }
    },
  };
}
