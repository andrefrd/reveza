// Regressões da revisão de segurança de 11/10/2026: cada teste prova que o caminho de ataque achado está fechado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { banco } from "./apoio.mjs";

const B64 = (n, v) => Buffer.alloc(n, v).toString("base64");

async function cenario() {
  const b = await banco();
  const admin = { id: await b.usuario("admin"), aal: "aal2" };
  const adminAal1 = { id: admin.id, aal: "aal1" };
  const leitor = { id: await b.usuario("leitura"), aal: "aal1" };
  return { b, admin, adminAal1, leitor };
}

test("alerta: vault_id vindo de fora é descartado; o segredo de um canal não vaza nem é sobrescrito por outro", async () => {
  const { b, admin } = await cenario();
  const tg = await b.rpc(admin, "painel_alerta", { p_canal: "telegram", p_destino: { chat_id: "1" }, p_eventos: ["sem_livre"] });
  await b.rpc(admin, "painel_alerta_segredo", { p_id: tg.id, p_segredo: "123456:TOKEN-DO-BOT" });
  const [{ destino }] = await b.como(admin, "select destino from public.alertas where id = $1", [tg.id]);
  const outro = await b.rpc(admin, "painel_alerta", {
    p_canal: "email", p_destino: { de: "a@exemplo.com", para: "b@exemplo.com", vault_id: destino.vault_id }, p_eventos: ["sem_livre"],
  });
  const [{ destino: d2 }] = await b.como(admin, "select destino from public.alertas where id = $1", [outro.id]);
  assert.equal(d2.vault_id, undefined, "o vault_id de outro canal não entra");
  assert.equal(await b.rpc("servico", "servico_segredo_alerta", { p_alerta: outro.id }), null);
  await b.rpc(admin, "painel_alerta_segredo", { p_id: outro.id, p_segredo: "chave-do-resend" });
  assert.equal(await b.rpc("servico", "servico_segredo_alerta", { p_alerta: tg.id }), "123456:TOKEN-DO-BOT");
  // editar o mesmo canal mantém o segredo dele; trocar de canal descarta
  await b.rpc(admin, "painel_alerta", { p_id: tg.id, p_canal: "telegram", p_destino: { chat_id: "2" }, p_eventos: ["troca"] });
  assert.equal(await b.rpc("servico", "servico_segredo_alerta", { p_alerta: tg.id }), "123456:TOKEN-DO-BOT");
  await b.rpc(admin, "painel_alerta", { p_id: tg.id, p_canal: "webhook", p_destino: { url: "https://hook.exemplo.com/x" }, p_eventos: ["troca"] });
  assert.equal(await b.rpc("servico", "servico_segredo_alerta", { p_alerta: tg.id }), null);
});

test("alerta e webhook: destino precisa ser https público; chaves estranhas não entram", async () => {
  const { b, admin } = await cenario();
  const recusados = [
    ["webhook", { url: "http://hook.exemplo.com/x" }],
    ["webhook", { url: "https://127.0.0.1/x" }],
    ["webhook", { url: "https://169.254.169.254/latest" }],
    ["webhook", { url: "https://0x7f.1/x" }],
    ["webhook", { url: "https://2130706433/x" }],
    ["webhook", { url: "https://localhost/x" }],
    ["webhook", { url: "https://banco.internal/x" }],
    ["webhook", { url: "https://hook.exemplo.com:5432/x" }],
    ["webhook", { url: "https://user@hook.exemplo.com/x" }],
    // o canal ntfy saiu (0017): nem com servidor https ele entra mais
    ["ntfy", { servidor: "https://ntfy.sh" }],
    ["telegram", { chat_id: "1; drop" }],
    ["email", { de: "a@b.com", para: "x" }],
    ["sms", {}],
  ];
  for (const [canal, destino] of recusados) {
    await assert.rejects(b.rpc(admin, "painel_alerta", { p_canal: canal, p_destino: destino, p_eventos: ["troca"] }), undefined, JSON.stringify(destino));
  }
  const ok = await b.rpc(admin, "painel_alerta", { p_canal: "webhook", p_destino: { url: "https://hook.exemplo.com:443/x", extra: 1 }, p_eventos: ["troca"] });
  const [{ destino }] = await b.como(admin, "select destino from public.alertas where id = $1", [ok.id]);
  assert.deepEqual(destino, { url: "https://hook.exemplo.com:443/x" });
  await assert.rejects(b.rpc(admin, "painel_webhook", { p_url: "https://10.0.0.5/x", p_eventos: ["*"] }), /https e público/);
});

