import type { HttpInit, Register, SessionRateLimit } from 'claude-code'

// O lado de cada sessão do Reveza AI (o agente roda no computador e escuta em 127.0.0.1, porta configurável).
// 1. Mostra na linha de status a conta em uso e o % da janela de 5 h.
// 2. Manda ao agente o uso que cada resposta trouxe (de graça e ao vivo): é com ele que a troca acontece na hora certa.
// 3. Quando a sessão bate o limite, avisa o agente (que troca na hora) e, assim que a conta muda, manda a sessão
//    continuar de onde parou. Sessão de terminal (`-p`) quem retoma é o agente, pelo --resume.

export const PORTA_PADRAO = 7788
const ESPERA_MAXIMA_MS = 2 * 60 * 60 * 1000
const LEITURA_MS = 30_000

export type Ativa = { slug: string | null; email: string | null; versao: number; trocadaEm: number }
type Janela = { tipo: string; rotulo?: string; pct: number | null; resetEm: number | null }
type Conta = { email: string; org: string | null; estado: string; janelas: Janela[] }
export type Estado = {
  contas: Conta[]
  auto: boolean
  modo?: string
  limiares: { aviso: number; troca: number }
  sombra?: boolean
  nuvem?: { ligada?: boolean; online?: boolean | null }
}

const ROTULO_ESTADO: Record<string, string> = {
  ativa: 'em uso',
  proxima: 'próxima',
  livre: 'livre',
  esgotada: 'esgotada',
  pausada: 'pausada',
  precisa_login: 'precisa entrar de novo',
  sem_leitura: 'sem leitura',
}

const ROTULO_JANELA: Record<string, string> = {
  five_hour: '5 horas',
  seven_day: 'Semana',
  seven_day_opus: 'Semana, modelo maior',
  seven_day_sonnet: 'Semana, modelo médio',
}

export function base(porta: unknown): string {
  const p = typeof porta === 'number' && Number.isInteger(porta) && porta > 0 && porta < 65536 ? porta : PORTA_PADRAO
  return `http://127.0.0.1:${p}`
}

