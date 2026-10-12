// Chave do cofre neste computador: criar (primeiro computador), ligar um computador novo e, em emergência, a frase.
//
// Computador novo (0.2.0): ele cria um par de chaves ECDH P-256 só em memória, registra a chave pública no pedido dele
// na nuvem e mostra um código de 8 caracteres tirado dela. A pessoa digita esse código num computador que já tem a
// chave do cofre; ele confere, cifra a chave do cofre para a chave pública do computador novo (ECDH efêmero +
// HKDF-SHA256 + AES-256-GCM) e entrega pela nuvem, que só vê texto cifrado. Nenhum segredo passa pela tela.
//
// Frase de 6 palavras: só o caminho manual de emergência, para um computador já ligado que perdeu a chave.

import { createHash, createHmac, scrypt as scryptCb, webcrypto, type ScryptOptions } from "node:crypto";

import { novaChave, TAMANHO_CHAVE } from "./cofre/cifra.js";
import { desembrulhar, embrulhar, gerarFrase, palavrasDesconhecidas, type Idioma } from "./cofre/frase.js";
import { SEGREDO_COFRE, type Guarda } from "./cofre/guarda.js";
import { ErroNuvem, type ChavePublica, type EnvelopeChave, type Nuvem, type PedidoLigacao } from "./nuvem/tipos.js";

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
  if (!k) throw new Error("este computador não tem a chave do cofre; mostre a frase num que tenha (reveza ligar --mostrar-frase)");
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
  if (!pacote) throw new Error("nenhuma frase aberta (vale 10 minutos; mostre outra com reveza ligar --mostrar-frase no computador que tem a chave)");
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

// ------------------------------------------------------------------------------------------------ computador novo
// Os rótulos são da versão 2 (a 1 era a frase cifrada para o navegador, que saiu na 0.2.0).

const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;
const ROTULO_INFO = new TextEncoder().encode("reveza-ligacao-computador-v2");
const ROTULO_SAL = new TextEncoder().encode("reveza-ligacao-computador-sal-v2");
const aad = (computadorId: string) => new TextEncoder().encode(`reveza-ligacao-computador-v2|${computadorId}`);

/** Dois pedidos ao mesmo tempo: todos recusados (falha fechada; revisão de segurança de 11/10/2026). */
export const LIGACAO_DUPLA = "dois pedidos de ligação ao mesmo tempo: recusei os dois; gere de novo no painel";

/** Tamanho do código: 8 símbolos de 32 (40 bits), mostrados como XXXX-XXXX. */
export const TAMANHO_CODIGO = 8;
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O e 1/I, que se confundem na tela

/**
 * Esticamento do código (scrypt, 32 MiB, ~40 ms aqui). A chave pública fica legível na nuvem; quem escreve direto no
 * banco poderia trocá-la por uma chave dele com o MESMO código e receber a chave do cofre. Achar essa chave pede 2^40
 * tentativas, e cada uma custa um scrypt: muitos anos de máquina, para um pedido que vence em 10 minutos.
 */
const ESTICAR: ScryptOptions = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function esticar(dado: Buffer): Promise<Buffer> {
  return new Promise((ok, falhou) => scryptCb(dado, "reveza-ligar-codigo-v2", TAMANHO_CODIGO, ESTICAR, (e, b) => (e ? falhou(e) : ok(b))));
}

/** O código que o computador novo mostra e a pessoa digita no que já tem a chave: SHA-256 da chave pública, esticado. */
export async function codigoDaChave(publica: ChavePublica): Promise<string> {
  const h = createHash("sha256").update(`reveza-ligar-v2.${publica.x}.${publica.y}`).digest();
  const b = await esticar(h);
  let r = "";
  for (let i = 0; i < TAMANHO_CODIGO; i++) r += ALFABETO[b[i]! % ALFABETO.length]; // 256/32 = 8: sem viés
  return `${r.slice(0, 4)}-${r.slice(4)}`;
}

