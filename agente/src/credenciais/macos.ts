// macOS: chaveiro pelo `security`, do mesmo jeito que o assistente grava.
//
// O segredo vai por stdin (`security -i`) quando a linha cabe (~4 KB; medido: o `security -i` corta em 4034
// caracteres). A principal, com o mcpOAuth dentro, não cabe, e aí vai por argv, como o próprio assistente faz no
// mesmo caso: fica visível na lista de processos durante a gravação, só para processos do mesmo usuário.

import * as os from "node:os";
import type { Executor } from "../util/executor.js";
import { igualJson } from "../util/arquivos.js";
import { SERVICO_PRINCIPAL, servicoDaPasta, type Blob } from "./blob.js";
import { PRINCIPAL, type Credenciais } from "./tipos.js";

export const LIMITE_LINHA = 4000;

export function comandoGravar(conta: string, servico: string, valor: string): { argv: string[]; entrada: string | null } {
  if (/["\n\r]/.test(conta) || /["\n\r]/.test(servico)) throw new Error("nome de entrada inválido para o chaveiro");
  const hexa = Buffer.from(valor, "utf8").toString("hex");
  const linha = `add-generic-password -U -a "${conta}" -s "${servico}" -X ${hexa}\n`;
  if (linha.length <= LIMITE_LINHA) return { argv: ["security", "-i"], entrada: linha };
  return { argv: ["security", "add-generic-password", "-U", "-a", conta, "-s", servico, "-X", hexa], entrada: null };
}

/** O `security -w` devolve o texto; quando o valor tem byte fora do ASCII imprimível, devolve em hexa. */
export function decodificarSaida(saida: string): string | null {
  const t = saida.trim();
  if (!t) return null;
  if (/^[0-9a-fA-F]+$/.test(t) && t.length % 2 === 0 && !t.startsWith("{")) {
    try {
      const texto = Buffer.from(t, "hex").toString("utf8");
      if (texto.trimStart().startsWith("{")) return texto;
    } catch {
      // segue como texto
    }
  }
  return t;
}

export class ChaveiroMac implements Credenciais {
  readonly tipo = "chaveiro" as const;
  constructor(
    private exec: Executor,
    private conta: string = process.env.USER || os.userInfo().username,
  ) {}

  nome(entrada: string): string {
    return entrada === PRINCIPAL ? SERVICO_PRINCIPAL : servicoDaPasta(entrada);
  }

  async lerTexto(servico: string): Promise<string | null> {
    const r = await this.exec.rodar(["security", "find-generic-password", "-s", servico, "-w"], { timeoutMs: 20_000 });
    if (r.codigo !== 0) return null;
    return decodificarSaida(r.saida);
  }

  async lerEstrito(entrada: string): Promise<Blob | null> {
    const servico = this.nome(entrada);
    const r = await this.exec.rodar(["security", "find-generic-password", "-s", servico, "-w"], { timeoutMs: 20_000 });
    if (r.codigo === 44) return null; // errSecItemNotFound: não existe mesmo
    if (r.codigo !== 0) throw new Error(`o chaveiro não respondeu (${servico})`);
    const texto = decodificarSaida(r.saida);
    if (texto === null) throw new Error(`entrada ilegível no chaveiro (${servico})`);
    const v = JSON.parse(texto);
    if (!v || typeof v !== "object") throw new Error(`entrada ilegível no chaveiro (${servico})`);
    return v as Blob;
  }

  async gravarTexto(servico: string, valor: string): Promise<void> {
    const { argv, entrada } = comandoGravar(this.conta, servico, valor);
    const r = await this.exec.rodar(argv, { entrada: entrada ?? undefined, timeoutMs: 20_000 });
    if (r.codigo !== 0) throw new Error(`não consegui gravar no chaveiro (${servico})`);
  }

  async ler(entrada: string): Promise<Blob | null> {
    const texto = await this.lerTexto(this.nome(entrada));
    if (!texto) return null;
    try {
      const v = JSON.parse(texto);
      return v && typeof v === "object" ? (v as Blob) : null;
    } catch {
      return null;
    }
  }

  async gravar(entrada: string, blob: Blob): Promise<void> {
    const servico = this.nome(entrada);
    await this.gravarTexto(servico, JSON.stringify(blob));
    if (!igualJson(await this.ler(entrada), blob)) throw new Error(`não consegui gravar no chaveiro (${servico})`);
  }

  async apagar(entrada: string): Promise<void> {
    await this.exec.rodar(["security", "delete-generic-password", "-s", this.nome(entrada)], { timeoutMs: 20_000 });
  }
}
