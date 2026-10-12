import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

const pacote = JSON.parse(readFileSync(resolve(import.meta.dirname, "package.json"), "utf8")) as { version: string }

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  define: {
    __VERSAO_PAINEL__: JSON.stringify(pacote.version),
  },
  build: {
    // Nada de mapa de código no ar: o build de produção não gera .map.
    sourcemap: false,
    target: "es2022",
    chunkSizeWarningLimit: 900,
  },
  server: { port: 5173 },
  preview: { port: 4173 },
  test: {
    environment: "node",
    // datas nos testes em fuso fixo: o resultado não depende de onde a máquina está
    env: { TZ: "America/Sao_Paulo" },
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"],
  },
})
