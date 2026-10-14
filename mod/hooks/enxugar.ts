// Saída enxuta (desligada por padrão; o painel liga por computador): encurta a saída de comandos de leitura conhecidos
// antes de ela entrar na conversa, e a janela da conta rende mais. Sai só o que se repete ou não informa (as dicas do
// git status, o caminho repetido no grep e no find, a linha "index" do git diff, o "total" e o . e .. do ls -l) e o
// excesso de uma listagem longa; quando corta linhas, a saída diz quantas e como ver tudo. Comando que não é um só comando simples (pipe, redirecionamento, `;`,
// `&&`, subcomando) passa inteiro: por isso "o mesmo comando com | cat" mostra tudo.

export const LIMITE_LINHAS = 300
export const LIMITE_ARQUIVO_DIFF = 200
const VER_TUDO = 'para ver tudo, rode o mesmo comando com | cat no fim'

/** As palavras do comando, se ele for um só comando simples. Aceita um `cd <pasta> &&` na frente. */
export function palavras(comando: string): string[] | null {
  let c = comando.trim()
  if (/`|\$\(/.test(c)) return null
  const cd = /^cd\s+(?:"[^"]*"|'[^']*'|[^\s"';&|<>()]+)\s*&&\s*/.exec(c)
  if (cd) c = c.slice(cd[0].length)
  const fora = c.replace(/"[^"]*"|'[^']*'/g, '')
  if (/["'|;&<>\n\r]/.test(fora)) return null
  const p = (c.match(/(?:"[^"]*"|'[^']*'|[^\s"'])+/g) ?? []).map(w => w.replace(/^(["'])(.*)\1$/, '$2'))
  while (p.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(p[0]!)) p.shift()
  return p.length > 0 ? p : null
}

function cortar(ls: string[], limite = LIMITE_LINHAS): string[] {
  if (ls.length <= limite) return ls
  return [...ls.slice(0, limite), `[Reveza: mais ${ls.length - limite} linhas cortadas; ${VER_TUDO}]`]
}

// Junta em bloco as linhas seguidas que começam pelo mesmo prefixo (`chave` devolve [prefixo, resto] ou null).
// Linha sozinha fica como veio. Devolve null se alguma linha não tiver prefixo.
function agrupar(ls: string[], chave: (l: string) => [string, string] | null, cabecalho: (k: string) => string): string[] | null {
  const partes = ls.map(chave)
  if (partes.some(p => p === null)) return null
  const saida: string[] = []
  for (let i = 0; i < ls.length; ) {
    const k = partes[i]![0]
    let j = i
    while (j < ls.length && partes[j]![0] === k) j++
    if (j - i === 1) saida.push(ls[i]!)
    else {
      saida.push(cabecalho(k))
      for (let x = i; x < j; x++) saida.push(`  ${partes[x]![1]}`)
    }
    i = j
  }
  return saida
}

// "  (use "git add <file>..." to include in what will be committed)": as dicas do git, em qualquer idioma
const DICA_GIT = /\s*\((?:[^()"]*"git [^"]*")+[^()]*\)\s*$/

function gitStatus(ls: string[]): string[] {
  return cortar(ls.map(l => l.replace(DICA_GIT, '')).filter(l => l.trim() !== ''))
}

function gitDiff(ls: string[]): string[] {
  // --stat, --name-only e afins não trazem patch: só o corte de linhas vale
  if (!ls.some(l => l.startsWith('diff --git '))) return cortar(ls)
  const saida: string[] = []
  let corpo = 0
  let cortadas = 0
  const fechar = () => {
    if (cortadas > 0) saida.push(`[Reveza: mais ${cortadas} linhas deste arquivo cortadas; ${VER_TUDO}]`)
    corpo = 0
    cortadas = 0
  }
  let noArquivo = false
  for (const l of ls) {
    if (l.startsWith('diff --git ')) {
      fechar()
      noArquivo = true
      saida.push(l)
      continue
    }
    if (!noArquivo) {
      saida.push(l)
      continue
    }
    if (corpo === 0 && /^index [0-9a-f]+\.\.[0-9a-f]+/.test(l)) continue
    if (corpo === 0 && !l.startsWith('@@')) {
      saida.push(l)
      continue
    }
    corpo++
    if (corpo > LIMITE_ARQUIVO_DIFF) cortadas++
    else saida.push(l)
  }
  fechar()
  return saida
}

function git(args: string[], ls: string[]): string[] | null {
  let i = 0
  while (i < args.length && args[i]!.startsWith('-')) i += args[i] === '-C' || args[i] === '-c' ? 2 : 1
  const sub = args[i]
  // formato de máquina (--porcelain, -s, -z) não tem dica nenhuma: fica como veio
  if (sub === 'status') return args.slice(i + 1).some(a => /^(--porcelain|--short|-[^-]*[sz])/.test(a)) ? null : gitStatus(ls)
  if (sub === 'diff' || sub === 'show') return gitDiff(ls)
  return null
}

function lista(args: string[], ls: string[]): string[] {
  // ls -l: a linha "total" e as entradas . e .. não dizem nada
  const longo = args.some(a => /^-[^-]*l/.test(a))
  return cortar(longo ? ls.filter(l => !/^total \d+$/.test(l) && !/^[dl][rwxsStT-]{9}[@+.]?\s.*\s\.\.?$/.test(l)) : ls)
}

const FIND_SEM_LISTA = /^-(printf|fprint.*|print0|ls|fls|exec|execdir|ok|okdir|delete)$/

function find(args: string[], ls: string[]): string[] | null {
  if (args.some(a => FIND_SEM_LISTA.test(a))) return null
  const grupos = agrupar(
    ls,
    l => {
      const b = l.lastIndexOf('/')
      // sem pasta na frente (o próprio ponto de partida): fica sozinha
      return b > 0 && b < l.length - 1 ? [l.slice(0, b + 1), l.slice(b + 1)] : [l, '']
    },
    k => k,
  )
  const melhor = grupos && grupos.join('\n').length < ls.join('\n').length ? grupos : ls
  return cortar(melhor)
}

// grep -c, -l, contexto (-A/-B/-C/-3) e saída com \0 não têm o "arquivo:linha" de sempre: só o corte de linhas vale.
const GREP_CURTO = /^-[^-]*[ABClLcZ0-9]/
const GREP_LONGO = /^--(context|after-context|before-context|count|files-with(out)?-match(es)?|null|json|heading|files|vimgrep)\b/

function grep(prog: string, args: string[], ls: string[]): string[] {
  if (args.some(a => GREP_CURTO.test(a) || GREP_LONGO.test(a))) return cortar(ls)
  const operandos = args.filter(a => !a.startsWith('-'))
  // grep -h (também junto, -rh); no rg o -h é a ajuda e o "sem nome" é o -I
  const semNome = args.some(a => a === '--no-filename' || (prog === 'rg' ? a === '-I' : /^-[^-]*h/.test(a)))
  const recursivo = args.some(a => /^-[^-]*[rRH]/.test(a) || a === '--recursive' || a === '--with-filename')
  // grep: o nome vem com -r/-H ou mais de um arquivo; rg: sempre, menos num arquivo só (o primeiro operando é o padrão)
  const arquivos = operandos.slice(1)
  const comNome =
    !semNome &&
    (prog === 'rg'
      ? !(arquivos.length === 1 && /\.[A-Za-z0-9]+$/.test(arquivos[0]!) && !/[*?[]/.test(arquivos[0]!))
      : recursivo || arquivos.length > 1 || arquivos.some(a => /[*?[]/.test(a)))
  if (!comNome) return cortar(ls)
  const grupos = agrupar(
    ls,
    l => {
      const d = l.indexOf(':')
      if (d <= 0) return null
      const arquivo = l.slice(0, d)
      // nome de arquivo de verdade: tem / ou ponto e não tem espaço (Windows "C:\..." cai fora: "C" não passa)
      return /^[^\s]*[/.][^\s]*$/.test(arquivo) ? [arquivo, l.slice(d + 1)] : null
    },
    k => k,
  )
  return cortar(grupos && grupos.join('\n').length < ls.join('\n').length ? grupos : ls)
}

/**
 * A saída enxuta de `comando`, ou null quando o comando não é conhecido ou não há o que tirar. Só stdout; o stderr
 * fica como veio.
 */
export function enxugarSaida(comando: string, stdout: string): string | null {
  const p = palavras(comando)
  if (!p || !stdout) return null
  const fim = stdout.endsWith('\n') ? '\n' : ''
  const ls = (fim ? stdout.slice(0, -1) : stdout).split('\n')
  const prog = p[0]!.split('/').pop() ?? ''
  const args = p.slice(1)
  let saida: string[] | null = null
  if (prog === 'git') saida = git(args, ls)
  else if (prog === 'ls') saida = lista(args, ls)
  else if (prog === 'find') saida = find(args, ls)
  else if (prog === 'grep' || prog === 'egrep' || prog === 'fgrep' || prog === 'rg') saida = grep(prog, args, ls)
  else if (prog === 'tree') saida = cortar(ls)
  if (!saida) return null
  const texto = saida.join('\n') + fim
  return texto.length < stdout.length ? texto : null
}