test("administrador só com a senha não lê tabelas de administrador nem revoga chave de outra pessoa (com duas etapas exigidas)", async () => {
  const { b, admin, adminAal1, leitor } = await cenario();
  await b.sql("insert into public.config (chave, valor) values ('exigir_duas_etapas', 'true') on conflict (chave) do update set valor = 'true'");
  await b.rpc(admin, "painel_convidar", { p_email: "x@exemplo.com", p_papel: "leitura", p_token_hash: "a".repeat(64) });
  for (const t of ["convites", "alertas", "webhooks_saida", "auditoria"]) {
    assert.equal((await b.como(adminAal1, `select * from public.${t}`)).length, 0, t);
  }
  assert.ok((await b.como(admin, "select * from public.convites")).length > 0, "com duas etapas lê");
  const chave = await b.rpc({ ...leitor, aal: "aal2" }, "painel_chave_api_criar", { p_nome: "minha", p_escopos: ["ler"] });
  await assert.rejects(b.rpc(adminAal1, "painel_chave_api_revogar", { p_id: chave.id }), /duas etapas/);
  const pc = await b.computador("pc");
  await assert.rejects(b.rpc(pc, "painel_chave_api_revogar", { p_id: chave.id }), /só membro/);
  assert.equal((await b.rpc(admin, "painel_chave_api_revogar", { p_id: chave.id })).ok, true);
});

test("código de login sai da tabela quando o computador reserva o comando", async () => {
  const { b, admin, leitor } = await cenario();
  const pc = await b.computador("pc");
  const [{ id: pcId }] = await b.sql("select id from public.computadores limit 1");
  const c = await b.rpc(admin, "painel_comando", { p_computador: pcId, p_acao: "codigo_login", p_corpo: { codigo: "abc#123", login_id: "a1b2c3d4" } });
  const r = await b.rpc(pc, "agente_reservar_comando", { p_id: c.id });
  assert.equal(r.comando.corpo.codigo, "abc#123", "o computador recebe o código");
  assert.ok(r.comando.criado_em, "e a hora do pedido");
  const [linha] = await b.como(leitor, "select corpo from public.comandos where id = $1", [c.id]);
  assert.equal(linha.corpo.codigo, undefined);
});

test("push: só serviço de push conhecido, e a inscrição de outra pessoa não troca de dono", async () => {
  const { b, admin, leitor } = await cenario();
  await assert.rejects(b.rpc(leitor, "painel_push_inscrever", { p_endpoint: "https://atacante.exemplo/x", p_p256dh: "k", p_auth: "a" }), /desconhecido/);
  const ep = "https://fcm.googleapis.com/fcm/send/abc";
  assert.equal((await b.rpc(admin, "painel_push_inscrever", { p_endpoint: ep, p_p256dh: "k", p_auth: "a" })).ok, true);
  assert.equal((await b.rpc(leitor, "painel_push_inscrever", { p_endpoint: ep, p_p256dh: "k2", p_auth: "a2" })).ok, false);
  const [{ user_id }] = await b.sql("select user_id from public.push_inscricoes where endpoint = $1", [ep]);
  assert.equal(user_id, admin.id);
});

