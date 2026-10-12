// Testes das Edge Functions no Node (node --experimental-strip-types), com o Supabase e os canais falsos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv, createECDH, createHmac, createVerify, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";
import * as api from "../api/index.ts";
import * as convite from "../convite/index.ts";
import * as pc from "../computador-novo/index.ts";
import * as alertas from "../alertas/index.ts";

function jwt(carga) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "HS256" })}.${b(carga)}.assinatura`;
}

function supabaseFalso(rotas) {
  const chamadas = [];
  const f = async (url, init = {}) => {
    const corpo = init.body && typeof init.body === "string" ? (() => { try { return JSON.parse(init.body); } catch { return init.body; } })() : init.body;
    chamadas.push({ url, metodo: init.method ?? "GET", corpo, headers: init.headers ?? {} });
    for (const [padrao, resp] of rotas) {
      if (url.includes(padrao)) {
        const r = typeof resp === "function" ? resp(corpo, init) : resp;
        return new Response(JSON.stringify(r.body ?? r), { status: r.status ?? 200 });
      }
    }
    return new Response(JSON.stringify({ message: "nao esperado " + url }), { status: 500 });
  };
  return { amb: { url: "https://ref.supabase.co", anon: "anon", servico: "SERVICO", fetch: f }, chamadas };
}

const CHAVE = "rvz_abc123_" + "a".repeat(64);
const req = (url, init = {}) => new Request(url, init);

test("API: sem chave, chave inválida e escopo faltando", async () => {
  const { amb } = supabaseFalso([["api_conferir_chave", { ok: true, user_id: "u1", escopos: ["ler"] }], ["api_estado", { contas: [] }]]);
  assert.equal((await api.tratar(req("https://x/functions/v1/api/estado"), amb)).status, 401);
  assert.equal((await api.tratar(req("https://x/functions/v1/api/estado", { headers: { authorization: "Bearer rvz_x" } }), amb)).status, 401);
  const ok = await api.tratar(req("https://x/functions/v1/api/estado", { headers: { authorization: `Bearer ${CHAVE}` } }), amb);
  assert.equal(ok.status, 200);
  const troca = await api.tratar(req("https://x/functions/v1/api/trocar", { method: "POST", headers: { authorization: `Bearer ${CHAVE}` }, body: "{}" }), amb);
  assert.equal(troca.status, 403);
  assert.equal(api.rota("https://x/functions/v1/api/estado/"), "/estado");
});

test("API: chave revogada não passa", async () => {
  const { amb } = supabaseFalso([["api_conferir_chave", { ok: false }]]);
  assert.equal((await api.tratar(req("https://x/api/estado", { headers: { authorization: `Bearer ${CHAVE}` } }), amb)).status, 401);
});

test("convite: envia como o administrador e o link leva um token de 64 hex", async () => {
  const token = jwt({ sub: "admin1", aal: "aal2" });
  const { amb, chamadas } = supabaseFalso([
    ["/auth/v1/user", { id: "admin1", email: "admin@exemplo.com" }],
    ["painel_convidar", { ok: true }],
    ["/auth/v1/invite", {}],
  ]);
  const r = await convite.tratar(req("https://x/convite", { method: "POST", headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ acao: "enviar", email: "Nova@Exemplo.com", papel: "leitura" }) }), amb, "https://painel.exemplo.com");
  assert.equal(r.status, 200);
  const rpcConvite = chamadas.find((c) => c.url.includes("painel_convidar"));
  assert.equal(rpcConvite.headers.Authorization, `Bearer ${token}`, "chama o banco como o administrador");
  assert.match(rpcConvite.corpo.p_token_hash, /^[0-9a-f]{64}$/);
  const inv = chamadas.find((c) => c.url.includes("/auth/v1/invite"));
  assert.equal(inv.corpo.email, "nova@exemplo.com");
  assert.match(inv.corpo.redirect_to, /^https:\/\/painel\.exemplo\.com\/aceitar\?convite=[0-9a-f]{64}$/);
});

test("convite: sem login 401; aceitar com convite mal formado 400", async () => {
  const { amb } = supabaseFalso([["/auth/v1/user", { status: 401, body: {} }]]);
  assert.equal((await convite.tratar(req("https://x", { method: "POST", body: "{}" }), amb, "https://p")).status, 401);
  const { amb: amb2 } = supabaseFalso([["/auth/v1/user", { id: "u", email: "u@exemplo.com" }]]);
  const r = await convite.tratar(req("https://x", { method: "POST", headers: { authorization: `Bearer ${jwt({ sub: "u" })}` },
    body: JSON.stringify({ acao: "aceitar", convite: "abc" }) }), amb2, "https://p");
  assert.equal(r.status, 400);
});

test("computador novo: só administrador com duas etapas", async () => {
  const semAal2 = supabaseFalso([["/auth/v1/user", { id: "a", email: "a@exemplo.com" }], ["servico_papel", "admin"]]);
  assert.equal((await pc.tratar(req("https://x", { method: "POST", headers: { authorization: `Bearer ${jwt({ sub: "a", aal: "aal1" })}` } }), semAal2.amb)).status, 403);
  const leitor = supabaseFalso([["/auth/v1/user", { id: "l", email: "l@exemplo.com" }], ["servico_papel", "leitura"]]);
  assert.equal((await pc.tratar(req("https://x", { method: "POST", headers: { authorization: `Bearer ${jwt({ sub: "l", aal: "aal2" })}` } }), leitor.amb)).status, 403);
  const ok = supabaseFalso([["/auth/v1/user", { id: "a", email: "a@exemplo.com" }], ["servico_papel", "admin"],
    ["/auth/v1/admin/users", { id: "11111111-2222-3333-4444-555555555555" }], ["servico_registrar_computador", { ok: true }]]);
  const r = await pc.tratar(req("https://x", { method: "POST", headers: { authorization: `Bearer ${jwt({ sub: "a", aal: "aal2" })}` } }), ok.amb);
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.match(d.email, /@computadores\.reveza\.invalid$/);
  assert.ok(d.senha.length >= 40);
  assert.ok(ok.chamadas.some((c) => c.url.includes("servico_registrar_computador") && c.corpo.p_criado_por === "a"));
});

test("alertas: sem o segredo do cron, 401", async () => {
  const { amb } = supabaseFalso([]);
  const r = await alertas.tratar(req("https://x", { method: "POST", headers: { "x-reveza-cron": "errado" }, body: JSON.stringify({ acao: "enviar" }) }), amb, "certo".repeat(8));
  assert.equal(r.status, 401);
});

test("alertas: envia ao telegram e ao webhook assinado só o que cada um quer", async () => {
  const segredoCron = "c".repeat(64);
  const { amb, chamadas } = supabaseFalso([
    ["rpc/vigiar", 0],
    ["alertas_pendentes", {
      eventos: [{ id: 1, tipo: "alerta", texto: "Nenhuma conta livre.", dados: { motivo: "sem_livre" } },
                { id: 2, tipo: "troca", texto: "Troca: a → b.", dados: {} }],
      canais: [{ id: "t1", canal: "telegram", destino: { chat_id: "99" }, tem_segredo: true, eventos: ["sem_livre"] }],
      webhooks: [{ id: "w1", url: "https://n8n.exemplo.com/hook", eventos: ["troca"] }],
    }],
    ["servico_segredo_alerta", "TOKEN-BOT"],
    ["servico_segredo_webhook", "segredo-do-webhook"],
    ["api.telegram.org", { ok: true }],
    ["n8n.exemplo.com", { ok: true }],
  ]);
  const r = await alertas.tratar(req("https://x", { method: "POST", headers: { "x-reveza-cron": segredoCron }, body: JSON.stringify({ acao: "enviar" }) }), amb, segredoCron);
  const d = await r.json();
  assert.deepEqual(d, { ok: true, eventos: 2, envios: 2 });
  const tg = chamadas.find((c) => c.url.includes("api.telegram.org"));
  assert.equal(tg.url, "https://api.telegram.org/botTOKEN-BOT/sendMessage");
  assert.equal(tg.corpo.chat_id, "99");
  const wh = chamadas.find((c) => c.url.includes("n8n.exemplo.com"));
  assert.equal(wh.corpo.evento, "troca");
  const esperado = "sha256=" + createHmac("sha256", "segredo-do-webhook").update(JSON.stringify(wh.corpo)).digest("hex");
  assert.equal(wh.headers["X-Reveza-Assinatura"], esperado);
});

test("VAPID: o JWT é ES256 válido para a chave pública", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const t = await alertas.vapidJwt("https://push.exemplo.com/abc", privateKey.export({ format: "jwk" }), "mailto:a@exemplo.com");
  const [cab, carga, assin] = t.split(".");
  assert.equal(JSON.parse(Buffer.from(carga, "base64url")).aud, "https://push.exemplo.com");
  const v = createVerify("SHA256");
  v.update(`${cab}.${carga}`);
  assert.ok(v.verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(assin, "base64url")));
});

test("resumo do dia em texto", () => {
  const t = alertas.textoResumo({ usd: 1234.5, trocas: 3, agentes: 7, contas: [{ email: "a@exemplo.com", pct: 42.4 }, { email: "b@exemplo.com", pct: null }] });
  assert.match(t, /US\$ 1\.234,50/);
  assert.match(t, /a@exemplo\.com: 42%/);
  assert.match(t, /b@exemplo\.com: sem leitura/);
});

test("urlExterna: só https público, sem IP escrito, porta estranha ou usuário na URL", async () => {
  const { urlExterna } = await import("../_comum/comum.ts");
  for (const ok of ["https://hook.exemplo.com/x", "https://fcm.googleapis.com", "https://a.b.exemplo.com:443/p?q=1"]) assert.ok(urlExterna(ok), ok);
  for (const ruim of ["http://hook.exemplo.com", "https://127.0.0.1/", "https://169.254.169.254/latest", "https://0x7f.1/", "https://2130706433/",
    "https://localhost/", "https://db.internal/", "https://x.exemplo.com:8080/", "https://u@x.exemplo.com/", "https://[::1]/", "https://semponto/",
    // o parser de URL do fetch transforma estes em 127.0.0.1 (auditoria de 11/10/2026)
    "https://127.0.0%2e1/x", "https://127.0.0\u30021/x", "https://127%2E0%2E0%2E1/", "https://exemplo..com/", "https://.exemplo.com/", "https://127.0.0.1\\a.exemplo.com/x"]) {
    assert.ok(!urlExterna(ruim), ruim);
  }
});

test("alertas: webhook com endereço interno não é chamado; o canal ntfy (que saiu) não manda nada", async () => {
  const { amb, chamadas } = supabaseFalso([["169.254", {}], ["127.0.0.1", {}], ["ntfy.sh", {}]]);
  assert.equal(await alertas.enviarCanal(amb, { id: "1", canal: "ntfy", destino: { servidor: "https://ntfy.sh" }, tem_segredo: false, eventos: [] }, "t", "x", amb.fetch), false);
  assert.equal(await alertas.enviarCanal(amb, { id: "2", canal: "webhook", destino: { url: "https://127.0.0.1/x" }, tem_segredo: false, eventos: [] }, "t", "x", amb.fetch), false);
  assert.equal(chamadas.length, 0);
});

// Web Push cifrado (RFC 8291): o exemplo do apêndice A da RFC, byte a byte.
const RFC8291 = {
  texto: "When I grow up, I want to be a watermelon",
  asPrivada: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublica: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  uaPublica: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  sal: "DGv6ra1nlYgDCS1FRnbzlw",
  corpo: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

test("push: o texto vai cifrado como a RFC 8291 manda (exemplo da RFC, byte a byte)", async () => {
  const pub = Buffer.from(RFC8291.asPublica, "base64url");
  const jwk = { kty: "EC", crv: "P-256", d: RFC8291.asPrivada, x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") };
  const privada = await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const corpo = await alertas.cifrarPush(RFC8291.texto, RFC8291.uaPublica, RFC8291.auth, {
    privada, publica: new Uint8Array(pub), sal: new Uint8Array(Buffer.from(RFC8291.sal, "base64url")),
  });
  assert.equal(Buffer.from(corpo).toString("base64url"), RFC8291.corpo);
});

/** O que o navegador faz ao receber: decifra com a chave dele (implementação à parte, só com node:crypto). */
function decifrarComoNavegador(corpo, uaEcdh, auth) {
  const b = Buffer.from(corpo);
  const sal = b.subarray(0, 16), idlen = b[20], asPublica = b.subarray(21, 21 + idlen), cifrado = b.subarray(21 + idlen);
  const ecdh = uaEcdh.computeSecret(asPublica);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), uaEcdh.getPublicKey(), asPublica]);
  const ikm = Buffer.from(hkdfSync("sha256", ecdh, auth, info, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, sal, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, sal, Buffer.from("Content-Encoding: nonce\0"), 12));
  const d = createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(cifrado.subarray(cifrado.length - 16));
  const claro = Buffer.concat([d.update(cifrado.subarray(0, cifrado.length - 16)), d.final()]);
  assert.equal(claro[claro.length - 1], 2, "delimitador do último registro");
  return claro.subarray(0, claro.length - 1).toString("utf8");
}

test("push: cada aparelho inscrito recebe o aviso cifrado só para ele; inscrição vencida sai da tabela", async () => {
  const vapid = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const env = new Map([
    ["VAPID_PUBLICA", Buffer.from(vapid.publicKey.export({ format: "jwk" }).x, "base64url").toString("base64url")],
    ["VAPID_PRIVADA", JSON.stringify(vapid.privateKey.export({ format: "jwk" }))],
  ]);
  globalThis.Deno = { env: { get: (k) => env.get(k) } };
  try {
    const ua = createECDH("prime256v1");
    ua.generateKeys();
    const auth = randomBytes(16);
    const { amb, chamadas } = supabaseFalso([
      ["/rest/v1/push_inscricoes?select", [
        { id: "i1", endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: ua.getPublicKey().toString("base64url"), auth: auth.toString("base64url") },
        { id: "i2", endpoint: "https://web.push.apple.com/vencida", p256dh: ua.getPublicKey().toString("base64url"), auth: auth.toString("base64url") },
        { id: "i3", endpoint: "https://127.0.0.1/interno", p256dh: "x", auth: "y" },
      ]],
      ["fcm.googleapis.com", { status: 201, body: {} }],
      ["web.push.apple.com", { status: 410, body: {} }],
      ["push_inscricoes?id=eq.i2", { status: 204, body: {} }],
    ]);
    const aceitos = await alertas.enviarPush(amb, amb.fetch, "Reveza AI", "Mac mini: bia → ana (limiar)");
    assert.equal(aceitos, 1);
    const envio = chamadas.find((c) => c.url.includes("fcm.googleapis.com"));
    assert.equal(envio.headers["Content-Encoding"], "aes128gcm");
    assert.match(envio.headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
    const aviso = JSON.parse(decifrarComoNavegador(envio.corpo, ua, auth));
    assert.deepEqual(aviso, { titulo: "Reveza AI", corpo: "Mac mini: bia → ana (limiar)", url: "/" });
    assert.ok(chamadas.some((c) => c.metodo === "DELETE" && c.url.includes("id=eq.i2")), "a inscrição vencida sai");
    assert.ok(!chamadas.some((c) => c.url.includes("127.0.0.1")), "endereço interno não é chamado");
  } finally {
    delete globalThis.Deno;
  }
});

test("push: o aviso é cortado para caber nos 4 KB do serviço de push", () => {
  const aviso = alertas.avisoPush("Reveza AI", "x".repeat(10_000));
  assert.ok(Buffer.byteLength(aviso) <= alertas.MAX_AVISO);
  assert.match(JSON.parse(aviso).corpo, /…$/);
});

test("alertas: testar o push sem nenhum aparelho inscrito diz o que fazer", async () => {
  globalThis.Deno = { env: { get: (k) => ({ VAPID_PUBLICA: "p", VAPID_PRIVADA: "{}" })[k] } };
  try {
    const token = jwt({ sub: "a1", aal: "aal2" });
    const { amb } = supabaseFalso([
      ["/auth/v1/user", { id: "a1", email: "a@exemplo.com" }],
      ["servico_papel", "admin"],
      ["rpc/alertas_pendentes", { eventos: [], canais: [{ id: "p1", canal: "push", destino: {}, tem_segredo: false, eventos: ["troca"] }], webhooks: [] }],
      ["/rest/v1/push_inscricoes", []],
    ]);
    const r = await alertas.tratar(req("https://x", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ acao: "testar", alerta_id: "p1" }) }), amb, "c".repeat(64));
    assert.equal(r.status, 502);
    assert.match((await r.json()).erro, /nenhum aparelho/);
  } finally {
    delete globalThis.Deno;
  }
});

test("API: erro do banco não vai cru para quem chama", async () => {
  const { amb } = supabaseFalso([
    ["api_conferir_chave", { ok: true, user_id: "u1", escopos: ["trocar"] }],
    ["api_trocar", { status: 400, body: { message: "detalhe interno da tabela public.atribuicao" } }],
  ]);
  const r = await api.tratar(req("https://x/functions/v1/api/trocar", { method: "POST", headers: { authorization: `Bearer ${CHAVE}` }, body: "{}" }), amb);
  const d = await r.json();
  assert.ok(!JSON.stringify(d).includes("atribuicao"));
});

test("alertas: testar webhook assina e manda; leitor ou sem duas etapas não", async () => {
  const token = jwt({ sub: "a1", aal: "aal2" });
  const { amb, chamadas } = supabaseFalso([
    ["/auth/v1/user", { id: "a1", email: "a@exemplo.com" }],
    ["servico_papel", "admin"],
    ["rpc/servico_webhook", { id: "w1", url: "https://n8n.exemplo.com/hook", ativo: true, tem_segredo: true }],
    ["servico_segredo_webhook", "segredo-w"],
    ["n8n.exemplo.com", {}],
  ]);
  const r = await alertas.tratar(req("https://x", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ acao: "testar_webhook", webhook_id: "w1" }) }), amb, "c".repeat(64));
  assert.equal(r.status, 200);
  const w = chamadas.find((c) => c.url.includes("n8n.exemplo.com"));
  assert.equal(w.headers["X-Reveza-Assinatura"], "sha256=" + createHmac("sha256", "segredo-w").update(JSON.stringify(w.corpo)).digest("hex"));
  const leitor = supabaseFalso([["/auth/v1/user", { id: "l", email: "l@exemplo.com" }], ["servico_papel", "leitura"]]);
  const r2 = await alertas.tratar(req("https://x", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ acao: "testar_webhook", webhook_id: "w1" }) }), leitor.amb, "c".repeat(64));
  assert.equal(r2.status, 403);
});

test("CORS: o painel consegue chamar (consulta prévia 204 sem corpo, CORS só para a origem do painel)", async () => {
  const { comCors, resposta } = await import("../_comum/comum.ts");
  assert.equal(resposta({}, 204).status, 204); // 204 com corpo quebrava a função (500)
  const site = "https://painel.exemplo";
  const h = comCors(async () => resposta({ ok: true }), site);
  const pre = await h(req("https://x/functions/v1/convite", { method: "OPTIONS", headers: { origin: site } }));
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), site);
  assert.match(pre.headers.get("access-control-allow-headers"), /authorization/);
  assert.equal(await pre.text(), "");
  const post = await h(req("https://x/functions/v1/convite", { method: "POST", headers: { origin: site }, body: "{}" }));
  assert.equal(post.headers.get("access-control-allow-origin"), site);
  assert.deepEqual(await post.json(), { ok: true });
  const outro = await h(req("https://x/functions/v1/convite", { method: "OPTIONS", headers: { origin: "https://malicioso.exemplo" } }));
  assert.equal(outro.headers.get("access-control-allow-origin"), null);
});

test("CORS: toda função que o painel chama passa pelo comCors", async () => {
  const { readFileSync, readdirSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const raiz = new URL("../../../painel/src", import.meta.url).pathname;
  const chamadas = new Set();
  const varrer = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) varrer(p);
      else if (/\.(ts|tsx)$/.test(n) && !/\.test\./.test(n)) {
        for (const m of readFileSync(p, "utf8").matchAll(/functions\.invoke<[^>]*>\(\s*"([a-z-]+)"|functions\.invoke\(\s*"([a-z-]+)"/g)) chamadas.add(m[1] ?? m[2]);
      }
    }
  };
  varrer(raiz);
  assert.ok(chamadas.size >= 3, `achou ${[...chamadas]}`);
  for (const f of chamadas) {
    const fonte = readFileSync(new URL(`../${f}/index.ts`, import.meta.url), "utf8");
    assert.match(fonte, /Deno\.serve\(comCors\(/, `a função ${f} é chamada pelo navegador e não responde ao CORS`);
  }
});

test("alertas: um destino que cai não derruba os outros nem o resto do lote", async () => {
  const recebidos = [];
  const { amb } = supabaseFalso([
    ["rpc/alertas_pendentes", {
      eventos: [{ id: 1, tipo: "troca", texto: "um", dados: {} }, { id: 2, tipo: "troca", texto: "dois", dados: {} }],
      canais: [{ id: "c1", canal: "webhook", destino: { url: "https://cai.exemplo.com/x" }, tem_segredo: false, eventos: ["troca"] },
               { id: "c2", canal: "telegram", destino: { chat_id: "123" }, tem_segredo: false, eventos: ["troca"] }],
      webhooks: [{ id: "w1", url: "https://cai.exemplo.com/w", eventos: ["*"] }, { id: "w2", url: "https://hook.exemplo.com/w", eventos: ["*"] }],
    }],
    ["servico_segredo_webhook", "s"],
  ]);
  const f = async (url, init = {}) => {
    if (url.includes("cai.exemplo.com")) throw new TypeError("dns error: failed to lookup address");
    if (url.includes("api.telegram.org") || url.includes("hook.exemplo.com")) { recebidos.push(url); return new Response("ok"); }
    return amb.fetch(url, init);
  };
  const r = await alertas.enviarPendentes({ ...amb, fetch: f }, f);
  assert.equal(r.eventos, 2);
  // por evento: o Telegram e o webhook que responde; o destino que cai só perde o dele
  assert.equal(r.envios, 4);
  assert.equal(recebidos.length, 4);
});
