import { test } from "node:test";
import assert from "node:assert/strict";
import { banco } from "./apoio.mjs";

const PAINEL = "pedido pelo painel";

async function cenario({ auto = true, modo = "limiar" } = {}) {
  const b = await banco();
  await b.config("auto", auto);
  await b.config("modo", modo);
  const admin = { id: await b.usuario("admin", "admin@exemplo.com"), aal: "aal2" };
  return { b, admin };
}

async function usar(b, pc, conta, motivo = "teste") {
  await b.sql(`insert into public.atribuicao (computador_id, conta_id, motivo, decidido_em)
               values ($1, $2, $3, now() - interval '1 hour')
               on conflict (computador_id) do update set conta_id = excluded.conta_id, motivo = excluded.motivo,
                                                         decidido_em = excluded.decidido_em`, [pc.pc, conta, motivo]);
}

async function pct(b, conta, valor) {
  await b.sql(`update public.uso_janelas set pct = $2, lido_em = now() where conta_id = $1 and tipo = 'five_hour'`, [conta, valor]);
}

async function preferir(b, pc, conta) {
  await b.sql("update public.computadores set conta_preferida = $2 where id = $1", [pc.pc, conta]);
}

async function motivo(b, pc) {
  const [l] = await b.sql("select motivo from public.atribuicao where computador_id = $1", [pc.pc]);
  return l?.motivo ?? null;
}

async function fora(b, pc) {
  await b.sql("update public.computadores set visto_em = now() - interval '10 minutes' where id = $1", [pc.pc]);
}

test("computador sem conta recebe a preferida, mesmo com prioridade pior e uso maior", async () => {
  const { b } = await cenario({ auto: false });
  const pc = await b.computador("mini");
  const boa = await b.conta(pc, "boa@exemplo.com", 5, { prioridade: 1 });
  const vinte = await b.conta(pc, "vinte@exemplo.com", 40, { prioridade: 50 });
  await preferir(b, pc, vinte);
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(pc), vinte);
  void boa;
});

test("os outros computadores evitam a preferida de um computador ligado; com o dono fora, ela volta à fila normal", async () => {
  const { b } = await cenario({ auto: false });
  const mini = await b.computador("mini");
  const air = await b.computador("air");
  const vinte = await b.conta(mini, "vinte@exemplo.com", 1, { prioridade: 1 });
  const outra = await b.conta(mini, "outra@exemplo.com", 30, { prioridade: 50 });
  const terceira = await b.conta(mini, "terceira@exemplo.com", 60, { prioridade: 90 });
  await preferir(b, mini, vinte);
  await usar(b, mini, outra, PAINEL);
  await b.sql("select public.decidir($1)", [air.pc]);
  assert.equal(await b.atribuida(air), terceira, "entre a preferida de outro e uma pior, fica com a pior");

  await b.sql("delete from public.atribuicao where computador_id = $1", [air.pc]);
  await b.sql("update public.contas set pausada = true where id = $1", [terceira]);
  await b.sql("select public.decidir($1)", [air.pc]);
  assert.equal(await b.atribuida(air), vinte, "sem outra livre, usa a preferida do mini em vez de ficar parado");

  await b.sql("delete from public.atribuicao where computador_id = $1", [air.pc]);
  await b.sql("update public.contas set pausada = false where id = $1", [terceira]);
  await fora(b, mini);
  await b.sql("select public.decidir($1)", [air.pc]);
  assert.equal(await b.atribuida(air), vinte, "dono fora do ar: a preferida volta a valer pela prioridade");
});

test("preferida no limite, pausada ou em outro computador: vale a fila normal", async () => {
  const { b } = await cenario({ auto: false });
  const pc = await b.computador("mini");
  const vinte = await b.conta(pc, "vinte@exemplo.com", 92);
  const outra = await b.conta(pc, "outra@exemplo.com", 20);
  await preferir(b, pc, vinte);
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(pc), outra, "acima do aviso não entra");

  const { b: b2 } = await cenario({ auto: false });
  const pc2 = await b2.computador("mini");
  const v2 = await b2.conta(pc2, "vinte@exemplo.com", 5, { pausada: true });
  const o2 = await b2.conta(pc2, "outra@exemplo.com", 20);
  await preferir(b2, pc2, v2);
  await b2.sql("select public.decidir()");
  assert.equal(await b2.atribuida(pc2), o2, "pausada não entra");

  const { b: b3 } = await cenario({ auto: false });
  const mini = await b3.computador("mini");
  const air = await b3.computador("air");
  const v3 = await b3.conta(mini, "vinte@exemplo.com", 5);
  const o3 = await b3.conta(mini, "outra@exemplo.com", 20);
  await preferir(b3, mini, v3);
  await usar(b3, air, v3, PAINEL);
  await b3.sql("select public.decidir($1)", [mini.pc]);
  assert.equal(await b3.atribuida(mini), o3, "em outro computador não entra");
});

