// Emulador da nuvem para o teste de ponta a ponta do instalador: a Management API do Supabase, o Auth e o PostgREST de
// um projeto (sobre um Postgres local, PGlite, com o que o Supabase traz pronto), a API da Vercel e o DNS.
// Não é um Supabase: só o que o instalador e o agente usam, com as mesmas regras de papel e de token.
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

export async function iniciarEmulador({ porta = 0, ref = "emuladorreveza000001" } = {}) {
  const db = new PGlite();
  await db.exec(readFileSync(path.join(aqui, "..", "..", "..", "nuvem", "testes", "supabase-falso.sql"), "utf8"));
  const senhas = new Map(); // email -> senha
  const estado = { segredos: new Set(), funcoes: [], authConfig: {}, arquivos: new Map(), implantacoes: [], projetosVercel: new Map(), consultas: 0 };
  // fila: o PGlite é uma conexão só
  let fila = Promise.resolve();
  const emFila = (fn) => (fila = fila.then(fn, fn));

  const token = (user) => {
    const agora = Math.floor(Date.now() / 1000);
    return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: user.id, email: user.email, role: "authenticated", aal: "aal1", iat: agora, exp: agora + 3600 })}.assinatura`;
  };
  const claimsDe = (req) => {
    const h = req.headers.authorization || "";
    const t = h.replace(/^Bearer\s+/i, "");
    const partes = t.split(".");
    if (partes.length !== 3) return null;
    try { return JSON.parse(Buffer.from(partes[1], "base64url").toString()); } catch { return null; }
  };

  async function tiposDe(fn) {
    const r = await db.query(
      `select unnest(proargnames) as nome, unnest(proargtypes::regtype[]::text[]) as tipo from pg_proc
        where proname = $1 and pronamespace = 'public'::regnamespace`, [fn]);
    return new Map(r.rows.map((x) => [x.nome, x.tipo]));
  }

  async function rpc(fn, args, claims) {
    if (!/^[a-z_0-9]+$/.test(fn)) return { status: 404, body: { message: "função desconhecida" } };
    const tipos = await tiposDe(fn);
    const nomes = Object.keys(args || {});
    for (const n of nomes) if (!tipos.has(n)) return { status: 404, body: { code: "PGRST202", message: `sem parâmetro ${n}` } };
    const valores = [];
    const lista = nomes.map((n, i) => {
      const tipo = tipos.get(n);
      const v = args[n];
      if (tipo === "jsonb" || tipo === "json") valores.push(v === null ? null : JSON.stringify(v));
      else if (tipo.endsWith("[]")) valores.push(v === null ? null : JSON.stringify(v));
      else valores.push(v === null || v === undefined ? null : String(v));
      const conv = tipo.endsWith("[]") ? `(select array_agg(x) from jsonb_array_elements_text($${i + 1}::jsonb) x)::${tipo}` : `$${i + 1}::${tipo}`;
      return `${n} => ${conv}`;
    });
    const papel = claims ? "authenticated" : "anon";
    try {
      const r = await db.transaction(async (tx) => {
        await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims || { role: "anon" })]);
        await tx.query(`set local role ${papel}`);
        return (await tx.query(`select public.${fn}(${lista.join(", ")}) as r`, valores)).rows;
      });
      return { status: 200, body: r[0] ? r[0].r : null };
    } catch (e) {
      const negado = /permission denied|só administrador|computador/i.test(e.message);
      return { status: negado ? 403 : 400, body: { code: e.code || "P0001", message: e.message } };
    }
  }

  async function gerencia(metodo, rota, corpo) {
    if (metodo === "GET" && rota === "/v1/organizations") return [{ id: "org-teste", slug: "org-teste", name: "Teste" }];
    if (metodo === "GET" && rota === "/v1/projects") return [{ id: ref, ref, name: "reveza", organization_slug: "org-teste", region: "sa-east-1", status: "ACTIVE_HEALTHY" }];
    if (metodo === "GET" && rota === `/v1/projects/${ref}`) return { id: ref, ref, status: "ACTIVE_HEALTHY", region: "sa-east-1" };
    if (metodo === "POST" && rota === `/v1/projects/${ref}/database/query`) {
      estado.consultas++;
      const q = corpo.query;
      if (/create extension if not exists pg_(cron|net)|cron\.(schedule|unschedule)/.test(q)) return []; // agenda: só no Supabase
      if (corpo.parameters) return (await db.query(q, corpo.parameters)).rows;
      const r = await db.exec(q);
      const ultimo = r.filter((x) => x.fields && x.fields.length).at(-1);
      return ultimo ? ultimo.rows : [];
    }
    if (metodo === "PATCH" && rota === `/v1/projects/${ref}/config/auth`) { Object.assign(estado.authConfig, corpo); return {}; }
    if (rota === `/v1/projects/${ref}/secrets`) {
      if (metodo === "GET") return [...estado.segredos].map((name) => ({ name, value: "digest" }));
      for (const s of corpo) estado.segredos.add(s.name);
      return {};
    }
    if (metodo === "POST" && rota.startsWith(`/v1/projects/${ref}/functions/deploy`)) { estado.funcoes.push(rota); return { version: 1 }; }
    if (metodo === "GET" && rota.startsWith(`/v1/projects/${ref}/api-keys`)) return [{ name: "anon", api_key: "anon-emulador" }, { name: "service_role", api_key: "servico-emulador" }];
    return { status: 404, body: { message: `emulador: ${metodo} ${rota}` } };
  }

  async function projeto(req, metodo, rota, corpo, busca) {
    if (rota === "/auth/v1/health") return { ok: true };
    if (metodo === "POST" && rota === "/auth/v1/admin/users") {
      if (req.headers.apikey !== "servico-emulador") return { status: 401, body: { msg: "chave" } };
      const email = String(corpo.email).toLowerCase();
      if (senhas.has(email)) return { status: 422, body: { msg: "email_exists" } };
      const r = await db.query("insert into auth.users (email) values ($1) returning id", [email]);
      senhas.set(email, corpo.password);
      return { id: r.rows[0].id, email };
    }
    if (metodo === "PUT" && rota.startsWith("/auth/v1/admin/users/")) {
      const id = rota.split("/").pop();
      const r = await db.query("select email from auth.users where id = $1", [id]);
      if (!r.rows[0]) return { status: 404, body: {} };
      senhas.set(r.rows[0].email, corpo.password);
      return { id };
    }
    if (metodo === "POST" && rota === "/auth/v1/token") {
      const tipo = busca.get("grant_type");
      let email = null;
      if (tipo === "password") {
        email = String(corpo.email || "").toLowerCase();
        if (!senhas.has(email) || senhas.get(email) !== corpo.password) return { status: 400, body: { error: "invalid_grant", error_description: "Invalid login credentials", msg: "Invalid login credentials" } };
      } else if (tipo === "refresh_token") {
        email = Buffer.from(String(corpo.refresh_token || ""), "base64url").toString();
        if (!senhas.has(email)) return { status: 400, body: { error: "invalid_grant" } };
      } else return { status: 400, body: { error: "unsupported_grant_type" } };
      const u = (await db.query("select id, email from auth.users where email = $1", [email])).rows[0];
      const agora = Math.floor(Date.now() / 1000);
      return {
        access_token: token(u), token_type: "bearer", expires_in: 3600, expires_at: agora + 3600,
        refresh_token: Buffer.from(email).toString("base64url"),
        user: { id: u.id, aud: "authenticated", role: "authenticated", email: u.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
      };
    }
    if (metodo === "GET" && rota === "/auth/v1/user") {
      const c = claimsDe(req);
      return c ? { id: c.sub, email: c.email, aud: "authenticated", role: "authenticated" } : { status: 401, body: {} };
    }
    if (metodo === "POST" && rota.startsWith("/rest/v1/rpc/")) return rpc(rota.slice("/rest/v1/rpc/".length), corpo, claimsDe(req));
    return { status: 404, body: { message: `emulador: ${metodo} ${rota}` } };
  }

  function vercel(metodo, rota, corpo, req) {
    if (rota === "/v2/user") return { user: { username: "teste" } };
    if (rota === "/v2/teams") return { teams: [] };
    if (metodo === "GET" && rota.startsWith("/v9/projects/")) {
      const nome = decodeURIComponent(rota.split("/")[3]);
      const p = estado.projetosVercel.get(nome);
      return p ? { id: p.id, name: nome } : { status: 404, body: { error: { code: "not_found", message: "Project not found" } } };
    }
    if (metodo === "POST" && rota === "/v11/projects") {
      const p = { id: `prj_${randomUUID().slice(0, 8)}`, name: corpo.name };
      estado.projetosVercel.set(corpo.name, p);
      return p;
    }
    if (metodo === "POST" && rota === "/v2/files") {
      const sha = req.headers["x-vercel-digest"];
      if (createHash("sha1").update(corpo).digest("hex") !== sha) return { status: 400, body: { error: { message: "sha não bate" } } };
      estado.arquivos.set(sha, corpo.length);
      return {};
    }
    if (metodo === "POST" && rota === "/v13/deployments") {
      const faltam = corpo.files.filter((f) => !estado.arquivos.has(f.sha));
      if (faltam.length) return { status: 400, body: { error: { code: "missing_files", message: "faltam arquivos" } } };
      const d = { id: `dpl_${estado.implantacoes.length + 1}`, url: `${corpo.name}-abc.vercel.app`, alias: [`${corpo.name}.vercel.app`], readyState: "READY", files: corpo.files.map((f) => f.file) };
      estado.implantacoes.push(d);
      return { id: d.id, url: d.url, readyState: "QUEUED" };
    }
    if (metodo === "GET" && rota.startsWith("/v13/deployments/")) {
      const d = estado.implantacoes.find((x) => x.id === rota.split("/")[3]);
      return d || { status: 404, body: {} };
    }
    return { status: 404, body: { error: { message: `emulador: ${metodo} ${rota}` } } };
  }

  const servidor = createServer((req, res) => {
    const pedacos = [];
    req.on("data", (c) => pedacos.push(c));
    req.on("end", () => emFila(async () => {
      const bruto = Buffer.concat(pedacos);
      const u = new URL(req.url, "http://emulador");
      const [, prefixo, ...resto] = u.pathname.split("/");
      const rota = "/" + resto.join("/");
      const ehArquivo = prefixo === "vercel" && rota === "/v2/files";
      let corpo = null;
      if (!ehArquivo && bruto.length) { try { corpo = JSON.parse(bruto.toString()); } catch { corpo = bruto.toString(); } }
      let r;
      try {
        if (prefixo === "mgmt") r = await gerencia(req.method, rota, corpo);
        else if (prefixo === "proj") r = await projeto(req, req.method, rota, corpo, u.searchParams);
        else if (prefixo === "vercel") r = vercel(req.method, rota, ehArquivo ? bruto : corpo, req);
        else if (prefixo === "dns") r = { Answer: [] };
        else if (prefixo === "teste" && rota === "/sql") r = (await db.query(corpo.sql, corpo.params || [])).rows;
        else r = { status: 404, body: { message: "emulador: prefixo desconhecido" } };
      } catch (e) {
        console.error(`emulador: ${req.method} ${req.url}: ${e.message}`);
        r = { status: 500, body: { message: e.message } };
      }
      const status = r && typeof r === "object" && !Array.isArray(r) && r.status && r.body !== undefined ? r.status : 200;
      const body = status !== 200 || (r && r.body !== undefined && r.status) ? r.body : r;
      res.writeHead(status, { "Content-Type": "application/json", Connection: "close" });
      res.end(JSON.stringify(body ?? null));
    }));
  });
  servidor.on("clientError", (e, sock) => {
    console.error(`emulador: pedido mal formado (${e.code || e.message})`);
    sock.destroy();
  });
  await new Promise((ok) => servidor.listen(porta, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${servidor.address().port}`;
  return { url, ref, db, estado, fechar: () => new Promise((ok) => servidor.close(ok)) };
}

// Chamado direto (e não importado)? Pelo caminho de verdade dos dois lados: a comparação de import.meta.url com
// `file://${argv[1]}` falhava calada no Windows e em pasta com espaço ou acento, e o script saía sem fazer nada.
function chamadoDireto() {
  try {
    return !!process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (chamadoDireto()) {
  const e = await iniciarEmulador({ porta: Number(process.argv[2] || 0) });
  console.log(e.url);
}
