// O agente com a nuvem (falsa, com as regras das funções agente_*): atribuição, posse, cofre, leitura com posse,
// comandos, sombra e sem internet.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { aadConta, aadRegistro, cifrarLogin, decifrarLogin } from "../src/cofre/cifra.js";
import { lerChave } from "../src/ligar.js";
import { ativaEm, BancoFalso, blob, contaEstacionada, montar, NuvemFalsa, type Montado } from "./falsos.js";

let m: Montado;
let banco: BancoFalso;
let nuvem: NuvemFalsa;
afterEach(() => m?.limpar());
const e = () => m.agente.estado;
const pasta = (id: string) => e().contas[id]!.pasta;

async function preparar(opcoes: { sombra?: boolean; chave?: Buffer | null; exec?: import("../src/util/executor.js").Executor } = {}) {
  banco = new BancoFalso();
  nuvem = new NuvemFalsa(banco, "pc-1");
  m = await montar({ nuvem, ...opcoes });
  banco.agora = () => m.relogio.agora();
}

/** Conta que existe na nuvem com o login no cofre (cifrado com a chave deste computador). */
async function semear(letra: string, versao = 2, tok = letra + "1") {
  const c = banco.conta(`${letra.toLowerCase()}@exemplo.com`);
  const k = (await lerChave(m.guarda))!;
  const { cifrado, nonce } = cifrarLogin(k, aadConta(c.id, versao), blob(tok, true, 3600, m.relogio.agora()));
  c.cofre = { cifrado, nonce, versao, expira_em: null };
  return c.id;
}

async function abrir(contaId: string) {
  const c = banco.contas.get(contaId)!;
  const k = (await lerChave(m.guarda))!;
  return decifrarLogin(k, aadConta(contaId, c.cofre!.versao), c.cofre!.cifrado, c.cofre!.nonce);
}

const fns = (fn: string) => banco.chamadas.filter((c) => c.fn === fn);

describe("partida com nuvem", () => {
  test("registra o computador, a nuvem atribui a conta que já estava nele e o agente pega a posse de uso", async () => {
    await preparar();
    const a = await ativaEm(m, "A", 10);
    await m.agente.esperar(); // a conta adotada entra na nuvem
    const contaId = e().contas[a]!.contaId!;
    assert.ok(contaId);
    await m.agente.busca();
    assert.equal(fns("registrar").length, 1);
    assert.equal(fns("ola")[0]!.args[2], "a@exemplo.com", "p_conta_local leva o e-mail da conta em uso");
    assert.equal(banco.atribuicao.get("pc-1")!.conta, contaId);
    assert.equal(banco.posse.get(contaId)!.pc, "pc-1");
    assert.equal(banco.posse.get(contaId)!.motivo, "uso");
  });

  test("conta adotada vai ao cofre com o dado associado definitivo (conta_id|versão), não o de registro", async () => {
    await preparar();
    const a = await ativaEm(m, "A", 10);
    await m.agente.esperar();
    const contaId = e().contas[a]!.contaId!;
    assert.equal(banco.contas.get(contaId)!.cofre!.versao, 2);
    assert.equal((await abrir(contaId)).claudeAiOauth?.accessToken, "A1");
  });

  test("sem a chave do cofre, a conta fica só neste computador e o agente avisa", async () => {
    await preparar({ chave: null });
    await ativaEm(m, "A", 10);
    await m.agente.esperar();
    assert.equal(fns("registrarConta").length, 0);
    assert.ok(e().eventos.some((x) => /falta a chave do cofre/.test(x.texto)));
  });
});