test("volta para a preferida quando ela fica livre de novo (troca automática ligada, depois da espera)", async () => {
  const { b } = await cenario();
  const pc = await b.computador("mini");
  const vinte = await b.conta(pc, "vinte@exemplo.com", 20);
  const outra = await b.conta(pc, "outra@exemplo.com", 10);
  await preferir(b, pc, vinte);
  await usar(b, pc, outra, "chegou a 95%");
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(pc), vinte);
  assert.equal(await motivo(b, pc), "conta preferida deste computador");

  await usar(b, pc, outra, "chegou a 95%");
  await b.sql("update public.atribuicao set decidido_em = now() where computador_id = $1", [pc.pc]);
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(pc), outra, "dentro da espera entre trocas, fica");
});

test("a troca pedida à mão é respeitada: não volta sozinha para a preferida", async () => {
  const { b } = await cenario();
  const pc = await b.computador("mini");
  const vinte = await b.conta(pc, "vinte@exemplo.com", 20);
  const outra = await b.conta(pc, "outra@exemplo.com", 10);
  await preferir(b, pc, vinte);
  await usar(b, pc, outra, PAINEL);
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(pc), outra);
  await usar(b, pc, outra, "pedido pela API");
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(pc), outra);
});

test("com a troca automática desligada, não volta para a preferida", async () => {
  const { b } = await cenario({ auto: false });
  const pc = await b.computador("mini");
  const vinte = await b.conta(pc, "vinte@exemplo.com", 20);
  const outra = await b.conta(pc, "outra@exemplo.com", 10);
  await preferir(b, pc, vinte);
  await usar(b, pc, outra, "chegou a 95%");
  assert.equal(await b.sql("select public.decidir()").then((r) => r[0].decidir), 0);
  assert.equal(await b.atribuida(pc), outra);
});

test("no limite, a preferida é a primeira escolha da troca", async () => {
  const { b } = await cenario();
  const pc = await b.computador("mini");
  const atual = await b.conta(pc, "atual@exemplo.com", 10, { prioridade: 1 });
  const boa = await b.conta(pc, "boa@exemplo.com", 5, { prioridade: 1 });
  const vinte = await b.conta(pc, "vinte@exemplo.com", 40, { prioridade: 90 });
  await preferir(b, pc, vinte);
  await usar(b, pc, atual, PAINEL);
  await pct(b, atual, 96);
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(pc), vinte);
  void boa;
});

test("outro computador devolve a preferida quando o dono está ligado sem ela", async () => {
  const { b } = await cenario();
  const mini = await b.computador("mini");
  const air = await b.computador("air");
  const vinte = await b.conta(mini, "vinte@exemplo.com", 20);
  const livre = await b.conta(mini, "livre@exemplo.com", 30);
  const doMini = await b.conta(mini, "domini@exemplo.com", 10);
  await preferir(b, mini, vinte);
  await usar(b, air, vinte, "computador sem conta");
  await usar(b, mini, doMini, "chegou a 95%");
  await b.sql("select public.decidir()");
  // O mini vem antes na ordem dos ids? Os dois passam: o air devolve e o mini pega na mesma rodada ou na próxima.
  await b.sql("update public.atribuicao set decidido_em = now() - interval '1 hour'");
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(mini), vinte);
  assert.notEqual(await b.atribuida(air), vinte);
  assert.equal(await b.atribuida(air), livre);
  const [ev] = await b.sql(`select dados from public.eventos where tipo = 'troca' and dados ->> 'motivo' = $1`,
    ["devolvendo a conta preferida de outro computador"]);
  assert.ok(ev, "a devolução fica registrada");
});

test("não devolve sem outra para pegar, por uma reserva, com troca à mão (de qualquer lado) ou com o dono fora do ar", async () => {
  const { b } = await cenario();
  const mini = await b.computador("mini");
  const air = await b.computador("air");
  const vinte = await b.conta(mini, "vinte@exemplo.com", 20);
  const doMini = await b.conta(mini, "domini@exemplo.com", 10);
  await preferir(b, mini, vinte);
  await usar(b, mini, doMini, "chegou a 95%");
  await usar(b, air, vinte, "computador sem conta");
  await b.sql("select public.decidir($1)", [air.pc]);
  assert.equal(await b.atribuida(air), vinte, "sem outra conta livre, fica");

  await b.conta(mini, "reserva@exemplo.com", 5, { reserva: true });
  await b.sql("select public.decidir($1)", [air.pc]);
  assert.equal(await b.atribuida(air), vinte, "não troca a preferida de outro por uma reserva");

  const livre = await b.conta(mini, "livre@exemplo.com", 30);
  await usar(b, air, vinte, PAINEL);
  await b.sql("select public.decidir($1)", [air.pc]);
  assert.equal(await b.atribuida(air), vinte, "o air pegou à mão: fica");

  await usar(b, air, vinte, "computador sem conta");
  await usar(b, mini, doMini, PAINEL);
  await b.sql("select public.decidir($1)", [air.pc]);
  assert.equal(await b.atribuida(air), vinte, "o mini escolheu outra à mão: o air fica");

  await usar(b, mini, doMini, "chegou a 95%");
  await fora(b, mini);
  await b.sql("select public.decidir($1)", [air.pc]);
  assert.equal(await b.atribuida(air), vinte, "o dono está fora do ar: fica");

  await b.sql("update public.computadores set visto_em = now() where id = $1", [mini.pc]);
  await b.sql("select public.decidir($1)", [air.pc]);
  assert.equal(await b.atribuida(air), livre, "controle: dono ligado, nada à mão, outra livre: devolve");
});

