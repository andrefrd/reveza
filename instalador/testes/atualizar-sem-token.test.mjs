// O caminho que o botão de atualizar do painel usa: o agente roda o instalador da versão nova com `--atualizar --sim`,
// sem token nenhum. Isso tem de atualizar só este computador, sem pergunta nenhuma e sem tocar a nuvem nem o painel.
// O instalador de verdade, com HOME temporária, um npm falso (nada baixa nem compila) e a rede bloqueada.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const VERSAO = JSON.parse(readFileSync(path.join(RAIZ, "package.json"), "utf8")).version;

test("--atualizar --sim sem token: só o programa deste computador; nada de nuvem, painel, rede ou pergunta", { skip: process.platform === "win32" ? "o npm falso é um script sh" : false }, () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "reveza-atualizar-"));
  try {
    const home = path.join(tmp, "casa");
    const base = path.join(home, ".reveza");
    const bin = path.join(tmp, "bin");
    mkdirSync(base, { recursive: true });
    mkdirSync(bin, { recursive: true });
    const cliLog = path.join(tmp, "cli.log");
    const redeLog = path.join(tmp, "rede.log");
    // o agente "instalado": anota cada comando que o instalador manda a ele
    const cliFalso = `import { appendFileSync } from "node:fs";
appendFileSync(process.env.REVEZA_TESTE_CLI, process.argv.slice(2).join(" ") + "\\n");
if (process.argv[2] === "status") console.log(JSON.stringify({ parado: true }));
`;
    writeFileSync(path.join(tmp, "cli-falso.mjs"), cliFalso);
    writeFileSync(
      path.join(bin, "npm"),
      `#!/bin/sh\nif [ "$1" = "run" ] && [ "$2" = "build" ]; then mkdir -p dist/src && cp "${path.join(tmp, "cli-falso.mjs")}" dist/src/cli.js; fi\nexit 0\n`,
    );
    chmodSync(path.join(bin, "npm"), 0o755);
    // rede bloqueada: qualquer fetch fica anotado e falha
    const bloqueio = path.join(tmp, "sem-rede.mjs");
    writeFileSync(bloqueio, `import { appendFileSync } from "node:fs";
globalThis.fetch = async (u) => { appendFileSync(process.env.REVEZA_TESTE_REDE, String(u) + "\\n"); throw new Error("rede bloqueada no teste"); };
`);
    const instalacao = {
      versao: "0.0.1",
      app: path.join(base, "app"),
      sombra: false,
      nuvem: { ref: "a".repeat(20), url: `https://${"a".repeat(20)}.supabase.co`, anon: "chave-publica", adminId: null },
      painel: { url: "https://painel.exemplo.com", projeto: "reveza", equipe: null, dominio: null },
    };
    writeFileSync(path.join(base, "instalacao.json"), JSON.stringify(instalacao));
    const env = {
      HOME: home,
      USERPROFILE: home,
      REVEZA_HOME: base,
      PATH: [bin, path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter),
      NODE_OPTIONS: `--import=${bloqueio}`,
      REVEZA_TESTE_CLI: cliLog,
      REVEZA_TESTE_REDE: redeLog,
      // nada de SUPABASE_ACCESS_TOKEN, VERCEL_TOKEN ou REVEZA_*: é como o agente roda
    };
    const r = spawnSync(process.execPath, [path.join(RAIZ, "instalador", "instalar.mjs"), "--atualizar", "--sim", "--sem-servico", "--sem-react-bits"], {
      cwd: tmp,
      env,
      input: "",
      encoding: "utf8",
      timeout: 120_000,
    });
    const saida = (r.stdout ?? "") + (r.stderr ?? "");
    assert.equal(r.status, 0, saida.slice(-1500));
    assert.match(saida, new RegExp(`Pronto: Reveza AI ${VERSAO.replace(/\./g, "\\.")}`));
    assert.equal(existsSync(redeLog) ? readFileSync(redeLog, "utf8") : "", "", "nenhuma chamada de rede (nem Supabase, nem Vercel)");
    assert.ok(!/Token do Supabase|Token da Vercel|Projeto do Supabase/.test(saida), "nenhuma pergunta de token");
    const comandos = readFileSync(cliLog, "utf8").trim().split("\n");
    assert.ok(!comandos.some((c) => c.startsWith("nuvem entrar") || c.startsWith("cofre")), comandos.join(" | "));
    const depois = JSON.parse(readFileSync(path.join(base, "instalacao.json"), "utf8"));
    assert.equal(depois.versao, VERSAO, "o programa deste computador foi atualizado");
    assert.deepEqual(depois.nuvem, instalacao.nuvem, "a nuvem ficou como estava");
    assert.deepEqual(depois.painel, instalacao.painel, "o painel ficou como estava");
    assert.ok(existsSync(path.join(base, "app", "agente", "dist", "src", "cli.js")));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