describe("atribuição", () => {
  async function comAeB() {
    await preparar();
    const a = await ativaEm(m, "A", 10);
    await m.agente.esperar();
    await m.agente.busca();
    const bId = await semear("B");
    const b = contaEstacionada(m, "B", 3, { contaId: bId });
    e().contas[b]!.versaoCofre = 2;
    return { a, b, aId: e().contas[a]!.contaId!, bId };
  }

  test("a nuvem atribui outra conta: pega a posse, troca, e a que saiu volta ao cofre antes de soltar", async () => {
    const { a, b, aId, bId } = await comAeB();
    m.cred.d.set("principal", blob("A5")); // as sessões renovaram A (o agente só vê na hora da troca)
    banco.atribuir("pc-1", bId, "chegou a 95%");
    await m.agente.busca();
    assert.equal(e().ativa, b);
    assert.equal(m.cred.token("principal"), "B1");
    assert.equal(banco.posse.get(bId)!.motivo, "uso");
    assert.ok(banco.posse.get(aId), "a que saiu fica com a posse até a conferência da troca passar");
    m.relogio.t += 25;
    await m.agente.busca();
    assert.equal(banco.posse.get(aId), undefined, "depois solta");
    assert.equal((await abrir(aId)).claudeAiOauth?.accessToken, "A5", "o cofre ficou com o login mais novo de A");
    const ordem = banco.chamadas.filter((c) => c.args[0] === aId && (c.fn === "devolverCofre" || c.fn === "soltarPosse")).map((c) => c.fn);
    assert.deepEqual(ordem.slice(-2), ["devolverCofre", "soltarPosse"], "devolve antes de soltar");
    assert.equal(m.cred.token(pasta(a)), "A5");
  });

  test("posse recusada (outro computador tem a conta): não troca", async () => {
    const { b, bId } = await comAeB();
    banco.atribuir("pc-1", bId);
    banco.posse.set(bId, { pc: "pc-2", motivo: "leitura", expira: m.relogio.agora() + 60 });
    await m.agente.busca();
    assert.notEqual(e().ativa, b);
    assert.equal(m.cred.token("principal"), "A1");
  });

  test("cofre mais novo que a cópia local entra no lugar dela antes da troca", async () => {
    const { bId } = await comAeB();
    await semear("B", 5, "B9");
    banco.atribuir("pc-1", bId);
    await m.agente.busca();
    assert.equal(m.cred.token("principal"), "B9");
  });

  test("gravação de registro antiga com versão nova não troca a cópia local mais nova", async () => {
    await preparar();
    await ativaEm(m, "A", 10);
    await m.agente.esperar();
    const c = banco.conta("b@exemplo.com");
    const id = contaEstacionada(m, "B", 3, { contaId: c.id });
    e().contas[id]!.versaoCofre = 1;
    m.cred.d.set(pasta(id), blob("B-local", true, 7200, m.relogio.agora()));
    const k = (await lerChave(m.guarda))!;
    const velho = cifrarLogin(k, aadRegistro("b@exemplo.com"), blob("B-velho", true, 600, m.relogio.agora()));
    c.cofre = { ...velho, versao: 9, expira_em: null };
    await m.agente.posse!.sincronizar(id, c.cofre);
    assert.equal(m.cred.token(pasta(id)), "B-local");
  });

  test("cópia do cofre nunca entra por cima da conta em uso", async () => {
    const { a, aId } = await comAeB();
    m.cred.d.set("principal", blob("A7"));
    await m.agente.trocador.conferirPrincipal();
    const k = (await lerChave(m.guarda))!;
    const velho = cifrarLogin(k, aadConta(aId, 9), blob("A0"));
    banco.contas.get(aId)!.cofre = { ...velho, versao: 9, expira_em: null };
    const copia = m.cred.token(pasta(a));
    const versao = e().contas[a]!.versaoCofre;
    await m.agente.posse!.sincronizar(a, banco.contas.get(aId)!.cofre!);
    assert.equal(m.cred.token("principal"), "A7");
    assert.equal(m.cred.token(pasta(a)), copia, "nem a cópia guardada da conta em uso é trocada");
    assert.equal(e().contas[a]!.versaoCofre, versao);
  });

  test("conta que só a nuvem conhece chega do cofre e entra em uso", async () => {
    await preparar();
    await ativaEm(m, "A", 10);
    await m.agente.esperar();
    await m.agente.busca();
    const cId = await semear("C", 3);
    banco.atribuir("pc-1", cId);
    await m.agente.busca();
    const c = Object.values(e().contas).find((x) => x.email === "c@exemplo.com")!;
    assert.ok(c);
    assert.equal(c.contaId, cId);
    assert.equal(e().ativa, c.id);
    assert.equal(m.cred.token("principal"), "C1");
    assert.ok(fs.existsSync(c.pasta));
  });

  test("conta sem login guardado: não troca e não martela a cada busca", async () => {
    const { b, bId } = await comAeB();
    m.cred.d.set(pasta(b), blob("B1", false));
    banco.contas.get(bId)!.cofre = null;
    banco.atribuir("pc-1", bId);
    await m.agente.busca();
    await m.agente.busca();
    assert.notEqual(e().ativa, b);
    assert.equal(fns("pegarPosse").filter((x) => x.args[0] === bId && x.args[1] === "uso").length, 1);
  });
});

