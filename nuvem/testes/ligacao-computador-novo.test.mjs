// Computador novo pelo código que aparece NELE (0019, versão 0.2.0): quem registra a chave pública, quem entrega a
// chave do cofre, uma vez só, e o vencimento. A nuvem só guarda texto cifrado; o banco não sabe conferir a cifra (o
// agente confere), então aqui se prova quem pode o quê.
import { test } from "node:test";
import assert from "node:assert/strict";
import { banco } from "./apoio.mjs";

const chave = (letra) => ({ kty: "EC", crv: "P-256", x: letra.repeat(43), y: letra.toUpperCase().repeat(43), ext: true });
const envelope = (letra = "e") => ({ efemera: chave(letra), iv: "A".repeat(16), cifrado: "B".repeat(64) });

async function cenario({ comImpressao = true } = {}) {
  const b = await banco();
  const admin = { id: await b.usuario("admin"), aal: "aal2" };
  const leitor = { id: await b.usuario("leitura"), aal: "aal1" };
  const velho = await b.computador("velho");
  const outro = await b.computador("outro");
  // a instalação já tem a chave do cofre (a impressão é gravada pelo primeiro computador)
  if (comImpressao) await b.rpc(velho, "agente_cofre_impressao", { p_impressao: "c".repeat(32) });
  return { b, admin, leitor, velho, outro };
}

/** Identidade pendente, como o painel cria (Edge Function computador-novo → servico_registrar_computador). */
async function pendente(b, admin) {
  const id = await b.usuario(null);
  const [{ r }] = await b.como("servico", "select public.servico_registrar_computador($1, $2) as r", [id, admin.id]);
  return { id, pc: r.computador_id };
}

test("só a identidade pendente dona registra a chave pública; uma vez, sem troca, e o mesmo pedido de novo", async () => {
  const { b, admin, leitor, velho } = await cenario();
  const novo = await pendente(b, admin);
  const r = await b.rpc(novo, "agente_ligacao_pedir", { p_publica: chave("a") });
  assert.equal(r.ok, true);
  assert.equal(r.computador_id, novo.pc);
  const minutos = (new Date(r.expira_em) - Date.now()) / 60_000;
  assert.ok(minutos > 9 && minutos <= 10, `vence em 10 minutos (${minutos})`);
  // a mesma chave de novo (a resposta se perdeu): o mesmo pedido, sem mudar o vencimento
  const r2 = await b.rpc(novo, "agente_ligacao_pedir", { p_publica: chave("a") });
  assert.equal(r2.expira_em, r.expira_em);
  // outra chave não troca a registrada (quem tem o código vazado não troca a chave do computador de verdade)
  await assert.rejects(b.rpc(novo, "agente_ligacao_pedir", { p_publica: chave("z") }), /já pediu para entrar uma vez/);
  const [{ publica }] = await b.sql("select publica from public.ligacao_pedidos where computador_id = $1", [novo.pc]);
  assert.equal(publica.x, "a".repeat(43));
  // ninguém mais pede por ele: computador ativo, administrador, leitor, anônimo
  await assert.rejects(b.rpc(velho, "agente_ligacao_pedir", { p_publica: chave("b") }), /já entrou/);
  await assert.rejects(b.rpc(admin, "agente_ligacao_pedir", { p_publica: chave("b") }), /só computador novo/);
  await assert.rejects(b.rpc(leitor, "agente_ligacao_pedir", { p_publica: chave("b") }), /só computador novo/);
  await assert.rejects(b.rpc("anon", "agente_ligacao_pedir", { p_publica: chave("b") }), /permission denied/);
});

test("chave pública fora do formato, código revogado e código de mais de 24 h não pedem", async () => {
  const { b, admin } = await cenario();
  const novo = await pendente(b, admin);
  for (const ruim of [{}, { ...chave("a"), crv: "P-384" }, { ...chave("a"), x: "x'; drop table" }, { ...chave("a"), y: "y".repeat(44) }, "texto"]) {
    await assert.rejects(b.rpc(novo, "agente_ligacao_pedir", { p_publica: ruim }), /chave pública inválida/, JSON.stringify(ruim));
  }
  await b.rpc(admin, "painel_revogar_computador", { p_computador: novo.pc });
  await assert.rejects(b.rpc(novo, "agente_ligacao_pedir", { p_publica: chave("a") }), /só computador novo/);
  const velho = await pendente(b, admin);
  await b.sql("update public.computadores set criado_em = now() - interval '25 hours' where id = $1", [velho.pc]);
  await assert.rejects(b.rpc(velho, "agente_ligacao_pedir", { p_publica: chave("a") }), /vencido/);
});

