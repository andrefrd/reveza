// Confirmação na tela do computador que tem a chave do cofre, antes de liberar a frase de um computador novo pedida
// pelo painel (auditoria de 11/10/2026: a nuvem sozinha não pode autorizar). A janela pede o código de 4 caracteres
// que o painel mostra, e não o mostra: só quem está com o painel aberto, fazendo o pedido, sabe o código. No primeiro
// teste de verdade a janela que só pedia um clique foi liberada em 8 s sem ninguém olhar o código; digitar resolve.
// Sem tela (servidor, VPS), devolve "sem_tela" e a frase sai só pelo terminal.

import type { Sistema } from "./config.js";
import type { Executor } from "./util/executor.js";

export type Confirmacao = "liberou" | "recusou" | "sem_tela";
export const ESPERA_CONFIRMACAO_S = 90;

function textos(idioma: "pt-BR" | "en") {
  return idioma === "en"
    ? {
        titulo: "Reveza AI",
        texto: "A new computer wants to join your Reveza AI.\n\nTo release it, type the 4-character code shown in the dashboard. If you did not ask for this, click Refuse.",
        sim: "Release",
        nao: "Refuse",
      }
    : {
        titulo: "Reveza AI",
        texto: "Um computador novo quer entrar no seu Reveza AI.\n\nPara liberar, digite o código de 4 caracteres que aparece no painel. Se não foi você que pediu, clique em Recusar.",
        sim: "Liberar",
        nao: "Recusar",
      };
}

/**
 * O comando que mostra a janela neste sistema. A janela NÃO mostra o código: a pessoa digita o que o painel dela
 * mostra. Um pedido forjado (que o painel dela não fez) não tem código na tela dela, então um clique por reflexo não
 * libera nada.
 */
export function comandoDaJanela(sistema: Sistema, idioma: "pt-BR" | "en", env: NodeJS.ProcessEnv = process.env): string[] | null {
  const t = textos(idioma);
  if (sistema === "macos") {
    const texto = t.texto.replace(/\n/g, '" & return & "');
    return ["osascript", "-e",
      `display dialog "${texto}" default answer "" with title "${t.titulo}" buttons {"${t.nao}", "${t.sim}"} default button "${t.sim}" cancel button "${t.nao}" with icon caution giving up after ${ESPERA_CONFIRMACAO_S}`];
  }
  if (sistema === "windows") {
    // texto em aspas simples do PowerShell (nada é interpretado); as quebras de linha entram como [char]10
    const texto = t.texto.split("\n").map((l) => `'${l.replace(/'/g, "''")}'`).join(" + [char]10 + ");
    return ["powershell", "-NoProfile", "-NonInteractive", "-Command",
      `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::InputBox((${texto}), '${t.titulo}', '')`];
  }
  if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return null;
  return ["zenity", "--entry", `--title=${t.titulo}`, `--text=${t.texto}`, `--ok-label=${t.sim}`, `--cancel-label=${t.nao}`, `--timeout=${ESPERA_CONFIRMACAO_S}`];
}

/** O que a pessoa digitou, do jeito que cada janela devolve (vazio se não clicou em Liberar ou o tempo acabou). */
function digitado(sistema: Sistema, saida: string, sim: string): string {
  if (sistema === "macos") {
    if (!saida.includes(`button returned:${sim}`) || saida.includes("gave up:true")) return "";
    return /text returned:([^,\n]*)/.exec(saida)?.[1] ?? "";
  }
  return saida;
}

const normal = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function pedirConfirmacao(exec: Executor, sistema: Sistema, codigo: string, idioma: "pt-BR" | "en" = "pt-BR", env: NodeJS.ProcessEnv = process.env): Promise<Confirmacao> {
  const argv = comandoDaJanela(sistema, idioma, env);
  if (!argv || !/^[A-Z0-9]{4}$/.test(codigo)) return "sem_tela";
  const t = textos(idioma);
  const r = await exec.rodar(argv, { timeoutMs: (ESPERA_CONFIRMACAO_S + 10) * 1000 });
  // programa que não existe (127) ou não abriu a janela: sem tela; janela que abriu e não liberou: recusou
  if (r.codigo === 127 || (r.codigo !== 0 && r.codigo !== 1 && r.codigo !== 5 && /not found|ENOENT|cannot open display/i.test(r.erro))) return "sem_tela";
  if (r.codigo !== 0) return "recusou";
  return normal(digitado(sistema, r.saida, t.sim)) === codigo ? "liberou" : "recusou";
}
