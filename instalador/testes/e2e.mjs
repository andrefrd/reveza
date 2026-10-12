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
  // instalação nova: a troca começa ligada, antes do limite (90% e 95%), sem pergunta (0.2.0); em dois passos ela vem
  // do estado local que o primeiro passo gravou
  conferir("troca automática gravada ligada, antes do limite (90% e 95%)", cfg.auto === true && cfg.modo === "limiar" && cfg.aviso === 90 && cfg.troca === 95,
    JSON.stringify({ auto: cfg.auto, modo: cfg.modo, aviso: cfg.aviso, troca: cfg.troca }));
  conferir("a instalação avisa a troca numa linha, sem perguntar", /troca automática ligada, antes do limite \(avisa em 90%, troca em 95%\)/.test(inst.texto)
    && !/Troca de conta|Como trocar/.test(inst.texto));
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
    // o pedido "ligar" do painel antigo (a frase cifrada para o navegador) saiu na 0.2.0
    const antigo = await sql(comoAdmin(adminId, `public.painel_comando(${uuid(pc)}, ${texto("ligar")}, ${jsonb({ publica: { kty: "EC", crv: "P-256", x: "a".repeat(43), y: "b".repeat(43) }, idioma: "pt-BR" })})`));
    conferir("o pedido de ligação pelo painel antigo é recusado", !Array.isArray(antigo) && /ligação pelo painel saiu/.test(JSON.stringify(antigo)), JSON.stringify(antigo).slice(0, 160));

    // um SEGUNDO computador entra pelo fluxo da 0.2.0: o painel cria a identidade pendente e escolhe onde a janela
    // abre; o código de acesso (rvzc_) só deixa o computador novo pedir; o código de 8 caracteres aparece NELE; quem tem
    // a chave libera digitando esse código (aqui, sem tela no contêiner, por `reveza ligar CODIGO`)
    {
      const senha2 = "s".repeat(20) + Math.random().toString(36).slice(2) + "X9";
      const u = await (await fetch(`${emu.url}/proj/auth/v1/admin/users`, { method: "POST", headers: { apikey: "servico-emulador", "Content-Type": "application/json" },
        body: JSON.stringify({ email: "pc-segundo@computadores.reveza.invalid", password: senha2 }) })).json();
      const [{ r: reg2 }] = await sql("select public.servico_registrar_computador($1, $2) as r", [u.id, adminId]);
      const pc2 = reg2 && reg2.computador_id;
      await sql(comoAdmin(adminId, `public.painel_ligacao_aprovador(${uuid(pc2)}, ${uuid(pc)}, ${texto("pt-BR")})`));
      const codigoAcesso = "rvzc_" + Buffer.from(JSON.stringify({ u: `https://${emu.ref}.supabase.co`, k: "anon-emulador", e: "pc-segundo@computadores.reveza.invalid", s: senha2 })).toString("base64url");
      const home2 = mkdtempSync(path.join(os.tmpdir(), "reveza-e2e-pc2-"));
      const env2 = { ...env, HOME: home2, REVEZA_CODIGO: codigoAcesso };
      delete env2.SUPABASE_ACCESS_TOKEN;
      delete env2.VERCEL_TOKEN;
      // sem --ligar: o código no ambiente basta para o instalador saber que é um computador novo
      const p2 = spawn(process.execPath, ["instalador/instalar.mjs", "--sim", "--sem-servico", "--sem-react-bits"], { cwd: RAIZ, env: env2, stdio: ["ignore", "pipe", "pipe"] });
      let texto2 = "";
      p2.stdout.on("data", (d) => (texto2 += d));
      p2.stderr.on("data", (d) => (texto2 += d));
      let fim2 = null;
      const terminou2 = new Promise((ok) => p2.on("close", (c) => ok((fim2 = c))));
      // o instalador compila o agente antes de pedir: o código pode levar alguns minutos para aparecer
      let codigoLig = null;
      for (let i = 0; i < 600 && !codigoLig && fim2 === null; i++) {
        await esperar(1000);
        codigoLig = (/^ {4}([A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4})$/m.exec(texto2) || [])[1] || null;
      }
      conferir("computador novo: o código de 8 caracteres aparece nele, em letras grandes", codigoLig && texto2.includes("█"), codigoLig ? "" : texto2.slice(-300));
      const [ped] = await sql("select publica, envelope from public.ligacao_pedidos where computador_id = $1", [pc2]);
      conferir("a nuvem guarda só a chave pública do pedido (nada que abra o cofre)", ped && ped.publica && ped.publica.crv === "P-256" && !ped.envelope);
      conferir("a identidade pendente não entrou antes de receber a chave",
        (await sql("select sistema from public.computadores where id = $1", [pc2]))[0]?.sistema === "pendente");
      if (codigoLig) {
        const { spawnSync } = await import("node:child_process");
        const errado = spawnSync(process.execPath, [cli, "ligar", "AAAA-AAAA"], { env, encoding: "utf8" });
        conferir("reveza ligar com o código errado não libera", errado.status !== 0 && /não confere/.test(errado.stderr), (errado.stderr || "").slice(-200));
        const lib = spawnSync(process.execPath, [cli, "ligar", codigoLig.toLowerCase()], { env, encoding: "utf8" });
        conferir("reveza ligar CODIGO no computador que tem a chave entrega a chave cifrada", lib.status === 0, (lib.stderr || "").slice(-200));
      }
      await Promise.race([terminou2, esperar(120_000)]);
      if (fim2 === null) p2.kill("SIGTERM");
      conferir("segundo computador: o instalador --ligar termina", fim2 === 0, fim2 === 0 ? "" : texto2.slice(-300));
      const [{ n2 }] = await sql("select count(*)::int as n2 from public.computadores where sistema <> 'pendente'");
      conferir("segundo computador registrado na nuvem", n2 === 2, `${n2} computadores`);
      const [lp] = await sql("select envelope, lido_em from public.ligacao_pedidos where computador_id = $1", [pc2]);
      conferir("a chave chegou cifrada e foi lida uma vez (o envelope saiu da nuvem)", lp && !lp.envelope && !!lp.lido_em && /recebeu a chave do cofre/.test(texto2));
      const chave = (h) => { try { return readFileSync(path.join(h, ".reveza", "segredos", "chave-cofre"), "utf8"); } catch { return null; } };
      conferir("o segundo computador tem a mesma chave do cofre do primeiro", !!chave(home) && chave(home) === chave(home2));
      conferir("nenhum segredo na saída do computador novo", !texto2.includes(senha2) && !(chave(home) && texto2.includes(chave(home))));
      // atualizar o segundo computador não é instalação nova: nem com os tokens no ambiente ele mexe na nuvem ou no
      // painel, e não pergunta nada disso (12/10/2026, o MacBook do Paulo pedia o token do Supabase)
      if (fim2 === 0) {
        const antes2 = readFileSync(path.join(home2, ".reveza", "instalacao.json"), "utf8");
        const consultasAntes = emu.estado.consultas;
        const at2 = await rodar(process.execPath, ["instalador/instalar.mjs", "--sim", "--sem-servico", "--sem-react-bits", "--atualizar"],
          { ...env, HOME: home2 }, { saida: false });
        const depois2 = JSON.parse(readFileSync(path.join(home2, ".reveza", "instalacao.json"), "utf8"));
        conferir("atualizar o segundo computador só atualiza o programa dele (sem token, sem nuvem, sem painel)",
          at2.codigo === 0 && /Computador ligado a uma instalação/.test(at2.texto) && !/Projeto do Supabase|Token da Vercel/.test(at2.texto)
            && emu.estado.consultas === consultasAntes && JSON.stringify(depois2.nuvem) === JSON.stringify(JSON.parse(antes2).nuvem) && !depois2.painel,
          at2.codigo === 0 ? `${emu.estado.consultas - consultasAntes} consultas à nuvem` : at2.texto.slice(-300));
      }
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