describe("leitura e renovação com posse", () => {
  test("conta parada é lida com posse curta, o número vai à nuvem e a posse é solta", async () => {
    await preparar();
    await ativaEm(m, "A", 10);
    await m.agente.esperar();
    await m.agente.busca();
    m.agente.online = true;
    const bId = await semear("B");
    const b = contaEstacionada(m, "B", 3, { contaId: bId });
    e().contas[b]!.versaoCofre = 2;
    m.api.usos.B = 44;
    await m.agente.lerUsoConta(b);
    assert.equal(e().contas[b]!.janelas[0]!.pct, 44);
    assert.ok(banco.janelas.some((j) => j.conta_id === bId && j.pct === 44), "a nuvem aceitou o número (havia posse)");
    assert.equal(banco.posse.get(bId), undefined);
    assert.equal(fns("pegarPosse").find((x) => x.args[0] === bId)!.args[1], "leitura");
  });

  test("sem posse (a conta é de outro computador) não lê nem renova", async () => {
    await preparar();
    await ativaEm(m, "A", 10);
    await m.agente.esperar();
    m.agente.online = true;
    const bId = await semear("B");
    const b = contaEstacionada(m, "B", 3, { contaId: bId });
    m.cred.d.set(pasta(b), blob("B1", true, 30));
    banco.atribuicao.set("pc-2", { conta: bId, versao: 1, motivo: "x" });
    await m.agente.lerUsoConta(b);
    assert.equal(m.cli.renovacoes.length, 0);
    assert.ok(!m.api.usosPedidos.includes("B1"));
  });

  test("conta parada vencida: posse de renovação, renova, devolve o login novo ao cofre e solta", async () => {
    await preparar();
    await ativaEm(m, "A", 10);
    await m.agente.esperar();
    m.agente.online = true;
    const bId = await semear("B", 2, "B1");
    const b = contaEstacionada(m, "B", 3, { contaId: bId });
    e().contas[b]!.versaoCofre = 2;
    const k = (await lerChave(m.guarda))!;
    const vencido = cifrarLogin(k, aadConta(bId, 2), blob("B1", true, 30, m.relogio.agora()));
    banco.contas.get(bId)!.cofre = { ...vencido, versao: 2, expira_em: null };
    m.cred.d.set(pasta(b), blob("B1", true, 30, m.relogio.agora()));
    m.cli.aoRenovar = (p) => m.cred.d.set(p, blob("B2", true, 7200, m.relogio.agora()));
    await m.agente.lerUsoConta(b);
    assert.equal(fns("pegarPosse").find((x) => x.args[0] === bId)!.args[1], "renovacao");
    assert.equal(m.cli.renovacoes.length, 1);
    assert.equal((await abrir(bId)).claudeAiOauth?.accessToken, "B2");
    assert.equal(banco.contas.get(bId)!.cofre!.versao, 3);
    assert.equal(banco.posse.get(bId), undefined);
  });

  test("as sessões renovaram a conta em uso: a cópia nova sobe ao cofre", async () => {
    await preparar();
    const a = await ativaEm(m, "A", 10);
    await m.agente.esperar();
    await m.agente.busca();
    const aId = e().contas[a]!.contaId!;
    m.cred.d.set("principal", blob("A2"));
    await m.agente.trocador.conferirPrincipal();
    m.relogio.t += 61;
    await m.agente.busca();
    assert.equal((await abrir(aId)).claudeAiOauth?.accessToken, "A2");
  });
});

