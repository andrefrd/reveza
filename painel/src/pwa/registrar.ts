// Aplicativo no celular (PWA): registra o service worker (casca offline e recebimento de push) só no build de
// produção. No modo de desenvolvimento, nada fica em cache.

export function registrarServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // sem service worker o painel funciona igual, só não abre sem internet
    })
  })
}

/** Evento de "instalar o app" que o navegador oferece (Chrome/Edge/Android). Guardado para o botão de Minha conta. */
export interface PedidoInstalacao extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

let pedido: PedidoInstalacao | null = null
const ouvintes = new Set<() => void>()

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault()
    pedido = e as PedidoInstalacao
    for (const o of ouvintes) o()
  })
  window.addEventListener("appinstalled", () => {
    pedido = null
    for (const o of ouvintes) o()
  })
}

export function pedidoDeInstalacao() {
  return pedido
}

export function aoMudarInstalacao(cb: () => void) {
  ouvintes.add(cb)
  return () => {
    ouvintes.delete(cb)
  }
}

export function jaInstalado(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches
}

// A inscrição de push e a notificação de teste moram em ./notificacoes.
