#!/usr/bin/env node
// Baixa os componentes grátis do React Bits que o painel usa para src/components/react-bits/ (ignorada pelo git).
// O painel funciona sem eles (cada peça tem a versão simples dela) e fica animado com eles.
//
//   npm run react-bits            baixa o que falta
//   npm run react-bits --forcar   baixa tudo de novo
//   npm run react-bits --listar   mostra a lista e o que já está na máquina
//
// Mesmo jeito do instalador do Claquete: registro oficial, um JSON por componente, só os arquivos .tsx.

import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { COMPONENTES, URL_REGISTRO } from "./react-bits-lista.mjs"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const DESTINO = join(RAIZ, "src", "components", "react-bits")
const args = new Set(process.argv.slice(2))

function dependenciasDoPainel() {
  const pacote = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8"))
  return new Set(Object.keys({ ...pacote.dependencies, ...pacote.devDependencies }))
}

function caminho(nome) {
  return join(DESTINO, `${nome}.tsx`)
}

if (args.has("--listar")) {
  for (const c of COMPONENTES) console.log(`${existsSync(caminho(c.nome)) ? "✓" : "·"} ${c.nome.padEnd(14)} ${c.onde}`)
  process.exit(0)
}

mkdirSync(DESTINO, { recursive: true })
writeFileSync(
  join(DESTINO, "LEIA-ME.txt"),
  "Componentes do React Bits baixados por scripts/baixar-react-bits.mjs. Não vão para o repositório (licença MIT + Commons Clause).\n"
)

const temDep = dependenciasDoPainel()
const baixados = []
const pulados = []
const falhas = []
const faltando = new Set()

const resumo = (texto) => createHash("sha256").update(texto, "utf8").digest("hex")

// Na pasta só ficam os componentes da lista: arquivo que não é dela não entra no pacote do painel.
for (const f of readdirSync(DESTINO)) {
  if (f.endsWith(".tsx") && !COMPONENTES.some((c) => `${c.nome}.tsx` === f)) rmSync(join(DESTINO, f))
}

for (const { nome, sha256 } of COMPONENTES) {
  if (existsSync(caminho(nome)) && !args.has("--forcar")) {
    pulados.push(nome)
    continue
  }
  try {
    const r = await fetch(URL_REGISTRO(nome))
    if (!r.ok) {
      falhas.push(`${nome} (HTTP ${r.status})`)
      continue
    }
    const item = await r.json()
    const arquivos = (item.files ?? []).filter((f) => /\.tsx$/.test(f.path ?? ""))
    if (!arquivos.length) {
      falhas.push(`${nome} (sem arquivo .tsx no registro)`)
      continue
    }
    if (arquivos.length !== 1 || resumo(String(arquivos[0].content)) !== sha256) {
      falhas.push(`${nome} (o registro mudou desde a última revisão: não gravado)`)
      continue
    }
    writeFileSync(caminho(nome), arquivos[0].content)
    for (const d of item.dependencies ?? []) {
      const pacote = d.startsWith("@") ? `@${d.slice(1).split("@")[0]}` : d.split("@")[0]
      if (!temDep.has(pacote)) faltando.add(d)
    }
    baixados.push(nome)
  } catch (e) {
    falhas.push(`${nome} (${e.message})`)
  }
}

if (baixados.length) console.log(`baixados: ${baixados.join(", ")}`)
if (pulados.length) console.log(`já estavam: ${pulados.join(", ")}  (use --forcar para baixar de novo)`)
if (faltando.size) console.log(`atenção: dependências que o painel não tem: ${[...faltando].join(", ")}`)
if (falhas.length) {
  console.error(`não baixou: ${falhas.join(", ")}  (o painel segue com as versões simples)`)
  process.exit(1)
}
console.log(`pronto: ${DESTINO}`)