test("convite: cancelar, convite novo invalida o anterior, e aceitar nunca rebaixa administrador", async () => {
  const { b, admin } = await cenario();
  const h1 = "1".repeat(64), h2 = "2".repeat(64);
  const c1 = await b.rpc(admin, "painel_convidar", { p_email: "novo@exemplo.com", p_papel: "admin", p_token_hash: h1 });
  await b.rpc(admin, "painel_convidar", { p_email: "novo@exemplo.com", p_papel: "leitura", p_token_hash: h2 });
  const novo = await b.usuario(null, "novo@exemplo.com");
  assert.equal((await b.rpc("servico", "convite_aceitar", { p_user: novo, p_email: "novo@exemplo.com", p_token_hash: h1 })).ok, false,
    "o convite de administrador antigo morreu com o novo");
  const h3 = "3".repeat(64);
  const c3 = await b.rpc(admin, "painel_convidar", { p_email: "outro@exemplo.com", p_papel: "leitura", p_token_hash: h3 });
  assert.equal((await b.rpc(admin, "painel_convite_cancelar", { p_id: c3.id })).ok, true);
  const outro = await b.usuario(null, "outro@exemplo.com");
  assert.equal((await b.rpc("servico", "convite_aceitar", { p_user: outro, p_email: "outro@exemplo.com", p_token_hash: h3 })).ok, false);
  // o próprio administrador aceitando um convite de leitura continua administrador
  const [{ email }] = await b.sql("select email from auth.users where id = $1", [admin.id]);
  const h4 = "4".repeat(64);
  await b.rpc(admin, "painel_convidar", { p_email: email, p_papel: "leitura", p_token_hash: h4 });
  await b.rpc("servico", "convite_aceitar", { p_user: admin.id, p_email: email, p_token_hash: h4 });
  const [{ papel }] = await b.sql("select papel::text from public.membros where user_id = $1", [admin.id]);
  assert.equal(papel, "admin");
  assert.equal(c1.ok, true);
});

test("computador não registra por cima de conta atribuída a outro, e o recusado não muda nada", async () => {
  const { b } = await cenario();
  const A = await b.computador("A");
  const B = await b.computador("B");
  const r = await b.rpc(A, "agente_registrar_conta", { p_email: "c@exemplo.com", p_organizacao: "Org", p_plano: "max", p_nivel: "5x",
    p_cifrado: B64(40, 1), p_nonce: B64(12, 1) });
  const [{ id: pcA }] = await b.sql("select c.id from public.computadores c where c.user_id = $1", [A.id]);
  await b.sql("insert into public.atribuicao (computador_id, conta_id, motivo) values ($1, $2, 'teste')", [pcA, r.conta_id]);
  await b.sql("update public.contas set precisa_login = true where id = $1", [r.conta_id]);
  await b.sql("delete from public.posse");
  const r2 = await b.rpc(B, "agente_registrar_conta", { p_email: "c@exemplo.com", p_organizacao: "Outra", p_plano: "pro", p_nivel: "1x",
    p_cifrado: B64(40, 9), p_nonce: B64(12, 9) });
  assert.equal(r2.ok, false);
  const [c] = await b.sql("select organizacao, plano, precisa_login from public.contas where id = $1", [r.conta_id]);
  assert.deepEqual(c, { organizacao: "Org", plano: "max", precisa_login: true });
  const [{ cifrado }] = await b.sql("select encode(cifrado, 'base64') as cifrado from public.cofre where conta_id = $1", [r.conta_id]);
  assert.equal(cifrado, B64(40, 1));
});

test("computador não pega conta pausada pela busca nem manda alerta pelos canais", async () => {
  const { b } = await cenario();
  const A = await b.computador("A");
  await b.sql("insert into public.contas (email, pausada) values ('p@exemplo.com', true)");
  const r = await b.rpc(A, "agente_ola", { p_versao: "0.1.0", p_diagnostico: null, p_conta_local: "p@exemplo.com" });
  assert.equal(r.atribuicao, null);
  await assert.rejects(b.rpc(A, "agente_evento", { p_tipo: "alerta", p_texto: "clique aqui", p_dados: {} }), /tipo inválido/);
});

