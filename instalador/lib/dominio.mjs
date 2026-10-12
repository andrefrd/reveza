// Domínio próprio do painel: validação, o passo a passo na Cloudflare e a conferência do DNS (por DNS sobre HTTPS).

export function dominioValido(d) {
  const s = String(d || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(s)) return null;
  return s;
}

/** Texto que guia a pessoa na Cloudflare (ou em outro provedor) para criar o registro que a Vercel pede. */
export function passosCloudflare(registro, t) {
  const r = registro;
  return [
    t("No painel da Cloudflare, abra o domínio e vá em DNS → Records → Add record:", "In the Cloudflare dashboard, open the domain and go to DNS → Records → Add record:"),
    `    ${t("Tipo", "Type")}: ${r.tipo}    ${t("Nome", "Name")}: ${r.nome}    ${t("Conteúdo", "Target")}: ${r.valor}`,
    t("    Proxy: desligado (nuvem cinza, \"DNS only\"). A Vercel emite o certificado; com a nuvem laranja ele não sai.",
      "    Proxy: off (grey cloud, \"DNS only\"). Vercel issues the certificate; with the orange cloud it cannot."),
    t("    Salve. Em outro provedor de DNS, o registro é o mesmo.", "    Save. With another DNS provider, the record is the same."),
  ];
}

/** O registro já responde como a Vercel pede? (consulta pública na Cloudflare, sem depender do DNS do computador) */
export async function dnsPronto(dominio, registro, { fetch: f = globalThis.fetch } = {}) {
  const tipo = registro.tipo === "A" ? "A" : "CNAME";
  try {
    const r = await f(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(dominio)}&type=${tipo}`, {
      headers: { accept: "application/dns-json" },
    });
    if (!r.ok) return false;
    const d = await r.json();
    const respostas = (d.Answer || []).map((a) => String(a.data).replace(/\.$/, "").toLowerCase());
    return respostas.includes(String(registro.valor).replace(/\.$/, "").toLowerCase());
  } catch {
    return false;
  }
}
