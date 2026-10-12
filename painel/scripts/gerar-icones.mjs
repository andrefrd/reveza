#!/usr/bin/env node
// Gera os PNGs do aplicativo (PWA) a partir dos SVGs de public/icones, com o Chromium que já está na máquina
// (playwright-core 1.63.0 fixo; CHROME=<caminho> para outro). Rodar só quando o desenho do ícone mudar.

import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { chromium } from "playwright-core"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const ICONES = join(RAIZ, "public", "icones")

const executavel =
  process.env.CHROME ??
  [
    join(
      homedir(),
      "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
    ),
    join(homedir(), ".cache/ms-playwright/chromium-1243/chrome-linux/chrome"),
  ].find((c) => existsSync(c))

const SAIDAS = [
  ["icone.svg", "icone-192.png", 192],
  ["icone.svg", "icone-512.png", 512],
  ["icone-maskable.svg", "icone-maskable-512.png", 512],
  ["icone-maskable.svg", "apple-touch-icon.png", 180],
]

const navegador = await chromium.launch({ executablePath: executavel })
for (const [origem, destino, tamanho] of SAIDAS) {
  const pagina = await navegador.newPage({ viewport: { width: tamanho, height: tamanho } })
  const svg = readFileSync(join(ICONES, origem), "utf8").replace(
    "<svg ",
    `<svg width="${tamanho}" height="${tamanho}" `
  )
  await pagina.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`)
  await pagina.screenshot({
    path: join(ICONES, destino),
    omitBackground: true,
    clip: { x: 0, y: 0, width: tamanho, height: tamanho },
  })
  await pagina.close()
  console.log(`ok ${destino}`)
}
await navegador.close()
