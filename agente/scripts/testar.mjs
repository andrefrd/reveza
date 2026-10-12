#!/usr/bin/env node
// Roda os testes compilados (dist/test/*.test.js) com o node:test, em qualquer sistema (sem depender do glob do shell).
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "test");
const filtro = process.argv[2];
const arquivos = readdirSync(dir)
  .filter((n) => n.endsWith(".test.js") && (!filtro || n.includes(filtro)))
  .sort()
  .map((n) => path.join(dir, n));
// --test-timeout só existe a partir do Node 20.11; no 18 os testes rodam sem limite próprio.
const [maior, menor] = process.versions.node.split(".").map(Number);
const limite = maior > 20 || (maior === 20 && menor >= 11) ? ["--test-timeout=60000"] : [];
const r = spawnSync(process.execPath, ["--test", ...limite, ...arquivos], { stdio: "inherit" });
process.exit(r.status ?? 1);
