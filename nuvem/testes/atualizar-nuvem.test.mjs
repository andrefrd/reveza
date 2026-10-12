// A nuvem e o painel se atualizando sozinhos (0021): os tokens cifrados, a vez de publicar, a ordem com os computadores
// e o andamento da atualização da nuvem. No banco de verdade (PGlite com as migrações).
import { test } from "node:test";
import assert from "node:assert/strict";
import { banco } from "./apoio.mjs";
import { hashesAceitos, migracoes, planoMigracoes } from "../provisionar.mjs";

const B64 = (n, v = 7) => Buffer.alloc(n, v).toString("base64");
const IMPRESSAO = "impressao-da-chave-do-cofre";

async function preparar() {
  const b = await banco();
  const admin = { id: await b.usuario("admin"), aal: "aal2" };
  const leitor = { id: await b.usuario("leitura"), aal: "aal2" };
  const pc1 = await b.computador("pc1");
  const pc2 = await b.computador("pc2");
  await b.config("cofre_impressao", IMPRESSAO);
  return { b, admin, leitor, pc1, pc2 };
}
const cfg = async (b, chave) => (await b.sql("select valor from public.config where chave = $1", [chave]))[0]?.valor ?? null;
const guardar = (b, pc, impressao = IMPRESSAO) =>
  b.rpc(pc, "agente_credenciais_guardar", {
    p_supabase: B64(40, 1), p_supabase_nonce: B64(12, 2), p_vercel: B64(48, 3), p_vercel_nonce: B64(12, 4), p_impressao: impressao,
  });
const pendente = async (b) => (await b.sql("select public.rvz_publicacao_pendente() as p"))[0].p;
const vezPublicar = (b, pc, para) => b.rpc(pc, "agente_vez_de_publicar", { p_para: para });
const resultado = (b, pc, para, estado, motivo = null) =>
  b.rpc(pc, "agente_publicacao_resultado", { p_para: para, p_estado: estado, p_motivo: motivo });

test("as chaves novas da configuração existem, e o painel não grava nenhuma delas", async () => {
  const { b, admin } = await preparar();
  for (const chave of ["nuvem_versao", "nuvem_atualizacao", "publicado", "impressoes", "painel_publicacao", "atualizacao_completa", "publicacao_vez"]) {
    await b.config(chave, { teste: true });
    await assert.rejects(b.rpc(admin, "painel_config", { p_chave: chave, p_valor: { ligada: true } }), /configuração desconhecida/, chave);
  }
});

test("tokens cifrados: só computador ativo com a chave da instalação guarda; ninguém de fora lê a tabela", async () => {
  const { b, admin, leitor, pc1 } = await preparar();
  await assert.rejects(guardar(b, pc1, "outra-impressao"), /não é a da instalação/);
  await assert.rejects(guardar(b, admin), /só computador/);
  assert.deepEqual(await guardar(b, pc1), { ok: true });
  const linhas = await b.sql("select nome, length(cifrado) as n, length(nonce) as nn from public.credenciais_atualizacao order by nome");
  assert.deepEqual(linhas.map((l) => [l.nome, l.n, l.nn]), [["supabase", 40, 12], ["vercel", 48, 12]]);
  // nem o painel (administrador ou leitor) nem a chave de serviço leem a tabela
  for (const quem of [admin, leitor, "anon", "servico"]) {
    await assert.rejects(b.como(quem, "select * from public.credenciais_atualizacao"), /permission denied/, JSON.stringify(quem));
  }
  // o painel não chama as funções de computador
  await assert.rejects(b.rpc(admin, "agente_credenciais_atualizacao"), /só computador/);
  const lido = await b.rpc(pc1, "agente_credenciais_atualizacao");
  assert.equal(lido.supabase.cifrado, B64(40, 1));
  assert.equal(lido.vercel.nonce, B64(12, 4));
  // a configuração diz que está ligada, sem cifrado nenhum; o evento também não leva
  const c = await cfg(b, "atualizacao_completa");
  assert.equal(c.ligada, true);
  assert.equal(c.computador, pc1.pc);
  const eventos = JSON.stringify(await b.sql("select texto, dados from public.eventos"));
  assert.ok(!eventos.includes(B64(40, 1)) && !eventos.includes(B64(48, 3)), "nada do cifrado nos eventos");
  // cifrado mal formado
  await assert.rejects(b.rpc(pc1, "agente_credenciais_guardar", {
    p_supabase: "%%%", p_supabase_nonce: B64(12), p_vercel: B64(40), p_vercel_nonce: B64(12), p_impressao: IMPRESSAO,
  }), /cifrado inválido/);
  await assert.rejects(b.rpc(pc1, "agente_credenciais_guardar", {
    p_supabase: B64(40), p_supabase_nonce: B64(11), p_vercel: B64(40), p_vercel_nonce: B64(12), p_impressao: IMPRESSAO,
  }), /cifrado inválido|nonce/);
});

