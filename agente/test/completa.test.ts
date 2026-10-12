// A atualização completa no agente (0.3.0): os tokens cifrados com a chave do cofre (nunca em claro no disco, no log, no
// evento ou num argumento), o comando de ligar e desligar, a vez de publicar (um computador por vez) e a ordem: a nuvem
// já na versão nova, funções e painel, e só então o programa deste computador.

import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { novaChave } from "../src/cofre/cifra.js";
import { GuardaFalsa, SEGREDO_COFRE } from "../src/cofre/guarda.js";
import { CredenciaisFalsas } from "../src/credenciais/falsa.js";
import { executarCli, type Ambiente } from "../src/cli.js";
import { VERSAO } from "../src/config.js";
import {
  aadToken,
  abrirTokens,
  cifrarTokens,
  completaLigada,
  conferirTokens,
  pendenteDaPublicacao,
  refDaNuvem,
  semSegredos,
  tokenValido,
} from "../src/completa.js";
import { impressaoDaChave } from "../src/ligar.js";
import { guardarIdentidade } from "../src/nuvem/supabase.js";
import type { FonteVersoes } from "../src/atualizar.js";
import { ApiFalsa, BancoFalso, CliFalsa, ExecutorFalso, montar, NuvemFalsa, pastaTemporaria, RelogioFalso, type Montado } from "./falsos.js";

// tokens de mentira, com cara de token (a trava do repositório recusa os de formato real)
const TOKENS = { supabase: "token-supabase-de-teste-1234567890", vercel: "token-vercel-de-teste-0987654321" };
const REF = "abcdefghijklmnopqrst";

let m: Montado | null = null;
let tmp: ReturnType<typeof pastaTemporaria> | null = null;
afterEach(() => {
  m?.limpar();
  m = null;
  tmp?.limpar();
  tmp = null;
});

/** Todo arquivo debaixo da pasta, como texto, para procurar o token em claro. */
function tudoNaPasta(dir: string): string {
  let r = "";
  if (!fs.existsSync(dir)) return r;
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) r += tudoNaPasta(p);
    else r += `\n${p}\n${fs.readFileSync(p).toString("latin1")}`;
  }
  return r;
}
const temToken = (t: string) => t.includes(TOKENS.supabase) || t.includes(TOKENS.vercel);