describe("sem internet e modo sombra", () => {
  test("sem internet: mantém a conta atual e segue tentando", async () => {
    await preparar();
    const a = await ativaEm(m, "A", 10);
    await m.agente.esperar();
    banco.foraDoAr = true;
    await m.agente.busca();
    assert.equal(m.agente.online, false);
    assert.equal(e().ativa, a);
    assert.equal(m.cred.token("principal"), "A1");
    assert.ok(m.log.linhas.some((l) => /mantenho a conta atual/.test(l)));
    banco.foraDoAr = false;
    await m.agente.busca();
    assert.equal(m.agente.online, true);
  });

  test("sombra: lê e decide, mas não pega posse, não troca, não responde comando e registra o que faria", async () => {
    await preparar({ sombra: true });
    const a = await ativaEm(m, "A", 10);
    await m.agente.esperar();
    const bId = await semear("B");
    contaEstacionada(m, "B", 3, { contaId: bId });
    banco.atribuir("pc-1", bId, "chegou a 95%");
    banco.comandos.push({ id: 7, acao: "atualizar", corpo: {}, pc: "pc-1", estado: "pendente" });
    const gravacoes = m.cred.gravacoes.length;
    await m.agente.busca();
    assert.equal(e().ativa, a);
    assert.equal(m.cred.gravacoes.length, gravacoes);
    assert.equal(fns("pegarPosse").length, 0);
    assert.equal(fns("registrarConta").length, 0);
    assert.equal(fns("reservarComando").length, 0);
    assert.equal(banco.comandos[0]!.estado, "pendente");
    assert.ok(m.log.linhas.some((l) => l.includes("faria: pegar a posse e trocar para b@exemplo.com")));
    assert.ok(m.log.linhas.some((l) => l.includes("faria: reservar e responder o comando 7")));
  });
});

describe("ciclo de vida", () => {
  test("a nuvem estava fora quando a conta apareceu: o registro é tentado de novo depois", async () => {
    await preparar();
    banco.foraDoAr = true;
    const a = await ativaEm(m, "A", 10);
    await m.agente.esperar();
    assert.equal(e().contas[a]!.contaId, null);
    banco.foraDoAr = false;
    await m.agente.busca();
    assert.ok(e().contas[a]!.contaId, "registrada na volta da nuvem");
    await m.agente.busca(); // na busca seguinte a nuvem atribui a conta local e o agente pega a posse de uso
    assert.equal(banco.posse.get(e().contas[a]!.contaId!)!.motivo, "uso");
  });

  test("a chave do cofre chega depois (reveza ligar em outro processo): o agente relê e a conta entra na nuvem", async () => {
    await preparar({ chave: null });
    const a = await ativaEm(m, "A", 10);
    await m.agente.esperar();
    await m.agente.busca();
    assert.equal(e().contas[a]!.contaId, null);
    const { novaChave } = await import("../src/cofre/cifra.js");
    await m.guarda.gravar("chave-cofre", novaChave().toString("base64"));
    m.relogio.t += 400;
    await m.agente.busca();
    assert.ok(e().contas[a]!.contaId);
  });

  test("posse que ficou de antes de o agente cair volta ao cofre e é solta na primeira busca", async () => {
    await preparar();
    await ativaEm(m, "A", 10);
    await m.agente.esperar();
    const bId = await semear("B");
    const b = contaEstacionada(m, "B", 3, { contaId: bId });
    e().contas[b]!.versaoCofre = 2;
    m.cred.d.set(pasta(b), blob("B4"));
    banco.posse.set(bId, { pc: "pc-1", motivo: "uso", expira: m.relogio.agora() + 120 }); // de antes de cair
    await m.agente.busca();
    assert.equal(banco.posse.get(bId), undefined);
    assert.equal((await abrir(bId)).claudeAiOauth?.accessToken, "B4");
  });

  test("partida sem posse de antes: a faxina não registra erro de cofre", async () => {
    await preparar();
    await ativaEm(m, "A", 10);
    await m.agente.esperar();
    const b = await semear("B");
    contaEstacionada(m, "B", 3, { contaId: b });
    await m.agente.busca();
    assert.ok(!m.log.linhas.some((l) => l.includes("recusou a versão nova")), m.log.linhas.join("\n"));
  });

  test("desligar: a conta em uso sobe ao cofre e fica com a posse; as paradas na mão são soltas", async () => {
    await preparar();
    const a = await ativaEm(m, "A", 10);
    await m.agente.esperar();
    await m.agente.busca();
    const aId = e().contas[a]!.contaId!;
    const bId = await semear("B");
    const b = contaEstacionada(m, "B", 3, { contaId: bId });
    e().contas[b]!.versaoCofre = 2;
    await m.agente.posse!.pegar(b, "leitura", 90);
    m.cred.d.set("principal", blob("A6"));
    await m.agente.desligar();
    assert.equal((await abrir(aId)).claudeAiOauth?.accessToken, "A6");
    assert.ok(banco.posse.get(aId), "a posse de uso fica (vence sozinha)");
    assert.equal(banco.posse.get(bId), undefined);
  });

  test("sombra com nuvem: a decisão local roda e o log diz uma vez que trocaria", async () => {
    await preparar({ sombra: true });
    await ativaEm(m, "A", 97);
    contaEstacionada(m, "B", 3);
    await m.agente.esperar();
    await m.agente.agir();
    await m.agente.agir();
    const linhas = m.log.linhas.filter((l) => l.includes("faria: trocar para b@exemplo.com"));
    assert.equal(linhas.length, 1);
    assert.equal(m.cred.token("principal"), "A1");
  });

  test("sombra não aplica a configuração da nuvem (segue a local, importada do roteador)", async () => {
    await preparar({ sombra: true });
    e().config.auto = true;
    banco.config.auto = false;
    await m.agente.busca();
    assert.equal(e().config.auto, true);
  });
});

