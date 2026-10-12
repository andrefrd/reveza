// Som de aviso quando este computador troca de conta (pedido do dono, 11/10/2026). Usa o som do próprio sistema, sem
// arquivo do projeto: no macOS o `afplay` com um som do sistema, no Linux o `paplay` ou o `canberra-gtk-play` (numa VPS
// sem som nada toca, e tudo bem), no Windows o SoundPlayer do .NET pelo PowerShell. Nunca atrasa nem derruba a troca:
// roda solto, com prazo, e se não tocar só fica no log.

import type { Sistema } from "./config.js";
import type { Executor } from "./util/executor.js";

const WINDOWS_WAV = "C:\\Windows\\Media\\Windows Notify System Generic.wav";

/** Os jeitos de tocar, em ordem: o primeiro que funcionar vale. */
export function comandosDoSom(sistema: Sistema): string[][] {
  if (sistema === "macos") return [["afplay", "/System/Library/Sounds/Glass.aiff"]];
  if (sistema === "windows") {
    return [["powershell", "-NoProfile", "-NonInteractive", "-Command", `(New-Object Media.SoundPlayer '${WINDOWS_WAV}').PlaySync()`]];
  }
  return [
    ["paplay", "/usr/share/sounds/freedesktop/stereo/complete.oga"],
    ["canberra-gtk-play", "-i", "complete"],
  ];
}

export async function tocarSom(exec: Executor, sistema: Sistema): Promise<boolean> {
  for (const argv of comandosDoSom(sistema)) {
    try {
      const r = await exec.rodar(argv, { timeoutMs: 5000 });
      if (r.codigo === 0) return true;
    } catch {
      // tenta o próximo
    }
  }
  return false;
}
