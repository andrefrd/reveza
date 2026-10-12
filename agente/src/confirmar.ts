// Confirmação na tela do computador que tem a chave do cofre, antes de liberar a frase de um computador novo pedida
// pelo painel (auditoria de 11/10/2026: a nuvem sozinha não pode autorizar; um clique aqui ela não consegue forjar).
// A janela mostra o código que o painel mostra: se não bater, é pedido de outra pessoa. Sem tela (servidor, VPS),
// devolve "sem_tela" e a frase sai só pelo terminal.

import type { Sistema } from "./config.js";
import type { Executor } from "./util/executor.js";

export type Confirmacao = "liberou" | "recusou" | "sem_tela";
export const ESPERA_CONFIRMACAO_S = 90;

function textos(codigo: string, idioma: "pt-BR" | "en") {
  return idioma === "en"
    ? {
        titulo: "Reveza AI",
        texto: `A new computer asked to join your Reveza AI from the dashboard.\n\nRelease it only if the dashboard shows the code ${codigo}.`,
        sim: "Release",
        nao: "Refuse",
      }
    : {
        titulo: "Reveza AI",
        texto: `Um computador novo pediu para entrar no seu Reveza AI pelo painel.\n\nSó libere se o painel mostrar o código ${codigo}.`,
        sim: "Liberar",
        nao: "Recusar",
      };
}

/** O comando que mostra a janela neste sistema (o código só tem letras e números, então entra no texto sem escape). */
export function comandoDaJanela(sistema: Sistema, codigo: string, idioma: "pt-BR" | "en", env: NodeJS.ProcessEnv = process.env): string[] | null {
  if (!/^[A-Z0-9]{4}$/.test(codigo)) return null;
  const t = textos(codigo, idioma);
  if (sistema === "macos") {
    const texto = t.texto.replace(/\n/g, '" & return & "');
    return ["osascript", "-e",
      `display dialog "${texto}" with title "${t.titulo}" buttons {"${t.nao}", "${t.sim}"} default button "${t.sim}" cancel button "${t.nao}" with icon caution giving up after ${ESPERA_CONFIRMACAO_S}`];
  }
  if (sistema === "windows") {
    // texto em aspas simples do PowerShell (nada é interpretado); as quebras de linha entram como [char]10
    const texto = t.texto.split("\n").map((l) => `'${l.replace(/'/g, "''")}'`).join(" + [char]10 + ");
    return ["powershell", "-NoProfile", "-NonInteractive", "-Command",
      `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show((${texto}), '${t.titulo}', 'YesNo', 'Warning')`];
  }
  if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return null;
  return ["zenity", "--question", `--title=${t.titulo}`, `--text=${t.texto}`, `--ok-label=${t.sim}`, `--cancel-label=${t.nao}`, `--timeout=${ESPERA_CONFIRMACAO_S}`];
}

export async function pedirConfirmacao(exec: Executor, sistema: Sistema, codigo: string, idioma: "pt-BR" | "en" = "pt-BR", env: NodeJS.ProcessEnv = process.env): Promise<Confirmacao> {
  const argv = comandoDaJanela(sistema, codigo, idioma, env);
  if (!argv) return "sem_tela";
  const t = textos(codigo, idioma);
  const r = await exec.rodar(argv, { timeoutMs: (ESPERA_CONFIRMACAO_S + 10) * 1000 });
  // programa que não existe (127) ou não abriu a janela: sem tela; janela que abriu e não liberou: recusou
  if (r.codigo === 127 || (r.codigo !== 0 && r.codigo !== 1 && /not found|ENOENT|cannot open display/i.test(r.erro))) return "sem_tela";
  if (sistema === "macos") return r.codigo === 0 && r.saida.includes(`button returned:${t.sim}`) && !r.saida.includes("gave up:true") ? "liberou" : "recusou";
  if (sistema === "windows") return r.codigo === 0 && /\bYes\b/.test(r.saida) ? "liberou" : r.codigo === 0 ? "recusou" : "sem_tela";
  return r.codigo === 0 ? "liberou" : r.codigo === 1 || r.codigo === 5 ? "recusou" : "sem_tela";
}
