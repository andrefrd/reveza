// Computador novo pelo código que aparece NELE (0.2.0; protocolo 3 desde a 0.4.0): o código XXXX-XXXX-YYYY (a primeira
// parte sai da chave pública, a segunda é sorteada e não vai à nuvem), a cifra da chave do cofre para a chave pública do
// computador novo com a parte sorteada, a liberação pelo terminal (`reveza ligar XXXX-XXXX-YYYY`) e pela janela do
// agente, com um pedido por vez e entrega uma vez só.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { GuardaFalsa, SEGREDO_COFRE } from "../src/cofre/guarda.js";
import { novaChave } from "../src/cofre/cifra.js";
import {
  abrirChaveDoEnvelope,
  ANTIGO,
  cifrarChaveParaComputadorNovo,
  codigoDaChave,
  conferirCodigo,
  impressaoDaChave,
  lerChave,
  liberarComputadorNovo,
  LIGACAO_DUPLA,
  novoParDeChaves,
  novoSegredo,
  pedirParaEntrar,
  prepararPedido,
} from "../src/ligar.js";
import type { ChavePublica } from "../src/nuvem/tipos.js";
import { ativaEm, BancoFalso, ExecutorFalso, montar, NuvemFalsa, type Montado } from "./falsos.js";

const S = "[A-HJ-NP-Z2-9]";
const LIGACAO = new RegExp(`^${S}{4}-${S}{4}$`);
const FORMATO = new RegExp(`^${S}{4}-${S}{4}-${S}{4}$`);

/** Um pedido de computador novo qualquer (de outro computador, para testar dois pedidos ao mesmo tempo). */
async function pedidoQualquer(n: NuvemFalsa) {
  const p = await prepararPedido();
  await n.ligacaoPedir(p.publica);
  return p;
}

describe("o código XXXX-XXXX-YYYY", () => {
  test("a primeira parte sai da chave pública (o mesmo dos dois lados); a segunda é sorteada a cada pedido", async () => {
    const { publica } = await novoParDeChaves();
    const c = await codigoDaChave(publica);
    assert.match(c, LIGACAO);
    assert.equal(await codigoDaChave({ ...publica }), c, "a mesma chave dá a mesma primeira parte (quem libera calcula igual)");
    assert.notEqual(await codigoDaChave((await novoParDeChaves()).publica), c, "outra chave, outra primeira parte");
    const sorteados = new Set(Array.from({ length: 300 }, () => novoSegredo()));
    for (const s of sorteados) assert.match(s, new RegExp(`^${S}{4}$`));
    assert.ok(sorteados.size > 290, "sorteado a cada pedido (20 bits)");
    const ped = await prepararPedido();
    assert.match(ped.codigo, FORMATO);
    assert.ok(ped.codigo.startsWith(await codigoDaChave(ped.publica)));
    assert.ok(ped.codigo.endsWith(`-${ped.segredo}`));
  });

  test("valor fixo: a primeira parte não muda sem querer (SHA-256 da chave esticado por scrypt, a mesma da versão 2)", async () => {
    const publica: ChavePublica = { kty: "EC", crv: "P-256", x: "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU", y: "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0" };
    assert.equal(await codigoDaChave(publica), "CY7B-64F4");
  });

  test("quem libera confere a primeira parte e fica com a segunda: minúscula, sem hífen ou com espaço valem", async () => {
    const ped = await prepararPedido("K7QM");
    for (const bom of [ped.codigo, ped.codigo.toLowerCase(), ped.codigo.replace(/-/g, ""), ` ${ped.codigo.replace(/-/g, " ")} `]) {
      assert.equal(await conferirCodigo(bom, ped.publica), "K7QM", bom);
    }
  });

  test("não confere: só os 8 (o código da versão 2), 11 ou 13, primeira parte errada, letra fora do alfabeto, outra chave", async () => {
    const ped = await prepararPedido("K7QM");
    const primeira = ped.codigo.slice(0, 9);
    const errada = primeira[0] === "A" ? `B${primeira.slice(1)}` : `A${primeira.slice(1)}`;
    for (const ruim of [primeira, `${primeira}-K7Q`, `${primeira}-K7QMM`, `${errada}-K7QM`, `${primeira}-K7Q0`, `${primeira}-K7QI`, ""]) {
      assert.equal(await conferirCodigo(ruim, ped.publica), null, ruim);
    }
    assert.equal(await conferirCodigo(ped.codigo, (await novoParDeChaves()).publica), null, "a chave pública trocada não confere");
  });
});