test("agenda mal formada é recusada na gravação e, se existir, não derruba a decisão", async () => {
  const { b, admin } = await cenario();
  await b.sql("insert into public.contas (email) values ('a@exemplo.com')");
  const [{ id }] = await b.sql("select id from public.contas where email = 'a@exemplo.com'");
  for (const agenda of [[{ dias: [8], de: "08:00", ate: "18:00" }], [{ dias: [1], de: "8h", ate: "18:00" }], [{ dias: [1], de: "18:00", ate: "08:00" }], [{}]]) {
    await assert.rejects(b.rpc(admin, "painel_conta", { p_conta: id, p_campos: { agenda } }), /agenda inválida/);
  }
  assert.equal((await b.rpc(admin, "painel_conta", { p_conta: id, p_campos: { agenda: [{ dias: [1, "2"], de: "08:00", ate: "24:00" }] } })).ok, true);
  await b.sql(`update public.contas set agenda = '[{"dias":["x"],"de":"lixo","ate":"lixo"}]' where id = $1`, [id]);
  await b.sql("select public.decidir()");
});

test("API: troca não vai para computador revogado nem para conta pausada", async () => {
  const { b, admin } = await cenario();
  const A = await b.computador("A");
  const pausada = await b.conta(A, "p@exemplo.com");
  const livre = await b.conta(A, "l@exemplo.com");
  await b.sql("delete from public.atribuicao");
  await b.sql("delete from public.posse");
  await b.sql("update public.contas set pausada = true where id = $1", [pausada]);
  assert.equal((await b.rpc("servico", "api_trocar", { p_user: admin.id, p_computador: A.pc, p_conta: pausada })).ok, false);
  await b.rpc(admin, "painel_revogar_computador", { p_computador: A.pc });
  assert.equal((await b.rpc("servico", "api_trocar", { p_user: admin.id, p_computador: A.pc, p_conta: livre })).ok, false);
});

test("revogar computador desliga o login dele e derruba as sessões", async () => {
  const { b, admin } = await cenario();
  const A = await b.computador("A");
  const [{ id: pc }] = await b.sql("select id from public.computadores where user_id = $1", [A.id]);
  await b.sql("insert into auth.sessions (user_id) values ($1)", [A.id]);
  await b.sql("insert into auth.refresh_tokens (user_id) values ($1)", [A.id]);
  const r = await b.rpc(admin, "painel_revogar_computador", { p_computador: pc });
  assert.deepEqual(r, { ok: true, login_desligado: true });
  const [{ banned_until }] = await b.sql("select banned_until::text from auth.users where id = $1", [A.id]);
  assert.equal(banned_until, "infinity");
  assert.equal((await b.sql("select 1 from auth.sessions where user_id = $1", [A.id])).length, 0);
  assert.equal((await b.sql("select 1 from auth.refresh_tokens where user_id = $1", [String(A.id)])).length, 0);
  await assert.rejects(b.rpc(A, "agente_ola", { p_versao: "0.1.0", p_diagnostico: null, p_conta_local: null }));
});

test("uma conta atribuída a um computador só", async () => {
  const { b } = await cenario();
  const A = await b.computador("A");
  const B = await b.computador("B");
  const [{ id: pcA }] = await b.sql("select id from public.computadores where user_id = $1", [A.id]);
  const [{ id: pcB }] = await b.sql("select id from public.computadores where user_id = $1", [B.id]);
  await b.sql("insert into public.contas (email) values ('u@exemplo.com')");
  const [{ id }] = await b.sql("select id from public.contas where email = 'u@exemplo.com'");
  await b.sql("select public.rvz_atribuir($1, $2, 'teste')", [pcA, id]);
  await b.sql("select public.rvz_atribuir($1, $2, 'teste')", [pcB, id]);
  const linhas = await b.sql("select computador_id from public.atribuicao where conta_id = $1", [id]);
  assert.deepEqual(linhas.map((l) => l.computador_id), [pcA]);
  await assert.rejects(b.sql("insert into public.atribuicao (computador_id, conta_id, motivo) values ($1, $2, 'x') on conflict (computador_id) do update set conta_id = excluded.conta_id", [pcB, id]));
});

