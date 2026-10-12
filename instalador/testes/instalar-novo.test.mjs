// Instalação nova: a troca começa LIGADA, antes do limite, sem pergunta nenhuma; quem importa fica com a importada.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { descreverTroca, TROCA_PADRAO, trocaInicial, trocaLocal } from "../instalar.mjs";
import { prepararCasa, SEM_SH } from "./apoio-instalador.mjs";

test("troca padrão: ligada, antes do limite, avisa em 90% e troca em 95%", () => {
  assert.deepEqual({ ...TROCA_PADRAO }, { auto: true, modo: "limiar", aviso: 90, troca: 95 });
  assert.ok(Object.isFrozen(TROCA_PADRAO));
});

test("só a instalação nova grava a troca padrão; atualizar, ligar e importar ficam com a que já vale", () => {
  assert.deepEqual(trocaInicial({}), { auto: true, modo: "limiar", aviso: 90, troca: 95 });
  const a = trocaInicial({});
  a.auto = false;
  assert.equal(TROCA_PADRAO.auto, true, "a cópia não mexe no padrão");
  assert.equal(trocaInicial({ atualizar: true }), null);
  assert.equal(trocaInicial({ ligar: true }), null);
  assert.equal(trocaInicial({ importar: "/algum/lugar" }), null);
});

test("a troca em palavras, nos três modos", () => {
  assert.equal(descreverTroca(TROCA_PADRAO), "troca automática ligada, antes do limite (avisa em 90%, troca em 95%)");
  assert.equal(descreverTroca({ auto: false, modo: "limite" }), "troca automática desligada, só quando a conta bate no limite");
  assert.equal(descreverTroca({ auto: true, modo: "rodizio" }), "troca automática ligada, rodízio entre as contas livres");
});

test("trocaLocal: a configuração do estado local vai para a nuvem como está (--com-nuvem e importação)", () => {
  const d = mkdtempSync(path.join(os.tmpdir(), "reveza-troca-"));
  try {
    const arq = path.join(d, "estado.json");
    assert.equal(trocaLocal(arq), null, "sem estado, nada");
    writeFileSync(arq, JSON.stringify({ config: { auto: false, modo: "rodizio", aviso: 80, troca: 90 } }));
    assert.deepEqual(trocaLocal(arq), { auto: false, modo: "rodizio", aviso: 80, troca: 90 });
    writeFileSync(arq, JSON.stringify({ config: { auto: true, modo: "limiar", aviso: 97, troca: 95 } }));
    assert.deepEqual(trocaLocal(arq), { auto: true, modo: "limiar", aviso: 90, troca: 95 }, "aviso acima da troca volta ao padrão");
    writeFileSync(arq, JSON.stringify({ config: { modo: "outro" } }));
    assert.equal(trocaLocal(arq), null);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("instalação nova --sem-nuvem: grava a troca ligada no estado local e avisa numa linha, sem perguntar", { skip: SEM_SH }, () => {
  const c = prepararCasa();
  try {
    const r = c.rodar(["--sim", "--sem-nuvem", "--sem-servico", "--sem-react-bits"]);
    assert.equal(r.status, 0, r.saida.slice(-1500));
    assert.equal(c.rede(), "", "nenhuma chamada de rede");
    const cfg = c.json("estado.json").config;
    assert.deepEqual({ auto: cfg.auto, modo: cfg.modo, aviso: cfg.aviso, troca: cfg.troca }, { auto: true, modo: "limiar", aviso: 90, troca: 95 });
    assert.match(r.saida, /troca automática ligada, antes do limite \(avisa em 90%, troca em 95%\), neste computador/);
    assert.ok(!/Troca de conta|Como trocar|Ligar a troca automática agora/.test(r.saida), "nenhuma pergunta de troca");
  } finally {
    c.limpar();
  }
});

test("instalação nova com --importar: fica a troca importada, o instalador não grava a dele", { skip: SEM_SH }, () => {
  const c = prepararCasa();
  try {
    const origem = path.join(c.tmp, "outro-gestor");
    mkdirSync(origem);
    const r = c.rodar(["--sim", "--sem-nuvem", "--sem-servico", "--sem-react-bits", "--importar", origem]);
    assert.equal(r.status, 0, r.saida.slice(-1500));
    assert.ok(c.comandos().some((x) => x.startsWith("importar --de")), c.comandos().join(" | "));
    assert.match(r.saida, /fica a configuração importada/);
    assert.ok(!/troca automática ligada/.test(r.saida));
    assert.ok(!existsSync(path.join(c.base, "estado.json")), "o instalador não escreveu configuração de troca por cima da importada");
  } finally {
    c.limpar();
  }
});
