/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL do projeto Supabase da instalação (https://<ref>.supabase.co). */
  readonly VITE_SUPABASE_URL?: string
  /** Chave pública (anon/publishable) do Supabase. Nenhuma outra chave entra no front. */
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** Repositório de onde o instalador é baixado, para os comandos mostrados no painel (ex.: pessoa/reveza). */
  readonly VITE_REVEZA_REPO?: string
  readonly VITE_REVEZA_VERSAO?: string
  /** Chave pública VAPID do push no celular (pública por natureza; a privada fica na Edge Function). */
  readonly VITE_VAPID_PUBLICA?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare const __VERSAO_PAINEL__: string
