#!/usr/bin/env node
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

if (import.meta.url === `file://${process.argv[1]}`) {
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
