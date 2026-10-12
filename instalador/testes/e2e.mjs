// Teste de ponta a ponta da instalação, contra o emulador da nuvem: o instalador de verdade (perguntas respondidas pelo
// ambiente), o banco montado pelas migrações, o painel compilado e publicado, e o agente de verdade se registrando e
// respondendo a um comando do painel. Rode num contêiner (scripts/e2e-docker.sh): ele instala serviço e mexe no HOME.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { iniciarEmulador } from "./emulador/emulador.mjs";
import { comoAdmin, jsonb, texto, uuid } from "../lib/sql.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = new Set(process.argv.slice(2));
const resultados = [];
const conferir = (nome, ok, detalhe = "") => {
  resultados.push({ nome, ok: !!ok, detalhe });
  console.log(`${ok ? "ok   " : "FALHA"} ${nome}${detalhe ? `: ${detalhe}` : ""}`);
};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function rodar(cmd, argv, env, { saida = true } = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, argv, { cwd: RAIZ, env, stdio: ["ignore", "pipe", "pipe"] });
    let texto = "";
    p.stdout.on("data", (d) => { texto += d; if (saida) process.stdout.write(d); });
    p.stderr.on("data", (d) => { texto += d; if (saida) process.stderr.write(d); });
    p.on("close", (codigo) => resolve({ codigo, texto }));
  });
}