test("letras grandes: todo símbolo do código tem desenho, 5 linhas, e o texto comum vai junto", async () => {
  const { letreiro } = await import("../src/letreiro.js");
  const { textoDoCodigo } = await import("../src/cli.js");
  const linhas = letreiro("ABCDEFGHJKLMNPQRSTUVWXYZ23456789-");
  assert.equal(linhas.length, 5);
  for (const ch of "ABCDEFGHJKLMNPQRSTUVWXYZ23456789-") assert.ok(letreiro(ch).some((l) => l.includes("█")), ch);
  const t = textoDoCodigo("CY7B-64F4-K7QM", "pt-BR");
  assert.match(t, /^ {4}CY7B-64F4-K7QM$/m);
  assert.match(t, /sem tela: reveza ligar CY7B-64F4-K7QM/);
  assert.match(t, /não mande foto/);
  const grandes = t.split("\n").filter((l) => l.includes("█"));
  assert.equal(grandes.length, 10, "duas linhas de letras grandes: XXXX-XXXX e YYYY");
  assert.ok(grandes.every((l) => l.length <= 80), "cabe num terminal de 80 colunas");
});

describe("a chave do cofre cifrada para o computador novo", () => {
  test("ida e volta: só a chave privada do computador novo, com o segredo do código dele, abre, e só para o id do pedido", async () => {
    const k = novaChave();
    const novo = await prepararPedido();
    const env = await cifrarChaveParaComputadorNovo(novo.publica, k, "pc-novo", novo.segredo);
    assert.ok(!JSON.stringify(env).includes(k.toString("base64")), "a chave não vai em claro");
    assert.deepEqual(await abrirChaveDoEnvelope(novo.privada, env, "pc-novo", novo.segredo), k);
    const outro = await novoParDeChaves();
    await assert.rejects(abrirChaveDoEnvelope(outro.privada, env, "pc-novo", novo.segredo), "outra chave privada não abre");
    await assert.rejects(abrirChaveDoEnvelope(novo.privada, env, "pc-outro", novo.segredo), "o envelope é amarrado ao computador do pedido");
    await assert.rejects(abrirChaveDoEnvelope(novo.privada, env, "pc-novo", novo.segredo === "AAAA" ? "BBBB" : "AAAA"), "outra parte sorteada não abre");
    const bytes = Buffer.from(env.cifrado, "base64");
    bytes[0]! ^= 1;
    await assert.rejects(abrirChaveDoEnvelope(novo.privada, { ...env, cifrado: bytes.toString("base64") }, "pc-novo", novo.segredo), "mexido não abre");
  });

  test("quem só tem a chave pública (a nuvem, quem escreve no banco) não monta envelope que o computador novo abra", async () => {
    const novo = await prepararPedido();
    const plantada = novaChave();
    // a primeira parte do código é pública; a sorteada não: o melhor que se faz é chutar
    const chute = novoSegredo() === novo.segredo ? "AAAA" : novoSegredo();
    const env = await cifrarChaveParaComputadorNovo(novo.publica, plantada, "pc-novo", chute === novo.segredo ? "BBBB" : chute);
    await assert.rejects(abrirChaveDoEnvelope(novo.privada, env, "pc-novo", novo.segredo));
  });

  test("a chave privada do computador novo não sai da memória", async () => {
    const { privada } = await novoParDeChaves();
    assert.equal(privada.extractable, false);
    await assert.rejects(webcrypto.subtle.exportKey("jwk", privada));
  });
});

