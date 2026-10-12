// Cliente do Supabase da instalação. Só usa a URL e a chave pública; o que cada pessoa pode ver e fazer é decidido no
// banco (RLS e as funções painel_*), com o token de quem está logado.

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

let cliente: SupabaseClient | null = null

export function urlSupabase(): string {
  const url = import.meta.env.VITE_SUPABASE_URL ?? ""
  if (!/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+\/?$/i.test(url))
    throw new Error("VITE_SUPABASE_URL inválida: use https://<projeto>.supabase.co")
  return url.replace(/\/$/, "")
}

export function supabase(): SupabaseClient {
  if (cliente) return cliente
  const chave = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ""
  if (!chave) throw new Error("VITE_SUPABASE_ANON_KEY ausente")
  cliente = createClient(urlSupabase(), chave, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // O convite do Auth (mandado pela Edge Function "convite") chega com a sessão no fragmento do endereço:
      // o fluxo implícito é o que entende esse link. A troca de senha por e-mail funciona igual. Só nessas duas
      // páginas a sessão do endereço vale: um link para outra página com a sessão de outra pessoa não a troca.
      detectSessionInUrl: (url, params) =>
        (url.pathname === "/aceitar" || url.pathname === "/nova-senha") &&
        Boolean(params.access_token || params.error_description),
      flowType: "implicit",
      storageKey: "reveza.sessao",
    },
    realtime: { params: { eventsPerSecond: 5 } },
  })
  return cliente
}
