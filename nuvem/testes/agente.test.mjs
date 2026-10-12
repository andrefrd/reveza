import { test } from "node:test";
import assert from "node:assert/strict";
import { banco } from "./apoio.mjs";

const b64 = (n, v) => Buffer.alloc(n, v).toString("base64");

test("computador novo recebe a conta que já estava nele e depois a melhor livre", async () => {
  const b = await banco();
  const pc = await b.computador();
  const a = await b.conta(pc, "a@exemplo.com", 10);
  const r = await b.rpc(pc, "agente_ola", { p_versao: "1.0.0", p_conta_local: "a@exemplo.com" });
  assert.equal(r.atribuicao.conta_id, a);
  assert.equal(r.atribuicao.email, "a@exemplo.com");
  assert.equal(r.config.auto, false, "a troca automática começa desligada");
  const pc2 = await b.computador("pc2");
  const c = await b.conta(pc2, "c@exemplo.com", 5);
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(pc2), c, "o segundo computador ganhou a conta livre, não a do primeiro");
});

test("posse: uma conta, um computador; uso só com atribuição", async () => {
  const b = await banco();
  const pc1 = await b.computador("pc1");
  const pc2 = await b.computador("pc2");
  const a = await b.conta(pc1, "a@exemplo.com");
  let r = await b.rpc(pc1, "agente_pegar_posse", { p_conta: a, p_motivo: "uso" });
  assert.equal(r.ok, false, "sem atribuição não pega para uso");
  r = await b.rpc(pc1, "agente_pegar_posse", { p_conta: a, p_motivo: "leitura", p_segundos: 60 });
  assert.equal(r.ok, true);
  assert.equal(r.cofre.versao, 1);
  assert.equal(r.cofre.nonce, b64(12, 2));
  r = await b.rpc(pc2, "agente_pegar_posse", { p_conta: a, p_motivo: "leitura" });
  assert.equal(r.ok, false, "outro computador não pega a mesma conta");
  await b.rpc(pc1, "agente_soltar_posse", { p_conta: a });
  r = await b.rpc(pc2, "agente_pegar_posse", { p_conta: a, p_motivo: "leitura" });
  assert.equal(r.ok, true);
});

test("cofre: só grava quem tem posse, e só por cima da versão que leu", async () => {
  const b = await banco();
  const pc = await b.computador();
  const a = await b.conta(pc, "a@exemplo.com");
  let r = await b.rpc(pc, "agente_devolver_cofre", { p_conta: a, p_cifrado: b64(40, 3), p_nonce: b64(12, 4), p_versao_anterior: 1 });
  assert.equal(r.ok, false, "sem posse");
  await b.rpc(pc, "agente_pegar_posse", { p_conta: a, p_motivo: "renovacao" });
  r = await b.rpc(pc, "agente_devolver_cofre", { p_conta: a, p_cifrado: b64(40, 3), p_nonce: b64(12, 4), p_versao_anterior: 7 });
  assert.equal(r.ok, false, "versão errada");
  r = await b.rpc(pc, "agente_devolver_cofre", { p_conta: a, p_cifrado: b64(40, 3), p_nonce: b64(12, 4), p_versao_anterior: 1 });
  assert.deepEqual(r, { ok: true, versao: 2 });
  const [k] = await b.sql("select versao, encode(nonce, 'base64') n from public.cofre where conta_id = $1", [a]);
  assert.equal(Number(k.versao), 2);
  assert.equal(k.n, b64(12, 4));
});

test("relato de uso só vale para conta em mãos", async () => {
  const b = await banco();
  const pc1 = await b.computador("pc1");
  const pc2 = await b.computador("pc2");
  const a = await b.conta(pc1, "a@exemplo.com", 10);
  const r = await b.rpc(pc2, "agente_relatar_uso", { p_janelas: [{ conta_id: a, tipo: "five_hour", pct: 99, fonte: "api" }] });
  assert.equal(r.gravadas, 0);
  const [j] = await b.sql("select pct from public.uso_janelas where conta_id = $1 and tipo = 'five_hour'", [a]);
  assert.equal(Number(j.pct), 10);
});

test("tokens: relato idempotente, projeto sem caminho, por computador", async () => {
  const b = await banco();
  const pc = await b.computador();
  const a = await b.conta(pc, "a@exemplo.com");
  const linha = { hora: "2026-10-11T03:12:00Z", conta_id: a, projeto: "/Users/x/proj", modelo: "m1", respostas: 3,
    entrada: 10, saida: 20, cache_escrita: 30, cache_leitura: 40, usd: 1.5 };
  await b.rpc(pc, "agente_relatar_tokens", { p_linhas: [linha] });
  await b.rpc(pc, "agente_relatar_tokens", { p_linhas: [{ ...linha, respostas: 4, usd: 2 }] });
  const linhas = await b.sql("select projeto, respostas, usd, hora from public.uso_tokens");
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].respostas, 4);
  assert.equal(linhas[0].projeto, "Usersxproj");
});