describe("os tokens cifrados com a chave do cofre", () => {
  test("cifra e abre com a mesma chave; outra chave, ou um token no lugar do outro, não abre", () => {
    const k = novaChave();
    const c = cifrarTokens(k, TOKENS);
    assert.ok(!c.supabase.cifrado.toString("latin1").includes("token-"), "o cifrado não leva o token");
    assert.deepEqual(abrirTokens(k, c), TOKENS);
    assert.throws(() => abrirTokens(novaChave(), c), /não abrem com a chave do cofre deste computador/);
    assert.throws(() => abrirTokens(k, { supabase: c.vercel, vercel: c.supabase }), /não abrem/, "o dado associado diz qual token é");
    assert.throws(() => abrirTokens(k, { supabase: c.supabase, vercel: null }), /desligada/);
    assert.equal(aadToken("supabase"), "reveza-atualizacao|supabase");
    try {
      abrirTokens(novaChave(), c);
    } catch (e) {
      assert.ok(!temToken((e as Error).message));
    }
  });

  test("o texto que vai para log ou evento sai sem nenhum pedaço dos tokens", () => {
    const t = `Parei: o Supabase recusou ${TOKENS.supabase} e a Vercel ${TOKENS.vercel}`;
    const limpo = semSegredos(t, [TOKENS.supabase, TOKENS.vercel]);
    assert.ok(!temToken(limpo));
    assert.match(limpo, /\[token\]/);
    assert.equal(semSegredos("nada aqui", ["abc"]), "nada aqui", "segredo curto demais não vira coringa");
    assert.equal(tokenValido(TOKENS.supabase), true);
    assert.equal(tokenValido("curto"), false);
    assert.equal(tokenValido("com espaço no meio do token xxxxx"), false);
    assert.equal(refDaNuvem(`https://${REF}.supabase.co`), REF);
    assert.equal(refDaNuvem("https://exemplo.com"), null);
  });

  test("conferir os tokens: o do Supabase alcança o projeto, o da Vercel a conta; o erro não leva o token", async () => {
    const pedidos: { url: string; auth: string }[] = [];
    const f = (status: Record<string, number>) =>
      (async (url: string | URL | Request, init?: RequestInit) => {
        const u = String(url);
        pedidos.push({ url: u, auth: String((init?.headers as Record<string, string>)?.Authorization ?? "") });
        const s = Object.entries(status).find(([k]) => u.includes(k))?.[1] ?? 500;
        return new Response("{}", { status: s });
      }) as typeof fetch;
    assert.deepEqual(await conferirTokens(TOKENS, REF, f({ "api.supabase.com": 200, "api.vercel.com": 200 })), { ok: true });
    assert.equal(pedidos[0]!.url, `https://api.supabase.com/v1/projects/${REF}`);
    assert.equal(pedidos[0]!.auth, `Bearer ${TOKENS.supabase}`);
    assert.equal(pedidos[1]!.auth, `Bearer ${TOKENS.vercel}`);
    const ruim = await conferirTokens(TOKENS, REF, f({ "api.supabase.com": 403 }));
    assert.equal(ruim.ok, false);
    assert.match((ruim as { erro: string }).erro, /não alcança o projeto abcdefghijklmnopqrst/);
    assert.ok(!temToken(JSON.stringify(ruim)));
    const semRede = await conferirTokens(TOKENS, REF, (async () => {
      throw new Error(`falhou com ${TOKENS.supabase}`);
    }) as typeof fetch);
    assert.match((semRede as { erro: string }).erro, /rede/);
    assert.ok(!temToken(JSON.stringify(semRede)));
  });

  test("o que falta publicar: a mesma regra do banco (rvz_publicacao_pendente)", () => {
    assert.deepEqual(pendenteDaPublicacao({}), { versao: null, funcoes: false, painel: false });
    assert.deepEqual(pendenteDaPublicacao({ nuvem_versao: "0.3.1" }), { versao: "0.3.1", funcoes: true, painel: true });
    const imp = { "0.3.0": { funcoes: "f1", painel: "p1" }, "0.3.1": { funcoes: "f1", painel: "p2" } };
    assert.deepEqual(pendenteDaPublicacao({ nuvem_versao: "0.3.1", publicado: { funcoes: "0.3.0", painel: "0.3.0" }, impressoes: imp }), {
      versao: "0.3.1",
      funcoes: false,
      painel: true,
    });
    assert.deepEqual(pendenteDaPublicacao({ nuvem_versao: "0.3.1", publicado: { funcoes: "0.4.0", painel: "0.3.1" } }), { versao: "0.3.1", funcoes: false, painel: false });
    assert.deepEqual(pendenteDaPublicacao({ nuvem_versao: "0.3.1", publicado: { funcoes: "lixo", painel: null } }), { versao: "0.3.1", funcoes: true, painel: true });
    assert.equal(completaLigada({ atualizacao_completa: { ligada: true } }), true);
    assert.equal(completaLigada({ atualizacao_completa: { ligada: false } }), false);
    assert.equal(completaLigada({}), false);
  });
});

// ------------------------------------------------------------------------------------------------ o comando

