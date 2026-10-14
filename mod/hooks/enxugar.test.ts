import { expect, test } from 'claude-code/testing'

import { enxugarSaida, LIMITE_ARQUIVO_DIFF, LIMITE_LINHAS, palavras } from './enxugar'

const linhas = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i)).join('\n') + '\n'

test('palavras: só comando simples; um cd na frente vale, pipe, redirecionamento e subcomando não', async () => {
  expect(palavras('git status')).toEqual(['git', 'status'])
  expect(palavras('cd "/tmp/a b" && git -C x status')).toEqual(['git', '-C', 'x', 'status'])
  expect(palavras('LANG=C grep -rn "a|b" src')).toEqual(['grep', '-rn', 'a|b', 'src'])
  expect(palavras("grep -n 'x; y' arquivo.ts")).toEqual(['grep', '-n', 'x; y', 'arquivo.ts'])
  for (const c of ['git status | cat', 'ls > saida', 'ls; pwd', 'ls && pwd', 'cd a && ls && pwd', 'ls $(pwd)', 'ls `pwd`', 'ls &', 'ls\npwd', ''])
    expect(palavras(c)).toBe(null)
})

test('git status: tira as dicas e as linhas em branco; formato de máquina fica como veio', async () => {
  const s = 'On branch main\nUntracked files:\n  (use "git add <file>..." to include in what will be committed)\n\tnovo.ts\n\nnothing added to commit but untracked files present (use "git add" to track)\n'
  expect(enxugarSaida('git status', s)).toBe('On branch main\nUntracked files:\n\tnovo.ts\nnothing added to commit but untracked files present\n')
  expect(enxugarSaida('git -C pasta status', s)).not.toBe(null)
  for (const c of ['git status --porcelain', 'git status -s', 'git status --short', 'git status -sb', 'git status -z'])
    expect(enxugarSaida(c, ' M a.ts\n\n?? b.ts\n')).toBe(null)
  // nada a tirar: null, e o hook devolve a saída do Claude Code sem tocar
  expect(enxugarSaida('git status', 'On branch main\nnothing to commit, working tree clean\n')).toBe(null)
})

test('git diff: some a linha index e o excesso de cada arquivo, com aviso', async () => {
  const corpo = linhas(LIMITE_ARQUIVO_DIFF + 50, i => `+linha ${i}`)
  const d = `diff --git a/x.ts b/x.ts\nindex 1a2b3c4..5d6e7f8 100644\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1,250 @@\n${corpo}diff --git a/y.ts b/y.ts\nindex aaaaaaa..bbbbbbb 100644\n--- a/y.ts\n+++ b/y.ts\n@@ -1 +1 @@\n-a\n+b\n`
  const r = enxugarSaida('git diff', d)!
  expect(r).not.toContain('index 1a2b3c4')
  expect(r).not.toContain('index aaaaaaa')
  expect(r).toContain('[Reveza: mais 51 linhas deste arquivo cortadas; para ver tudo, rode o mesmo comando com | cat no fim]')
  expect(r).toContain('diff --git a/y.ts b/y.ts\n--- a/y.ts\n+++ b/y.ts\n@@ -1 +1 @@\n-a\n+b\n')
  // a linha "index" que é conteúdo do arquivo (depois do @@) fica
  expect(enxugarSaida('git show', 'diff --git a/i b/i\n@@ -1 +1 @@\n-index 1a..2b\n+x\n')).toBe(null)
})

test('git diff --stat e afins: sem patch, só o corte de linhas', async () => {
  const stat = linhas(LIMITE_LINHAS + 10, i => ` arquivo${i}.ts | 2 +-`)
  const r = enxugarSaida('git diff --stat', stat)!
  expect(r.split('\n')).toHaveLength(LIMITE_LINHAS + 2)
  expect(r).toContain('[Reveza: mais 10 linhas cortadas;')
  expect(enxugarSaida('git diff --name-only', 'a.ts\nb.ts\n')).toBe(null)
  expect(enxugarSaida('git log', linhas(LIMITE_LINHAS + 10, i => `commit ${i}`))).toBe(null)
})

test('ls -l: tira o total e o . e ..; ls sem -l só corta', async () => {
  const l = 'total 16\ndrwxr-xr-x   5 p  staff  160 Oct 13 10:00 .\ndrwxr-xr-x  20 p  staff  640 Oct 13 10:00 ..\n-rw-r--r--   1 p  staff   10 Oct 13 10:00 a.ts\ndrwxr-xr-x   3 p  staff   96 Oct 13 10:00 src\n'
  expect(enxugarSaida('ls -la', l)).toBe('-rw-r--r--   1 p  staff   10 Oct 13 10:00 a.ts\ndrwxr-xr-x   3 p  staff   96 Oct 13 10:00 src\n')
  expect(enxugarSaida('ls', 'a.ts\nsrc\n')).toBe(null)
})

test('find: junta os arquivos da mesma pasta; -exec e -print0 ficam como vieram', async () => {
  const f = './src/a.ts\n./src/b.ts\n./src/c.ts\n./x.ts\n.\n'
  expect(enxugarSaida('find . -name "*.ts"', f)).toBe('./src/\n  a.ts\n  b.ts\n  c.ts\n./x.ts\n.\n')
  expect(enxugarSaida('find . -exec echo {} +', f)).toBe(null)
  expect(enxugarSaida('find . -print0', f)).toBe(null)
})

test('grep -rn: junta as linhas do mesmo arquivo; -c, -l e contexto só cortam', async () => {
  const g = 'src/agente.ts:10:  const a = 1\nsrc/agente.ts:20:  const b = 2\nsrc/agente.ts:30:  const c = 3\nsrc/rpc.ts:5:export x\n'
  expect(enxugarSaida('grep -rn const src', g)).toBe('src/agente.ts\n  10:  const a = 1\n  20:  const b = 2\n  30:  const c = 3\nsrc/rpc.ts:5:export x\n')
  expect(enxugarSaida('rg -n const', g)).not.toBe(null)
  // um arquivo só: o grep não põe o nome, então "x:y" é conteúdo e fica
  expect(enxugarSaida('grep -n a arquivo.ts', 'a.b:1\na.b:2\na.b:3\n')).toBe(null)
  expect(enxugarSaida('grep -rh const src', g)).toBe(null)
  for (const c of ['grep -rc const src', 'grep -rl const src', 'grep -rn -A 2 const src', 'grep -rn --count const src'])
    expect(enxugarSaida(c, g)).toBe(null)
})

test('listagem longa: corta no limite, diz quantas e como ver tudo; o fim de linha se mantém', async () => {
  const t = linhas(LIMITE_LINHAS + 50, i => `├── item${i}`)
  const r = enxugarSaida('tree', t)!
  expect(r.endsWith('[Reveza: mais 50 linhas cortadas; para ver tudo, rode o mesmo comando com | cat no fim]\n')).toBe(true)
  // passar do limite por pouco não compensa o aviso: fica como veio
  expect(enxugarSaida('tree', linhas(LIMITE_LINHAS + 5, i => `├── item${i}`))).toBe(null)
  expect(enxugarSaida('tree | cat', t)).toBe(null)
  expect(enxugarSaida('tree', linhas(10, i => `item${i}`))).toBe(null)
})

test('comando desconhecido ou saída vazia: null', async () => {
  expect(enxugarSaida('npm test', 'ok\n')).toBe(null)
  expect(enxugarSaida('git status', '')).toBe(null)
})
