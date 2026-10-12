import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { hmacHex } from './register'

// Agente falso: responde /api/ativa com a versão do momento e guarda o que o mod mandou.
function agente(on: On) {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sessao-teste' }))
  on('session.cwd', () => ({ value: '/tmp/projeto' }))
  on('session.surfaces', () => ({ value: ['terminal' as const] }))
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('classic.StopFailure', () => ({}) as never)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  const recebidos: { url: string; corpo: Record<string, unknown> | null; metodo: string; cabecalhos: Record<string, string> }[] = []
  const estado = { versao: 3, email: 'a@exemplo.com', foraDoAr: false, impostor: false }
  on('http.fetch', async ($, e) => {
    if (estado.foraDoAr) throw new Error('ECONNREFUSED')
    const corpo = e.init?.body ? (JSON.parse(e.init.body) as Record<string, unknown>) : null
    recebidos.push({
      url: e.url,
      corpo,
      metodo: e.init?.method ?? 'GET',
      cabecalhos: (e.init?.headers ?? {}) as Record<string, string>,
    })
    let resposta: unknown = { ok: true }
    if (e.url.endsWith('/api/ativa')) resposta = { slug: 'a', email: estado.email, versao: estado.versao, trocadaEm: 0 }
    if (e.url.endsWith('/api/limite')) resposta = { ok: true, versao: estado.versao }
    if (e.url.endsWith('/api/estado'))
      resposta = {
        auto: true,
        modo: 'limiar',
        limiares: { aviso: 90, troca: 95 },
        contas: [
          { email: 'a@exemplo.com', org: 'Org A', estado: 'ativa', janelas: [{ tipo: 'five_hour', rotulo: '5 horas', pct: 42, resetEm: null }] },
          { email: 'b@exemplo.com', org: null, estado: 'livre', janelas: [{ tipo: 'seven_day_opus', pct: 12, resetEm: null }] },
        ],
      }
    const nonce = ((e.init?.headers ?? {}) as Record<string, string>)['X-Reveza-Nonce'] ?? ''
    const headers: Record<string, string> = estado.impostor ? {} : { 'x-reveza-servidor': await hmacHex('c'.repeat(64), `servidor\n${nonce}`) }
    return { value: { status: 200, ok: true, headers, text: JSON.stringify(resposta) } }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }) as never)
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/teste' : undefined }))
  on('fs.read', ($, e) => {
    if (e.path === '/home/teste/.reveza/ponte.chave') return { value: `${'c'.repeat(64)}\n` }
    throw new Error('ENOENT')
  })
  return { recebidos, estado }
}

test('no limite, avisa o agente e continua sozinha quando a conta troca', async ($, on) => {
  const relogio = mock.clock(on)
  const { recebidos, estado } = agente(on)
  const enviados: string[] = []
  on('prompt.submit', ($, e) => {
    enviados.push(e.text)
    return { text: e.text }
  })

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await relogio.advance(5000)
  // a prova do agente é conferida com digest assíncrono: deixa a leitura da conta em uso terminar
  await relogio.settle()
  await $.classic.StopFailure({ error: 'rate_limit' })

  // a chave nunca viaja: vai só a prova
  expect(recebidos.every(r => r.cabecalhos['X-Reveza-Chave'] === undefined)).toBe(true)
  expect(recebidos.every(r => /^[0-9a-f]{64}$/.test(String(r.cabecalhos['X-Reveza-Prova'])))).toBe(true)
  expect(recebidos.every(r => !JSON.stringify(r.cabecalhos).includes('c'.repeat(64)))).toBe(true)
  const limite = recebidos.find(r => r.url.endsWith('/api/limite'))
  expect(limite?.corpo).toMatchObject({ erro: 'rate_limit', tipo: 'interativa', versao: 3, sessao: 'sessao-teste' })

  await relogio.advance(5000)
  expect(enviados).toHaveLength(0)

  estado.versao = 4
  estado.email = 'b@exemplo.com'
  await relogio.advance(5000)
  await relogio.settle()
  for (let i = 0; i < 5 && enviados.length === 0; i++) {
    await relogio.advance(5000)
    await relogio.settle()
  }
  expect(enviados).toHaveLength(1)
  expect(enviados[0]).toContain('trocou de conta')
  expect(enviados[0]).not.toContain('b@exemplo.com') // o que a ponte devolve não entra no prompt
  expect(recebidos.some(r => r.url.includes('/api/fila/') && r.url.endsWith('/retomada'))).toBe(true)
})

