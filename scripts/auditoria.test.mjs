import { test } from "node:test";
import assert from "node:assert/strict";
import { avaliar, avisos } from "./auditoria.mjs";

const relatorio = {
  vulnerabilities: {
    braces: { via: [{ name: "braces", title: "pilha", severity: "high", url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc" }] },
    micromatch: { via: ["braces"] },
    "fast-glob": { via: ["micromatch"] },
    outro: { via: [{ name: "outro", title: "x", severity: "moderate", url: "https://github.com/advisories/GHSA-dddd-eeee-ffff" }] },
  },
};

test("avisos: um por GHSA, com a cadeia de quem puxa", () => {
  const l = avisos(relatorio);
  assert.deepEqual(l.map((a) => a.ghsa).sort(), ["GHSA-aaaa-bbbb-cccc", "GHSA-dddd-eeee-ffff"]);
  const b = l.find((a) => a.pacote === "braces");
  assert.ok(b.afetados.includes("micromatch") && b.afetados.includes("fast-glob"));
});

test("aceito dentro do prazo passa; prazo vencido e aviso novo reprovam", () => {
  const aceitos = [{ ghsa: "GHSA-aaaa-bbbb-cccc", motivo: "sem correção", revisar_em: "2026-11-11" }];
  const dentro = avaliar(avisos(relatorio), aceitos, "2026-10-11");
  assert.equal(dentro.aceitos.length, 1);
  assert.equal(dentro.novos.length, 1);
  assert.equal(dentro.novos[0].ghsa, "GHSA-dddd-eeee-ffff");
  const depois = avaliar(avisos(relatorio), aceitos, "2026-11-12");
  assert.equal(depois.vencidos.length, 1);
});

test("relatório sem alerta não reprova", () => {
  const r = avaliar(avisos({ vulnerabilities: {} }), [], "2026-10-11");
  assert.deepEqual(r, { aceitos: [], vencidos: [], novos: [] });
});