test("identidade pendente não vira computador sem receber a chave do cofre (o código vazado só pede)", async () => {
  const { b, admin } = await cenario();
  const novo = await pendente(b, admin);
  await assert.rejects(b.rpc(novo, "agente_registrar", { p_nome: "intruso", p_sistema: "linux", p_versao: "0.2.0" }), /ainda não recebeu a chave/);
  await b.rpc(novo, "agente_ligacao_pedir", { p_publica: chave("a") });
  await assert.rejects(b.rpc(novo, "agente_registrar", { p_nome: "intruso", p_sistema: "linux", p_versao: "0.2.0" }), /ainda não recebeu a chave/);
  // nem as funções de computador ativo, nem a leitura do painel
  await assert.rejects(b.rpc(novo, "agente_ola", { p_versao: "1", p_diagnostico: null, p_conta_local: null }), /só computador/);
  await assert.rejects(b.rpc(novo, "agente_ligacoes_abertas", {}), /só computador/);
  await assert.rejects(b.rpc(novo, "agente_ligacao_entregar", { p_computador: novo.pc, p_publica: chave("a"), p_envelope: envelope() }), /só computador/);
  assert.equal((await b.como(novo, "select id from public.computadores")).length, 0);
  // a primeira identidade da instalação (antes de existir a chave do cofre) registra direto: ela é quem cria a chave
  const { b: b2, admin: admin2 } = await cenario({ comImpressao: false });
  const primeiro = await pendente(b2, admin2);
  assert.ok((await b2.rpc(primeiro, "agente_registrar", { p_nome: "primeiro", p_sistema: "macos", p_versao: "0.2.0" })).computador_id);
});

