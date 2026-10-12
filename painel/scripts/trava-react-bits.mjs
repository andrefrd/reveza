#!/usr/bin/env node
import { realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"
// Trava do painel: recusa commit que leve código do React Bits (a licença não deixa redistribuir). Pega pela pasta
// react-bits e também pelo nome do arquivo (CountUp.tsx em qualquer lugar), além do texto de origem do registro.
// O pre-commit do repositório chama esta trava depois da trava geral (scripts/trava.mjs, na raiz).
//
//   node painel/scripts/trava-react-bits.mjs           confere o que está preparado para o commit
//   node painel/scripts/trava-react-bits.mjs --todos   confere tudo o que está versionado

import { execFileSync } from "node:child_process"
import { basename, extname } from "node:path"

import { NOMES } from "./react-bits-lista.mjs"

const EXTENSOES = new Set([".tsx", ".jsx", ".ts", ".js"])

/** Dos caminhos dados, os que são componente do React Bits. */
export function componentesReactBits(caminhos, conteudo = () => null) {
  return caminhos.filter((c) => {
    const normal = c.replace(/\\/g, "/")
    if (/(^|\/)react-bits\//i.test(normal)) return true
    const ext = extname(normal)
    if (EXTENSOES.has(ext) && NOMES.includes(basename(normal, ext))) return true
    const texto = conteudo(c)
    return (
      typeof texto === "string" &&
      /reactbits\.dev\/r\/|@reactbits-(starter|pro)/i.test(texto) &&
      !/scripts\/(react-bits-lista|trava-react-bits|baixar-react-bits)/.test(normal)
    )
  })
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
}

// Chamado direto (e não importado)? Pelo caminho de verdade dos dois lados: a comparação de import.meta.url com
// `file://${argv[1]}` falhava calada no Windows e em pasta com espaço ou acento, e o script saía sem fazer nada.
function chamadoDireto() {
  try {
    return !!process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
  } catch {
    return false
  }
}

if (chamadoDireto()) {
  const todos = process.argv.includes("--todos")
  const raiz = git("rev-parse", "--show-toplevel").trim()
  const lista = (
    todos
      ? git("-C", raiz, "ls-files", "-z")
      : git("-C", raiz, "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z")
  )
    .split("\0")
    .filter(Boolean)
  const ler = (c) => {
    try {
      return execFileSync("git", ["-C", raiz, "show", `${todos ? "HEAD" : ""}:${c}`], {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      })
    } catch {
      return null
    }
  }
  const ruins = componentesReactBits(lista, ler)
  if (ruins.length) {
    for (const r of ruins)
      console.error(`RECUSADO  ${r}: código do React Bits (é baixado na instalação, não versionado)`)
    console.error("\nTire com: git restore --staged <arquivo>")
    process.exit(1)
  }
  if (todos) console.log(`ok: ${lista.length} arquivos versionados, nenhum componente do React Bits`)
}
