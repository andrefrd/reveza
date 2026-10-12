// Planilha CSV do uso. Separador vírgula, aspas quando precisa, e proteção contra fórmula: um campo que começa com
// = + - @ (ou tab/retorno) ganha um apóstrofo, para a planilha não executar nada que veio do banco.

export function campoCsv(valor: unknown): string {
  if (valor === null || valor === undefined) return ""
  let texto = typeof valor === "number" ? String(valor) : String(valor)
  if (typeof valor !== "number" && /^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`
  if (/[",\n\r]/.test(texto)) texto = `"${texto.replace(/"/g, '""')}"`
  return texto
}

export function paraCsv(cabecalho: string[], linhas: unknown[][]): string {
  const todas = [cabecalho, ...linhas]
  return todas.map((l) => l.map(campoCsv).join(",")).join("\r\n") + "\r\n"
}

/** Baixa o texto como arquivo no navegador (com BOM, para a planilha abrir os acentos certos). */
export function baixarArquivo(nome: string, conteudo: string, tipo = "text/csv;charset=utf-8") {
  const blob = new Blob(["﻿", conteudo], { type: tipo })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = nome
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
