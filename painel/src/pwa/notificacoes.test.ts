import { afterEach, describe, expect, it, vi } from "vitest"

import { ErroPainel } from "@/dados/fonte"
import {
  chaveDeAplicacao,
  ehIos,
  inscreverPush,
  pedirPermissao,
  registroServiceWorker,
  suporteNotificacao,
  suportePush,
} from "./notificacoes"

const CHROME_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36"
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Version/18.5 Mobile/15E148 Safari/604.1"

/** Um navegador de mentira: o que cada teste precisa de window, navigator e Notification. */
function navegador({
  ua = CHROME_MAC,
  toque = 0,
  app = false,
  notificacao = true,
  push = true,
  permissao = "default" as NotificationPermission,
  resposta = "granted" as NotificationPermission,
  sw = {} as Record<string, unknown> | null,
} = {}) {
  const pedir = vi.fn(async () => resposta)
  const janela: Record<string, unknown> = { matchMedia: () => ({ matches: app }) }
  if (notificacao)
    janela.Notification = Object.assign(function Notification() {}, { permission: permissao, requestPermission: pedir })
  if (push) janela.PushManager = function PushManager() {}
  vi.stubGlobal("window", janela)
  if (notificacao) vi.stubGlobal("Notification", janela.Notification)
  vi.stubGlobal("navigator", { userAgent: ua, maxTouchPoints: toque, ...(sw ? { serviceWorker: sw } : {}) })
  return { pedir }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("o que o navegador suporta", () => {
  it("iPhone e iPad (que se apresenta como Mac, com toque) no Safari: só com o painel instalado", () => {
    expect(ehIos({ userAgent: SAFARI_IPHONE, maxTouchPoints: 5 })).toBe(true)
    expect(ehIos({ userAgent: CHROME_MAC.replace("Chrome/141.0.0.0 ", ""), maxTouchPoints: 5 })).toBe(true)
    expect(ehIos({ userAgent: CHROME_MAC, maxTouchPoints: 0 })).toBe(false)

    navegador({ ua: SAFARI_IPHONE, toque: 5, notificacao: false, push: false, sw: null })
    expect(suporteNotificacao()).toBe("ios_instalar")
    expect(suportePush()).toBe("ios_instalar")
    // instalado na tela inicial (iOS 16.4 ou mais novo): tem tudo
    navegador({ ua: SAFARI_IPHONE, toque: 5, app: true })
    expect(suportePush()).toBe("ok")
  })

  it("navegador sem notificação nem push", () => {
    navegador({ notificacao: false, push: false, sw: null })
    expect(suporteNotificacao()).toBe("sem_suporte")
    expect(suportePush()).toBe("sem_suporte")
  })
})

describe("permissão", () => {
  const codigo = (p: Promise<unknown>) =>
    p.then(
      () => "ok",
      (e) => (e instanceof ErroPainel ? e.codigo : `outro: ${e}`)
    )

  it("pede uma vez e diz o que fazer quando bloqueia, fecha sem responder ou não existe", async () => {
    const { pedir } = navegador({ resposta: "granted" })
    expect(await codigo(pedirPermissao())).toBe("ok")
    expect(pedir).toHaveBeenCalledTimes(1)

    navegador({ permissao: "denied" })
    expect(await codigo(pedirPermissao())).toBe("notif_bloqueada")
    navegador({ resposta: "denied" })
    expect(await codigo(pedirPermissao())).toBe("notif_bloqueada")
    navegador({ resposta: "default" })
    expect(await codigo(pedirPermissao())).toBe("notif_sem_resposta")
    navegador({ ua: SAFARI_IPHONE, toque: 5, notificacao: false, push: false, sw: null })
    expect(await codigo(pedirPermissao())).toBe("notif_ios_instalar")
    navegador({ notificacao: false })
    expect(await codigo(pedirPermissao())).toBe("notif_sem_suporte")
  })
})

describe("inscrição de push", () => {
  // uma chave pública P-256 qualquer, em base64url sem "=" (como o VAPID_PUBLICA)
  const CHAVE = "BJ-QsKsdog3wESitoVxEQA_plGpO_D5rzR08nTiC_jM8NfPOOt8RsV0h1b-5HXUaC5yh5pQkqwvoYbSyLQwF9z0"

  it("a chave vira os 65 bytes que o navegador pede", () => {
    const b = chaveDeAplicacao(CHAVE)
    expect(b.length).toBe(65)
    expect(b[0]).toBe(4)
  })

  function swFalso({ antiga = null as null | { chave: Uint8Array }, recusa = null as null | Error } = {}) {
    const inscrever = vi.fn(async ({ applicationServerKey }: { applicationServerKey: Uint8Array }) => {
      if (recusa) throw recusa
      return {
        options: { applicationServerKey: applicationServerKey.buffer },
        toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/novo", keys: { p256dh: "p", auth: "a" } }),
      }
    })
    const desinscrever = vi.fn(async () => true)
    const registro = {
      pushManager: {
        getSubscription: async () =>
          antiga
            ? {
                options: { applicationServerKey: antiga.chave.buffer },
                unsubscribe: desinscrever,
                toJSON: () => ({
                  endpoint: "https://fcm.googleapis.com/fcm/send/antigo",
                  keys: { p256dh: "p", auth: "a" },
                }),
              }
            : null,
        subscribe: inscrever,
      },
    }
    const sw = { getRegistration: async () => registro, register: vi.fn(), ready: Promise.resolve(registro) }
    return { sw, inscrever, desinscrever }
  }

  it("reaproveita a inscrição com a mesma chave e refaz a de outra chave", async () => {
    const mesma = swFalso({ antiga: { chave: chaveDeAplicacao(CHAVE) } })
    navegador({ sw: mesma.sw })
    expect((await inscreverPush(CHAVE)).endpoint).toContain("antigo")
    expect(mesma.inscrever).not.toHaveBeenCalled()

    const outra = swFalso({ antiga: { chave: new Uint8Array(65).fill(9) } })
    navegador({ sw: outra.sw })
    expect((await inscreverPush(CHAVE)).endpoint).toContain("novo")
    expect(outra.desinscrever).toHaveBeenCalledTimes(1)
  })

  it("bloqueio na inscrição vira o aviso de permissão; sem service worker não fica girando para sempre", async () => {
    const recusado = swFalso({ recusa: new DOMException("denied", "NotAllowedError") })
    navegador({ sw: recusado.sw })
    await expect(inscreverPush(CHAVE)).rejects.toMatchObject({ codigo: "notif_bloqueada" })

    navegador({
      sw: { getRegistration: async () => undefined, register: vi.fn(async () => ({})), ready: new Promise(() => {}) },
    })
    await expect(registroServiceWorker(20)).rejects.toMatchObject({ codigo: "notif_sem_service_worker" })
  })
})