const emu = await iniciarEmulador();
const sql = async (q, params = []) => {
  const r = await fetch(`${emu.url}/teste/sql`, { method: "POST", body: JSON.stringify({ sql: q, params }) });
  return r.json();
};
const home = mkdtempSync(path.join(os.tmpdir(), "reveza-e2e-"));
const env = {
  ...process.env,
  HOME: home,
  REVEZA_EMULADOR: emu.url,
  NODE_OPTIONS: `--import ${path.join(RAIZ, "instalador", "testes", "emulador", "rede.mjs")}`,
  SUPABASE_ACCESS_TOKEN: "sbp_emulador_nao_e_segredo",
  VERCEL_TOKEN: "vercel_emulador",
  REVEZA_ADMIN_EMAIL: "admin@exemplo.com",
  REVEZA_ADMIN_SENHA: "SenhaForte12345",
  REVEZA_SUPABASE_REF: emu.ref,
  REVEZA_DEPURAR: "1",
};
let agente = null;
try {
  console.log(`emulador em ${emu.url}; HOME ${home}`);
  const rb = args.has("--com-react-bits") ? [] : ["--sem-react-bits"];
  if (args.has("--em-dois-passos")) {
    // primeiro só no computador; depois a nuvem entra na mesma instalação (--com-nuvem), sem perder nada local
    const local = await rodar(process.execPath, ["instalador/instalar.mjs", "--sim", "--sem-servico", "--sem-nuvem", ...rb], env);
    conferir("primeiro passo (só no computador) termina sem erro", local.codigo === 0, `saída ${local.codigo}`);
    conferir("primeiro passo não mexe na nuvem", emu.estado.consultas === 0, `${emu.estado.consultas} consultas`);
  }
  const inst = await rodar(process.execPath, ["instalador/instalar.mjs", "--sim", "--sem-servico", ...(args.has("--em-dois-passos") ? ["--com-nuvem"] : []), ...rb], env);
  conferir("instalador termina sem erro", inst.codigo === 0, `saída ${inst.codigo}`);
  conferir("nenhum segredo na saída do instalador", !/SenhaForte12345|servico-emulador|sbp_emulador/.test(inst.texto));
  if (args.has("--em-dois-passos")) {
    // terceiro passo: atualizar só o computador, sem token (o corte do gestor antigo faz assim); a nuvem fica
    const semToken = { ...env };
    delete semToken.SUPABASE_ACCESS_TOKEN;
    delete semToken.VERCEL_TOKEN;
    const antes = readFileSync(path.join(home, ".reveza", "instalacao.json"), "utf8");
    const at = await rodar(process.execPath, ["instalador/instalar.mjs", "--sim", "--sem-servico", "--atualizar", ...rb], semToken);
    const depois = JSON.parse(readFileSync(path.join(home, ".reveza", "instalacao.json"), "utf8"));
    conferir("atualizar sem token mantém a nuvem e o painel", at.codigo === 0 && JSON.stringify(depois.nuvem) === JSON.stringify(JSON.parse(antes).nuvem) && depois.painel?.url === JSON.parse(antes).painel?.url, `saída ${at.codigo}`);
  }

  const migr = readdirSync(path.join(RAIZ, "nuvem", "migracoes")).filter((a) => a.endsWith(".sql") && !a.startsWith("."));
  const reg = await sql("select nome from public.reveza_migracoes order by nome");
  conferir("todas as migrações registradas", reg.length === migr.length, `${reg.length}/${migr.length}`);
  const [adm] = await sql("select m.papel::text as papel, u.email from public.membros m join auth.users u on u.id = m.user_id where u.email = 'admin@exemplo.com'");
  conferir("administrador criado com papel admin", adm && adm.papel === "admin");
  const cfg = Object.fromEntries((await sql("select chave, valor from public.config")).map((r) => [r.chave, r.valor]));
  conferir("troca automática gravada desligada, modo limiar", cfg.auto === false && cfg.modo === "limiar", JSON.stringify({ auto: cfg.auto, modo: cfg.modo }));
  conferir("login sem cadastro aberto e com duas etapas", emu.estado.authConfig.disable_signup === true && emu.estado.authConfig.mfa_totp_enroll_enabled === true);
  conferir("4 funções publicadas", emu.estado.funcoes.length === 4, String(emu.estado.funcoes.length));
  conferir("segredos das funções", ["REVEZA_SITE", "REVEZA_CRON", "VAPID_PUBLICA", "VAPID_PRIVADA"].every((s) => emu.estado.segredos.has(s)));
  const dep = emu.estado.implantacoes.at(-1);
  const dist = path.join(home, ".reveza", "painel-build", "dist", "assets");
  const js = existsSync(dist) ? readdirSync(dist).filter((a) => a.endsWith(".js")).map((a) => readFileSync(path.join(dist, a), "utf8")).join("\n") : "";
  const vapid = (await sql("select 1")).length ? JSON.parse(readFileSync(path.join(home, ".reveza", "instalacao.json"), "utf8")).nuvem?.vapidPublica : null;
  conferir("chave pública do push dentro do painel (e nenhuma chave de serviço)", vapid && js.includes(vapid) && !js.includes("servico-emulador"));
  conferir("painel publicado com index.html e vercel.json", dep && dep.files.includes("index.html") && dep.files.includes("vercel.json"), dep ? `${dep.files.length} arquivos` : "nenhuma implantação");

  const arqInst = path.join(home, ".reveza", "instalacao.json");
  const instalacao = existsSync(arqInst) ? readFileSync(arqInst, "utf8") : "";
  conferir("instalacao.json gravado", !!instalacao);
  conferir("instalacao.json sem segredo", instalacao && !/SenhaForte|servico-emulador|sbp_|senha|token/i.test(instalacao));
  const dados = instalacao ? JSON.parse(instalacao) : {};
  conferir("endereço do painel guardado", dados.painel && dados.painel.url === "https://reveza.vercel.app", dados.painel && dados.painel.url);
  // o login só volta para o painel publicado (o endereço provisório, do próprio computador, não fica valendo)
  conferir("login volta só para o painel publicado", emu.estado.authConfig.site_url === "https://reveza.vercel.app"
    && emu.estado.authConfig.uri_allow_list === "https://reveza.vercel.app/**", `${emu.estado.authConfig.site_url} ${emu.estado.authConfig.uri_allow_list}`);

  // o agente de verdade, com a identidade que o instalador guardou
  const cli = path.join(home, ".reveza", "app", "agente", "dist", "src", "cli.js");
  agente = spawn(process.execPath, [cli, "rodar"], { env, stdio: ["ignore", "pipe", "pipe"] });
  let logAgente = "";
  agente.stdout.on("data", (d) => (logAgente += d));
  agente.stderr.on("data", (d) => (logAgente += d));
  let pc = null;
  for (let i = 0; i < 30 && !pc; i++) {
    await esperar(1000);
    const r = await sql("select c.id from public.computadores c join auth.users u on u.id = c.user_id where u.email like 'pc-%'");
    pc = r[0] && r[0].id;
  }
  conferir("o agente entrou na nuvem e registrou o computador", !!pc, pc ? "" : logAgente.slice(-400));
  if (pc) {
    const [{ id: adminId }] = await sql("select id from auth.users where email = 'admin@exemplo.com'");
    const [{ r }] = await sql(comoAdmin(adminId, `public.painel_comando(${uuid(pc)}, ${texto("atualizar")}, ${jsonb({})})`));
    let estadoCmd = null;
    for (let i = 0; i < 30; i++) {
      await esperar(1000);
      const [c] = await sql("select estado::text as estado, http from public.comandos where id = $1", [r.id]);
      if (c && c.estado !== "pendente" && c.estado !== "reservado") { estadoCmd = c; break; }
    }
    conferir("comando do painel chega ao computador e volta feito", estadoCmd && estadoCmd.estado === "feito", JSON.stringify(estadoCmd));
    // ligar computador novo pelo painel: sem a permissão do computador, recusa; com ela, a frase volta cifrada
    // para a chave efêmera deste "navegador"
    const { spawnSync } = await import("node:child_process");
    spawnSync(process.execPath, [cli, "ligar", "--painel", "ligar"], { env });
    const { webcrypto } = await import("node:crypto");
    const par = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const jwk = await webcrypto.subtle.exportKey("jwk", par.publicKey);
    const [{ r: lig }] = await sql(comoAdmin(adminId, `public.painel_comando(${uuid(pc)}, ${texto("ligar")}, ${jsonb({ publica: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, idioma: "pt-BR" })})`));
    let resp = null;
    for (let i = 0; i < 30 && !resp; i++) {
      await esperar(1000);
      const [c] = await sql("select estado::text as estado, resposta from public.comandos where id = $1", [lig.id]);
      if (c && c.estado === "feito") resp = c.resposta;
      else if (c && c.estado === "recusado") { resp = c.resposta; break; }
    }
    const { abrirEnvelopeNavegador } = await import(path.join(home, ".reveza", "app", "agente", "dist", "src", "ligar.js"));
    let frase = null;
    try { frase = resp && resp.envelope ? await abrirEnvelopeNavegador(par.privateKey, resp.envelope) : null; } catch { frase = null; }
    conferir("ligar pelo painel: a frase chega cifrada e só este navegador abre", frase && frase.palavras.length === 6 && !JSON.stringify(resp).includes(frase.palavras.join(" ")), JSON.stringify(resp).slice(0, 120));
    const [{ abertas }] = await sql("select count(*)::int as abertas from public.ligacoes where usado_em is null and expira_em > now()");
    conferir("a ligação ficou aberta na nuvem (embrulhada pela frase)", abertas === 1);

    // um SEGUNDO computador entra só com o código de ligação do painel (acesso e frase juntos)
    if (frase) {
      const senha2 = "s".repeat(20) + Math.random().toString(36).slice(2) + "X9";
      const u = await (await fetch(`${emu.url}/proj/auth/v1/admin/users`, { method: "POST", headers: { apikey: "servico-emulador", "Content-Type": "application/json" },
        body: JSON.stringify({ email: "pc-segundo@computadores.reveza.invalid", password: senha2 }) })).json();
      await sql("select public.servico_registrar_computador($1, $2)", [u.id, adminId]);
      // o código de um passo só (o que o painel monta): acesso e frase juntos, nada mais é perguntado
      const codigo = "rvzl_" + Buffer.from(JSON.stringify({ u: `https://${emu.ref}.supabase.co`, k: "anon-emulador", e: "pc-segundo@computadores.reveza.invalid", s: senha2, f: frase.palavras.join(" ") })).toString("base64url");
      const home2 = mkdtempSync(path.join(os.tmpdir(), "reveza-e2e-pc2-"));
      const env2 = { ...env, HOME: home2, REVEZA_CODIGO: codigo };
      delete env2.SUPABASE_ACCESS_TOKEN;
      delete env2.VERCEL_TOKEN;
      // sem --ligar: o código no ambiente basta para o instalador saber que é um computador novo
      const r2 = await rodar(process.execPath, ["instalador/instalar.mjs", "--sim", "--sem-servico", "--sem-react-bits"], env2, { saida: false });
      conferir("segundo computador: o instalador --ligar termina", r2.codigo === 0, r2.codigo === 0 ? "" : r2.texto.slice(-300));
      const [{ n2 }] = await sql("select count(*)::int as n2 from public.computadores");
      conferir("segundo computador registrado na nuvem", n2 === 2, `${n2} computadores`);
      const [{ usadas }] = await sql("select count(*)::int as usadas from public.ligacoes where usado_em is not null");
      conferir("segundo computador recebeu a chave do cofre pela frase", usadas === 1 && /recebeu a chave do cofre/.test(r2.texto), "");
    }
    const [{ n }] = await sql("select count(*)::int as n from public.computadores where id = $1 and visto_em > now() - interval '1 minute'", [pc]);
    conferir("o computador aparece como visto agora", n === 1);
  }
} catch (e) {
  conferir("execução", false, e.stack || e.message);
} finally {
  if (agente) agente.kill("SIGTERM");
  await esperar(500);
  await emu.fechar();
}
const falhas = resultados.filter((r) => !r.ok);
console.log(`\n${resultados.length - falhas.length}/${resultados.length} conferências ok`);
process.exit(falhas.length ? 1 : 0);