describe("reveza atualizacao-completa", () => {
  async function ambiente(o: { chave?: Buffer | null; respostas?: string[]; entrada?: string; status?: Record<string, number> } = {}) {
    tmp = pastaTemporaria();
    const guarda = new GuardaFalsa();
    const k = o.chave === undefined ? novaChave() : o.chave;
    if (k) await guarda.gravar(SEGREDO_COFRE, k.toString("base64"));
    await guardarIdentidade(guarda, { url: `https://${REF}.supabase.co`, chavePublica: "anon", email: "pc@exemplo.com", senha: "s".repeat(40) });
    const banco = new BancoFalso();
    banco.cofreImpressao = k ? impressaoDaChave(k) : "outra";
    const saidas: string[] = [];
    const erros: string[] = [];
    const respostas = [...(o.respostas ?? [TOKENS.supabase, TOKENS.vercel])];
    const perguntas: string[] = [];
    const amb: Ambiente = {
      c: tmp.c,
      sistema: "linux",
      exec: new ExecutorFalso(),
      relogio: new RelogioFalso(),
      saida: (t) => saidas.push(t),
      erro: (t) => erros.push(t),
      perguntar: async () => assert.fail("token nunca pela pergunta com eco"),
      perguntarSegredo: async (q) => {
        perguntas.push(q);
        return respostas.shift() ?? "";
      },
      lerEntrada: async () => o.entrada ?? "",
      fetch: (async (url: string | URL | Request) => {
        const u = String(url);
        const s = Object.entries(o.status ?? { "api.supabase.com": 200, "api.vercel.com": 200 }).find(([x]) => u.includes(x))?.[1] ?? 500;
        return new Response("{}", { status: s });
      }) as typeof fetch,
      env: {},
      script: "/app/cli.js",
      fabricas: { cred: () => new CredenciaisFalsas(), guarda: async () => guarda, api: () => new ApiFalsa(), cli: () => new CliFalsa(), nuvem: async () => new NuvemFalsa(banco, "pc-1") },
    };
    return { amb, banco, saidas, erros, perguntas, k };
  }

  test("ligar: pede os dois sem eco, avisa o que custa, confere, cifra e guarda; nada em claro na saída, no disco ou na nuvem", async () => {
    const a = await ambiente();
    assert.equal(await executarCli(["atualizacao-completa", "ligar"], a.amb), 0, a.erros.join("\n"));
    assert.deepEqual(a.perguntas.map((q) => q.split(" (")[0]), ["Token do Supabase", "Token da Vercel"]);
    const texto = a.saidas.join("\n");
    assert.match(texto, /CIFRADOS com a chave do cofre/);
    assert.match(texto, /quem tiver um computador desta instalação passa a ter esses tokens/);
    assert.match(texto, /Vercel .*escopo só no time do painel e com validade/);
    assert.match(texto, /Atualização completa ligada/);
    const c = a.banco.credenciais;
    assert.ok(c.supabase && c.vercel);
    assert.deepEqual(abrirTokens(a.k!, { supabase: c.supabase, vercel: c.vercel }), TOKENS, "a nuvem guarda o cifrado que só K abre");
    assert.ok(!temToken(c.supabase.cifrado.toString("latin1") + c.vercel.cifrado.toString("latin1")));
    assert.ok(!temToken(texto + a.erros.join("\n")), "nada do token na tela");
    assert.ok(!temToken(tudoNaPasta(tmp!.dir)), "nada do token no disco");
    assert.ok(!temToken(JSON.stringify(a.banco.eventos) + JSON.stringify(a.banco.config)), "nem em evento nem na configuração");
    assert.equal(a.banco.config.atualizacao_completa && (a.banco.config.atualizacao_completa as { ligada: boolean }).ligada, true);
    // status: ligada, e este computador abre
    a.saidas.length = 0;
    assert.equal(await executarCli(["atualizacao-completa", "status", "--json"], a.amb), 0);
    const st = JSON.parse(a.saidas[0]!);
    assert.equal(st.ligada, true);
    assert.equal(st.abreAqui, true);
    assert.ok(!temToken(a.saidas.join("\n")));
    // desligar: tira da nuvem e lembra de apagar os tokens lá
    a.saidas.length = 0;
    assert.equal(await executarCli(["atualizacao-completa", "desligar"], a.amb), 0);
    assert.deepEqual(a.banco.credenciais, {});
    assert.match(a.saidas.join("\n"), /apague os tokens em https:\/\/supabase\.com\/dashboard\/account\/tokens e https:\/\/vercel\.com\/account\/tokens/);
  });

  test("ligar pela entrada padrão (a oferta do instalador): sem pergunta, mesmo resultado", async () => {
    const a = await ambiente({ entrada: JSON.stringify(TOKENS) });
    assert.equal(await executarCli(["atualizacao-completa", "ligar", "--stdin"], a.amb), 0, a.erros.join("\n"));
    assert.deepEqual(a.perguntas, []);
    assert.deepEqual(abrirTokens(a.k!, { supabase: a.banco.credenciais.supabase!, vercel: a.banco.credenciais.vercel! }), TOKENS);
  });

  test("não liga: sem a chave do cofre, com token recusado, com um token só, ou com a chave que não é a da instalação", async () => {
    let a = await ambiente({ chave: null });
    assert.equal(await executarCli(["atualizacao-completa", "ligar"], a.amb), 1);
    assert.match(a.erros.join("\n"), /não tem a chave do cofre/);
    a = await ambiente({ status: { "api.supabase.com": 401 } });
    assert.equal(await executarCli(["atualizacao-completa", "ligar"], a.amb), 1);
    assert.match(a.erros.join("\n"), /não liguei: o token do Supabase não alcança o projeto/);
    assert.deepEqual(a.banco.credenciais, {}, "nada guardado");
    a = await ambiente({ respostas: [TOKENS.supabase, ""] });
    assert.equal(await executarCli(["atualizacao-completa", "ligar"], a.amb), 2);
    assert.match(a.erros.join("\n"), /faltam os dois tokens/);
    a = await ambiente();
    a.banco.cofreImpressao = "de-outra-chave";
    assert.equal(await executarCli(["atualizacao-completa", "ligar"], a.amb), 1);
    assert.match(a.erros.join("\n"), /não é a da instalação/);
    assert.ok(!temToken(a.erros.join("\n") + a.saidas.join("\n")));
  });
});