test("desligar: pelo computador ou pelo administrador (a regra das duas etapas de sempre); o leitor não", async () => {
  const { b, admin, leitor, pc1 } = await preparar();
  await guardar(b, pc1);
  await assert.rejects(b.rpc(leitor, "painel_credenciais_apagar"), /só administrador/);
  // administrador que ativou as duas etapas precisa do código na sessão (aal2)
  await b.sql("insert into auth.mfa_factors (user_id, status) values ($1, 'verified')", [admin.id]);
  await assert.rejects(b.rpc({ id: admin.id, aal: "aal1" }, "painel_credenciais_apagar"), /duas etapas/);
  assert.deepEqual(await b.rpc(admin, "painel_credenciais_apagar"), { ok: true });
  assert.equal((await b.sql("select count(*)::int as n from public.credenciais_atualizacao"))[0].n, 0);
  assert.equal((await cfg(b, "atualizacao_completa")).ligada, false);
  await guardar(b, pc1);
  assert.deepEqual(await b.rpc(pc1, "agente_credenciais_apagar"), { ok: true });
  assert.equal((await b.sql("select count(*)::int as n from public.credenciais_atualizacao"))[0].n, 0);
  assert.match((await b.sql("select texto from public.eventos order by id desc limit 1"))[0].texto, /apague os tokens no Supabase e na Vercel/);
});

test("o que falta publicar: pela versão e, quando a versão nova não mexeu na parte, pelo resumo", async () => {
  const { b } = await preparar();
  assert.deepEqual(await pendente(b), { versao: null, funcoes: false, painel: false }, "sem versão da nuvem, nada");
  await b.config("nuvem_versao", "0.3.1");
  assert.deepEqual(await pendente(b), { versao: "0.3.1", funcoes: true, painel: true }, "sem saber o que está no ar: pendente");
  await b.config("publicado", { funcoes: "0.3.0", painel: "0.3.0" });
  assert.deepEqual(await pendente(b), { versao: "0.3.1", funcoes: true, painel: true });
  await b.config("impressoes", { "0.3.0": { funcoes: "f1", painel: "p1" }, "0.3.1": { funcoes: "f1", painel: "p2" } });
  assert.deepEqual(await pendente(b), { versao: "0.3.1", funcoes: false, painel: true }, "as funções da 0.3.1 são as da 0.3.0");
  await b.config("publicado", { funcoes: "0.3.0", painel: "0.3.1" });
  assert.deepEqual(await pendente(b), { versao: "0.3.1", funcoes: false, painel: false });
  await b.config("publicado", { funcoes: "0.4.0", painel: "0.4.0" });
  assert.deepEqual(await pendente(b), { versao: "0.3.1", funcoes: false, painel: false }, "no ar uma mais nova que a nuvem");
  await b.config("publicado", { funcoes: "lixo", painel: null });
  assert.deepEqual(await pendente(b), { versao: "0.3.1", funcoes: true, painel: true });
});

