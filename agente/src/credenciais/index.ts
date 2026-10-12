import type { Caminhos, Sistema } from "../config.js";
import type { Executor } from "../util/executor.js";
import { CredenciaisArquivo } from "./arquivo.js";
import { ChaveiroMac } from "./macos.js";
import type { Credenciais } from "./tipos.js";

export function credenciaisDoSistema(sistema: Sistema, exec: Executor, c: Caminhos): Credenciais {
  return sistema === "macos" ? new ChaveiroMac(exec) : new CredenciaisArquivo(c.principalDir);
}

export * from "./blob.js";
export * from "./tipos.js";
