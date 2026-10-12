// Chave do cofre neste computador: criar (primeiro computador), publicar a frase de ligação (quem já tem) e receber
// (computador novo). A chave fica só na guarda do sistema; a frase só na tela de quem liga.

import { createHash, createHmac, webcrypto } from "node:crypto";

type JsonWebKey = webcrypto.JsonWebKey;
import { novaChave, TAMANHO_CHAVE } from "./cofre/cifra.js";
import { desembrulhar, embrulhar, gerarFrase, palavrasDesconhecidas, type Idioma } from "./cofre/frase.js";
import { SEGREDO_COFRE, type Guarda } from "./cofre/guarda.js";
import type { Nuvem } from "./nuvem/tipos.js";

export async function lerChave(guarda: Guarda): Promise<Buffer | null> {
  const t = await guarda.ler(SEGREDO_COFRE);
  if (!t) return null;
  const k = Buffer.from(t, "base64");
  return k.length === TAMANHO_CHAVE ? k : null;
}

/** Impressão da chave (HMAC, 128 bits): a nuvem guarda a da instalação, e só ela; não revela a chave. */
export function impressaoDaChave(k: Buffer): string {
  return createHmac("sha256", k).update("reveza-cofre-impressao-v1").digest("hex").slice(0, 32);
}

/** Cria a chave do cofre se este computador ainda não tem. Devolve se criou. */
export async function iniciarCofre(guarda: Guarda): Promise<boolean> {
  if (await lerChave(guarda)) return false;
  await guarda.gravar(SEGREDO_COFRE, novaChave().toString("base64"));
  return true;
}

export async function publicarLigacao(guarda: Guarda, nuvem: Nuvem, idioma: Idioma = "pt-BR"): Promise<{ frase: string; expiraEm: string | null }> {
  const k = await lerChave(guarda);
  if (!k) throw new Error("este computador não tem a chave do cofre; rode `reveza ligar` num que tenha");
  const frase = gerarFrase(idioma);
  const { embrulho, sal } = embrulhar(k, frase);
  const r = await nuvem.ligacaoPublicar(embrulho, sal);
  if (!r.ok) throw new Error("a nuvem recusou a ligação");
  return { frase, expiraEm: r.expira_em };
}

export async function receberLigacao(guarda: Guarda, nuvem: Nuvem, frase: string): Promise<void> {
  const erradas = palavrasDesconhecidas(frase);
  if (erradas.length) throw new Error(`palavra fora da lista: ${erradas.join(", ")} (confira a digitação)`);
  if (await lerChave(guarda)) throw new Error("este computador já tem a chave do cofre");
  const pacote = await nuvem.ligacaoBuscar();
  if (!pacote) throw new Error("nenhuma ligação aberta (a frase vale 10 minutos; gere outra no computador que já está ligado)");
  let k: Buffer;
  try {
    k = desembrulhar(pacote.embrulho, pacote.sal, frase);
  } catch {
    throw new Error("a frase não abriu a chave; confira as 6 palavras e a ordem");
  }
  // a chave precisa ser a desta instalação (a nuvem guarda a impressão da primeira); outra chave dividiria o cofre
  const daInstalacao = await nuvem.cofreImpressao(null);
  if (daInstalacao && daInstalacao !== impressaoDaChave(k)) {
    throw new Error("a chave recebida não é a desta instalação: gere a frase num computador que já usa o Reveza");
  }
  await guarda.gravar(SEGREDO_COFRE, k.toString("base64"));
  if (!daInstalacao) await nuvem.cofreImpressao(impressaoDaChave(k));
}

// ------------------------------------------------------------------------------------------------ ligar pelo painel
// O navegador manda só a chave pública efêmera dele (ECDH P-256). A frase volta cifrada para ela
// (ECDH + HKDF-SHA256 + AES-256-GCM), com os mesmos rótulos que o painel usa (painel/src/lib/ligacao.ts).
// A nuvem guarda o pedido e a resposta, mas só vê texto cifrado.

