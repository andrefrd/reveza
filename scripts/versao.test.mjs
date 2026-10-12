import { test } from "node:test";
import assert from "node:assert/strict";
import { conferir, maior, precisaVersao, primeiraDoChangelog, secaoDoChangelog, versoes, workflowsVermelhos } from "./versao.mjs";

const CHANGELOG = `# Versões

texto

## 0.2.0 · 12/10/2026

Recurso novo.

- item

## 0.1.1 · 11/10/2026

Correção.
`;

test("todas as versões do repositório batem (package.json, travas, agente, badges; CHANGELOG igual ou à frente)", () => {
  assert.doesNotThrow(() => conferir(versoes()));
});

test("conferir recusa pacote fora da versão e aceita a CHANGELOG uma versão à frente", () => {
  const base = { "package.json": "0.1.1", "agente/src/config.ts": "0.1.1", "README.md (badge)": "0.1.1" };
  assert.equal(conferir({ ...base, "CHANGELOG.md": "0.1.1" }), "0.1.1");
  assert.equal(conferir({ ...base, "CHANGELOG.md": "0.1.2" }), "0.1.1");
  assert.throws(() => conferir({ ...base, "agente/src/config.ts": "0.1.0", "CHANGELOG.md": "0.1.1" }));
  assert.throws(() => conferir({ ...base, "CHANGELOG.md": "0.1.0" }), "CHANGELOG atrás");
});

test("CHANGELOG: a primeira entrada e o texto de uma versão", () => {
  assert.equal(primeiraDoChangelog(CHANGELOG), "0.2.0");
  assert.equal(secaoDoChangelog(CHANGELOG, "0.2.0"), "Recurso novo.\n\n- item");
  assert.equal(secaoDoChangelog(CHANGELOG, "0.1.1"), "Correção.");
  assert.equal(secaoDoChangelog(CHANGELOG, "9.9.9"), null);
});

test("versão nova só quando o que se instala mudou e a versão ficou a mesma", () => {
  assert.equal(precisaVersao(["agente/src/troca.ts"], "0.1.1", "0.1.1"), true);
  assert.equal(precisaVersao(["instalador/instalar.mjs", "README.md"], "0.1.1", "0.1.1"), true);
  assert.equal(precisaVersao(["agente/src/troca.ts"], "0.1.2", "0.1.1"), false, "já subiu");
  assert.equal(precisaVersao(["README.md", "docs/ARQUITETURA.md", "CHANGELOG.md"], "0.1.1", "0.1.1"), false, "só documentação");
  assert.equal(precisaVersao(["package.json"], "0.1.1", "0.1.1"), true);
});

test("comparação de versões", () => {
  assert.equal(maior("0.1.2", "0.1.1"), true);
  assert.equal(maior("0.2.0", "0.1.9"), true);
  assert.equal(maior("0.1.1", "0.1.1"), false);
  assert.equal(maior("0.1.0", "0.1.1"), false);
});

test("lançar recusa quando o run mais recente de algum workflow na main está vermelho", () => {
  const runs = [
    { workflowName: "Instalar nos três sistemas", conclusion: "success", status: "completed" },
    { workflowName: "Windows de verdade", conclusion: "failure", status: "completed" },
    { workflowName: "Instalar nos três sistemas", conclusion: "failure", status: "completed" },
  ];
  assert.deepEqual(workflowsVermelhos(runs), ["Windows de verdade"], "o vermelho antigo de um workflow que já ficou verde não conta");
  assert.deepEqual(workflowsVermelhos([{ workflowName: "Windows de verdade", conclusion: "", status: "in_progress" }, ...runs]), [], "rodando agora: espera o resultado");
  assert.deepEqual(workflowsVermelhos([]), []);
});
