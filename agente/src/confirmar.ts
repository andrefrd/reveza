// Confirmação na tela do computador que tem a chave do cofre, antes de entregá-la a um computador novo. Desde a 0.2.0
// o código aparece NA TELA DO COMPUTADOR NOVO (12 caracteres desde a 0.4.0, os 4 últimos sorteados lá) e a pessoa o
// digita aqui:
// a janela pede o código e não o mostra. Um pedido que ninguém fez não tem código na tela de ninguém, então um clique
// por reflexo não libera nada (no primeiro teste de verdade, a janela que só pedia um clique foi liberada em 8 s).
// Sem tela (servidor, VPS), devolve "sem_tela" e a liberação é pelo terminal: `reveza ligar XXXX-XXXX-YYYY`.
// O texto da janela é fixo: nada que vem da nuvem entra na linha de comando.

import type { Sistema } from "./config.js";
import type { Executor } from "./util/executor.js";

/**
 * liberou: digitou o código certo; errado: digitou outro (a janela pergunta de novo); recusou: clicou em Recusar;
 * sem_resposta: o tempo acabou (o pedido segue aberto para `reveza ligar`); sem_tela: não há como mostrar janela.
 */
export type Confirmacao = "liberou" | "errado" | "recusou" | "sem_resposta" | "sem_tela";
export const ESPERA_CONFIRMACAO_S = 90;

function textos(idioma: "pt-BR" | "en", errou: boolean) {
  if (idioma === "en") {
    const abre = errou
      ? "The code did not match.\n\nCheck the 12-character code on the new computer's screen and type it again"
      : "A new computer wants to join your Reveza AI.\n\nTo let it in, type the 12-character code shown on the NEW computer's screen";
    return {
      titulo: "Reveza AI",
      texto: `${abre}. If you are not linking a computer right now, click Refuse.`,
      // a InputBox do Windows não troca o nome dos botões: são OK e Cancelar, na língua do Windows
      textoWindows: `${abre}, then click OK. If you are not linking a computer right now, click Cancel.`,
      sim: "Release",
      nao: "Refuse",
    };
  }
  const abre = errou
    ? "O código não confere.\n\nConfira o código de 12 caracteres na tela do computador novo e digite de novo"
    : "Um computador novo quer entrar no seu Reveza AI.\n\nPara liberar, digite o código de 12 caracteres que aparece na tela do computador NOVO";
  return {
    titulo: "Reveza AI",
    texto: `${abre}. Se você não está ligando um computador agora, clique em Recusar.`,
    textoWindows: `${abre}, depois clique em OK. Se você não está ligando um computador agora, clique em Cancelar.`,
    sim: "Liberar",
    nao: "Recusar",
  };
}

/**
 * Texto literal do PowerShell, entre aspas simples (nada dentro é interpretado: nem `$`, nem crase, nem aspas duplas).
 * O PowerShell também fecha a string nas aspas tipográficas (‘ ’ ‚ ‛), então todas são dobradas, não só a `'`: uma
 * tradução com "don’t" fecharia a string no meio e o resto viraria comando.
 */
export function aspasPs(texto: string): string {
  return `'${texto.replace(/['‘’‚‛]/g, "$&$&")}'`;
}

/** O comando que mostra a janela neste sistema. A janela NÃO mostra o código: a pessoa digita o que o computador novo mostra. */
export function comandoDaJanela(sistema: Sistema, idioma: "pt-BR" | "en", env: NodeJS.ProcessEnv = process.env, errou = false): string[] | null {
  const t = textos(idioma, errou);
  if (sistema === "macos") {
    const texto = t.texto.replace(/\n/g, '" & return & "');
    return ["osascript", "-e",
      `display dialog "${texto}" default answer "" with title "${t.titulo}" buttons {"${t.nao}", "${t.sim}"} default button "${t.sim}" cancel button "${t.nao}" with icon caution giving up after ${ESPERA_CONFIRMACAO_S}`];
  }
  if (sistema === "windows") {
    // texto em aspas simples do PowerShell (nada é interpretado); as quebras de linha entram como [char]10
    const texto = t.textoWindows.split("\n").map(aspasPs).join(" + [char]10 + ");
    return ["powershell", "-NoProfile", "-NonInteractive", "-Command",
      `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::InputBox((${texto}), ${aspasPs(t.titulo)}, '')`];
  }
  if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return null;
  return ["zenity", "--entry", `--title=${t.titulo}`, `--text=${t.texto}`, `--ok-label=${t.sim}`, `--cancel-label=${t.nao}`, `--timeout=${ESPERA_CONFIRMACAO_S}`];
}

const normal = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Abre a janela e diz o que a pessoa fez. `confere` diz se o que a pessoa digitou (sem espaço, hífen nem caixa) é o
 * código do computador novo (desde a 0.4.0 só a primeira parte se calcula aqui; a sorteada não se confere aqui);
 * `errou` muda o texto para "não confere".
 * Cada sistema avisa de um jeito: no macOS, Recusar sai com erro "User canceled" e o tempo esgotado com "gave up";
 * no Linux, Recusar sai 1 e o tempo 5; no Windows, Cancelar devolve vazio e não há tempo (o executor encerra).
 */
export async function pedirConfirmacao(
  exec: Executor,
  sistema: Sistema,
  confere: (digitado: string) => Promise<boolean> | boolean,
  idioma: "pt-BR" | "en" = "pt-BR",
  env: NodeJS.ProcessEnv = process.env,
  errou = false,
): Promise<Confirmacao> {
  const argv = comandoDaJanela(sistema, idioma, env, errou);
  if (!argv) return "sem_tela";
  const t = textos(idioma, errou);
  // `janela`: sem esconder o programa. No Windows, esconder o PowerShell (o padrão do executor) esconde também a
  // primeira janela que ele abre, a própria InputBox: provado no Windows de verdade (a janela nunca apareceu).
  const r = await exec.rodar(argv, { timeoutMs: (ESPERA_CONFIRMACAO_S + 10) * 1000, janela: true });
  if (r.codigo === 127 || /not found|ENOENT|cannot open display/i.test(r.erro)) return "sem_tela";
  let digitado: string;
  if (sistema === "macos") {
    if (r.codigo !== 0) return /User canceled|-128/i.test(r.erro) ? "recusou" : "sem_resposta";
    if (r.saida.includes("gave up:true")) return "sem_resposta";
    if (!r.saida.includes(`button returned:${t.sim}`)) return "recusou";
    digitado = /text returned:([^,\n]*)/.exec(r.saida)?.[1] ?? "";
  } else if (sistema === "windows") {
    if (r.codigo !== 0) return "sem_resposta";
    digitado = r.saida;
    if (!normal(digitado)) return "recusou";
  } else {
    if (r.codigo === 1) return "recusou";
    if (r.codigo !== 0) return "sem_resposta";
    digitado = r.saida;
  }
  const d = normal(digitado);
  return /^[A-Z0-9]{12}$/.test(d) && (await confere(d)) ? "liberou" : "errado";
}
