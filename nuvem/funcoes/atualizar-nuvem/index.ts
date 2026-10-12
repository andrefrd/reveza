// A nuvem se atualiza sozinha (0.3.0): aplica as migrações da versão oficial mais nova, sem credencial guardada. Quem
// pede: o administrador pelo painel (Atualizar a nuvem) ou o pg_cron, de hora em hora, com o segredo do cron (a escolha
// da instalação diz se e quando: desligada, de madrugada, assim que sair). A regra está em logica.ts; quem pode pedir,
// em tratar.ts.
//
// O banco é alcançado pela conexão que a própria plataforma dá às funções (SUPABASE_DB_URL), com o cliente Postgres que
// o Supabase indica para o Edge Runtime (jsr:@db/postgres, versão travada). Nenhum token de gerência entra aqui.
import { Pool } from "jsr:@db/postgres@0.19.5";
import { ambiente, comCors } from "../_comum/comum.ts";
import type { Banco } from "./logica.ts";
import { tratar, type Dependencias } from "./tratar.ts";

if ((globalThis as any).Deno) {
  const env = (globalThis as any).Deno.env;
  // uma conexão só, aberta quando precisa: a atualização é um passo por vez
  const pool = new Pool(env.get("SUPABASE_DB_URL"), 1, true);
  const comBanco = async <T>(fn: (b: Banco) => Promise<T>): Promise<T> => {
    const c = await pool.connect();
    try {
      return await fn({
        consulta: async (sql: string, parametros?: unknown[]) =>
          (parametros?.length ? await c.queryObject(sql, parametros) : await c.queryObject(sql)).rows as Record<string, unknown>[],
        // várias instruções pelo protocolo simples; queryArray não amarra as colunas da primeira às seguintes
        executar: async (sql: string) => void (await c.queryArray(sql)),
      });
    } finally {
      c.release();
    }
  };
  const deps: Dependencias = { comBanco, fetch, cron: env.get("REVEZA_CRON") ?? "" };
  // se quem chamou desistir de esperar (o navegador fechou), o trabalho segue até o fim
  const atender = (req: Request) => {
    const trabalho = tratar(req, ambiente(), deps);
    (globalThis as any).EdgeRuntime?.waitUntil?.(trabalho.catch(() => undefined));
    return trabalho;
  };
  (globalThis as any).Deno.serve(comCors(atender));
}