// Auditoria com a skill security-audit da Cloudflare (11/10/2026).
test("evento escrito por computador (troca, limite) não sai pelos canais de alerta nem pelo webhook", async () => {
  const { b } = await cenario();
  const A = await b.computador("A");
  await b.como("servico", "select public.alertas_pendentes(500)");
  await b.rpc(A, "agente_evento", { p_tipo: "troca", p_texto: "Entre de novo em https://golpe.exemplo", p_dados: { acao: "x" } });
  await b.rpc(A, "agente_evento", { p_tipo: "limite", p_texto: "Pague em https://golpe.exemplo", p_dados: {} });
  await assert.rejects(b.rpc(A, "agente_evento", { p_tipo: "info", p_texto: "x", p_dados: [1] }), /dados inválidos/);
  await b.sql("select public.rvz_evento('troca', 'A: x -> y', '{}')");
  const [{ r }] = await b.como("servico", "select public.alertas_pendentes(50) as r");
  assert.deepEqual(r.eventos.map((e) => e.texto), ["A: x -> y"], "só o evento da nuvem");
});

test("endereço de webhook com %2e, ponto ideográfico ou caractere estranho é recusado no banco", async () => {
  const { b } = await cenario();
  for (const ruim of ["https://127.0.0%2e1/x", "https://127.0.0\u30021/x", "https://exemplo..com/x", "https://.exemplo.com/x", "https://ex_emplo.com/x", "https://127.0.0.1\\\\a.exemplo.com/x"]) {
    const [{ ok }] = await b.sql("select public.rvz_url_externa($1) as ok", [JSON.parse(`"${ruim}"`)]);
    assert.equal(ok, false, ruim);
  }
  const [{ ok }] = await b.sql("select public.rvz_url_externa('https://hook.exemplo.com/x') as ok");
  assert.equal(ok, true);
});

test("pedido ao computador: e-mail sem caractere de shell, computador revogado não recebe, código precisa do login", async () => {
  const { b, admin } = await cenario();
  await b.computador("pc");
  const [{ id: pcId }] = await b.sql("select id from public.computadores limit 1");
  for (const email of ["a&calc@x.com", 'a"b@x.com', "a|b@x.com", "a@x.com&calc", "a b@x.com"])
    await assert.rejects(b.rpc(admin, "painel_comando", { p_computador: pcId, p_acao: "conectar", p_corpo: { email } }), /e-mail inválido/, email);
  await assert.rejects(b.rpc(admin, "painel_comando", { p_computador: pcId, p_acao: "codigo_login", p_corpo: { codigo: "abc" } }), /login desconhecido/);
  await assert.rejects(b.rpc(admin, "painel_comando", { p_computador: pcId, p_acao: "codigo_login", p_corpo: { login_id: "a1b2c3d4", codigo: "a\nb" } }), /código inválido/);
  await b.rpc(admin, "painel_revogar_computador", { p_computador: pcId });
  await assert.rejects(b.rpc(admin, "painel_comando", { p_computador: pcId, p_acao: "atualizar", p_corpo: {} }), /revogado/);
});

test("membro revogado: chaves de API ficam revogadas e o celular para de receber aviso", async () => {
  const { b, admin, leitor } = await cenario();
  const ch = await b.rpc(leitor, "painel_chave_api_criar", { p_nome: "script", p_escopos: ["ler"] });
  await b.rpc(leitor, "painel_push_inscrever", { p_endpoint: "https://fcm.googleapis.com/fcm/send/zz", p_p256dh: "k", p_auth: "a" });
  const [{ uid }] = await b.sql("select user_id as uid from public.membros where papel = 'leitura' limit 1");
  await b.rpc(admin, "painel_revogar_membro", { p_user: uid });
  const [{ n }] = await b.sql("select count(*)::int as n from public.chaves_api where user_id = $1 and not revogada", [uid]);
  const [{ p }] = await b.sql("select count(*)::int as p from public.push_inscricoes where user_id = $1", [uid]);
  assert.equal(n, 0);
  assert.equal(p, 0);
  assert.ok(ch);
});