describe("comandos do painel", () => {
  async function comComando(acao: string, corpo: Record<string, unknown> = {}, id = 1, painelLiberado = false) {
    await preparar();
    if (painelLiberado) {
      fs.mkdirSync(path.dirname(m.c.ligarPeloPainel), { recursive: true });
      fs.writeFileSync(m.c.ligarPeloPainel, "");
    }
    await ativaEm(m, "A", 10);
    await m.agente.esperar();
    banco.comandos.push({ id, acao, corpo, pc: "pc-1", estado: "pendente" });
    await m.agente.busca();
    await m.agente.emEspera;
    return banco.comandos.find((c) => c.id === id)!;
  }

  test("atualizar: reserva, roda e responde 200", async () => {
    const c = await comComando("atualizar");
    assert.equal(c.estado, "feito");
    assert.equal(c.http, 200);
  });

  test("retomar_sessao: só sessão que ainda espera, e na pasta da transcrição", async () => {
    await preparar();
    await ativaEm(m, "A", 10);
    await m.agente.esperar();
    const sessao = "77777777-0000-4000-8000-000000000007";
    const dir = path.join(m.c.projetos, "-p");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${sessao}.jsonl`), JSON.stringify({ sessionId: sessao, cwd: m.c.base }) + "\n");
    e().fila.unshift({ sessao, cwd: "/tmp/outra", tipo: "headless", em: m.relogio.agora(), estado: "aguardando", conta: null });
    const comTela = "00000000-0000-4000-8000-0000000000aa";
    e().fila.unshift({ sessao: comTela, cwd: "/tmp/outra", tipo: "interativa", em: m.relogio.agora(), estado: "aguardando", conta: null });
    banco.comandos.push({ id: 1, acao: "retomar_sessao", corpo: { sessao }, pc: "pc-1", estado: "pendente" });
    banco.comandos.push({ id: 2, acao: "retomar_sessao", corpo: { sessao }, pc: "pc-1", estado: "pendente" });
    banco.comandos.push({ id: 3, acao: "retomar_sessao", corpo: { sessao: comTela }, pc: "pc-1", estado: "pendente" });
    await m.agente.busca();
    assert.deepEqual(m.cli.retomadas, [{ sessao, cwd: m.c.base }]);
    assert.equal(banco.comandos.find((c) => c.id === 1)!.http, 200);
    assert.equal(banco.comandos.find((c) => c.id === 2)!.http, 409, "a segunda vez é recusada");
    assert.equal(banco.comandos.find((c) => c.id === 3)!.http, 409, "sessão com tela não é retomada no terminal por cima");
  });

  test("ligar pelo painel: a frase volta cifrada para o navegador, e só ele abre", async () => {
    const { webcrypto } = await import("node:crypto");
    const { abrirEnvelopeNavegador } = await import("../src/ligar.js");
    const par = (await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as import("node:crypto").webcrypto.CryptoKeyPair;
    const jwk = await webcrypto.subtle.exportKey("jwk", par.publicKey);
    const c = await comComando("ligar", { publica: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, idioma: "pt-BR" }, 1, true);
    assert.equal(c.http, 200);
    const env = (c.resposta as { envelope: import("../src/ligar.js").EnvelopeNavegador }).envelope;
    assert.ok(!JSON.stringify(c.resposta).match(/\b[a-z]{3,12}( [a-z]{3,12}){5}\b/), "a frase não vai em claro");
    const aberto = await abrirEnvelopeNavegador<{ palavras: string[]; expiraEm: string | null }>(par.privateKey, env);
    assert.equal(aberto.palavras.length, 6);
    assert.equal(banco.ligacoes.length, 1, "a ligação foi publicada na nuvem");
    const outro = (await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as import("node:crypto").webcrypto.CryptoKeyPair;
    await assert.rejects(abrirEnvelopeNavegador(outro.privateKey, env), "outro navegador não abre");
  });

  test("sem tela para confirmar e sem a liberação permanente, o pedido do painel é recusado (a frase só sai pelo terminal)", async () => {
    const { webcrypto } = await import("node:crypto");
    const par = (await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as import("node:crypto").webcrypto.CryptoKeyPair;
    const jwk = await webcrypto.subtle.exportKey("jwk", par.publicKey);
    await preparar();
    await ativaEm(m, "A", 10);
    await m.agente.esperar();
    fs.rmSync(m.c.ligarPeloPainel, { force: true });
    banco.comandos.push({ id: 1, acao: "ligar", corpo: { publica: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, idioma: "pt-BR" }, pc: "pc-1", estado: "pendente" });
    await m.agente.busca();
    await m.agente.emEspera;
    const c = banco.comandos.find((x) => x.id === 1)!;
    assert.equal(c.http, 403);
    assert.equal(banco.ligacoes.length, 0, "nenhuma ligação publicada");
  });

  test("ligar pelo painel com confirmação na tela: a janela mostra o código do painel, e só o clique em Liberar solta a frase", async () => {
    const { webcrypto } = await import("node:crypto");
    const { codigoDeConfirmacao } = await import("../src/ligar.js");
    const { ExecutorFalso } = await import("./falsos.js");
    const par = (await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as import("node:crypto").webcrypto.CryptoKeyPair;
    const jwk = await webcrypto.subtle.exportKey("jwk", par.publicKey);
    const publica = { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
    const codigo = codigoDeConfirmacao(publica);
    assert.match(codigo, /^[A-HJ-NP-Z2-9]{4}$/);
    for (const [clique, http, ligacoes] of [["Recusar", 403, 0], ["Liberar", 200, 1]] as const) {
      const exec = new ExecutorFalso();
      let soltar: () => void = () => undefined;
      const clicou = new Promise<void>((r) => (soltar = r));
      exec.rodar = async (argv: string[]) => {
        exec.chamadas.push({ argv });
        if (argv[0] !== "osascript") return { codigo: 0, saida: "", erro: "" };
        await clicou;
        return clique === "Liberar" ? { codigo: 0, saida: "button returned:Liberar, gave up:false", erro: "" } : { codigo: 1, saida: "", erro: "User canceled." };
      };
      await preparar({ exec });
      await ativaEm(m, "A", 10);
      await m.agente.esperar();
      fs.rmSync(m.c.ligarPeloPainel, { force: true });
      banco.comandos.push({ id: 1, acao: "ligar", corpo: { publica, idioma: "pt-BR" }, pc: "pc-1", estado: "pendente" });
      await m.agente.busca();
      // a busca terminou com a janela ainda aberta: a troca e as leituras não esperam o clique
      assert.equal(banco.comandos.find((x) => x.id === 1)!.estado, "reservado");
      const janela = exec.chamadas.find((c) => c.argv[0] === "osascript")!;
      assert.ok(janela.argv.join(" ").includes(codigo), "a janela mostra o mesmo código do painel");
      assert.ok(exec.chamadas.some((c) => c.argv[0] === "afplay"), "toca o som para chamar a atenção");
      soltar();
      await m.agente.emEspera;
      const c = banco.comandos.find((x) => x.id === 1)!;
      assert.equal(c.http, http, clique);
      assert.equal(banco.ligacoes.length, ligacoes, clique);
      m.limpar();
    }
  });

  test("computador com chave de outra instalação não responde ao pedido de ligação", async () => {
    const { webcrypto } = await import("node:crypto");
    const par = (await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as import("node:crypto").webcrypto.CryptoKeyPair;
    const jwk = await webcrypto.subtle.exportKey("jwk", par.publicKey);
    await preparar();
    banco.cofreImpressao = "0".repeat(32); // a instalação tem outra chave
    await ativaEm(m, "A", 10);
    await m.agente.esperar();
    banco.comandos.push({ id: 1, acao: "ligar", corpo: { publica: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, idioma: "pt-BR" }, pc: "pc-1", estado: "pendente" });
    await m.agente.busca();
    await m.agente.emEspera;
    const c = banco.comandos.find((x) => x.id === 1)!;
    assert.equal(c.http, 409);
    assert.equal(banco.ligacoes.length, 0);
  });

  test("ligar com chave pública mal formada é recusado", async () => {
    const c = await comComando("ligar", { publica: { kty: "RSA", n: "x" } });
    assert.equal(c.http, 400);
  });

  test("ação desconhecida é recusada sem rodar", async () => {
    const c = await comComando("apagar_tudo");
    assert.equal(c.estado, "recusado");
    assert.equal(c.http, 403);
  });

  test("conectar: inicia o login oficial com o e-mail pedido", async () => {
    const c = await comComando("conectar", { email: "b@exemplo.com" });
    assert.equal(c.http, 200);
    assert.equal(m.cli.logins[0]!.email, "b@exemplo.com");
    assert.ok((c.resposta as Record<string, unknown>).login_id);
  });

  test("conectar e-mail fora da lista do computador (quando ela existe) é recusado", async () => {
    await preparar();
    fs.mkdirSync(m.c.base, { recursive: true });
    fs.writeFileSync(m.c.permitidas, "# só estas\nb@exemplo.com\n");
    banco.comandos.push({ id: 3, acao: "conectar", corpo: { email: "invasor@exemplo.com" }, pc: "pc-1", estado: "pendente" });
    banco.comandos.push({ id: 4, acao: "conectar", corpo: { email: "nao-e-email" }, pc: "pc-1", estado: "pendente" });
    await m.agente.busca();
    assert.equal(banco.comandos[0]!.http, 403);
    assert.equal(banco.comandos[1]!.http, 400);
    assert.equal(m.cli.logins.length, 0);
  });

  test("o mesmo comando nunca roda duas vezes", async () => {
    await comComando("atualizar", {}, 9);
    const reservas = fns("reservarComando").length;
    banco.comandos[0]!.estado = "pendente"; // a nuvem mandou de novo (a resposta se perdeu, por exemplo)
    await m.agente.busca();
    assert.equal(fns("reservarComando").length, reservas);
  });

  test("comando grande demais é recusado", async () => {
    const c = await comComando("codigo_login", { codigo: "x".repeat(5000) });
    assert.equal(c.http, 413);
  });
  test("reserva que falha (outro já pegou o comando): não roda", async () => {
    await preparar();
    await ativaEm(m, "A", 10);
    await m.agente.esperar();
    banco.comandos.push({ id: 11, acao: "conectar", corpo: { email: "b@exemplo.com" }, pc: "pc-1", estado: "pendente" });
    nuvem.reservarComando = async () => ({ ok: false, comando: null });
    await m.agente.busca();
    assert.equal(m.cli.logins.length, 0);
    assert.equal(fns("responderComando").length, 0);
  });

  test("configuração da nuvem fora da faixa é ignorada", async () => {
    await preparar();
    m.agente.aplicarConfig({ aviso: 150, troca: "95", intervalo_s: 0, modo: "turbo", auto: "sim", rodizio_minutos: 5 });
    const k = e().config;
    assert.deepEqual([k.aviso, k.troca, k.intervaloS, k.modo, k.auto, k.rodizio.minutos], [90, 95, 5, "limiar", true, 90]);
    m.agente.aplicarConfig({ aviso: 80, troca: 92, intervalo_s: 10, modo: "rodizio", auto: false, rodizio_minutos: 60, retomar_terminal: true });
    assert.deepEqual([k.aviso, k.troca, k.intervaloS, k.modo, k.auto, k.rodizio.minutos, k.retomarHeadless], [80, 92, 10, "rodizio", false, 60, true]);
  });

});

describe("relatos", () => {
  test("limite da sessão vai à nuvem na hora (agente_limite) e a busca roda em seguida", async () => {
    await preparar();
    const a = await ativaEm(m, "A", 50);
    await m.agente.esperar();
    await m.agente.busca();
    const olas = fns("ola").length;
    await m.agente.alvoPonte().limite({ sessao: "s1", cwd: "/tmp", tipo: "interativa" });
    await m.agente.esperar();
    const lim = fns("limite")[0]!;
    assert.deepEqual(lim.args, [e().contas[a]!.contaId, "s1"]);
    assert.ok(fns("ola").length > olas);
  });

  test("tokens das transcrições vão com a conta da nuvem", async () => {
    await preparar();
    const a = await ativaEm(m, "A", 50);
    await m.agente.esperar();
    await m.agente.busca();
    const dir = `${m.c.projetos}/-x-proj`;
    fs.mkdirSync(dir, { recursive: true });
    const linha = {
      type: "assistant",
      sessionId: "s1",
      cwd: "/x/proj",
      timestamp: new Date((m.relogio.agora() + 10) * 1000).toISOString(),
      message: { id: "m1", model: "claude-opus-5-5", usage: { input_tokens: 5, output_tokens: 7 } },
    };
    fs.writeFileSync(`${dir}/s1.jsonl`, JSON.stringify(linha) + "\n");
    await m.agente.registro();
    const enviadas = [...banco.tokens.values()];
    assert.equal(enviadas.length, 1);
    assert.equal(enviadas[0]!.conta_id, e().contas[a]!.contaId);
    assert.equal(enviadas[0]!.projeto, "proj");
    assert.equal(banco.sessoes.get("s1")!.respostas, 1);
  });

  test("conta em uso que perdeu o login avisa a nuvem uma vez; voltando, avisa de novo", async () => {
    await preparar();
    const a = await ativaEm(m, "A", 10);
    await m.agente.esperar();
    const contaId = e().contas[a]!.contaId!;
    await m.agente.busca();
    e().contas[a]!.precisaLogin = true;
    await m.agente.busca();
    await m.agente.busca();
    const avisos = fns("marcarLogin").filter((c) => c.args[1] === true);
    assert.equal(avisos.length, 1, "não repete a cada busca");
    assert.equal(banco.contas.get(contaId)!.precisaLogin, true);
    e().contas[a]!.precisaLogin = false;
    await m.agente.busca();
    assert.equal(banco.contas.get(contaId)!.precisaLogin, false);
  });

  test("conta fora da mão não marca login na nuvem e tenta de novo só depois de 5 min", async () => {
    await preparar();
    await ativaEm(m, "A", 10);
    await m.agente.esperar();
    await m.agente.busca();
    const b = await semear("B");
    banco.posse.set(b, { pc: "pc-2", motivo: "uso", expira: m.relogio.agora() + 3600 });
    const idLocal = contaEstacionada(m, "B", 10, { contaId: b });
    e().contas[idLocal]!.precisaLogin = true;
    await m.agente.busca();
    await m.agente.busca();
    assert.equal(fns("marcarLogin").filter((c) => c.args[0] === b).length, 1);
    assert.notEqual(banco.contas.get(b)!.precisaLogin, true);
    await m.relogio.avancar(301_000);
    await m.agente.busca();
    assert.equal(fns("marcarLogin").filter((c) => c.args[0] === b).length, 2);
  });

  test("evento local vai à nuvem só com os tipos que ela aceita", async () => {
    await preparar();
    await ativaEm(m, "A", 50);
    m.agente.trocador.evento("alerta", "teste de alerta");
    await new Promise((r) => setImmediate(r));
    assert.ok(banco.eventos.some((x) => x.tipo === "aviso" && x.texto === "teste de alerta"));
  });
});