test("o rodízio não tira o computador da preferida", async () => {
  const { b } = await cenario({ modo: "rodizio" });
  const pc = await b.computador("mini");
  const vinte = await b.conta(pc, "vinte@exemplo.com", 20);
  await b.conta(pc, "outra@exemplo.com", 10);
  await preferir(b, pc, vinte);
  await usar(b, pc, vinte, "rodízio do dia");
  await b.config("proximo_rodizio_em", new Date(Date.now() - 60_000).toISOString());
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(pc), vinte);
});

test("painel: só administrador com duas etapas grava; uma conta é preferida de um computador só", async () => {
  const { b, admin } = await cenario({ auto: false });
  const mini = await b.computador("mini");
  const air = await b.computador("air");
  const vinte = await b.conta(mini, "vinte@exemplo.com", 20);
  const leitura = { id: await b.usuario("leitura", "leitura@exemplo.com"), aal: "aal2" };
  const semDuas = { id: admin.id, aal: "aal1" };
  await assert.rejects(b.rpc(leitura, "painel_computador_preferida", { p_computador: mini.pc, p_conta: vinte }), /só administrador/);
  // administrador que ativou as duas etapas precisa do código na sessão (aal2)
  await b.sql("insert into auth.mfa_factors (user_id, status) values ($1, 'verified')", [admin.id]);
  await assert.rejects(b.rpc(semDuas, "painel_computador_preferida", { p_computador: mini.pc, p_conta: vinte }), /duas etapas/);
  await b.como({ id: mini.id, aal: "aal1" }, "update public.computadores set conta_preferida = $2 where id = $1", [mini.pc, vinte])
    .catch(() => null);
  const [{ conta_preferida: depoisDoComputador }] = await b.sql("select conta_preferida from public.computadores where id = $1", [mini.pc]);
  assert.equal(depoisDoComputador, null, "o computador não grava a preferida direto na tabela");

  assert.deepEqual(await b.rpc(admin, "painel_computador_preferida", { p_computador: mini.pc, p_conta: vinte }), { ok: true });
  const r = await b.rpc(admin, "painel_computador_preferida", { p_computador: air.pc, p_conta: vinte });
  assert.equal(r.ok, false);
  assert.match(r.erro, /outro computador já prefere/);
  const desconhecida = await b.rpc(admin, "painel_computador_preferida",
    { p_computador: mini.pc, p_conta: "00000000-0000-0000-0000-000000000001" });
  assert.equal(desconhecida.ok, false);

  const [aud] = await b.sql("select alvo, detalhes from public.auditoria where acao = 'preferida' order by id limit 1");
  assert.equal(aud.alvo, mini.pc);
  assert.equal(aud.detalhes.conta, vinte);

  assert.deepEqual(await b.rpc(admin, "painel_computador_preferida", { p_computador: mini.pc, p_conta: null }), { ok: true });
  const [{ conta_preferida }] = await b.sql("select conta_preferida from public.computadores where id = $1", [mini.pc]);
  assert.equal(conta_preferida, null);
  assert.deepEqual(await b.rpc(admin, "painel_computador_preferida", { p_computador: air.pc, p_conta: vinte }), { ok: true },
    "tirada do mini, o air pode preferir");
});

test("painel: com a preferida livre, o computador passa para ela na hora", async () => {
  const { b, admin } = await cenario({ auto: false });
  const pc = await b.computador("mini");
  const vinte = await b.conta(pc, "vinte@exemplo.com", 20);
  const outra = await b.conta(pc, "outra@exemplo.com", 10);
  await usar(b, pc, outra, PAINEL);
  await b.rpc(admin, "painel_computador_preferida", { p_computador: pc.pc, p_conta: vinte });
  assert.equal(await b.atribuida(pc), vinte);
  assert.equal(await motivo(b, pc), "conta preferida deste computador");
});

test("computador revogado solta a preferência (o índice e a regra só olham os não revogados)", async () => {
  const { b, admin } = await cenario({ auto: false });
  const velho = await b.computador("velho");
  const novo = await b.computador("novo");
  const vinte = await b.conta(velho, "vinte@exemplo.com", 20);
  await preferir(b, velho, vinte);
  await b.sql("update public.computadores set revogado = true where id = $1", [velho.pc]);
  assert.deepEqual(await b.rpc(admin, "painel_computador_preferida", { p_computador: novo.pc, p_conta: vinte }), { ok: true });
});