// ------------------------------------------------------------------------------------------------ a publicação

function tarGz(arquivos: Record<string, string>): Buffer {
  const partes: Buffer[] = [];
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    const c = Buffer.from(conteudo);
    const h = Buffer.alloc(512);
    h.write(nome, 0, "utf8");
    h.write("0000644\0", 100);
    h.write("0000000\0", 108);
    h.write("0000000\0", 116);
    h.write(c.length.toString(8).padStart(11, "0") + "\0", 124);
    h.write("00000000000\0", 136);
    h.write("        ", 148);
    h.write("0", 156);
    h.write("ustar\0", 257);
    h.write("00", 263);
    const soma = h.reduce((s, b) => s + b, 0);
    h.write(soma.toString(8).padStart(6, "0") + "\0 ", 148);
    partes.push(h, c, Buffer.alloc((512 - (c.length % 512)) % 512));
  }
  partes.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(partes));
}

class VersoesFalsas implements FonteVersoes {
  baixadas: string[] = [];
  constructor(public lista: string[]) {}
  async publicadas() {
    return [...this.lista];
  }
  async baixar(versao: string, arquivo: string) {
    this.baixadas.push(versao);
    const raiz = `reveza-${versao}`;
    fs.writeFileSync(arquivo, tarGz({ [`${raiz}/package.json`]: JSON.stringify({ name: "reveza", version: versao }), [`${raiz}/instalador/instalar.mjs`]: "// instalador\n" }));
  }
}

