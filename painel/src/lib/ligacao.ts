// Ligar um computador novo (0.2.0): nenhum segredo passa pela tela do painel.
//
// O painel cria a identidade pendente do computador novo e mostra o código de acesso (rvzc_): o endereço da nuvem, a
// chave pública e o e-mail e a senha dessa identidade. Esse código só deixa o computador novo PEDIR para entrar: a
// nuvem não deixa a identidade pendente fazer mais nada antes de receber a chave do cofre. O computador novo mostra um
// código de 12 caracteres; a pessoa digita esse código num computador que já tem a chave do cofre, que entrega a chave
// cifrada só para o computador novo. O painel só acompanha.

/** A versão do agente que sabe liberar um computador novo pelo código que aparece nele (protocolo 3, 0.4.0: o código não vai à nuvem). */
export const VERSAO_MINIMA_PARA_LIBERAR = "0.4.0"

function b64url(bytes: Uint8Array): string {
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function deB64url(texto: string): Uint8Array {
  const t = texto.replace(/-/g, "+").replace(/_/g, "/")
  const s = atob(t + "=".repeat((4 - (t.length % 4)) % 4))
  const u8 = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i)
  return u8
}

/** Endereço da nuvem, chave pública (anon), e-mail e senha da identidade pendente do computador novo. */
export interface AcessoComputador {
  u: string
  k: string
  e: string
  s: string
}

/** O código que o instalador do computador novo pede (--ligar). Não abre o cofre: só deixa pedir para entrar. */
export function codigoDeAcesso(a: AcessoComputador): string {
  return "rvzc_" + b64url(new TextEncoder().encode(JSON.stringify({ u: a.u, k: a.k, e: a.e, s: a.s })))
}

export function lerCodigoDeAcesso(codigo: string): AcessoComputador | null {
  const m = /^rvzc_([A-Za-z0-9_-]+)$/.exec(codigo.trim())
  if (!m) return null
  try {
    const a = JSON.parse(new TextDecoder().decode(deB64url(m[1]!))) as Partial<AcessoComputador>
    return a && [a.u, a.k, a.e, a.s].every((x) => typeof x === "string" && x) ? (a as AcessoComputador) : null
  } catch {
    return null
  }
}