test("a vez de publicar: desligada, nuvem atrás, em dia, um por vez, a que caiu no meio e a que passou do prazo", async () => {
  const { b, pc1, pc2 } = await preparar();
  await b.config("nuvem_versao", "0.3.1");
  await b.config("publicado", { funcoes: "0.3.0", painel: "0.3.0" });
  assert.deepEqual(await vezPublicar(b, pc1, "0.3.1"), { pode: false, motivo: "desligada" });
  await guardar(b, pc1);
  assert.deepEqual(await vezPublicar(b, pc1, "0.3.2"), { pode: false, motivo: "nuvem" }, "a nuvem ainda não está nessa versão");
  assert.deepEqual(await vezPublicar(b, pc1, "0.3.1"), { pode: true, funcoes: true, painel: true });
  assert.deepEqual(await vezPublicar(b, pc2, "0.3.1"), { pode: false, motivo: "outro" });
  // o mesmo computador pedindo de novo: a publicação dele caiu no meio (o agente reiniciou)
  assert.equal((await vezPublicar(b, pc1, "0.3.1")).pode, true);
  // passou de 45 minutos sem terminar: vira falha, alerta, e ninguém mais tenta sozinho
  await b.sql("update public.config set valor = jsonb_set(valor, '{desde}', to_jsonb(now() - interval '50 minutes')) where chave = 'publicacao_vez'");
  assert.deepEqual(await vezPublicar(b, pc2, "0.3.1"), { pode: false, motivo: "falhou" });
  assert.deepEqual(await vezPublicar(b, pc1, "0.3.1"), { pode: false, motivo: "falhou" });
  const [alerta] = await b.sql("select texto, dados from public.eventos where tipo = 'alerta' order by id desc limit 1");
  assert.equal(alerta.dados.motivo, "atualizacao_falhou");
  assert.equal(alerta.dados.parte, "publicacao");
  // o administrador pede de novo (a função atualizar-nuvem destrava)
  await b.sql("select public.servico_nuvem_destravar()");
  assert.equal((await vezPublicar(b, pc2, "0.3.1")).pode, true);
  // a parte que a versão nova não mexeu não entra
  await b.sql("delete from public.config where chave = 'publicacao_vez'");
  await b.config("impressoes", { "0.3.0": { funcoes: "f1", painel: "p1" }, "0.3.1": { funcoes: "f1", painel: "p2" } });
  assert.deepEqual(await vezPublicar(b, pc1, "0.3.1"), { pode: true, funcoes: false, painel: true });
  await b.config("publicado", { funcoes: "0.3.1", painel: "0.3.1" });
  await b.sql("delete from public.config where chave = 'publicacao_vez'");
  assert.deepEqual(await vezPublicar(b, pc1, "0.3.1"), { pode: false, motivo: "em_dia" });
});

test("o fim da publicação: concluída marca o que está no ar; falhou avisa e segura os computadores", async () => {
  const { b, admin, pc1, pc2 } = await preparar();
  await b.config("nuvem_versao", "0.3.1");
  await b.config("publicado", { funcoes: "0.3.0", painel: "0.3.0" });
  await b.config("atualizar_sozinho", "assim_que_sair");
  await guardar(b, pc1);
  // a ordem: com a atualização completa ligada, os computadores esperam a publicação da versão da nuvem
  assert.deepEqual(await b.rpc(pc2, "agente_vez_de_atualizar", { p_de: "0.3.0", p_para: "0.3.1" }), { pode: false, motivo: "publicacao" });
  assert.equal((await vezPublicar(b, pc1, "0.3.1")).pode, true);
  assert.deepEqual(await resultado(b, pc2, "0.3.1", "concluida"), { ok: false }, "só quem tem a vez conta o fim");
  assert.deepEqual(await resultado(b, pc1, "0.3.1", "falhou", "a Vercel respondeu 403"), { ok: true });
  const [alerta] = await b.sql("select texto, dados from public.eventos where tipo = 'alerta' order by id desc limit 1");
  assert.match(alerta.texto, /0\.3\.1.*não deu certo: a Vercel respondeu 403.*painel que estava no ar continua/);
  assert.equal(alerta.dados.parte, "publicacao");
  assert.deepEqual(await b.rpc(pc2, "agente_vez_de_atualizar", { p_de: "0.3.0", p_para: "0.3.1" }), { pode: false, motivo: "publicacao_falhou" });
  // de novo (o administrador pediu: Atualizar a nuvem destrava)
  await b.sql("select public.servico_nuvem_destravar()");
  assert.equal((await vezPublicar(b, pc1, "0.3.1")).pode, true);
  assert.deepEqual(await resultado(b, pc1, "0.3.1", "concluida"), { ok: true });
  const pub = await cfg(b, "publicado");
  assert.equal(pub.funcoes, "0.3.1");
  assert.equal(pub.painel, "0.3.1");
  assert.deepEqual(await pendente(b), { versao: "0.3.1", funcoes: false, painel: false });
  assert.deepEqual(await b.rpc(pc2, "agente_vez_de_atualizar", { p_de: "0.3.0", p_para: "0.3.1" }), { pode: true });
  // sem os tokens, a ordem é a da 0.2.1 (só a trava das migrações, no agente)
  await b.rpc(admin, "painel_credenciais_apagar");
  await b.sql("delete from public.config where chave = 'atualizacao_vez'");
  await b.config("publicado", { funcoes: "0.3.0", painel: "0.3.0" });
  assert.deepEqual(await b.rpc(pc2, "agente_vez_de_atualizar", { p_de: "0.3.0", p_para: "0.3.1" }), { pode: true });
});

