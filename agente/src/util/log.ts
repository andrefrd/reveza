// Log do agente: uma linha por acontecimento, com a hora local. No modo sombra, o que o agente FARIA vai para cá.
// Segredo nunca entra no log: só e-mail, organização, números e nomes de entrada.

import * as fs from "node:fs";
import * as path from "node:path";

export interface Log {
  info(texto: string): void;
  erro(texto: string): void;
  /** Modo sombra: o que seria feito e não foi. */
  faria(texto: string): void;
}

function hora(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** No modo sombra o mesmo "faria" se repete a cada ciclo: vai ao log uma vez por hora. */
export const FARIA_REPETIDO_MS = 3_600_000;

export function logEmArquivo(caminho: string, eco = false, agora: () => number = Date.now): Log {
  const vistos = new Map<string, number>();
  const escrever = (tipo: string, texto: string) => {
    const linha = `${hora()} [${tipo}] ${texto}\n`;
    if (eco) process.stderr.write(linha);
    try {
      fs.mkdirSync(path.dirname(caminho), { recursive: true, mode: 0o700 });
      try {
        if (fs.statSync(caminho).size > 5_000_000) fs.renameSync(caminho, caminho + ".1");
      } catch {
        // primeiro uso
      }
      fs.appendFileSync(caminho, linha, { mode: 0o600 });
    } catch {
      // o log não pode derrubar o agente
    }
  };
  return {
    info: (t) => escrever("info", t),
    erro: (t) => escrever("erro", t),
    faria: (t) => {
      const ultimo = vistos.get(t);
      if (ultimo !== undefined && agora() - ultimo < FARIA_REPETIDO_MS) return;
      vistos.set(t, agora());
      if (vistos.size > 500) vistos.delete(vistos.keys().next().value!);
      escrever("sombra", `faria: ${t}`);
    },
  };
}

export class LogMemoria implements Log {
  linhas: string[] = [];
  info(t: string) {
    this.linhas.push(`[info] ${t}`);
  }
  erro(t: string) {
    this.linhas.push(`[erro] ${t}`);
  }
  faria(t: string) {
    this.linhas.push(`[sombra] faria: ${t}`);
  }
}

export const logMudo: Log = { info: () => undefined, erro: () => undefined, faria: () => undefined };
