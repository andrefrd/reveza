#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
// Trava do repositório público: recusa commit que leve segredo, dado pessoal ou componente do React Bits.
//
// - Segredo: chaves de serviço, tokens, chaves privadas, arquivos .env.
// - Dado pessoal: nomes e domínios de quem mantém o projeto (o repositório não leva conta de ninguém).
// - React Bits: a licença (MIT + Commons Clause) não deixa redistribuir; o instalador baixa na máquina de quem usa.
//
// Uso: node scripts/trava.mjs [--todos | --historia]   (sem argumento: os arquivos preparados para o commit;
//      --historia: tudo que um push leva, toda versão de arquivo e toda mensagem de commit)
// Ligar num clone: git config core.hooksPath .githooks

import { execFileSync } from "node:child_process";

export const SEGREDOS = [
  [/sk-ant-[a-z0-9]{2,}-[A-Za-z0-9_-]{20,}/, "token de conta do assistente"],
  [/\bsbp_[a-f0-9]{40}\b/, "token de acesso do Supabase"],
  [/\bsb_secret_[A-Za-z0-9_-]{20,}/, "chave secreta do Supabase"],
  [/\brbp[spu]-[a-f0-9-]{20,}/, "licença do React Bits"],
  [/\bcfat_[A-Za-z0-9_-]{20,}|\bcfut_[A-Za-z0-9_-]{20,}/, "token da Cloudflare"],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}/, "token do GitHub"],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/, "token do Slack"],
  [/\bAKIA[0-9A-Z]{16}\b/, "chave da AWS"],
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, "chave privada"],
  [/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]*c2VydmljZV9yb2xl[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{10,}/, "JWT de service_role"],
  [/\bvck_[A-Za-z0-9]{20,}|\bVERCEL_TOKEN\s*=\s*\S{10,}/, "token da Vercel"],
];

export const PESSOAIS = [/paulosdantas/i, /chatadv/i, /postadv/i, /deltaacademy/i, /qwize/i, /revizia/i];

const ARQUIVO_PROIBIDO = /(^|\/)(\.env(\.[^/]*)?|id_rsa|id_ed25519|.*\.pem|.*\.p12|.*\.pfx|.*\.key)$/;
const ENV_EXEMPLO = /(^|\/)\.env\.(exemplo|example)$/;
const REACT_BITS = /(^|\/)react-bits\//i;
const ISENTOS = /^scripts\/trava(\.test)?\.mjs$/; // a própria trava descreve os padrões

// O README pode ter o bloco "Quem fez" (como o do Claquete), com o site e os perfis públicos de quem mantém o projeto:
// só esse trecho, entre os marcadores, fica fora da regra de dado pessoal. Segredo continua valendo nele.
const QUEM_FEZ = /<!-- quem-fez -->[\s\S]*?<!-- \/quem-fez -->/g;
const README = /^README(\.[a-z]{2})?\.md$/;

export function problemas(caminho, conteudo) {
  const achados = [];
  if (ARQUIVO_PROIBIDO.test(caminho) && !ENV_EXEMPLO.test(caminho)) achados.push("arquivo de segredo");
  if (REACT_BITS.test(caminho)) achados.push("componente do React Bits (é baixado na instalação, não versionado)");
  if (ISENTOS.test(caminho) || conteudo === null) return achados;
  for (const [padrao, nome] of SEGREDOS) if (padrao.test(conteudo)) achados.push(nome);
  const semQuemFez = README.test(caminho) ? conteudo.replace(QUEM_FEZ, "") : conteudo;
  for (const padrao of PESSOAIS) if (padrao.test(semQuemFez) || padrao.test(caminho)) achados.push(`dado pessoal (${padrao.source})`);
  return achados;
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function conteudoPreparado(caminho, todos) {
  try {
    const buf = execFileSync("git", ["show", `${todos ? "HEAD" : ""}:${caminho}`], { maxBuffer: 64 * 1024 * 1024 });
    return buf.includes(0) ? null : buf.toString("utf8"); // binário: só o nome conta
  } catch {
    return null;
  }
}

/** Todo blob de toda a história (o que vai junto num push) e toda mensagem de commit. */
export function historia() {
  const lista = git("rev-list", "--objects", "--all").split("\n").filter(Boolean)
    .map((l) => { const i = l.indexOf(" "); return i < 0 ? null : { sha: l.slice(0, i), caminho: l.slice(i + 1) }; })
    .filter(Boolean);
  const tipos = execFileSync("git", ["cat-file", "--batch-check=%(objectname) %(objecttype)"], {
    input: lista.map((x) => x.sha).join("\n") + "\n", encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  }).split("\n");
  const blob = new Set(tipos.filter((l) => l.endsWith(" blob")).map((l) => l.split(" ")[0]));
  const achados = [];
  for (const { sha, caminho } of lista) {
    if (!blob.has(sha)) continue;
    const buf = execFileSync("git", ["cat-file", "blob", sha], { maxBuffer: 256 * 1024 * 1024 });
    const r = problemas(caminho, buf.includes(0) ? null : buf.toString("utf8"));
    if (r.length) achados.push(`${caminho} (${sha.slice(0, 10)}): ${r.join(", ")}`);
  }
  for (const bloco of git("log", "--all", "--format=%H%x00%B%x01").split("\x01")) {
    const [sha, msg] = bloco.trim().split("\0");
    if (!sha) continue;
    const r = problemas("mensagem de commit", msg || "");
    if (r.length) achados.push(`mensagem do commit ${sha.slice(0, 10)}: ${r.join(", ")}`);
  }
  return { blobs: blob.size, achados };
}

function principal() {
  if (process.argv.includes("--historia")) {
    const { blobs, achados } = historia();
    for (const a of achados) console.error(`RECUSADO  ${a}`);
    if (achados.length) {
      console.error(`\n${achados.length} problema(s) na história: publicar com história nova (um commit só) ou limpar antes.`);
      process.exit(1);
    }
    console.log(`ok: ${blobs} versões de arquivo e todas as mensagens de commit da história, nenhum segredo, dado pessoal ou React Bits`);
    return;
  }
  const todos = process.argv.includes("--todos");
  const lista = todos
    ? git("ls-files", "-z").split("\0").filter(Boolean)
    : git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z").split("\0").filter(Boolean);
  let ruins = 0;
  for (const caminho of lista) {
    const achados = problemas(caminho, conteudoPreparado(caminho, todos));
    if (achados.length) {
      ruins += 1;
      console.error(`RECUSADO  ${caminho}: ${achados.join(", ")}`);
    }
  }
  if (ruins) {
    console.error(`\n${ruins} arquivo(s) não podem ir para o repositório público. Tire com: git restore --staged <arquivo>`);
    process.exit(1);
  }
  if (todos) console.log(`ok: ${lista.length} arquivos versionados, nenhum segredo, dado pessoal ou React Bits`);
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

if (chamadoDireto()) principal();