function hora(epoch: number): string {
  const d = new Date(epoch * 1000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function janelasTexto(janelas: Janela[]): string {
  const partes = janelas
    .filter(j => j.pct !== null)
    .map(
      j =>
        `${ROTULO_JANELA[j.tipo] ?? j.rotulo ?? j.tipo} ${Math.round(j.pct ?? 0)}%${j.resetEm ? ` (renova ${hora(j.resetEm)})` : ''}`,
    )
  return partes.length ? partes.join(', ') : 'sem leitura ainda'
}

export function resumo(estado: Estado): string {
  const linhas = estado.contas.map(
    c => `- ${c.email}${c.org ? ` (${c.org})` : ''}: ${ROTULO_ESTADO[c.estado] ?? c.estado}. ${janelasTexto(c.janelas)}`,
  )
  const modo =
    estado.modo === 'limite'
      ? 'só no limite'
      : estado.modo === 'rodizio'
        ? 'rodízio ao longo do dia'
        : `aviso em ${estado.limiares.aviso}%, troca em ${estado.limiares.troca}%`
  const troca = estado.auto ? `Troca automática ligada (${modo}).` : 'Troca automática desligada.'
  const extra: string[] = []
  if (estado.sombra) extra.push('Agente em modo sombra: só observa e registra o que faria.')
  if (estado.nuvem?.ligada && estado.nuvem.online === false) extra.push('Sem falar com a nuvem agora: a conta atual fica.')
  return ['Reveza AI', troca, ...extra, ...(linhas.length ? linhas : ['Nenhuma conta conectada. No terminal: reveza contas conectar <email>'])].join(
    '\n',
  )
}

export function janelasDaMedida(limites: readonly SessionRateLimit[]) {
  return limites
    .filter(l => l.kind === 'five_hour' || l.kind === 'seven_day')
    .map(l => ({ tipo: l.kind, pct: l.percentUsed, resetEm: l.resetsAt ?? null }))
}

// Chave local da ponte (~/.reveza/ponte.chave, só o dono do computador lê): sem ela o agente responde 401.
// A chave nunca viaja: vai só a prova (HMAC-SHA256 do método, caminho, hora e nonce), para que outro programa que
// estiver na porta no lugar do agente não a aprenda.
let chavePonte = ''

const hexParaBytes = (h: string) => new Uint8Array((h.match(/../g) ?? []).map(x => parseInt(x, 16)))
const bytesParaHex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')

/** HMAC-SHA256 só com o digest (o ambiente do mod não tem importKey/sign). Chave em hex, até 64 bytes. */
export async function hmacHex(chaveHex: string, mensagem: string): Promise<string> {
  const k = new Uint8Array(64)
  k.set(hexParaBytes(chaveHex).slice(0, 64))
  const msg = new TextEncoder().encode(mensagem)
  const dentro = new Uint8Array(64 + msg.length)
  const fora = new Uint8Array(64 + 32)
  for (let i = 0; i < 64; i++) {
    dentro[i] = k[i]! ^ 0x36
    fora[i] = k[i]! ^ 0x5c
  }
  dentro.set(msg, 64)
  fora.set(new Uint8Array(await crypto.subtle.digest('SHA-256', dentro)), 64)
  return bytesParaHex(new Uint8Array(await crypto.subtle.digest('SHA-256', fora)))
}

async function pedido(metodo: string, caminho: string, corpo?: unknown): Promise<{ init: HttpInit; nonce: string }> {
  const prova: Record<string, string> = {}
  const nonce = crypto.randomUUID()
  if (chavePonte) {
    const tempo = String(Date.now())
    prova['X-Reveza-Tempo'] = tempo
    prova['X-Reveza-Nonce'] = nonce
    prova['X-Reveza-Prova'] = await hmacHex(chavePonte, `${metodo}\n${caminho}\n${tempo}\n${nonce}`)
  }
  return {
    init: {
      method: metodo,
      headers: { 'Content-Type': 'application/json', 'X-Reveza': '1', ...prova },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    },
    nonce,
  }
}

/** A resposta veio do agente de verdade? Ele assina com a mesma chave; outro programa na porta não consegue. */
async function doAgente(r: { ok: boolean; headers?: Record<string, string> }, nonce: string): Promise<boolean> {
  if (!r.ok || !chavePonte) return false
  return (r.headers?.['x-reveza-servidor'] ?? '') === (await hmacHex(chavePonte, `servidor\n${nonce}`))
}

function lerJson<T>(r: { ok: boolean; text: string }): T | null {
  if (!r.ok) return null
  try {
    return JSON.parse(r.text) as T
  } catch {
    return null
  }
}

export const register: Register = (on, options) => {
  const BASE = base(options?.porta)
  let sessao = ''
  let interativa = true
  let versao: number | null = null
  let email: string | null = null
  let cinco = ''
  let foraDoAr = false
  let ultimaLeitura = 0
  let espera: { referencia: number; desde: number } | null = null
  let retomando = false

  function textoStatus(): string | undefined {
    if (foraDoAr) return 'Reveza: agente fora do ar'
    if (!email) return undefined
    return `conta ${email.split('@')[0]}${cinco ? ` · ${cinco}` : ''}`
  }

  // Devolve o aviso a mostrar quando a conta mudou desde a última leitura.
  function aplicarAtiva(a: Ativa): string | null {
    const mudou = versao !== null && a.versao !== versao && !!a.email && a.email !== email
    versao = a.versao
    email = a.email
    if (!mudou) return null
    cinco = ''
    return `Reveza: agora na conta ${a.email}`
  }

  on('session.start', async ($, e, next) => {
    interativa = e.isInteractive
    sessao = await $.session.id()
    const raiz =
      (await $.env.get('REVEZA_HOME')) ??
      `${(await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''}/.reveza`
    chavePonte = String(await $.fs.read(`${raiz}/ponte.chave`).catch(() => '')).trim()
    await $.command.register({
      name: 'reveza',
      description: 'Reveza AI: a conta em uso, o uso de cada conta e o estado do agente',
    })

    $.clock.every(5000, () => {
      void (async () => {
        // o agente pode ter subido depois da sessão (a chave nasce com ele)
        if (!chavePonte) chavePonte = String(await $.fs.read(`${raiz}/ponte.chave`).catch(() => '')).trim()
        if (!espera && Date.now() - ultimaLeitura < LEITURA_MS) return
        ultimaLeitura = Date.now()
        let ativa: Ativa | null = null
        try {
          const p = await pedido('GET', '/api/ativa')
          const r = await $.http.fetch(`${BASE}/api/ativa`, p.init)
          ativa = (await doAgente(r, p.nonce)) ? lerJson<Ativa>(r) : null
          foraDoAr = false
        } catch {
          foraDoAr = true
        }
        const aviso = ativa ? aplicarAtiva(ativa) : null
        if (aviso) $.ui.toast(aviso)
        $.ui.status(textoStatus())

        if (espera && Date.now() - espera.desde > ESPERA_MAXIMA_MS) espera = null
        if (!espera || !ativa || ativa.versao <= espera.referencia) return
        espera = null
        retomando = true
        await $.prompt.submit({
          // texto fixo: o que a ponte local devolve não entra no prompt (outro programa poderia ocupar a porta)
          text: 'A conta anterior bateu o limite de uso e o Reveza trocou de conta. Continue a tarefa de onde parou.',
        })
        await $.http
          .fetch(
            `${BASE}/api/fila/${encodeURIComponent(sessao)}/retomada`,
            (await pedido('POST', `/api/fila/${encodeURIComponent(sessao)}/retomada`, {})).init,
          )
          .catch(() => undefined)
      })()
    })

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits') && e.rateLimits.length > 0) {
      const janelas = janelasDaMedida(e.rateLimits)
      const cincoHoras = e.rateLimits.find(l => l.kind === 'five_hour')
      cinco = cincoHoras ? `5h ${Math.round(cincoHoras.percentUsed)}%` : ''
      $.ui.status(textoStatus())
      if (janelas.length > 0) {
        await $.http
          .fetch(`${BASE}/api/medida`, (await pedido('POST', '/api/medida', { sessao, versao, janelas })).init)
          .catch(() => undefined)
      }
    }
    return next(e)
  })

  on('classic.StopFailure', async ($, e, next) => {
    if (e.error !== 'rate_limit') return next(e)
    const superficies = await $.session.surfaces().catch(() => [])
    const tipo = interativa || superficies.length > 0 ? 'interativa' : 'headless'
    const antes = versao
    let resposta: { ok: boolean; versao: number } | null = null
    try {
      const p = await pedido('POST', '/api/limite', { sessao, cwd: await $.session.cwd(), tipo, erro: 'rate_limit', versao: antes })
      const r = await $.http.fetch(`${BASE}/api/limite`, p.init)
      resposta = (await doAgente(r, p.nonce)) ? lerJson(r) : null
    } catch {
      resposta = null
    }
    if (!resposta) {
      $.ui.toast('Limite da conta atingido e o agente do Reveza está fora do ar: a sessão espera o reset.')
    } else if (tipo === 'interativa') {
      espera = { referencia: antes ?? resposta.versao, desde: Date.now() }
      $.ui.toast('Limite da conta atingido. Assim que o Reveza trocar de conta, a sessão continua sozinha.')
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', ($, e, next) => {
    // Turno que não foi o nosso (a pessoa digitou, ou o assistente continuou sozinho no reset): a espera acabou.
    if (!retomando) espera = null
    retomando = false
    return next(e)
  })

  on('command.run', { command: 'reveza' }, async $ => {
    let estado: Estado | null = null
    if (!chavePonte) {
      const raiz =
        (await $.env.get('REVEZA_HOME')) ??
        `${(await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''}/.reveza`
      chavePonte = String(await $.fs.read(`${raiz}/ponte.chave`).catch(() => '')).trim()
    }
    try {
      const p = await pedido('GET', '/api/estado')
      const r = await $.http.fetch(`${BASE}/api/estado`, p.init)
      estado = (await doAgente(r, p.nonce)) ? lerJson<Estado>(r) : null
    } catch {
      estado = null
    }
    if (!estado) {
      return {
        text: 'O agente do Reveza está fora do ar. No terminal: reveza servico instalar (ou reveza rodar), e depois reveza doctor.',
      }
    }
    return { text: resumo(estado) }
  })
}
