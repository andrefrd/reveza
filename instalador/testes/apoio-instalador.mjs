// Roda o instalador de verdade num HOME temporário, com dublês: um npm falso (nada baixa nem compila, o "build" do
// agente é um cli que só anota os comandos), a rede bloqueada (todo fetch fica anotado e falha) e o PATH sem o
// assistente de código. Nunca toca o HOME de quem roda os testes.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const VERSAO = JSON.parse(readFileSync(path.join(RAIZ, "package.json"), "utf8")).version;
export const SEM_SH = process.platform === "win32" ? "o npm falso é um script sh" : false;

/** Prepara o HOME temporário. `instalacao` (opcional) vira o ~/.reveza/instalacao.json de antes. */
export function prepararCasa({ instalacao } = {}) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "reveza-instalador-"));
  const home = path.join(tmp, "casa");
  const base = path.join(home, ".reveza");
  const bin = path.join(tmp, "bin");
  mkdirSync(base, { recursive: true });
  mkdirSync(bin, { recursive: true });
  const cliLog = path.join(tmp, "cli.log");
  const redeLog = path.join(tmp, "rede.log");
  // o agente "instalado": anota cada comando que o instalador manda a ele
  writeFileSync(path.join(tmp, "cli-falso.mjs"), `import { appendFileSync } from "node:fs";
appendFileSync(process.env.REVEZA_TESTE_CLI, process.argv.slice(2).join(" ") + "\\n");
if (process.argv[2] === "status") console.log(JSON.stringify({ parado: true }));
`);
  writeFileSync(
    path.join(bin, "npm"),
    `#!/bin/sh\nif [ "$1" = "run" ] && [ "$2" = "build" ]; then mkdir -p dist/src && cp "${path.join(tmp, "cli-falso.mjs")}" dist/src/cli.js; fi\nexit 0\n`,
  );
  chmodSync(path.join(bin, "npm"), 0o755);
  const bloqueio = path.join(tmp, "sem-rede.mjs");
  writeFileSync(bloqueio, `import { appendFileSync } from "node:fs";
globalThis.fetch = async (u) => { appendFileSync(process.env.REVEZA_TESTE_REDE, String(u) + "\\n"); throw new Error("rede bloqueada no teste"); };
`);
  if (instalacao) writeFileSync(path.join(base, "instalacao.json"), JSON.stringify({ app: path.join(base, "app"), ...instalacao }));
  const env = {
    HOME: home,
    USERPROFILE: home,
    REVEZA_HOME: base,
    PATH: [bin, path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter),
    NODE_OPTIONS: `--import=${bloqueio}`,
    REVEZA_TESTE_CLI: cliLog,
    REVEZA_TESTE_REDE: redeLog,
    // nada de SUPABASE_ACCESS_TOKEN, VERCEL_TOKEN ou REVEZA_*
  };
  const ler = (arq) => (existsSync(arq) ? readFileSync(arq, "utf8") : "");
  return {
    tmp, home, base, env,
    rodar: (args) => {
      const r = spawnSync(process.execPath, [path.join(RAIZ, "instalador", "instalar.mjs"), ...args], {
        cwd: tmp, env, input: "", encoding: "utf8", timeout: 120_000,
      });
      return { status: r.status, saida: (r.stdout ?? "") + (r.stderr ?? "") };
    },
    rede: () => ler(redeLog),
    comandos: () => ler(cliLog).trim().split("\n").filter(Boolean),
    json: (nome) => JSON.parse(readFileSync(path.join(base, nome), "utf8")),
    limpar: () => rmSync(tmp, { recursive: true, force: true }),
  };
}

/** Os títulos de etapa numerados ("3/5 Serviço") na ordem em que saíram. */
export const etapasDaSaida = (saida) => [...saida.matchAll(/^(\d+)\/(\d+) (.+)$/gm)].map((m) => `${m[1]}/${m[2]} ${m[3].trim()}`);