export interface EnvelopeNavegador {
  efemera: JsonWebKey;
  iv: string;
  cifrado: string;
}

const ROTULO_INFO = new TextEncoder().encode("reveza-ligacao-v1");
const ROTULO_SAL = new TextEncoder().encode("reveza-ligacao-sal-v1");
const ROTULO_AAD = new TextEncoder().encode("reveza-ligacao");
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

export function chavePublicaDoNavegador(v: unknown): JsonWebKey | null {
  if (!v || typeof v !== "object") return null;
  const j = v as Record<string, unknown>;
  const coord = (x: unknown) => typeof x === "string" && /^[A-Za-z0-9_-]{40,50}$/.test(x);
  if (j.kty !== "EC" || j.crv !== "P-256" || !coord(j.x) || !coord(j.y)) return null;
  return { kty: "EC", crv: "P-256", x: j.x as string, y: j.y as string, ext: true };
}

async function chaveSimetrica(privada: webcrypto.CryptoKey, publica: JsonWebKey): Promise<webcrypto.CryptoKey> {
  const s = webcrypto.subtle;
  const pub = await s.importKey("jwk", publica, ECDH, false, []);
  const segredo = await s.deriveBits({ name: "ECDH", public: pub }, privada, 256);
  const base = await s.importKey("raw", segredo, "HKDF", false, ["deriveKey"]);
  return s.deriveKey({ name: "HKDF", hash: "SHA-256", salt: ROTULO_SAL, info: ROTULO_INFO }, base, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Tamanho do código de confirmação: 6 símbolos de 32 (30 bits). Com 4 (20 bits), achar uma chave com o mesmo código levava ~37 s. */
export const TAMANHO_CODIGO = 6;

/**
 * Código curto que o painel mostra e a pessoa digita na janela de confirmação: sai da chave pública efêmera do
 * navegador que pediu a ligação. Um pedido forjado direto no banco vem com outra chave, e então com outro código; quem
 * lê a chave do pedido verdadeiro no banco e procura uma chave com o mesmo código precisa de ~2^30 tentativas (horas
 * de CPU, para um pedido que vence em 2 minutos), e um pedido junto com outro derruba os dois (agente.ts).
 */
export function codigoDeConfirmacao(publica: JsonWebKey): string {
  const h = createHash("sha256").update(`reveza-ligar-v1.${publica.x}.${publica.y}`).digest();
  const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O e 1/I, que se confundem na tela
  let r = "";
  for (let i = 0; i < TAMANHO_CODIGO; i++) r += ALFABETO[h[i]! % ALFABETO.length];
  return r;
}

export async function cifrarParaNavegador(publica: JsonWebKey, conteudo: unknown): Promise<EnvelopeNavegador> {
  const s = webcrypto.subtle;
  const par = (await s.generateKey(ECDH, true, ["deriveBits"])) as webcrypto.CryptoKeyPair;
  const chave = await chaveSimetrica(par.privateKey, publica);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const cifrado = await s.encrypt({ name: "AES-GCM", iv, additionalData: ROTULO_AAD }, chave, new TextEncoder().encode(JSON.stringify(conteudo)));
  const efemera = await s.exportKey("jwk", par.publicKey);
  return {
    efemera: { kty: efemera.kty, crv: efemera.crv, x: efemera.x, y: efemera.y, ext: true },
    iv: Buffer.from(iv).toString("base64"),
    cifrado: Buffer.from(cifrado).toString("base64"),
  };
}

/** O lado do navegador, para os testes do agente provarem que o painel abre o que o agente cifra. */
export async function abrirEnvelopeNavegador<T>(privada: webcrypto.CryptoKey, env: EnvelopeNavegador): Promise<T> {
  const chave = await chaveSimetrica(privada, env.efemera);
  const claro = await webcrypto.subtle.decrypt(
    { name: "AES-GCM", iv: Buffer.from(env.iv, "base64"), additionalData: ROTULO_AAD },
    chave,
    Buffer.from(env.cifrado, "base64"),
  );
  return JSON.parse(Buffer.from(claro).toString("utf8")) as T;
}
