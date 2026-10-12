// Etapas numeradas de 1 a N só com as que rodam em cada caminho; nenhum número pulado, nenhuma etapa sem número.
import { test } from "node:test";
import assert from "node:assert/strict";
import { etapasDoCaminho, manterNuvemPrevisto, numeroDaEtapa } from "../lib/etapas.mjs";
import { numerarProximoTitulo, titulo } from "../lib/texto.mjs";
import { etapasDaSaida, prepararCasa, SEM_SH } from "./apoio-instalador.mjs";

test("a lista de etapas de cada caminho", () => {
  const tudo = ["conferir", "programa", "nuvem", "servico", "painel", "contas", "alertas", "prova"];
  assert.deepEqual(etapasDoCaminho({ nuvemNova: true }), tudo, "instalação nova com nuvem: as 8");
  assert.deepEqual(etapasDoCaminho({ nuvemNova: true, semNuvem: true }), ["conferir", "programa", "servico", "contas", "prova"], "instalação nova --sem-nuvem");
  assert.deepEqual(etapasDoCaminho({ nuvemNova: true, ligar: true }), ["conferir", "programa", "ligar", "servico", "prova"], "computador novo numa instalação que já existe");
  assert.deepEqual(etapasDoCaminho({ atualizar: true, soEsteComputador: true }), ["conferir", "programa", "servico", "prova"], "atualização de computador ligado");
  assert.deepEqual(etapasDoCaminho({ atualizar: true, semNuvem: true, nuvemNova: true }), ["conferir", "programa", "servico", "prova"], "atualização sem nuvem");
  assert.deepEqual(etapasDoCaminho({ atualizar: true }), ["conferir", "programa", "nuvem", "servico", "painel", "prova"], "atualização com o token");
  assert.deepEqual(etapasDoCaminho({ atualizar: true, manterNuvem: true }), ["conferir", "programa", "nuvem", "servico", "prova"], "atualização sem o token");
  assert.deepEqual(etapasDoCaminho({ atualizar: true, nuvemNova: true }), ["conferir", "programa", "nuvem", "servico", "painel", "alertas", "prova"], "--com-nuvem numa instalação que estava só no computador");
});

test("número da etapa: posição de 1 a N; etapa fora da lista fica sem número", () => {
  const l = etapasDoCaminho({ atualizar: true, soEsteComputador: true });
  assert.deepEqual(l.map((id) => numeroDaEtapa(l, id)), ["1/4", "2/4", "3/4", "4/4"]);
  assert.equal(numeroDaEtapa(l, "painel"), "");
});

test("atualização sem pergunta e sem token no ambiente: já se sabe que a nuvem fica como está", () => {
  assert.equal(manterNuvemPrevisto({ atualizar: true, temNuvem: true, semPerguntas: true, tokenNoAmbiente: false }), true);
  assert.equal(manterNuvemPrevisto({ atualizar: true, temNuvem: true, semPerguntas: true, tokenNoAmbiente: true }), false);
  assert.equal(manterNuvemPrevisto({ atualizar: true, temNuvem: true, semPerguntas: false, tokenNoAmbiente: false }), false, "com pergunta, só a resposta diz");
  assert.equal(manterNuvemPrevisto({ atualizar: false, temNuvem: false, semPerguntas: true, tokenNoAmbiente: false }), false);
});

test("o número anunciado vai só no próximo título", () => {
  const linhas = [];
  const log = console.log;
  console.log = (s) => linhas.push(s);
  try {
    numerarProximoTitulo("3/5");
    titulo("Serviço");
    titulo("  Sub-título");
    numerarProximoTitulo("");
    titulo("Sem número");
  } finally {
    console.log = log;
  }
  assert.deepEqual(linhas.map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").trim()), ["3/5 Serviço", "Sub-título", "Sem número"]);
});

const NUVEM = { ref: "a".repeat(20), url: `https://${"a".repeat(20)}.supabase.co`, anon: "chave-publica", adminId: null };
const casos = [
  {
    nome: "instalação nova --sem-nuvem",
    args: ["--sem-nuvem"],
    etapas: ["1/5 Conferência do computador", "2/5 Agente e mod", "3/5 Serviço", "4/5 Contas", "5/5 Prova final"],
  },
  {
    nome: "computador novo com o código de ligação (a etapa de ligar ganha número sem mexer na função dela)",
    env: {
      REVEZA_CODIGO: "rvzl_" + Buffer.from(JSON.stringify({ u: NUVEM.url, k: "chave-publica", e: "pc-teste@computadores.reveza.invalid", s: "x".repeat(24),
        f: "uma duas tres quatro cinco seis" })).toString("base64url"),
    },
    // o nome da etapa de ligar é da função ligar (refeita noutra frente): aqui só o número importa
    etapas: ["1/5 Conferência do computador", "2/5 Agente e mod", /^3\/5 \S/, "4/5 Serviço", "5/5 Prova final"],
  },
  {
    nome: "atualização de computador ligado",
    instalacao: { versao: "0.0.1", sombra: false, nuvem: { url: NUVEM.url, anon: NUVEM.anon } },
    args: ["--atualizar"],
    etapas: ["1/4 Conferência do computador", "2/4 Agente e mod", "3/4 Serviço", "4/4 Prova final"],
  },
  {
    nome: "atualização de instalação sem nuvem",
    instalacao: { versao: "0.0.1", sombra: false, nuvem: null },
    args: ["--atualizar"],
    etapas: ["1/4 Conferência do computador", "2/4 Agente e mod", "3/4 Serviço", "4/4 Prova final"],
  },
  {
    nome: "atualização com nuvem, sem token (o botão de atualizar do painel)",
    instalacao: { versao: "0.0.1", sombra: false, nuvem: NUVEM, painel: { url: "https://painel.exemplo.com", projeto: "reveza" } },
    args: ["--atualizar"],
    etapas: ["1/5 Conferência do computador", "2/5 Agente e mod", "3/5 A nuvem (Supabase)", "4/5 Serviço", "5/5 Prova final"],
  },
];

for (const caso of casos) {
  test(`etapas na saída do instalador: ${caso.nome}`, { skip: SEM_SH }, () => {
    const c = prepararCasa(caso.instalacao ? { instalacao: caso.instalacao } : {});
    try {
      Object.assign(c.env, caso.env || {});
      const r = c.rodar(["--sim", "--sem-servico", "--sem-react-bits", ...(caso.args || [])]);
      assert.equal(r.status, 0, r.saida.slice(-1500));
      const vistas = etapasDaSaida(r.saida);
      assert.equal(vistas.length, caso.etapas.length, vistas.join(" | "));
      caso.etapas.forEach((e, i) => (e instanceof RegExp ? assert.match(vistas[i], e) : assert.equal(vistas[i], e)));
      assert.equal(c.rede(), "", "nenhuma chamada de rede");
    } finally {
      c.limpar();
    }
  });
}