test("posse vencida não marca login nem grava histórico; nome do computador sem link", async () => {
  const { b } = await cenario();
  const A = await b.computador("A");
  const B = await b.computador("B");
  await b.sql("insert into public.contas (email) values ('z@exemplo.com')");
  const [{ id: z }] = await b.sql("select id from public.contas where email = 'z@exemplo.com'");
  await b.rpc(A, "agente_pegar_posse", { p_conta: z, p_motivo: "leitura", p_segundos: 10 });
  await b.sql("update public.posse set expira_em = now() - interval '5 minutes' where conta_id = $1", [z]);
  const r = await b.rpc(A, "agente_marcar_login", { p_conta: z, p_precisa: true });
  assert.equal(r.ok, false);
  await b.rpc(A, "agente_relatar_uso", { p_janelas: [], p_historico: [{ conta_id: z, em: new Date().toISOString(), p5: 50, p7: 10 }] });
  const [{ h }] = await b.sql("select count(*)::int as h from public.uso_historico where conta_id = $1", [z]);
  assert.equal(h, 0);
  await b.rpc(B, "agente_registrar", { p_nome: "URGENTE: entre em https://golpe.exemplo/x", p_sistema: "linux", p_versao: "0.1.0" });
  const [{ nome }] = await b.sql("select nome from public.computadores where nome like 'URGENTE%'");
  assert.ok(!/[:/]/.test(nome), nome);
});


test("código de login some também quando o pedido vence sem o computador pegar", async () => {
  const { b, admin, leitor } = await cenario();
  const pc = await b.computador("pc");
  const c = await b.rpc(admin, "painel_comando", { p_computador: pc.pc, p_acao: "codigo_login", p_corpo: { codigo: "CODIGO-1", login_id: "a1b2c3d4" } });
  await b.sql("update public.comandos set criado_em = now() - interval '3 minutes' where id = $1", [c.id]);
  await b.rpc(pc, "agente_ola", { p_versao: "1.0.0", p_diagnostico: null, p_conta_local: null });
  const [linha] = await b.como(leitor, "select estado, corpo from public.comandos where id = $1", [c.id]);
  assert.equal(linha.estado, "expirado");
  assert.equal(linha.corpo.codigo, undefined);
});

test("trocar agora pelo painel recusa conta pausada; API de admin sem duas etapas para quando a instalação exige", async () => {
  const { b, admin } = await cenario();
  const pc = await b.computador("pc");
  const conta = await b.conta(pc, "pausada@exemplo.com", 10, { pausada: true });
  const r = await b.rpc(admin, "painel_trocar_agora", { p_computador: pc.pc, p_conta: conta });
  assert.equal(r.ok, false);
  const [{ x }] = await b.como("servico", "select public.api_config($1, 'auto', 'true'::jsonb) as x", [admin.id]);
  assert.equal(x.ok, true, "sem exigir, a chave do admin vale");
  await b.sql("insert into public.config (chave, valor) values ('exigir_duas_etapas', 'true'::jsonb) on conflict (chave) do update set valor = excluded.valor");
  await assert.rejects(b.como("servico", "select public.api_config($1, 'auto', 'false'::jsonb)", [admin.id]), /sem acesso/);
});

test("impressão da chave do cofre: o primeiro computador grava, nenhum outro troca, formato conferido", async () => {
  const { b } = await cenario();
  const A = await b.computador("A");
  const B = await b.computador("B");
  const r1 = await b.rpc(A, "agente_cofre_impressao", { p_impressao: "a".repeat(32) });
  assert.equal(r1.impressao, "a".repeat(32));
  const r2 = await b.rpc(B, "agente_cofre_impressao", { p_impressao: "b".repeat(32) });
  assert.equal(r2.impressao, "a".repeat(32), "a segunda chave não substitui a da instalação");
  await assert.rejects(b.rpc(B, "agente_cofre_impressao", { p_impressao: "XYZ" }), /impressão inválida/);
  await assert.rejects(b.como("anon", "select public.agente_cofre_impressao(null)"));
});

