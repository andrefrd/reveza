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

/** Inscreve este aparelho no push, com a chave pública de push da instalação. */
export async function inscreverPush(chavePublica: string): Promise<PushSubscriptionJSON> {
  const registro = await navigator.serviceWorker.ready
  const permissao = await Notification.requestPermission()
  if (permissao !== "granted") throw new Error("push_negado")
  const chave = Uint8Array.from(atob(chavePublica.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))
  const inscricao = await registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chave })
  return inscricao.toJSON()
}

/** Notificação de teste local, mostrada pelo service worker (sem passar pela nuvem). */
export async function notificacaoDeTeste(titulo: string, corpo: string) {
  const permissao = await Notification.requestPermission()
  if (permissao !== "granted") throw new Error("push_negado")
  const registro = await navigator.serviceWorker.getRegistration()
  if (registro)
    await registro.showNotification(titulo, {
      body: corpo,
      icon: "/icones/icone-192.png",
      badge: "/icones/icone-192.png",
    })
  else new Notification(titulo, { body: corpo })
}
