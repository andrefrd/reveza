// A prova final do instalador: antes do doctor, espera a conta que a nuvem mandou chegar ao assistente.
//
// O agente recém-ligado (ou recém-atualizado) põe a conta atribuída na primeira busca, segundos depois de subir; o doctor
// rodando antes disso acusava "nenhum login" à toa (12/10/2026, MacBook do Paulo na 0.1.6: a conta entrou 1 a 2 s depois
// da falha). Quem sabe se há conta a caminho é o agente (`credencial.esperandoConta` no `reveza status --json`).

/**
 * Espera enquanto o agente disser que a conta está a caminho, até `segundos`. `lerEstado` devolve o estado do agente
 * (ou null, parado). Devolve quantos segundos esperou e se a espera terminou porque a conta chegou.
 */
export async function esperarConta(lerEstado, { segundos = 60, passoMs = 2000, dormir = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let esperou = 0;
  while (true) {
    const e = lerEstado();
    if (e?.credencial?.esperandoConta !== true) return { esperou: Math.round(esperou / 1000), chegou: esperou > 0 };
    if (esperou >= segundos * 1000) return { esperou: Math.round(esperou / 1000), chegou: false };
    await dormir(passoMs);
    esperou += passoMs;
  }
}
