// Abre no navegador a página de criar o token, na hora em que o instalador pede o token. Só ajuda: quando não dá
// para abrir (sem tela, sem pergunta, token já no ambiente) ou o comando falha, nada para e o endereço segue impresso.
import { spawn } from "node:child_process";
import { ambienteLimpo } from "./programa.mjs";

export const PAGINA_TOKEN_SUPABASE = "https://supabase.com/dashboard/account/tokens";
export const PAGINA_TOKEN_VERCEL = "https://vercel.com/account/tokens";

/**
 * Dá para abrir o navegador aqui? Só numa instalação que pergunta (nunca com --sim nem sem terminal), quando o token
 * ainda não veio do ambiente e há uma tela: no macOS e no Windows, fora de sessão SSH (lá o navegador abriria na tela
 * de outra pessoa, ou em nenhuma); no Linux, com tela gráfica (X ou Wayland), inclusive a encaminhada pelo SSH.
 */
export function podeAbrirNavegador({ interativo, tokenDoAmbiente, plataforma = process.platform, env = process.env }) {
  if (!interativo || tokenDoAmbiente) return false;
  const ssh = !!(env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY);
  if (plataforma === "darwin" || plataforma === "win32") return !ssh;
  return !!(env.DISPLAY || env.WAYLAND_DISPLAY);
}

/** O comando do sistema que abre um endereço no navegador padrão. */
export function comandoDoNavegador(url, plataforma = process.platform) {
  if (plataforma === "darwin") return ["open", [url]];
  if (plataforma === "win32") return ["explorer.exe", [url]];
  return ["xdg-open", [url]];
}

/**
 * Abre o endereço sem esperar o navegador e sem nunca lançar erro. Devolve true quando o comando do sistema subiu,
 * false quando ele não existe ou falhou ao subir (a pessoa usa o endereço impresso). Só https: o endereço é fixo,
 * mas a guarda impede que um dia chegue aqui algo que o sistema trataria como arquivo ou programa.
 */
export function abrirNavegador(url, { plataforma = process.platform, iniciar = spawn, esperaMs = 2000 } = {}) {
  if (!/^https:\/\/[\w.-]+\/[\w./-]*$/.test(String(url))) return Promise.resolve(false);
  const [cmd, args] = comandoDoNavegador(url, plataforma);
  return new Promise((resolve) => {
    let p;
    const relogio = setTimeout(() => resolve(false), esperaMs);
    const fim = (v) => { clearTimeout(relogio); resolve(v); };
    try {
      // o filho não herda token nem senha do ambiente do instalador, e não segura o terminal nem o fim do instalador
      p = iniciar(cmd, args, { stdio: "ignore", detached: true, windowsHide: true, env: ambienteLimpo() });
    } catch {
      return fim(false);
    }
    p.once("error", () => fim(false));
    p.once("spawn", () => fim(true));
    p.unref?.();
  });
}

/**
 * Na hora de pedir um token: mostra onde criar e, quando dá, abre a página. `aviso` é a linha que diz onde criar;
 * a página só abre se `podeAbrirNavegador` deixar. Devolve se abriu.
 */
export async function mostrarPaginaDoToken(url, { aviso, abriu, interativo, tokenDoAmbiente, info, abrir = abrirNavegador, plataforma, env } = {}) {
  info(aviso);
  if (!podeAbrirNavegador({ interativo, tokenDoAmbiente, plataforma, env })) return false;
  const ok = await abrir(url, plataforma ? { plataforma } : {});
  if (ok) info(abriu);
  return ok;
}