describe("pelo terminal: o computador novo pede, reveza ligar XXXX-XXXX libera", () => {
  async function cena() {
    const banco = new BancoFalso();
    const velha = new GuardaFalsa();
    const k = novaChave();
    await velha.gravar(SEGREDO_COFRE, k.toString("base64"));
    banco.cofreImpressao = impressaoDaChave(k);
    const nv = new NuvemFalsa(banco, "pc-velho");
    await nv.registrar("velho");
    banco.pendentes.add("pc-novo");
    const nn = new NuvemFalsa(banco, "pc-novo");
    return { banco, velha, k, nv, nn };
  }

  /** O computador novo pedindo em paralelo; `liberar` roda quando o código aparece (como a pessoa no outro computador). */
  async function pedir(nn: NuvemFalsa, guarda: GuardaFalsa, liberar: (codigo: string) => Promise<unknown>) {
    let codigo = "";
    let liberou: Promise<unknown> | null = null;
    let erroDoLiberar: unknown = null;
    const r = await pedirParaEntrar(guarda, nn, {
      aoMostrarCodigo: (c) => {
        codigo = c;
      },
      dormir: async () => {
        if (!liberou) liberou = liberar(codigo).catch((e) => (erroDoLiberar = e));
        await liberou;
      },
      intervaloMs: 0,
    });
    return { r, codigo, erroDoLiberar };
  }

  test("o código certo entrega a chave do cofre, que chega igual e só uma vez; depois o computador novo entra", async () => {
    const { banco, velha, k, nv, nn } = await cena();
    const nova = new GuardaFalsa();
    const { codigo, erroDoLiberar } = await pedir(nn, nova, (c) => liberarComputadorNovo(velha, nv, c.toLowerCase().replace("-", " ")));
    assert.equal(erroDoLiberar, null);
    assert.match(codigo, FORMATO);
    assert.deepEqual(await lerChave(nova), k);
    assert.equal(banco.pedidos.get("pc-novo")!.envelope, null, "o envelope saiu da nuvem na leitura");
    assert.equal((await nn.ligacaoReceber()).estado, "lido");
    // entregar de novo não dá
    await assert.rejects(liberarComputadorNovo(velha, nv, codigo), /nenhum computador novo pedindo/);
    assert.equal((await nn.registrar("novo")).computador_id, "pc-novo");
  });

  test("antes de receber a chave, a identidade do computador novo não entra (o código de acesso vazado só pede)", async () => {
    const { nn } = await cena();
    await assert.rejects(nn.registrar("intruso"), /ainda não recebeu a chave/);
  });

  test("código errado não libera (e não gasta o pedido); 7 caracteres nem consulta", async () => {
    const { banco, velha, nv, nn } = await cena();
    const ped = await prepararPedido();
    await nn.ligacaoPedir(ped.publica);
    await assert.rejects(liberarComputadorNovo(velha, nv, ped.codigo.startsWith("AAAA-AAAA") ? "BBBB-BBBB-CCCC" : "AAAA-AAAA-CCCC"), /não confere/);
    await assert.rejects(liberarComputadorNovo(velha, nv, "AAAA-AAAA-CCC"), /12 letras e números/);
    assert.equal(banco.pedidos.get("pc-novo")!.entreguePor, null);
    await liberarComputadorNovo(velha, nv, ped.codigo);
    assert.equal(banco.pedidos.get("pc-novo")!.entreguePor, "pc-velho");
  });

  test("dois pedidos abertos: recusa os dois, mesmo com o código certo de um deles", async () => {
    const { banco, velha, nv, nn } = await cena();
    banco.pendentes.add("pc-forjado");
    const ped = await prepararPedido();
    await nn.ligacaoPedir(ped.publica);
    await pedidoQualquer(new NuvemFalsa(banco, "pc-forjado"));
    await assert.rejects(liberarComputadorNovo(velha, nv, ped.codigo), (e: Error) => e.message === LIGACAO_DUPLA);
    assert.equal(banco.pedidos.get("pc-novo")!.recusado, "dois_pedidos");
    assert.equal(banco.pedidos.get("pc-forjado")!.recusado, "dois_pedidos");
    assert.equal(banco.pedidos.get("pc-novo")!.envelope, null);
    const { estado, motivo } = await nn.ligacaoReceber();
    assert.deepEqual({ estado, motivo }, { estado: "recusado", motivo: "dois_pedidos" });
  });

  test("o pedido não se troca: outra chave para o mesmo computador novo é recusada", async () => {
    const { nn } = await cena();
    await nn.ligacaoPedir((await novoParDeChaves()).publica);
    await assert.rejects(nn.ligacaoPedir((await novoParDeChaves()).publica), /já pediu para entrar uma vez/);
  });

  test("a chave que chega e não é a da instalação não é guardada", async () => {
    const { banco, nn } = await cena();
    banco.cofreImpressao = "0".repeat(32);
    const outra = new GuardaFalsa();
    await outra.gravar(SEGREDO_COFRE, novaChave().toString("base64"));
    const nv = new NuvemFalsa(banco, "pc-velho");
    const nova = new GuardaFalsa();
    // o computador que libera também recusa: a chave dele não é a da instalação
    let erro: unknown = null;
    let codigo = "";
    await assert.rejects(
      pedirParaEntrar(nova, nn, {
        aoMostrarCodigo: (c) => void (codigo = c),
        dormir: async () => {
          if (erro) throw erro;
          await liberarComputadorNovo(outra, nv, codigo).catch((e) => (erro = e));
          if (erro) throw erro;
        },
        intervaloMs: 0,
      }),
      /não é a da instalação/,
    );
    assert.equal(await lerChave(nova), null);
  });

  test("sem a impressão da chave na nuvem, a chave entregue não é guardada (quem escreve no banco não planta chave)", async () => {
    const { banco, velha, nv, nn } = await cena();
    const nova = new GuardaFalsa();
    let codigo = "";
    await assert.rejects(
      pedirParaEntrar(nova, nn, {
        aoMostrarCodigo: (c) => void (codigo = c),
        dormir: async () => {
          const p = banco.pedidos.get("pc-novo")!;
          if (p.envelope) return;
          await liberarComputadorNovo(velha, nv, codigo);
          banco.cofreImpressao = null; // alguém apagou a impressão depois da entrega
        },
        intervaloMs: 0,
      }),
      /não tem a impressão da chave do cofre/,
    );
    assert.equal(await lerChave(nova), null);
  });

  test("quem escreve direto no banco não planta chave: envelope e impressão trocados juntos, sem o código, são recusados", async () => {
    // o achado da auditoria de 12/10/2026 (rodada 3): o envelope com a chave do escritor, para a chave pública do
    // computador novo (que a nuvem conhece), e a impressão da instalação trocada para a dessa chave
    const { banco, nn } = await cena();
    const nova = new GuardaFalsa();
    const plantada = novaChave();
    let codigoNaTela = "";
    await assert.rejects(
      pedirParaEntrar(nova, nn, {
        aoMostrarCodigo: (c) => void (codigoNaTela = c),
        dormir: async () => {
          const p = banco.pedidos.get("pc-novo")!;
          if (p.envelope || p.entreguePor) return;
          // o escritor sabe a primeira parte (sai da chave pública, que ele lê); a sorteada ele chuta
          const chute = codigoNaTela.endsWith("-AAAA") ? "BBBB" : "AAAA";
          Object.assign(p, { envelope: await cifrarChaveParaComputadorNovo(p.publica!, plantada, "pc-novo", chute), entreguePor: "pc-escritor" });
          banco.cofreImpressao = impressaoDaChave(plantada);
        },
        intervaloMs: 0,
      }),
      /não abriu com o código deste computador: confira os 4 últimos/,
    );
    assert.equal(await lerChave(nova), null, "nada guardado");
  });

  test("envelope que abre (com o código certo) mas traz chave de outra instalação: o computador novo confere a impressão e não guarda", async () => {
    const { banco, nn } = await cena();
    const nova = new GuardaFalsa();
    let codigoNaTela = "";
    await assert.rejects(
      pedirParaEntrar(nova, nn, {
        aoMostrarCodigo: (c) => void (codigoNaTela = c),
        dormir: async () => {
          const p = banco.pedidos.get("pc-novo")!;
          if (p.envelope || p.entreguePor) return;
          // quem digitou o código certo num computador com a chave de OUTRA instalação (a impressão da nuvem é a desta)
          const env = await cifrarChaveParaComputadorNovo(p.publica!, novaChave(), "pc-novo", codigoNaTela.slice(-4));
          Object.assign(p, { envelope: env, entreguePor: "pc-de-outra-instalacao" });
        },
        intervaloMs: 0,
      }),
      /não é a desta instalação/,
    );
    assert.equal(await lerChave(nova), null);
  });

  test("quem escreve no banco troca a chave pública do pedido (mesmo vendo o código na tela): não confere, nada é entregue", async () => {
    const { banco, velha, nv, nn } = await cena();
    const ped = await prepararPedido();
    await nn.ligacaoPedir(ped.publica);
    banco.pedidos.get("pc-novo")!.publica = (await novoParDeChaves()).publica;
    await assert.rejects(liberarComputadorNovo(velha, nv, ped.codigo), /não confere/);
    assert.equal(banco.pedidos.get("pc-novo")!.entreguePor, null);
  });

  test("computador novo com o Reveza antigo (código de 8): não se libera, e a mensagem diz o que fazer", async () => {
    const { banco, velha, nv, nn } = await cena();
    const ped = await prepararPedido();
    await nn.ligacaoPedir(ped.publica);
    await assert.rejects(liberarComputadorNovo(velha, nv, ped.codigo.slice(0, 9)), (e: Error) => e.message === ANTIGO);
    assert.equal(banco.pedidos.get("pc-novo")!.entreguePor, null);
  });

  test("recusado ou vencido: o computador novo para com a mensagem de gerar outro código", async () => {
    const { banco, nv, nn } = await cena();
    const nova = new GuardaFalsa();
    await assert.rejects(
      pedirParaEntrar(nova, nn, {
        aoMostrarCodigo: () => undefined,
        dormir: async () => void (await nv.ligacaoRecusar("pc-novo", "recusado_na_tela")),
        intervaloMs: 0,
      }),
      /recusado na tela.*gere outro código/,
    );
    banco.pendentes.add("pc-outro");
    const no = new NuvemFalsa(banco, "pc-outro");
    await assert.rejects(
      pedirParaEntrar(new GuardaFalsa(), no, {
        aoMostrarCodigo: () => undefined,
        dormir: async () => void (banco.pedidos.get("pc-outro")!.expira = 0),
        intervaloMs: 0,
      }),
      /venceu/,
    );
  });
});

