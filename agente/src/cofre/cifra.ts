// Cofre: o login de cada conta vai à nuvem só cifrado, com a chave K que existe apenas nos computadores.
//
// AES-256-GCM, nonce aleatório de 12 bytes, tag de 16 bytes no fim do cifrado. Dado associado `conta_id|versao`:
// o cifrado de uma conta não serve no lugar do de outra, nem uma versão velha no lugar da nova.
// Exceção: o registro de uma conta (`agente_registrar_conta`), em que a nuvem só diz o conta_id e a versão depois de
// gravar, usa `<email>|registro`; o agente regrava em seguida com `conta_id|versao` (ver posse.ts).

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { soLogin, type Blob } from "../credenciais/blob.js";

export const TAMANHO_CHAVE = 32;
export const TAMANHO_NONCE = 12;
const TAMANHO_TAG = 16;

export function novaChave(): Buffer {
  return randomBytes(TAMANHO_CHAVE);
}

export function aadConta(contaId: string, versao: number): string {
  return `${contaId}|${versao}`;
}

export function aadRegistro(email: string): string {
  return `${email.trim().toLowerCase()}|registro`;
}

export function cifrar(chave: Buffer, aad: string, dados: Buffer): { cifrado: Buffer; nonce: Buffer } {
  if (chave.length !== TAMANHO_CHAVE) throw new Error("chave do cofre com tamanho errado");
  const nonce = randomBytes(TAMANHO_NONCE);
  const c = createCipheriv("aes-256-gcm", chave, nonce);
  c.setAAD(Buffer.from(aad, "utf8"));
  const corpo = Buffer.concat([c.update(dados), c.final()]);
  return { cifrado: Buffer.concat([corpo, c.getAuthTag()]), nonce };
}

export function decifrar(chave: Buffer, aad: string, cifrado: Buffer, nonce: Buffer): Buffer {
  if (chave.length !== TAMANHO_CHAVE) throw new Error("chave do cofre com tamanho errado");
  if (nonce.length !== TAMANHO_NONCE || cifrado.length < TAMANHO_TAG) throw new Error("cifrado inválido");
  const d = createDecipheriv("aes-256-gcm", chave, nonce);
  d.setAAD(Buffer.from(aad, "utf8"));
  d.setAuthTag(cifrado.subarray(cifrado.length - TAMANHO_TAG));
  return Buffer.concat([d.update(cifrado.subarray(0, cifrado.length - TAMANHO_TAG)), d.final()]);
}

/** Só `claudeAiOauth` e `organizationUuid` vão ao cofre; o resto da entrada (mcpOAuth) é da máquina. */
export function cifrarLogin(chave: Buffer, aad: string, blob: Blob): { cifrado: Buffer; nonce: Buffer } {
  return cifrar(chave, aad, Buffer.from(JSON.stringify(soLogin(blob)), "utf8"));
}

export function decifrarLogin(chave: Buffer, aad: string, cifrado: Buffer, nonce: Buffer): Blob {
  const v = JSON.parse(decifrar(chave, aad, cifrado, nonce).toString("utf8"));
  if (!v || typeof v !== "object") throw new Error("login do cofre ilegível");
  return soLogin(v as Blob);
}