test("a nuvem se atualizando: uma por vez, o fim marca a versão e os resumos, a falha vira alerta", async () => {
  const { b, pc1 } = await preparar();
  const sql1 = async (q, p = []) => (await b.sql(q, p))[0];
  await b.config("nuvem_versao", "0.3.0");
  assert.deepEqual((await sql1("select public.servico_nuvem_comecar('0.3.1', 'sozinho') as r")).r, { ok: true, de: "0.3.0" });
  assert.deepEqual((await sql1("select public.servico_nuvem_comecar('0.3.1', 'painel') as r")).r, { ok: false, motivo: "atualizando", para: "0.3.1" });
  await assert.rejects(b.sql("select public.servico_nuvem_comecar('3', 'painel')"), /versão inválida/);
  await assert.rejects(b.sql("select public.servico_nuvem_comecar('0.3.1', 'outro')"), /origem inválida/);
  // a vez da nuvem vence em 10 minutos (a função caiu no meio)
  await b.sql("update public.config set valor = jsonb_set(valor, '{desde}', to_jsonb(now() - interval '11 minutes')) where chave = 'nuvem_atualizacao'");
  assert.equal((await sql1("select public.servico_nuvem_comecar('0.3.1', 'painel') as r")).r.ok, true);
  // uma publicação parada da versão anterior não segura a nova
  await b.config("publicacao_vez", { computador: pc1.pc, para: "0.3.0", desde: new Date().toISOString(), estado: "falhou" });
  const imp = {};
  for (let i = 0; i < 8; i++) imp[`0.2.${i}`] = { funcoes: `f${i}`, painel: `p${i}` };
  await b.config("impressoes", imp);
  await b.sql("select public.servico_nuvem_terminou('0.3.1', $1::jsonb, $2::jsonb)",
    [JSON.stringify(["0021_atualizar_nuvem.sql", "0099_permissoes.sql"]), JSON.stringify({ "0.3.1": { funcoes: "fa", painel: "pa" } })]);
  assert.equal(await cfg(b, "nuvem_versao"), "0.3.1");
  const at = await cfg(b, "nuvem_atualizacao");
  assert.equal(at.estado, "atualizada");
  assert.equal(at.de, "0.3.0");
  assert.deepEqual(at.aplicadas, ["0021_atualizar_nuvem.sql", "0099_permissoes.sql"]);
  const guardadas = Object.keys(await cfg(b, "impressoes")).sort();
  assert.equal(guardadas.length, 6, "fica a meia dúzia mais nova");
  assert.ok(guardadas.includes("0.3.1") && !guardadas.includes("0.2.0") && !guardadas.includes("0.2.1"));
  assert.equal(await cfg(b, "publicacao_vez"), null);
  assert.match((await sql1("select texto from public.eventos order by id desc limit 1")).texto, /nuvem foi atualizada para a 0\.3\.1 \(2 migração/);
  // terminar com uma versão mais velha (outra rodada atrasada) não volta a versão da nuvem
  await b.sql("select public.servico_nuvem_terminou('0.3.0', '[]'::jsonb, null)");
  assert.equal(await cfg(b, "nuvem_versao"), "0.3.1");
  // a falha
  await b.sql("select public.servico_nuvem_comecar('0.3.2', 'sozinho')");
  await b.sql("select public.servico_nuvem_falhou('0.3.2', 'a migração 0022_x.sql falhou: erro de sintaxe')");
  const f = await cfg(b, "nuvem_atualizacao");
  assert.equal(f.estado, "falhou");
  assert.match(f.motivo, /0022_x\.sql/);
  assert.equal(await cfg(b, "nuvem_versao"), "0.3.1", "a versão não muda");
  const [alerta] = await b.sql("select texto, dados from public.eventos where tipo = 'alerta' order by id desc limit 1");
  assert.equal(alerta.dados.motivo, "atualizacao_falhou");
  assert.equal(alerta.dados.parte, "nuvem");
  assert.match(alerta.texto, /Nada ficou pela metade/);
});

test("as funções da nuvem não estão liberadas para ninguém de fora; as novas dos computadores e do painel, sim", async () => {
  const { b, admin, pc1 } = await preparar();
  for (const fn of ["servico_nuvem_estado()", "servico_nuvem_comecar('0.3.1', 'painel')", "servico_nuvem_terminou('0.3.1', '[]', '{}')",
    "servico_nuvem_falhou('0.3.1', 'x')", "servico_nuvem_destravar()", "rvz_apagar_credenciais('x', null)"]) {
    for (const quem of [admin, pc1, "anon", "servico"]) {
      await assert.rejects(b.como(quem, `select public.${fn}`), /permission denied/, `${fn} por ${JSON.stringify(quem)}`);
    }
  }
  const liberadas = await b.sql(`select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('agente_credenciais_guardar', 'agente_credenciais_atualizacao', 'agente_credenciais_apagar',
                      'agente_vez_de_publicar', 'agente_publicacao_resultado', 'painel_credenciais_apagar', 'agente_painel_publicacao')
    and has_function_privilege('authenticated', p.oid, 'execute')`);
  assert.equal(liberadas.length, 7);
  // os dados do painel: só para computador, sem token
  await b.config("painel_publicacao", { projeto: "reveza", equipe: "team_x", url: "https://reveza.vercel.app" });
  assert.deepEqual((await b.rpc(pc1, "agente_painel_publicacao")).painel.projeto, "reveza");
  await assert.rejects(b.rpc(admin, "agente_painel_publicacao"), /só computador/);
});

test("uma reaplicável antiga que muda não derruba o que as seguintes redefinem (a 0020 da 0.3.1 tirava o portão da 0021)", async () => {
  const { b, pc1, pc2 } = await preparar();
  await b.config("nuvem_versao", "0.3.1");
  await b.config("publicado", { funcoes: "0.3.0", painel: "0.3.0" });
  await b.config("atualizar_sozinho", "assim_que_sair");
  await guardar(b, pc1);
  const vez = () => b.rpc(pc2, "agente_vez_de_atualizar", { p_de: "0.3.0", p_para: "0.3.1" });
  assert.deepEqual(await vez(), { pode: false, motivo: "publicacao" });
  // a nuvem tem tudo registrado, menos a 0020 (que mudou na versão nova): o plano roda a 0020 e as reaplicáveis seguintes
  const todas = migracoes().filter((m) => !m.nome.endsWith(".supabase.sql"));
  const feitas = new Map(todas.map((m) => [m.nome, hashesAceitos(m.sql)[0]]));
  feitas.set("0020_atualizar_escolha.sql", "0".repeat(64));
  const plano = planoMigracoes(todas, feitas, true);
  const nomes = plano.map((m) => m.nome);
  assert.equal(nomes[0], "0020_atualizar_escolha.sql");
  assert.ok(nomes.includes("0021_atualizar_nuvem.sql"), `a 0021 roda de novo: ${nomes.join(", ")}`);
  assert.equal(nomes.at(-1), "0099_permissoes.sql");
  for (const m of plano) await b.db.exec(m.sql);
  assert.deepEqual(await vez(), { pode: false, motivo: "publicacao" }, "o portão da publicação continua de pé");
  const [{ tem }] = await b.sql("select position('rvz_completa_ligada' in prosrc) > 0 as tem from pg_proc where proname = 'agente_vez_de_atualizar'");
  assert.equal(tem, true);
});

test("guardar tokens de novo ou desligar no meio de uma publicação não tira a vez de quem está publicando", async () => {
  const { b, admin, pc1, pc2 } = await preparar();
  await b.config("nuvem_versao", "0.3.1");
  await b.config("publicado", { funcoes: "0.3.0", painel: "0.3.0" });
  await guardar(b, pc1);
  assert.equal((await vezPublicar(b, pc1, "0.3.1")).pode, true);
  // outro computador guarda os tokens de novo: a vez em andamento fica, e ele não publica junto
  await guardar(b, pc2);
  assert.equal((await cfg(b, "publicacao_vez")).estado, "em_andamento");
  assert.equal((await vezPublicar(b, pc2, "0.3.1")).pode, false);
  // desligar também não apaga a vez em andamento; quem publica ainda conta o fim
  await b.rpc(admin, "painel_credenciais_apagar");
  assert.equal((await cfg(b, "publicacao_vez")).estado, "em_andamento");
  assert.deepEqual(await resultado(b, pc1, "0.3.1", "concluida"), { ok: true });
  // a vez parada sai ao guardar de novo (tokens novos tentam de novo)
  await b.config("publicacao_vez", { computador: pc1.pc, para: "0.3.1", desde: new Date().toISOString(), estado: "falhou" });
  await guardar(b, pc1);
  assert.equal(await cfg(b, "publicacao_vez"), null);
});
