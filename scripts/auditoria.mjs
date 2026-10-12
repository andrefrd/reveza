#!/usr/bin/env node
// Auditoria das dependências: `npm audit` em cada trava do repositório. Alerta novo reprova. Alerta sem correção
// publicada pode ficar aceito em auditoria-aceita.json, com o motivo e a data de revisar: passou a data, reprova de
// novo e alguém olha se já saiu a correção.
//
// Uso: node scripts/auditoria.mjs   (consulta o registro do npm: precisa de internet)

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PASTAS = [".", "agente", "painel", "nuvem"];

/** Os avisos (GHSA) de um relatório do `npm audit --json`, com o pacote e a cadeia de quem puxa. */
export function avisos(relatorio) {
  const lista = new Map();
  for (const [nome, v] of Object.entries(relatorio?.vulnerabilities ?? {})) {
    for (const via of v.via ?? []) {
      if (typeof via !== "object" || !via.url) continue;
      const ghsa = via.url.split("/").pop();
      const a = lista.get(ghsa) ?? { ghsa, pacote: via.name, titulo: via.title, gravidade: via.severity, afetados: [] };
      a.afetados.push(nome);
      lista.set(ghsa, a);
    }
    for (const via of v.via ?? []) {
      if (typeof via !== "string") continue;
      for (const a of lista.values()) if (a.pacote === via || a.afetados.includes(via)) a.afetados.push(nome);
    }
  }
  return [...lista.values()];
}

/** Separa os avisos em aceitos (dentro do prazo), vencidos (aceitos, mas a data de revisar passou) e novos. */
export function avaliar(lista, aceitos, hoje) {
  const r = { aceitos: [], vencidos: [], novos: [] };
  for (const a of lista) {
    const ok = aceitos.find((x) => x.ghsa === a.ghsa);
    if (!ok) r.novos.push(a);
    else if (ok.revisar_em < hoje) r.vencidos.push({ ...a, revisar_em: ok.revisar_em });
    else r.aceitos.push({ ...a, motivo: ok.motivo, revisar_em: ok.revisar_em });
  }
  return r;
}

function auditar(pasta) {
  try {
    return JSON.parse(execFileSync("npm", ["audit", "--json", "--package-lock-only"], { cwd: pasta, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch (e) {
    if (e.stdout) return JSON.parse(e.stdout); // npm audit sai com erro quando acha alerta
    throw e;
  }
}

function principal() {
  const aceitos = JSON.parse(readFileSync(path.join(RAIZ, "auditoria-aceita.json"), "utf8"));
  const hoje = new Date().toISOString().slice(0, 10);
  let ruim = 0;
  for (const p of PASTAS) {
    const pasta = path.join(RAIZ, p);
    if (!existsSync(path.join(pasta, "package-lock.json"))) continue;
    const r = avaliar(avisos(auditar(pasta)), aceitos, hoje);
    const nome = p === "." ? "raiz" : p;
    for (const a of r.aceitos) console.log(`aceito   ${nome}: ${a.ghsa} ${a.pacote} (${a.gravidade}), revisar até ${a.revisar_em}`);
    for (const a of r.vencidos) console.error(`REVISAR  ${nome}: ${a.ghsa} ${a.pacote}: a data de revisar (${a.revisar_em}) passou; veja se saiu a correção`);
    for (const a of r.novos) console.error(`NOVO     ${nome}: ${a.ghsa} ${a.pacote} (${a.gravidade}) ${a.titulo}; via ${[...new Set(a.afetados)].join(", ")}`);
    if (!r.aceitos.length && !r.vencidos.length && !r.novos.length) console.log(`ok       ${nome}: nenhum alerta`);
    ruim += r.vencidos.length + r.novos.length;
  }
  if (ruim) process.exit(1);
}

// Chamado direto (e não importado)? Pelo caminho de verdade dos dois lados: a comparação de import.meta.url com
// `file://${argv[1]}` falhava calada no Windows e em pasta com espaço ou acento, e o script saía sem fazer nada.
function chamadoDireto() {
  try {
    return !!process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (chamadoDireto()) principal();