test('a pessoa digitou durante a espera: não manda continuar por cima', async ($, on) => {
  const relogio = mock.clock(on)
  const { estado } = agente(on)
  const enviados: string[] = []
  on('prompt.submit', ($, e) => {
    enviados.push(e.text)
    return { text: e.text }
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await relogio.advance(5000)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await $.turn.start({ text: 'outra coisa', turnId: 't1' })
  estado.versao = 4
  await relogio.advance(5000)
  await relogio.settle()
  expect(enviados).toHaveLength(0)
})

test('outro erro de API não mexe no agente', async ($, on) => {
  const { recebidos } = agente(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.classic.StopFailure({ error: 'overloaded' })
  expect(recebidos.some(r => r.url.endsWith('/api/limite'))).toBe(false)
})

test('o uso de cada resposta vai para o agente, com o cabeçalho X-Reveza e na porta padrão', async ($, on) => {
  const { recebidos } = agente(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.session.measure({
    context: { window: 200000 } as never,
    rateLimits: [{ kind: 'five_hour', percentUsed: 91.5, resetsAt: '2026-10-11T01:50:00Z' }],
    changed: ['rateLimits'],
  })
  const medida = recebidos.find(r => r.url.endsWith('/api/medida'))
  expect(medida?.corpo).toMatchObject({ janelas: [{ tipo: 'five_hour', pct: 91.5 }] })
  expect(medida?.url.startsWith('http://127.0.0.1:7788/')).toBe(true)
  expect(medida?.cabecalhos['X-Reveza']).toBe('1')
})

test('a porta do agente vem da configuração do mod', { options: { porta: 7799 } }, async ($, on) => {
  const { recebidos } = agente(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.session.measure({
    context: { window: 200000 } as never,
    rateLimits: [{ kind: 'five_hour', percentUsed: 10 }],
    changed: ['rateLimits'],
  })
  expect(recebidos.some(r => r.url.startsWith('http://127.0.0.1:7799/api/medida'))).toBe(true)
})

test('/reveza resume as contas, sem marca de terceiros', async ($, on) => {
  agente(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({
    command: 'reveza',
    args: '',
    origin: { kind: 'composer' } as never,
    presentation: { isFullscreen: false, columns: 100 },
  })
  expect(r.text).toContain('a@exemplo.com')
  expect(r.text).toContain('5 horas 42%')
  expect(r.text).toContain('Semana, modelo maior 12%')
  expect(r.text).toContain('Troca automática ligada')
  expect(/claude|anthropic|opus|sonnet/i.test(r.text ?? '')).toBe(false)
})

test('/reveza com o agente fora do ar explica como ligar', async ($, on) => {
  const { estado } = agente(on)
  estado.foraDoAr = true
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({
    command: 'reveza',
    args: '',
    origin: { kind: 'composer' } as never,
    presentation: { isFullscreen: false, columns: 100 },
  })
  expect(r.text).toContain('fora do ar')
  expect(r.text).toContain('reveza servico instalar')
})

test('HMAC-SHA256 do mod bate com o vetor do RFC 4231 (caso 1)', async () => {
  expect(await hmacHex('0b'.repeat(20), 'Hi There')).toBe('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7')
})

test('outro programa na porta (sem a prova do agente) não controla o /reveza nem a retomada', async ($, on) => {
  const { estado } = agente(on)
  estado.impostor = true
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({ command: 'reveza', args: '' })
  expect(String(r.text)).not.toContain('Org A')
})