/** O que a pessoa digitou, sem espaço, hífen nem caixa. */
export function normalizarCodigo(t: string): string {
  return t.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function codigoConfere(digitado: string, codigo: string): boolean {
  const a = normalizarCodigo(digitado);
  return a.length === TAMANHO_CODIGO && a === normalizarCodigo(codigo);
}

async function chaveSimetrica(privada: webcrypto.CryptoKey, publica: ChavePublica): Promise<webcrypto.CryptoKey> {
  const s = webcrypto.subtle;
  const pub = await s.importKey("jwk", { ...publica, ext: true }, ECDH, false, []);
  const segredo = await s.deriveBits({ name: "ECDH", public: pub }, privada, 256);
  const base = await s.importKey("raw", segredo, "HKDF", false, ["deriveKey"]);
  return s.deriveKey({ name: "HKDF", hash: "SHA-256", salt: ROTULO_SAL, info: ROTULO_INFO }, base, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function publicaDe(jwk: webcrypto.JsonWebKey): ChavePublica {
  return { kty: "EC", crv: "P-256", x: jwk.x!, y: jwk.y! };
}

/** O par do computador novo: a chave privada não sai da memória (não exportável). */
export async function novoParDeChaves(): Promise<{ publica: ChavePublica; privada: webcrypto.CryptoKey }> {
  const par = (await webcrypto.subtle.generateKey(ECDH, false, ["deriveBits"])) as webcrypto.CryptoKeyPair;
  return { publica: publicaDe(await webcrypto.subtle.exportKey("jwk", par.publicKey)), privada: par.privateKey };
}

/** Quem tem a chave do cofre: cifra a chave para a chave pública do pedido (amarrada ao id do computador novo). */
export async function cifrarChaveParaComputadorNovo(publica: ChavePublica, k: Buffer, computadorId: string): Promise<EnvelopeChave> {
  const s = webcrypto.subtle;
  const par = (await s.generateKey(ECDH, true, ["deriveBits"])) as webcrypto.CryptoKeyPair;
  const chave = await chaveSimetrica(par.privateKey, publica);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const cifrado = await s.encrypt({ name: "AES-GCM", iv, additionalData: aad(computadorId) }, chave, k);
  return {
    efemera: publicaDe(await s.exportKey("jwk", par.publicKey)),
    iv: Buffer.from(iv).toString("base64"),
    cifrado: Buffer.from(cifrado).toString("base64"),
  };
}

/** O computador novo abre o envelope com a chave privada que só ele tem. */
export async function abrirChaveDoEnvelope(privada: webcrypto.CryptoKey, env: EnvelopeChave, computadorId: string): Promise<Buffer> {
  const chave = await chaveSimetrica(privada, env.efemera);
  const claro = Buffer.from(
    await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(env.iv, "base64"), additionalData: aad(computadorId) }, chave, Buffer.from(env.cifrado, "base64")),
  );
  if (claro.length !== TAMANHO_CHAVE) throw new Error("a chave entregue não tem o tamanho de uma chave do cofre");
  return claro;
}

export interface OpcoesPedir {
  /** Mostra o código (o computador novo escreve em letras grandes). */
  aoMostrarCodigo: (codigo: string, expiraEm: string | null) => void;
  /** O computador onde a janela abriu (quando a nuvem souber). */
  aoEsperar?: (aprovador: string | null) => void;
  dormir: (ms: number) => Promise<void>;
  /** Agora, em ms (os testes trocam). */
  agoraMs?: () => number;
  intervaloMs?: number;
}

const MOTIVOS: Record<string, string> = {
  recusado_na_tela: "o pedido foi recusado na tela do computador que já usa o Reveza",
  dois_pedidos: "chegaram dois pedidos ao mesmo tempo e os dois foram recusados, por segurança",
  codigo_errado: "o código digitado não conferiu três vezes e o pedido foi recusado",
};

/**
 * O computador novo pede para entrar: registra a chave pública, mostra o código e espera a chave do cofre chegar
 * (até o pedido vencer). Confere a impressão contra a da instalação antes de guardar. Devolve a impressão da instalação.
 */
export async function pedirParaEntrar(guarda: Guarda, nuvem: Nuvem, o: OpcoesPedir): Promise<{ impressao: string | null }> {
  if (await lerChave(guarda)) throw new Error("este computador já tem a chave do cofre");
  const agora = o.agoraMs ?? (() => Date.now());
  const par = await novoParDeChaves();
  const pedido = await nuvem.ligacaoPedir(par.publica);
  o.aoMostrarCodigo(await codigoDaChave(par.publica), pedido.expira_em);
  const vence = (pedido.expira_em ? Date.parse(pedido.expira_em) : agora() + 10 * 60_000) + 30_000;
  let aprovador: string | null | undefined;
  for (;;) {
    let r;
    try {
      r = await nuvem.ligacaoReceber();
    } catch (e) {
      // sem rede por um instante: tenta de novo até o pedido vencer
      if (!(e instanceof ErroNuvem && e.semRede) || agora() > vence) throw e;
      await o.dormir(o.intervaloMs ?? 2000);
      continue;
    }
    if (r.estado === "entregue") {
      if (!r.envelope) throw new Error("a nuvem não trouxe a chave do cofre: gere outro código no painel");
      let k: Buffer;
      try {
        k = await abrirChaveDoEnvelope(par.privada, r.envelope, pedido.computador_id);
      } catch {
        throw new Error("a chave entregue não abriu com a chave deste computador (o pedido foi trocado no caminho): gere outro código no painel");
      }
      // a chave precisa ser a desta instalação; outra dividiria o cofre
      if (r.impressao && r.impressao !== impressaoDaChave(k)) {
        throw new Error("a chave recebida não é a desta instalação: libere num computador que já usa o Reveza nesta instalação");
      }
      await guarda.gravar(SEGREDO_COFRE, k.toString("base64"));
      return { impressao: r.impressao };
    }
    if (r.estado === "recusado") throw new Error(`${MOTIVOS[r.motivo ?? ""] ?? "o pedido foi recusado"}: gere outro código no painel`);
    if (r.estado === "vencido") throw new Error("o pedido venceu (10 minutos): gere outro código no painel");
    if (r.estado === "lido") throw new Error("a chave deste pedido já foi lida: gere outro código no painel");
    if (r.estado === "sem_pedido") throw new Error("a nuvem não achou o pedido deste computador: gere outro código no painel");
    if (r.aprovador !== aprovador) {
      aprovador = r.aprovador;
      o.aoEsperar?.(aprovador);
    }
    if (agora() > vence) throw new Error("o pedido venceu (10 minutos): gere outro código no painel");
    await o.dormir(o.intervaloMs ?? 2000);
  }
}

/** Quem tem a chave do cofre: entrega para um pedido já conferido. */
export async function entregarChave(nuvem: Nuvem, k: Buffer, pedido: PedidoLigacao): Promise<void> {
  const env = await cifrarChaveParaComputadorNovo(pedido.publica, k, pedido.computador_id);
  const r = await nuvem.ligacaoEntregar(pedido.computador_id, pedido.publica, env);
  if (!r.ok) throw new Error(r.erro ?? "a nuvem recusou a entrega");
}

/**
 * `reveza ligar XXXX-XXXX` no computador que já tem a chave (sem janela: servidor, VPS, SSH): confere o código digitado
 * contra o do único pedido aberto e entrega. Dois pedidos abertos: recusa os dois.
 */
export async function liberarComputadorNovo(guarda: Guarda, nuvem: Nuvem, digitado: string): Promise<PedidoLigacao> {
  const k = await lerChave(guarda);
  if (!k) throw new Error("este computador não tem a chave do cofre: libere num computador que já usa o Reveza");
  const daInstalacao = await nuvem.cofreImpressao(null);
  if (daInstalacao && daInstalacao !== impressaoDaChave(k)) {
    throw new Error("a chave do cofre deste computador não é a da instalação: libere em outro computador");
  }
  if (normalizarCodigo(digitado).length !== TAMANHO_CODIGO) throw new Error("o código tem 8 letras e números (XXXX-XXXX), como aparece no computador novo");
  const pedidos = await nuvem.ligacoesAbertas();
  if (!pedidos.length) throw new Error("nenhum computador novo pedindo para entrar agora (o pedido vale 10 minutos)");
  if (pedidos.length > 1) {
    for (const p of pedidos) await nuvem.ligacaoRecusar(p.computador_id, "dois_pedidos").catch(() => undefined);
    throw new Error(LIGACAO_DUPLA);
  }
  const p = pedidos[0]!;
  if (!codigoConfere(digitado, await codigoDaChave(p.publica))) {
    throw new Error("o código não confere com o do computador novo: confira as 8 letras e números na tela dele");
  }
  await entregarChave(nuvem, k, p);
  return p;
}
