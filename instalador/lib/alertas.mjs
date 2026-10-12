// Canais de alerta: o instalador ajuda a configurar e manda uma mensagem de teste ANTES de salvar.
// O envio de verdade é da Edge Function `alertas`; aqui é o mesmo formato, para o teste provar o canal.
import { randomBytes, createHmac } from "node:crypto";

export const CANAIS = ["telegram", "ntfy", "email", "webhook"];

/** Telegram: depois de a pessoa mandar qualquer mensagem ao bot, o chat dela aparece em getUpdates. */
export async function acharChatTelegram(token, { fetch: f = globalThis.fetch } = {}) {
  if (!/^\d{5,}:[\w-]{30,}$/.test(token)) throw new Error("token do bot com formato estranho (o @BotFather mostra algo como 123456:ABC...)");
  const r = await f(`https://api.telegram.org/bot${token}/getUpdates`);
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.ok) throw new Error("o Telegram recusou o token do bot");
  const chats = [];
  for (const u of d.result || []) {
    const c = (u.message || u.channel_post || u.my_chat_member || {}).chat;
    if (c && !chats.some((x) => x.id === String(c.id))) chats.push({ id: String(c.id), nome: c.title || [c.first_name, c.last_name].filter(Boolean).join(" ") || c.username || String(c.id) });
  }
  return chats;
}

export const topicoNtfy = () => `reveza-${randomBytes(12).toString("hex")}`;

/** Manda a mensagem de teste pelo canal. Devolve { ok, erro }. */
export async function testar(canal, destino, segredo, { fetch: f = globalThis.fetch, titulo = "Reveza AI · teste", texto = "Se chegou, o canal está certo." } = {}) {
  let r;
  try {
    if (canal === "telegram") {
      r = await f(`https://api.telegram.org/bot${segredo}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: destino.chat_id, text: `${titulo}\n${texto}` }),
      });
    } else if (canal === "ntfy") {
      const servidor = String(destino.servidor || "https://ntfy.sh").replace(/\/+$/, "");
      if (!/^https:\/\//.test(servidor)) return { ok: false, erro: "o servidor do ntfy precisa ser https" };
      r = await f(`${servidor}/${encodeURIComponent(segredo)}`, { method: "POST", headers: { Title: titulo }, body: texto });
    } else if (canal === "email") {
      r = await f("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${segredo}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: destino.de, to: [destino.para], subject: titulo, text: texto }),
      });
    } else if (canal === "webhook") {
      if (!/^https:\/\/[^\s/]+/.test(destino.url || "")) return { ok: false, erro: "o endereço do webhook precisa ser https" };
      const corpo = JSON.stringify({ titulo, texto, em: new Date().toISOString() });
      const assinatura = "sha256=" + createHmac("sha256", segredo).update(corpo).digest("hex");
      r = await f(destino.url, { method: "POST", headers: { "Content-Type": "application/json", "X-Reveza-Assinatura": assinatura }, body: corpo, redirect: "manual" });
    } else return { ok: false, erro: "canal desconhecido" };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
  if (r.ok) return { ok: true };
  const corpo = await r.text().catch(() => "");
  return { ok: false, erro: `${r.status} ${corpo.slice(0, 160)}`.trim() };
}

export const segredoWebhook = () => randomBytes(32).toString("hex");