test("código de acesso nunca usado aparece no painel, pode ser revogado e vence em 24 h", async () => {
  const { b, admin } = await cenario();
  const novo = await b.usuario(null);
  await b.como("servico", "select public.servico_registrar_computador($1, $2)", [novo, admin.id]);
  const [pend] = await b.como(admin, "select id, sistema from public.computadores where user_id = $1", [novo]);
  assert.equal(pend.sistema, "pendente", "aparece no painel desde o código");
  // pendente não age na nuvem antes do primeiro registro
  await assert.rejects(b.rpc({ id: novo }, "agente_ola", { p_versao: "1", p_diagnostico: null, p_conta_local: null }));
  // revogar antes de usar: o código morre
  const r = await b.rpc(admin, "painel_revogar_computador", { p_computador: pend.id });
  assert.equal(r.ok, true);
  await assert.rejects(b.rpc({ id: novo }, "agente_registrar", { p_nome: "x", p_sistema: "macos", p_versao: "1" }), /revogado/);
  // outro código, nunca usado por mais de 24 h: vencido
  const velho = await b.usuario(null);
  await b.como("servico", "select public.servico_registrar_computador($1, $2)", [velho, admin.id]);
  await b.sql("update public.computadores set criado_em = now() - interval '25 hours' where user_id = $1", [velho]);
  await assert.rejects(b.rpc({ id: velho }, "agente_registrar", { p_nome: "x", p_sistema: "macos", p_versao: "1" }), /vencido/);
});

test("uso com data no futuro (ou muito velha) não entra; revogar apaga o diagnóstico do computador", async () => {
  const { b, admin } = await cenario();
  const A = await b.computador("A");
  const linha = (hora) => ({ hora, conta_id: null, projeto: "p", modelo: "m", respostas: 1, entrada: 1, saida: 1, cache_escrita: 0, cache_leitura: 0, usd: 999 });
  await b.rpc(A, "agente_relatar_tokens", { p_linhas: [linha("2099-01-01T00:00:00Z"), linha("2001-01-01T00:00:00Z"), linha(new Date().toISOString())], p_sessoes: [] });
  const [{ n }] = await b.sql("select count(*)::int as n from public.uso_tokens");
  assert.equal(n, 1, "só a linha de agora");
  await b.rpc(A, "agente_ola", { p_versao: "1", p_diagnostico: { em: 1e20, itens: [null] }, p_conta_local: null });
  await b.rpc(admin, "painel_revogar_computador", { p_computador: A.pc });
  const [{ d }] = await b.sql("select diagnostico as d from public.computadores where id = $1", [A.pc]);
  assert.equal(d, null);
});

test("computador não cala o aviso de 90% da nuvem; e-mail de conta fora do formato é recusado", async () => {
  const { b } = await cenario();
  const A = await b.computador("A");
  await b.config("auto", true);
  await b.config("modo", "limiar");
  const a = await b.conta(A, "a@exemplo.com", 91);
  await b.conta(A, "z@exemplo.com", 5);
  await b.sql("insert into public.atribuicao (computador_id, conta_id, motivo, decidido_em) values ($1, $2, 'teste', now() - interval '1 hour')", [A.pc, a]);
  // o computador escreve um "aviso" com a conta para a nuvem achar que já avisou
  await b.rpc(A, "agente_evento", { p_tipo: "aviso", p_texto: "já avisado", p_dados: { conta: a } });
  await b.sql("select public.decidir()");
  const avisos = await b.sql("select origem from public.eventos where tipo = 'aviso' and dados ->> 'conta' = $1 order by id", [a]);
  assert.deepEqual(avisos.map((x) => x.origem), ["computador", "nuvem"]);
  for (const ruim of ["x\"<a href=//mal.exemplo>@exemplo.com", "Clique aqui:@exemplo.com", "a@b", "-a@exemplo.com", "a@exemplo..com"]) {
    await assert.rejects(b.rpc(A, "agente_registrar_conta", { p_email: ruim, p_organizacao: "Org", p_plano: "max", p_nivel: "5x",
      p_cifrado: B64(40, 1), p_nonce: B64(12, 1) }), /e-mail inválido/, ruim);
  }
  const ok = await b.rpc(A, "agente_registrar_conta", { p_email: "Nome.Sobrenome+rvz@sub.exemplo.com.br", p_organizacao: "Org", p_plano: "max",
    p_nivel: "5x", p_cifrado: B64(40, 1), p_nonce: B64(12, 1) });
  assert.equal(ok.ok, true);
});
