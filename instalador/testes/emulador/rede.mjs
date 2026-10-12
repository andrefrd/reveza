// Carregado com `node --import` (também nos processos filhos, por NODE_OPTIONS): manda ao emulador tudo o que iria ao
// Supabase, à Vercel e ao DNS. O resto (o registro do npm, por exemplo) segue para a rede de verdade.
const base = process.env.REVEZA_EMULADOR;
if (!base) throw new Error("REVEZA_EMULADOR não definido");
const original = globalThis.fetch;

function desviar(url) {
  if (url.startsWith("https://api.supabase.com/")) return `${base}/mgmt/${url.slice("https://api.supabase.com/".length)}`;
  const p = url.match(/^https:\/\/[a-z0-9]{20}\.supabase\.co\/(.*)$/);
  if (p) return `${base}/proj/${p[1]}`;
  if (url.startsWith("https://api.vercel.com/")) return `${base}/vercel/${url.slice("https://api.vercel.com/".length)}`;
  if (url.startsWith("https://cloudflare-dns.com/")) return `${base}/dns/${url.slice("https://cloudflare-dns.com/".length)}`;
  if (/^https:\/\/(api\.telegram\.org|api\.resend\.com)\//.test(url)) return `${base}/bloqueado`;
  return null;
}

globalThis.fetch = async (entrada, init) => {
  const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
  const novo = desviar(url);
  if (!novo) return original(entrada, init);
  if (typeof entrada === "string" || entrada instanceof URL) return original(novo, init);
  return original(new Request(novo, entrada), init);
};