test("comandos: reserva atômica, uma vez só, e velho expira", async () => {
  const b = await banco();
  const pc = await b.computador();
  const admin = { id: await b.usuario("admin"), aal: "aal2" };
  const { id } = await b.rpc(admin, "painel_comando", { p_computador: pc.pc, p_acao: "atualizar", p_corpo: {} });
  let r = await b.rpc(pc, "agente_ola", { p_versao: "1" });
  assert.equal(r.comandos.length, 1);
  r = await b.rpc(pc, "agente_reservar_comando", { p_id: id });
  assert.equal(r.ok, true);
  r = await b.rpc(pc, "agente_reservar_comando", { p_id: id });
  assert.equal(r.ok, false, "não reserva duas vezes");
  await b.rpc(pc, "agente_responder_comando", { p_id: id, p_http: 400, p_resposta: { erro: "x" } });
  const [c] = await b.sql("select estado, http from public.comandos where id = $1", [id]);
  assert.equal(c.estado, "recusado");
  const velho = await b.rpc(admin, "painel_comando", { p_computador: pc.pc, p_acao: "atualizar", p_corpo: {} });
  await b.sql("update public.comandos set criado_em = now() - interval '5 minutes' where id = $1", [velho.id]);
  assert.equal((await b.rpc(pc, "agente_reservar_comando", { p_id: velho.id })).ok, false);
  await assert.rejects(b.rpc(admin, "painel_comando", { p_computador: pc.pc, p_acao: "apagar_tudo", p_corpo: {} }));
  await assert.rejects(b.rpc(admin, "painel_comando", { p_computador: pc.pc, p_acao: "conectar", p_corpo: { email: "x" } }), /e-mail inválido/);
});

test("ligação de computador novo: uma vez, por 10 minutos, nunca para quem abriu", async () => {
  const b = await banco();
  const pc1 = await b.computador("pc1");
  const pc2 = await b.computador("pc2");
  await b.rpc(pc1, "agente_ligacao_publicar", { p_embrulho: b64(60, 7), p_sal: b64(16, 8) });
  assert.equal((await b.rpc(pc1, "agente_ligacao_buscar")).ok, false, "quem abriu não pega");
  const r = await b.rpc(pc2, "agente_ligacao_buscar");
  assert.equal(r.ok, true);
  assert.equal(r.embrulho, b64(60, 7));
  assert.equal((await b.rpc(pc2, "agente_ligacao_buscar")).ok, false, "só uma vez");
});

test("precisa entrar de novo: sai da fila e troca na hora; só quem tem a conta marca", async () => {
  const b = await banco();
  const pc = await b.computador("pc1");
  const outro = await b.computador("pc2");
  await b.config("auto", true);
  const a = await b.conta(pc, "a@exemplo.com", 10);
  const c = await b.conta(pc, "c@exemplo.com", 10);
  await b.sql("insert into public.atribuicao (computador_id, conta_id, motivo) values ($1, $2, 'teste')", [pc.pc, a]);
  assert.equal((await b.rpc(outro, "agente_marcar_login", { p_conta: a, p_precisa: true })).ok, false);
  assert.equal((await b.rpc(pc, "agente_marcar_login", { p_conta: a, p_precisa: true })).ok, true);
  assert.equal(await b.atribuida(pc), c);
  const [x] = await b.sql("select precisa_login from public.contas where id = $1", [a]);
  assert.equal(x.precisa_login, true);
});

test("a busca renova só a posse da conta atribuída", async () => {
  const b = await banco();
  const pc = await b.computador();
  const a = await b.conta(pc, "a@exemplo.com", 10);
  const c = await b.conta(pc, "c@exemplo.com", 10);
  await b.sql("insert into public.atribuicao (computador_id, conta_id, motivo) values ($1, $2, 'teste')", [pc.pc, a]);
  await b.sql(`insert into public.posse (conta_id, computador_id, motivo, expira_em) values
               ($1, $3, 'uso', now() + interval '10 seconds'), ($2, $3, 'uso', now() + interval '10 seconds')`, [a, c, pc.pc]);
  await b.rpc(pc, "agente_ola", { p_versao: "1" });
  const [pa] = await b.sql("select expira_em > now() + interval '90 seconds' renovada from public.posse where conta_id = $1", [a]);
  const [pc2] = await b.sql("select expira_em > now() + interval '90 seconds' renovada from public.posse where conta_id = $1", [c]);
  assert.equal(pa.renovada, true);
  assert.equal(pc2.renovada, false);
});