test("o caminho inteiro: quem tem a chave vê o pedido, entrega cifrado, o novo lê uma vez e só então entra", async () => {
  const { b, admin, leitor, velho, outro } = await cenario();
  const novo = await pendente(b, admin);
  // o painel escolhe onde a janela abre
  await assert.rejects(b.rpc(leitor, "painel_ligacao_aprovador", { p_computador: novo.pc, p_aprovador: velho.pc }), /só administrador/);
  await assert.rejects(b.rpc(admin, "painel_ligacao_aprovador", { p_computador: velho.pc, p_aprovador: outro.pc }), /computador novo desconhecido/);
  await assert.rejects(b.rpc(admin, "painel_ligacao_aprovador", { p_computador: novo.pc, p_aprovador: novo.pc }), /computador desconhecido/);
  assert.equal((await b.rpc(admin, "painel_ligacao_aprovador", { p_computador: novo.pc, p_aprovador: velho.pc })).ok, true);
  assert.deepEqual(await b.rpc(novo, "agente_ligacao_receber", {}), { estado: "sem_pedido" });
  await b.rpc(novo, "agente_ligacao_pedir", { p_publica: chave("a") });
  const esperando = await b.rpc(novo, "agente_ligacao_receber", {});
  assert.equal(esperando.estado, "esperando");
  assert.equal(esperando.aprovador, "velho");

  // os computadores ativos veem o pedido (a janela abre só no escolhido)
  const ola = await b.rpc(velho, "agente_ola", { p_versao: "0.2.0", p_diagnostico: null, p_conta_local: null });
  assert.equal(ola.ligacoes.length, 1);
  assert.equal(ola.ligacoes[0].computador_id, novo.pc);
  assert.equal(ola.ligacoes[0].publica.x, "a".repeat(43));
  assert.equal(ola.ligacoes[0].para_mim, true);
  const doOutro = await b.rpc(outro, "agente_ligacoes_abertas", {});
  assert.equal(doOutro.pedidos[0].para_mim, false);

  // o painel acompanha sem ver a chave pública nem o envelope
  const [estado] = await b.como(leitor, "select pedido_em, expira_em, entregue_em from public.ligacao_pedidos where computador_id = $1", [novo.pc]);
  assert.ok(estado.pedido_em && !estado.entregue_em);
  await assert.rejects(b.como(leitor, "select publica from public.ligacao_pedidos"), /permission denied/);
  await assert.rejects(b.como(admin, "select envelope from public.ligacao_pedidos"), /permission denied/);
  await assert.rejects(b.como(velho, "select publica from public.ligacao_pedidos"), /permission denied/);

  // entrega: só para a chave que o computador conferiu, envelope no formato
  await assert.rejects(b.rpc(velho, "agente_ligacao_entregar", { p_computador: novo.pc, p_publica: chave("a"), p_envelope: { cifrado: "x" } }), /envelope inválido/);
  const trocada = await b.rpc(velho, "agente_ligacao_entregar", { p_computador: novo.pc, p_publica: chave("z"), p_envelope: envelope() });
  assert.deepEqual(trocada, { ok: false, erro: "a chave do pedido não é a que foi conferida" });
  assert.equal((await b.rpc(velho, "agente_ligacao_entregar", { p_computador: novo.pc, p_publica: chave("a"), p_envelope: envelope() })).ok, true);
  const segunda = await b.rpc(outro, "agente_ligacao_entregar", { p_computador: novo.pc, p_publica: chave("a"), p_envelope: envelope("f") });
  assert.deepEqual(segunda, { ok: false, erro: "pedido já fechado" }, "entregue uma vez só");
  assert.equal((await b.rpc(velho, "agente_ligacoes_abertas", {})).pedidos.length, 0, "entregue sai da lista");

  // o computador novo lê uma vez: o envelope sai do banco
  const recebido = await b.rpc(novo, "agente_ligacao_receber", {});
  assert.equal(recebido.estado, "entregue");
  assert.deepEqual(recebido.envelope, { efemera: { kty: "EC", crv: "P-256", x: "e".repeat(43), y: "E".repeat(43) }, iv: "A".repeat(16), cifrado: "B".repeat(64) });
  assert.equal(recebido.impressao, "c".repeat(32));
  const [linha] = await b.sql("select envelope, lido_em, entregue_por from public.ligacao_pedidos where computador_id = $1", [novo.pc]);
  assert.equal(linha.envelope, null);
  assert.ok(linha.lido_em);
  assert.equal(linha.entregue_por, velho.pc);
  assert.deepEqual(await b.rpc(novo, "agente_ligacao_receber", {}), { estado: "lido" });

  // agora sim ele entra (e deixa de ser pendente: não pede nem recebe de novo)
  assert.equal((await b.rpc(novo, "agente_registrar", { p_nome: "novo", p_sistema: "linux", p_versao: "0.2.0" })).computador_id, novo.pc);
  await assert.rejects(b.rpc(novo, "agente_ligacao_receber", {}), /já entrou/);
  const eventos = (await b.sql("select texto from public.eventos order by id")).map((e) => e.texto);
  assert.ok(eventos.some((t) => /pediu para entrar/.test(t)));
  assert.ok(eventos.some((t) => /entregue cifrada só para ele/.test(t)));
});

test("dois pedidos abertos ao mesmo tempo: a entrega recusa os dois (falha fechada)", async () => {
  const { b, admin, velho } = await cenario();
  const n1 = await pendente(b, admin);
  const n2 = await pendente(b, admin);
  await b.rpc(n1, "agente_ligacao_pedir", { p_publica: chave("a") });
  await b.rpc(n2, "agente_ligacao_pedir", { p_publica: chave("b") });
  assert.equal((await b.rpc(velho, "agente_ligacoes_abertas", {})).pedidos.length, 2);
  const r = await b.rpc(velho, "agente_ligacao_entregar", { p_computador: n1.pc, p_publica: chave("a"), p_envelope: envelope() });
  assert.equal(r.ok, false);
  assert.match(r.erro, /dois pedidos/);
  assert.deepEqual(await b.rpc(n1, "agente_ligacao_receber", {}), { estado: "recusado", motivo: "dois_pedidos" });
  assert.deepEqual(await b.rpc(n2, "agente_ligacao_receber", {}), { estado: "recusado", motivo: "dois_pedidos" });
  const [{ n }] = await b.sql("select count(*)::int as n from public.ligacao_pedidos where envelope is not null");
  assert.equal(n, 0, "nenhum envelope ficou");
  // recusado não volta: o mesmo código não pede de novo
  await assert.rejects(b.rpc(n1, "agente_ligacao_pedir", { p_publica: chave("a") }), /já fechou|já pediu/);
});

