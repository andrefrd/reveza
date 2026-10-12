// Rótulos para a tela montados só com campos que não são segredo.

/** Rótulo do destino de um alerta só com campos que não são segredo (token e senha nunca aparecem). */
export function rotuloDestino(canal: string, destino: Record<string, unknown>): string {
  const s = (k: string) => (typeof destino[k] === "string" ? (destino[k] as string) : "")
  if (canal === "telegram") return s("chat_id") ? `chat ${s("chat_id")}` : "Telegram"
  // no ntfy o tópico é o segredo (quem sabe o tópico lê as mensagens): aparece só o servidor
  if (canal === "ntfy") return (s("servidor") || "https://ntfy.sh").replace(/^https?:\/\//, "").replace(/\/$/, "")
  if (canal === "email") return s("para")
  if (canal === "webhook") {
    try {
      const u = new URL(s("url"))
      return `${u.host}${u.pathname}`
    } catch {
      return ""
    }
  }
  return ""
}
