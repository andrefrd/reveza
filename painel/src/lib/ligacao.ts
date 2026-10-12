// Frase de ligação de computador novo, sem a frase passar em claro pela nuvem.
//
// O navegador cria um par de chaves efêmero (ECDH P-256) e manda só a chave pública ao computador que já tem a chave
// do cofre (comando "ligar"). O computador gera as 6 palavras, publica a chave do cofre embrulhada por elas (scrypt,
// 10 minutos) e devolve as palavras cifradas para a chave pública deste navegador (ECDH + HKDF-SHA256 + AES-256-GCM).
// A nuvem só vê texto cifrado; a chave privada nunca sai da memória desta aba.

const INFO = new TextEncoder().encode("reveza-ligacao-v1")
const SAL = new TextEncoder().encode("reveza-ligacao-sal-v1")
const AAD = new TextEncoder().encode("reveza-ligacao")

export interface Envelope {
  /** Chave pública efêmera de quem cifrou. */
  efemera: JsonWebKey
  iv: string
  cifrado: string
}

export interface PedidoLigacao {
  publica: JsonWebKey
  privada: CryptoKey
}

function b64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ""
  for (const b of u8) s += String.fromCharCode(b)
  return btoa(s)
}

function deB64(texto: string): Uint8Array<ArrayBuffer> {
  const s = atob(texto)
  const u8 = new Uint8Array(new ArrayBuffer(s.length))
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i)
  return u8
}

const ECDH = { name: "ECDH", namedCurve: "P-256" } as const

function publicaLimpa(jwk: JsonWebKey): JsonWebKey {
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true }
}

export async function criarPedido(): Promise<PedidoLigacao> {
  const par = await crypto.subtle.generateKey(ECDH, false, ["deriveBits"])
  const publica = await crypto.subtle.exportKey("jwk", par.publicKey)
  return { publica: publicaLimpa(publica), privada: par.privateKey }
}

async function chaveSimetrica(privada: CryptoKey, publicaJwk: JsonWebKey): Promise<CryptoKey> {
  const publica = await crypto.subtle.importKey("jwk", publicaLimpa(publicaJwk), ECDH, false, [])
  const segredo = await crypto.subtle.deriveBits({ name: "ECDH", public: publica }, privada, 256)
  const base = await crypto.subtle.importKey("raw", segredo, "HKDF", false, ["deriveKey"])
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: SAL, info: INFO },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  )
}

/** O lado do computador (o agente faz o mesmo em Node). Aqui serve à demonstração e aos testes. */
export async function cifrarParaNavegador(publicaNavegador: JsonWebKey, conteudo: unknown): Promise<Envelope> {
  const par = await crypto.subtle.generateKey(ECDH, true, ["deriveBits"])
  const chave = await chaveSimetrica(par.privateKey, publicaNavegador)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const dados = new TextEncoder().encode(JSON.stringify(conteudo))
  const cifrado = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, chave, dados)
  const efemera = await crypto.subtle.exportKey("jwk", par.publicKey)
  return { efemera: publicaLimpa(efemera), iv: b64(iv), cifrado: b64(cifrado) }
}

export async function abrirEnvelope<T = unknown>(privada: CryptoKey, envelope: Envelope): Promise<T> {
  const chave = await chaveSimetrica(privada, envelope.efemera)
  const claro = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: deB64(envelope.iv), additionalData: AAD },
    chave,
    deB64(envelope.cifrado)
  )
  return JSON.parse(new TextDecoder().decode(claro)) as T
}

/** Confere a forma da frase: 6 palavras de letras minúsculas. */
export function fraseValida(palavras: unknown): palavras is string[] {
  return (
    Array.isArray(palavras) &&
    palavras.length === 6 &&
    palavras.every((p) => typeof p === "string" && /^[a-z]{3,12}$/.test(p))
  )
}

/**
 * Código de acesso de um computador novo: endereço da nuvem, chave pública, e-mail e senha da identidade dele, num
 * texto só para colar no instalador (`--ligar`). Leva a senha: aparece uma vez e não vai para lugar nenhum além da tela.
 */
export interface AcessoComputador {
  u: string
  k: string
  e: string
  s: string
}

export function codigoDeAcesso(a: AcessoComputador): string {
  const bytes = new TextEncoder().encode(JSON.stringify(a))
  return "rvzpc_" + b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function lerCodigoDeAcesso(codigo: string): AcessoComputador | null {
  const m = /^rvzpc_([A-Za-z0-9_-]+)$/.exec(codigo.trim())
  if (!m) return null
  try {
    const t = m[1]!.replace(/-/g, "+").replace(/_/g, "/")
    const a = JSON.parse(new TextDecoder().decode(deB64(t + "=".repeat((4 - (t.length % 4)) % 4)))) as AcessoComputador
    return a && typeof a.u === "string" && typeof a.k === "string" && typeof a.e === "string" && typeof a.s === "string" ? a : null
  } catch {
    return null
  }
}

/**
 * Código de ligação de um passo só: o acesso do computador novo e as 6 palavras juntos, para o instalador do computador
 * novo não perguntar mais nada. Leva a senha do computador e a frase: aparece uma vez, vale 10 minutos (a frase), e não
 * vai para lugar nenhum além da tela.
 */
export function codigoDeLigacao(a: AcessoComputador, palavras: string[]): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ ...a, f: palavras.join(" ") }))
  return "rvzl_" + b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/**
 * O código curto que o computador mostra na janela de confirmação: sai da chave pública deste navegador. É o mesmo
 * cálculo do agente (agente/src/ligar.ts, codigoDeConfirmacao); pedido forjado vem com outra chave e outro código.
 */
export async function codigoDeConfirmacao(publica: JsonWebKey): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`reveza-ligar-v1.${publica.x}.${publica.y}`)))
  const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  let r = ""
  for (let i = 0; i < 4; i++) r += ALFABETO[h[i]! % ALFABETO.length]
  return r
}