describe("pela janela do agente que tem a chave", () => {
  let m: Montado;
  let banco: BancoFalso;
  afterEach(() => m?.limpar());

  /** O agente (pc-1, com a chave) e um computador novo pedindo; a janela abre no pc-1 se `paraMim`. */
  async function cena(responder: (argv: string[], vez: number) => { codigo: number; saida: string; erro: string } | Promise<{ codigo: number; saida: string; erro: string }>, paraMim = true) {
    banco = new BancoFalso();
    const exec = new ExecutorFalso();
    let vez = 0;
    exec.rodar = async (argv: string[]) => {
      exec.chamadas.push({ argv });
      if (argv[0] !== "osascript") return { codigo: 0, saida: "", erro: "" };
      return responder(argv, ++vez);
    };
    m = await montar({ nuvem: new NuvemFalsa(banco, "pc-1"), exec });
    banco.agora = () => m.relogio.agora();
    await ativaEm(m, "A", 10);
    await m.agente.esperar();
    await m.agente.busca(); // registra e grava a impressão da chave da instalação
    banco.pendentes.add("pc-novo");
    const nn = new NuvemFalsa(banco, "pc-novo");
    const par = await prepararPedido();
    if (paraMim) new NuvemFalsa(banco, "painel").escolherAprovador("pc-novo", "pc-1");
    await nn.ligacaoPedir(par.publica);
    return { exec, nn, par, codigo: par.codigo };
  }
  const janelas = (exec: ExecutorFalso) => exec.chamadas.filter((c) => c.argv[0] === "osascript");
  const digitou = (texto: string) => ({ codigo: 0, saida: `button returned:Liberar, text returned:${texto}, gave up:false`, erro: "" });

  test("abre a janela (com som) pedindo o código, sem mostrá-lo; o código certo entrega a chave cifrada só para o novo", async () => {
    let codigoCerto = "";
    const { exec, nn, par, codigo } = await cena(() => digitou(codigoCerto));
    codigoCerto = codigo.toLowerCase();
    await m.agente.busca();
    await m.agente.emEspera;
    const j = janelas(exec);
    assert.equal(j.length, 1);
    assert.ok(!j[0]!.argv.join(" ").includes(codigo), "a janela pede o código, não o mostra (ele aparece no computador novo)");
    assert.match(j[0]!.argv.join(" "), /computador NOVO/);
    assert.ok(exec.chamadas.some((c) => c.argv[0] === "afplay"), "toca o som para chamar a atenção");
    const r = await nn.ligacaoReceber();
    assert.equal(r.estado, "entregue");
    assert.deepEqual(await abrirChaveDoEnvelope(par.privada, r.envelope!, "pc-novo", par.segredo), await lerChave(m.guarda));
    // a mesma janela não abre de novo para o mesmo pedido
    await m.agente.busca();
    await m.agente.emEspera;
    assert.equal(janelas(exec).length, 1);
  });

  test("Recusar na janela recusa o pedido na nuvem; nada é entregue", async () => {
    const { nn } = await cena(() => ({ codigo: 1, saida: "", erro: "execution error: User canceled. (-128)" }));
    await m.agente.busca();
    await m.agente.emEspera;
    const r = await nn.ligacaoReceber();
    assert.deepEqual([r.estado, r.motivo], ["recusado", "recusado_na_tela"]);
  });

  test("código errado: a janela pergunta de novo (\"não confere\"); na terceira errada, o pedido é recusado", async () => {
    const { exec, nn } = await cena(() => digitou("AAAA-AAAA"));
    await m.agente.busca();
    await m.agente.emEspera;
    const j = janelas(exec);
    assert.equal(j.length, 3);
    assert.doesNotMatch(j[0]!.argv.join(" "), /não confere/);
    assert.match(j[1]!.argv.join(" "), /não confere/);
    const r = await nn.ligacaoReceber();
    assert.deepEqual([r.estado, r.motivo], ["recusado", "codigo_errado"]);
  });

  test("errou uma vez e acertou na segunda: entrega", async () => {
    let codigoCerto = "";
    const { nn, codigo } = await cena((_, vez) => digitou(vez === 1 ? "AAAA-AAAA" : codigoCerto));
    codigoCerto = codigo;
    await m.agente.busca();
    await m.agente.emEspera;
    assert.equal((await nn.ligacaoReceber()).estado, "entregue");
  });

  test("ninguém respondeu (o tempo acabou): o pedido segue aberto para reveza ligar", async () => {
    const { nn } = await cena(() => ({ codigo: 0, saida: "button returned:, text returned:, gave up:true", erro: "" }));
    await m.agente.busca();
    await m.agente.emEspera;
    assert.equal((await nn.ligacaoReceber()).estado, "esperando");
  });

  test("dois pedidos abertos: os dois são recusados e nenhuma janela abre", async () => {
    const { exec, nn } = await cena(() => digitou("qualquer"));
    banco.pendentes.add("pc-forjado");
    await pedidoQualquer(new NuvemFalsa(banco, "pc-forjado"));
    await m.agente.busca();
    await m.agente.emEspera;
    assert.equal(janelas(exec).length, 0);
    assert.equal((await nn.ligacaoReceber()).motivo, "dois_pedidos");
    assert.equal(banco.pedidos.get("pc-forjado")!.recusado, "dois_pedidos");
    assert.ok(m.agente.estado.eventos.some((e) => e.texto.includes(LIGACAO_DUPLA)), "o aviso fica nos eventos");
    assert.ok(exec.chamadas.some((c) => c.argv[0] === "afplay"), "toca o som");
  });

  test("pedido que chega com a janela aberta derruba os dois, mesmo com o código certo digitado", async () => {
    let soltar: () => void = () => undefined;
    const clicou = new Promise<void>((r) => (soltar = r));
    let codigoCerto = "";
    const { nn, codigo } = await cena(async () => {
      await clicou;
      return digitou(codigoCerto);
    });
    codigoCerto = codigo;
    await m.agente.busca();
    assert.ok(m.agente.emEspera, "a janela está aberta e a busca seguiu");
    banco.pendentes.add("pc-forjado");
    await pedidoQualquer(new NuvemFalsa(banco, "pc-forjado"));
    await m.agente.busca();
    soltar();
    await m.agente.emEspera;
    const r = await nn.ligacaoReceber();
    assert.deepEqual([r.estado, r.motivo], ["recusado", "dois_pedidos"]);
    assert.equal(banco.pedidos.get("pc-novo")!.entreguePor, null, "nada foi entregue");
  });

  test("a janela só abre no computador que o painel escolheu; sem tela, só registra e deixa o pedido aberto", async () => {
    const { exec, nn } = await cena(() => digitou("x"), false);
    await m.agente.busca();
    await m.agente.emEspera;
    assert.equal(janelas(exec).length, 0, "não foi escolhido: sem janela");
    new NuvemFalsa(banco, "painel").escolherAprovador("pc-novo", "pc-1");
    exec.rodar = async (argv: string[]) => {
      exec.chamadas.push({ argv });
      return argv[0] === "osascript" ? { codigo: 127, saida: "", erro: "spawn osascript ENOENT" } : { codigo: 0, saida: "", erro: "" };
    };
    await m.agente.busca();
    await m.agente.emEspera;
    assert.equal((await nn.ligacaoReceber()).estado, "esperando");
    assert.ok(m.log.linhas.some((l) => /não tem tela/.test(l)));
  });

  test("a janela abre na língua que o painel escolheu (o texto é fixo; só a língua vem da nuvem)", async () => {
    let codigoCerto = "";
    const { exec, nn, codigo } = await cena(() => ({ codigo: 0, saida: `button returned:Release, text returned:${codigoCerto}, gave up:false`, erro: "" }), false);
    codigoCerto = codigo;
    new NuvemFalsa(banco, "painel").escolherAprovador("pc-novo", "pc-1", "en");
    await m.agente.busca();
    await m.agente.emEspera;
    assert.match(janelas(exec)[0]!.argv.join(" "), /A new computer wants to join/);
    assert.equal((await nn.ligacaoReceber()).estado, "entregue");
  });

  test("computador com a chave de outra instalação não abre janela", async () => {
    banco = new BancoFalso();
    banco.cofreImpressao = "0".repeat(32);
    const exec = new ExecutorFalso();
    m = await montar({ nuvem: new NuvemFalsa(banco, "pc-1"), exec });
    banco.agora = () => m.relogio.agora();
    await m.agente.busca();
    banco.pendentes.add("pc-novo");
    new NuvemFalsa(banco, "painel").escolherAprovador("pc-novo", "pc-1");
    await pedidoQualquer(new NuvemFalsa(banco, "pc-novo"));
    await m.agente.busca();
    await m.agente.emEspera;
    assert.equal(janelas(exec).length, 0);
  });
});