describe("a publicação das funções e do painel", () => {
  const NUVEM = "0.3.1";
  async function preparar(o: { saida?: string; codigo?: number; ligada?: boolean } = {}) {
    const banco = new BancoFalso();
    const exec = new ExecutorFalso();
    exec.responder = (argv) =>
      argv.includes("--publicar-nuvem") ? { codigo: o.codigo ?? 0, saida: o.saida ?? "  ✓ funções da nuvem publicadas\n", erro: "" } : { codigo: 0, saida: "", erro: "" };
    const versoes = new VersoesFalsas([NUVEM, "0.3.0", VERSAO]);
    const nuvem = new NuvemFalsa(banco, "pc-1");
    m = await montar({ nuvem, exec, versoes, refNuvem: REF });
    banco.cofreImpressao = impressaoDaChave(m.agente.chave!);
    banco.config.nuvem_versao = NUVEM;
    banco.config.publicado = { funcoes: "0.3.0", painel: "0.3.0" };
    banco.config.atualizar_sozinho = "assim_que_sair";
    if (o.ligada !== false) {
      const c = cifrarTokens(m.agente.chave!, TOKENS);
      await nuvem.credenciaisGuardar(c.supabase, c.vercel, banco.cofreImpressao);
    }
    return { banco, exec, versoes, nuvem };
  }

  test("com a atualização completa ligada, o computador calmo pega a vez e publica pelo instalador da versão da nuvem, com os tokens só pela entrada padrão", async () => {
    const { banco, exec, versoes } = await preparar();
    await m!.agente.busca();
    await m!.agente.esperar();
    assert.deepEqual(versoes.baixadas, [NUVEM], "o pacote da versão em que a nuvem está");
    const chamada = exec.chamadas.find((c) => c.argv.includes("--publicar-nuvem"))!;
    assert.ok(chamada, "rodou o instalador");
    assert.deepEqual(chamada.argv.slice(2), ["--publicar-nuvem", "--ref", REF, "--partes", "funcoes,painel"]);
    assert.match(chamada.argv[1]!, new RegExp(`reveza-${NUVEM.replaceAll(".", "\\.")}[/\\\\]instalador[/\\\\]instalar\\.mjs$`));
    assert.deepEqual(JSON.parse(chamada.entrada!), TOKENS, "os tokens vão pela entrada padrão");
    assert.ok(!temToken(chamada.argv.join(" ")), "nunca em argumento");
    assert.equal(banco.publicacaoVez?.estado, "concluida");
    assert.deepEqual(banco.config.publicado, { funcoes: NUVEM, painel: NUVEM });
    assert.ok(fs.existsSync(path.join(m!.c.logs, `publicacao-${NUVEM}.log`)));
    assert.ok(!temToken(tudoNaPasta(path.dirname(m!.c.base))), "nada do token no disco (log incluído)");
    assert.ok(!temToken(m!.log.linhas.join("\n")), "nem no log do agente");
    assert.ok(!temToken(JSON.stringify(banco.eventos) + JSON.stringify(banco.chamadas.filter((c) => c.fn !== "credenciaisGuardar"))), "nem nos eventos ou chamadas à nuvem");
    assert.equal(m!.agente.publicando, null);
  });

  test("a saída do instalador com o token (se um dia escapar) vai para o log sem ele; a falha vira o motivo e o alerta", async () => {
    const { banco } = await preparar({ codigo: 1, saida: `· Publicando\n\n  Parei: Vercel GET /v9/projects: 403 token ${TOKENS.vercel} sem acesso ao time\n` });
    await m!.agente.busca();
    await m!.agente.esperar();
    assert.equal(banco.publicacaoVez?.estado, "falhou");
    assert.match(String(banco.publicacaoVez?.motivo), /Parei: Vercel GET \/v9\/projects: 403 token \[token\] sem acesso ao time/);
    assert.ok(banco.alertas.some((a) => a.dados.parte === "publicacao"));
    const log = fs.readFileSync(path.join(m!.c.logs, `publicacao-${NUVEM}.log`), "utf8");
    assert.ok(!temToken(log) && !temToken(JSON.stringify(banco.alertas)) && !temToken(m!.log.linhas.join("\n")));
    // parou: não tenta de novo sozinho (quem pede de novo é o administrador, pelo painel)
    await m!.relogio.avancar(3600_000);
    const antes = banco.chamadas.filter((c) => c.fn === "vezDePublicar").length;
    banco.config.publicacao_vez = { computador: "pc-1", para: NUVEM, estado: "falhou" };
    await m!.agente.busca();
    assert.equal(banco.chamadas.filter((c) => c.fn === "vezDePublicar").length, antes);
  });

  test("um computador por vez: com a vez de outro, este espera; desligada ou sem nada a publicar, nem pede", async () => {
    const { banco, exec } = await preparar();
    banco.publicacaoVez = { pc: "outro-pc", para: NUVEM, estado: "em_andamento", desde: banco.agora() };
    await m!.agente.busca();
    await m!.agente.esperar();
    assert.ok(!exec.chamadas.some((c) => c.argv.includes("--publicar-nuvem")), "não publicou com a vez do outro");
    assert.match(m!.log.linhas.join("\n"), /ainda não \(outro\)/);
    m!.limpar();
    m = null;
    const d = await preparar({ ligada: false });
    await m!.agente.busca();
    assert.ok(!d.banco.chamadas.some((c) => c.fn === "vezDePublicar"), "desligada: nem pede a vez");
    d.banco.config.atualizacao_completa = { ligada: true };
    d.banco.config.publicado = { funcoes: NUVEM, painel: NUVEM };
    await m!.relogio.avancar(600_000);
    await m!.agente.busca();
    assert.ok(!d.banco.chamadas.some((c) => c.fn === "vezDePublicar"), "em dia: nem pede a vez");
  });

  test("a ordem: enquanto publica, este computador não se atualiza (a publicação é um processo dele)", async () => {
    await preparar();
    m!.agente.publicando = NUVEM;
    const r = await m!.agente.atualizarPrograma("mais_nova", { comando: 1, sozinho: false });
    assert.equal(r.ok, false);
    assert.match((r as { erro: string }).erro, /publicando as funções e o painel da 0\.3\.1/);
  });
});