test("recusar: só computador ativo, motivo da lista; o computador novo fica sabendo", async () => {
  const { b, admin, velho } = await cenario();
  const novo = await pendente(b, admin);
  await b.rpc(novo, "agente_ligacao_pedir", { p_publica: chave("a") });
  await assert.rejects(b.rpc(velho, "agente_ligacao_recusar", { p_computador: novo.pc, p_motivo: "porque sim" }), /motivo inválido/);
  await assert.rejects(b.rpc(novo, "agente_ligacao_recusar", { p_computador: novo.pc, p_motivo: "recusado_na_tela" }), /só computador/);
  assert.equal((await b.rpc(velho, "agente_ligacao_recusar", { p_computador: novo.pc, p_motivo: "recusado_na_tela" })).ok, true);
  assert.deepEqual(await b.rpc(novo, "agente_ligacao_receber", {}), { estado: "recusado", motivo: "recusado_na_tela" });
  const r = await b.rpc(velho, "agente_ligacao_entregar", { p_computador: novo.pc, p_publica: chave("a"), p_envelope: envelope() });
  assert.equal(r.ok, false);
});

test("vencimento: pedido de mais de 10 minutos não aparece, não recebe entrega e o envelope não fica guardado", async () => {
  const { b, admin, velho } = await cenario();
  const novo = await pendente(b, admin);
  await b.rpc(novo, "agente_ligacao_pedir", { p_publica: chave("a") });
  await b.sql("update public.ligacao_pedidos set expira_em = now() - interval '1 second' where computador_id = $1", [novo.pc]);
  assert.equal((await b.rpc(velho, "agente_ligacoes_abertas", {})).pedidos.length, 0);
  assert.deepEqual(await b.rpc(velho, "agente_ligacao_entregar", { p_computador: novo.pc, p_publica: chave("a"), p_envelope: envelope() }),
    { ok: false, erro: "pedido vencido" });
  assert.deepEqual(await b.rpc(novo, "agente_ligacao_receber", {}), { estado: "vencido" });
  // vencido não se renova com outra chave nem com a mesma
  await assert.rejects(b.rpc(novo, "agente_ligacao_pedir", { p_publica: chave("a") }), /já fechou/);
  // entregue e não lido em 10 minutos: o envelope sai do banco
  const outro = await pendente(b, admin);
  await b.rpc(outro, "agente_ligacao_pedir", { p_publica: chave("b") });
  await b.rpc(velho, "agente_ligacao_entregar", { p_computador: outro.pc, p_publica: chave("b"), p_envelope: envelope() });
  await b.sql("update public.ligacao_pedidos set entregue_em = now() - interval '11 minutes' where computador_id = $1", [outro.pc]);
  assert.deepEqual(await b.rpc(outro, "agente_ligacao_receber", {}), { estado: "vencido" });
  const [{ envelope: guardado }] = await b.sql("select envelope from public.ligacao_pedidos where computador_id = $1", [outro.pc]);
  assert.equal(guardado, null);
  await assert.rejects(b.rpc(outro, "agente_registrar", { p_nome: "x", p_sistema: "linux", p_versao: "0.2.0" }), /ainda não recebeu/);
});

test("revogar o computador novo fecha o pedido dele", async () => {
  const { b, admin, velho } = await cenario();
  const novo = await pendente(b, admin);
  await b.rpc(novo, "agente_ligacao_pedir", { p_publica: chave("a") });
  await b.rpc(admin, "painel_revogar_computador", { p_computador: novo.pc });
  assert.equal((await b.rpc(velho, "agente_ligacoes_abertas", {})).pedidos.length, 0);
  assert.deepEqual(await b.rpc(velho, "agente_ligacao_entregar", { p_computador: novo.pc, p_publica: chave("a"), p_envelope: envelope() }),
    { ok: false, erro: "pedido desconhecido" });
  await assert.rejects(b.rpc(novo, "agente_ligacao_receber", {}), /só computador novo/);
});
