// As chamadas do instalador contra um Postgres local com as migrações de verdade (as mesmas funções do painel).
import { test } from "node:test";
import assert from "node:assert/strict";
import { banco } from "../../nuvem/testes/apoio.mjs";
import { comoAdmin, texto, uuid } from "../lib/sql.mjs";
import { computadorDoEmail, esperarComando, pedirComando, salvarAlerta, salvarTroca } from "../lib/nuvem.mjs";

async function montar() {
  const b = await banco();
  const consultar = async (sql, parametros) => (await b.db.query(sql, parametros)).rows;
  const admin = await b.usuario("admin", "admin@exemplo.com");
  return { b, consultar, admin };
}

test("texto escapa aspas e recusa nulo; uuid recusa o que não é uuid", () => {
  assert.equal(texto("a'b"), "'a''b'");
  assert.throws(() => texto("a\0b"), /nulo/);
  assert.throws(() => uuid("1; drop table x"), /inválido/);
  assert.match(comoAdmin("11111111-2222-3333-4444-555555555555", "1"), /^with _rvz as \(select set_config/);
});

test("troca: grava modo, limiares e liga como o administrador, com auditoria", async () => {
  const { b, consultar, admin } = await montar();
  await salvarTroca(consultar, admin, { auto: true, modo: "limiar", aviso: 85, troca: 92, fuso: "America/Sao_Paulo" });
  const cfg = Object.fromEntries((await b.sql("select chave, valor from public.config")).map((r) => [r.chave, r.valor]));
  assert.equal(cfg.modo, "limiar");
  assert.equal(cfg.aviso, 85);
  assert.equal(cfg.troca, 92);
  assert.equal(cfg.auto, true);
  assert.equal(cfg.fuso, "America/Sao_Paulo");
  const [{ n }] = await b.sql("select count(*)::int as n from public.auditoria where acao = 'config' and user_id = $1", [admin]);
  assert.ok(n >= 5);
  // limiares altos também passam (a troca vai a 100 antes)
  await salvarTroca(consultar, admin, { auto: false, modo: "limiar", aviso: 96, troca: 99 });
  await assert.rejects(salvarTroca(consultar, admin, { auto: false, modo: "limiar", aviso: 99, troca: 96 }), /menor que a troca/);
  await assert.rejects(salvarTroca(consultar, admin, { auto: false, modo: "turbo" }), /modo desconhecido/);
});

test("troca: quem não é administrador é recusado pelo banco", async () => {
  const { b, consultar } = await montar();
  const leitor = await b.usuario("leitura");
  await assert.rejects(salvarTroca(consultar, leitor, { auto: true, modo: "limite" }), /só administrador/);
});

test("alerta: destino na tabela, segredo no Vault, nada do segredo na tabela", async () => {
  const { b, consultar, admin } = await montar();
  const textos = [];
  const espiao = (sql, parametros) => (textos.push(sql), consultar(sql, parametros));
  const id = await salvarAlerta(espiao, admin, { canal: "telegram", destino: { chat_id: "123" }, segredo: "123456:TOKEN-do-bot" });
  // o segredo vai como parâmetro: o texto do SQL (que pode ficar no histórico de consultas do banco) não o leva
  assert.ok(textos.length >= 2 && textos.every((q) => !q.includes("TOKEN-do-bot")));
  const [a] = await b.sql("select canal, destino, eventos from public.alertas where id = $1", [id]);
  assert.equal(a.canal, "telegram");
  assert.equal(a.destino.chat_id, "123");
  assert.ok(a.destino.vault_id);
  assert.ok(!JSON.stringify(a).includes("TOKEN-do-bot"));
  assert.deepEqual(a.eventos, ["sem_livre", "precisa_login", "computador_parado", "login_vence"]);
});

test("comando de prova: vai para o computador da identidade e o estado é lido", async () => {
  const { b, consultar, admin } = await montar();
  const pcUser = await b.usuario("computador", "pc-abc@computadores.reveza.invalid");
  await b.sql("insert into public.computadores (user_id, nome, sistema, versao) values ($1, 'Computador novo', 'pendente', '')", [pcUser]);
  await b.rpc({ id: pcUser, aal: "aal1" }, "agente_registrar", { p_nome: "mac", p_sistema: "macos", p_versao: "0.1.0" });
  const pc = await computadorDoEmail(consultar, "PC-abc@computadores.reveza.invalid");
  assert.ok(pc);
  const id = await pedirComando(consultar, admin, pc, "atualizar");
  assert.equal((await esperarComando(consultar, id, { tentativas: 1, esperar: async () => {} })), null, "pendente ainda não é resposta");
  await b.sql("update public.comandos set estado = 'feito', http = 200 where id = $1", [id]);
  assert.deepEqual(await esperarComando(consultar, id, { tentativas: 1, esperar: async () => {} }), { estado: "feito", http: 200 });
});
