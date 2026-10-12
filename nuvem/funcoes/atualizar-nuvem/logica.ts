// A nuvem aplicando as próprias migrações, sem credencial guardada (0.3.0). Esta parte não depende do Deno nem do
// banco de verdade: os testes rodam no Node, com um GitHub falso e o PGlite.
//
// As regras são as do agente (agente/src/atualizar.ts): o repositório é fixo aqui, o endereço do pacote da tag é montado
// aqui a partir de um número de versão conferido, e só vale versão OFICIAL publicada (nem rascunho, nem pré-lançamento)
// e MAIOR que a da nuvem. Nada de endereço vindo de fora. As migrações saem do pacote da tag (nuvem/migracoes/*.sql) e
// seguem a regra do instalador (nuvem/provisionar.mjs): nova entra; reaplicável que mudou roda de novo; de tabela que
// mudou é recusada; as permissões (0099) fecham qualquer aplicação. Cada migração vai numa transação própria, com a
// trava `pg_advisory_xact_lock` e o registro conferido de novo lá dentro: duas rodadas juntas não aplicam a mesma duas
// vezes, e uma que falha não deixa nada pela metade.

export const REPOSITORIO = "dantaspaulo/reveza";
export const URL_VERSOES = `https://api.github.com/repos/${REPOSITORIO}/releases?per_page=30`;
/** A página que o GitHub redireciona para a versão publicada mais nova (sem a API, que limita 60 pedidos por hora). */
export const URL_MAIS_NOVA = `https://github.com/${REPOSITORIO}/releases/latest`;
export const VERSAO_VALIDA = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/;
/** github.com manda o pacote da tag para codeload.github.com: o download só segue dentro destes dois. */
const HOSTS_DO_PACOTE = new Set(["github.com", "codeload.github.com"]);
export const PACOTE_MAXIMO = 64 * 1024 * 1024;
export const DESCOMPACTADO_MAXIMO = 256 * 1024 * 1024;
/** Trava das migrações (a 778802 é a vez dos computadores; 778803, a da nuvem; 778804, a da publicação). */
export const TRAVA_MIGRACOES = 778805;
export const FUSO_PADRAO = "America/Sao_Paulo";

/** Fecha o que nasce no public antes de qualquer migração (o mesmo SQL_FECHAR_PADRAO do instalador). */
export const SQL_FECHAR_PADRAO = `alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;`;

export function compararVersao(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

export function urlDoPacote(versao: string): string {
  if (!VERSAO_VALIDA.test(versao)) throw new Error("versão inválida");
  return `https://github.com/${REPOSITORIO}/archive/refs/tags/v${versao}.tar.gz`;
}

/** As versões publicadas (nem rascunho, nem pré-lançamento) na resposta da API de releases, da mais nova à mais velha. */
export function versoesPublicadas(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  const vs = new Set<string>();
  for (const r of json) {
    if (!r || typeof r !== "object") continue;
    const x = r as Record<string, unknown>;
    if (x.draft === true || x.prerelease === true || typeof x.tag_name !== "string") continue;
    const v = x.tag_name.replace(/^v/, "");
    if (VERSAO_VALIDA.test(v)) vs.add(v);
  }
  return [...vs].sort((a, b) => compararVersao(b, a));
}

/** A versão no endereço para onde /releases/latest manda (só o do próprio repositório, no github.com). */
export function versaoDoRedirecionamento(location: string | null): string | null {
  const m = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/tag\/v([0-9.]+)$/.exec(location ?? "");
  if (!m || m[1] !== REPOSITORIO || !VERSAO_VALIDA.test(m[2]!)) return null;
  return m[2]!;
}

const CABECALHOS = { "User-Agent": "reveza-nuvem", Accept: "application/vnd.github+json" };

/**
 * A versão publicada mais nova. Primeiro a API (que diz rascunho e pré-lançamento); se ela recusar (limite de pedidos
 * por endereço, que as funções dividem com outros projetos), a página /releases/latest, que só aponta para versão
 * publicada de verdade.
 */
export async function versaoMaisNova(f: typeof fetch): Promise<string> {
  let motivo = "";
  try {
    const r = await f(URL_VERSOES, { headers: CABECALHOS, redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (r.ok) {
      const v = versoesPublicadas(await r.json())[0];
      if (v) return v;
      motivo = "a lista de versões veio vazia";
    } else motivo = `a API do GitHub respondeu ${r.status}`;
  } catch (e) {
    motivo = `a API do GitHub não respondeu (${(e as Error).message})`;
  }
  const r = await f(URL_MAIS_NOVA, { headers: { "User-Agent": "reveza-nuvem" }, redirect: "manual", signal: AbortSignal.timeout(20_000) });
  const v = r.status >= 300 && r.status < 400 ? versaoDoRedirecionamento(r.headers.get("location")) : null;
  if (!v) throw new Error(`não consegui ler a versão publicada (${motivo}; a página da mais nova respondeu ${r.status})`);
  return v;
}

/** O pacote da tag, pelo endereço montado aqui; o redirecionamento só segue para o GitHub. */
export async function baixarPacote(f: typeof fetch, versao: string): Promise<Uint8Array> {
  let url = urlDoPacote(versao);
  for (let i = 0; i < 5; i++) {
    const r = await f(url, { headers: { "User-Agent": "reveza-nuvem" }, redirect: "manual", signal: AbortSignal.timeout(60_000) });
    if (r.status >= 300 && r.status < 400) {
      const proximo = new URL(r.headers.get("location") ?? "", url);
      if (proximo.protocol !== "https:" || !HOSTS_DO_PACOTE.has(proximo.hostname)) throw new Error("o download do pacote foi mandado para fora do GitHub");
      url = proximo.toString();
      continue;
    }
    if (!r.ok) throw new Error(`o GitHub respondeu ${r.status} ao pacote da ${versao}`);
    const tamanho = Number(r.headers.get("content-length") ?? "0");
    if (tamanho > PACOTE_MAXIMO) throw new Error("o pacote é grande demais");
    const dados = new Uint8Array(await r.arrayBuffer());
    if (dados.length > PACOTE_MAXIMO) throw new Error("o pacote é grande demais");
    return dados;
  }
  throw new Error("redirecionamentos demais no download do pacote");
}

/** Descompacta o .gz com o que o Deno e o Node trazem (DecompressionStream), parando no tamanho máximo. */
export async function gunzip(dados: Uint8Array, maximo = DESCOMPACTADO_MAXIMO): Promise<Uint8Array> {
  const leitor = new Blob([dados]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.length;
    if (total > maximo) {
      await leitor.cancel();
      throw new Error("o pacote descompactado é grande demais");
    }
    partes.push(value);
  }
  const tudo = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) {
    tudo.set(p, pos);
    pos += p.length;
  }
  return tudo;
}

const texto = new TextDecoder("utf-8", { ignoreBOM: true });

function lerPax(bloco: Uint8Array): Record<string, string> {
  const r: Record<string, string> = {};
  let pos = 0;
  while (pos < bloco.length) {
    const espaco = bloco.indexOf(0x20, pos);
    if (espaco < 0) break;
    const tamanho = Number(texto.decode(bloco.subarray(pos, espaco)));
    if (!Number.isInteger(tamanho) || tamanho <= 0) break;
    const linha = texto.decode(bloco.subarray(espaco + 1, pos + tamanho - 1));
    const igual = linha.indexOf("=");
    if (igual > 0) r[linha.slice(0, igual)] = linha.slice(igual + 1);
    pos += tamanho;
  }
  return r;
}

/**
 * Os arquivos comuns de um .tar (na memória; nada vai para o disco). Link, caminho absoluto ou com ".." recusam o
 * pacote inteiro, como no agente.
 */
export function lerTar(dados: Uint8Array): Map<string, Uint8Array> {
  const arquivos = new Map<string, Uint8Array>();
  let pos = 0;
  let nomePax: string | null = null;
  let nomeLongo: string | null = null;
  while (pos + 512 <= dados.length) {
    const h = dados.subarray(pos, pos + 512);
    if (h.every((b) => b === 0)) break;
    const campo = (ini: number, tam: number) => texto.decode(h.subarray(ini, ini + tam)).replace(/\0[\s\S]*$/, "");
    let soma = 0;
    for (let i = 0; i < 512; i++) soma += i >= 148 && i < 156 ? 32 : h[i]!;
    if (soma !== parseInt(campo(148, 8).trim(), 8)) throw new Error("pacote corrompido (soma do cabeçalho)");
    const tamanho = parseInt(campo(124, 12).trim() || "0", 8);
    const tipo = String.fromCharCode(h[156] || 48);
    pos += 512;
    const conteudo = dados.subarray(pos, pos + tamanho);
    pos += Math.ceil(tamanho / 512) * 512;
    if (tipo === "g") continue;
    if (tipo === "x") {
      nomePax = lerPax(conteudo).path ?? null;
      continue;
    }
    if (tipo === "L") {
      nomeLongo = texto.decode(conteudo).replace(/\0[\s\S]*$/, "");
      continue;
    }
    const prefixo = campo(345, 155);
    const nome = nomePax ?? nomeLongo ?? (prefixo ? `${prefixo}/${campo(0, 100)}` : campo(0, 100));
    nomePax = null;
    nomeLongo = null;
    if (tipo === "1" || tipo === "2") throw new Error(`o pacote tem um link (${nome}): recusado`);
    const rel = nome.replace(/\\/g, "/");
    if (!rel || rel.startsWith("/") || /^[A-Za-z]:/.test(rel) || rel.split("/").includes("..")) throw new Error(`caminho inválido no pacote: ${nome}`);
    if (tipo === "0" || tipo === "7") arquivos.set(rel, conteudo);
  }
  return arquivos;
}

/** A pasta de cima do pacote, conferindo que é o Reveza na versão pedida. */
export function raizDoPacote(arquivos: Map<string, Uint8Array>, versao: string): string {
  for (const [nome, conteudo] of arquivos) {
    const partes = nome.split("/");
    if (partes.length !== 2 || partes[1] !== "package.json") continue;
    let p: { name?: string; version?: string };
    try {
      p = JSON.parse(texto.decode(conteudo));
    } catch {
      continue;
    }
    if (p.name !== "reveza") continue;
    if (p.version !== versao) throw new Error(`o pacote não é o da ${versao} (veio ${p.version ?? "sem versão"})`);
    return partes[0]!;
  }
  throw new Error("o pacote não tem o programa");
}

export interface Migracao {
  nome: string;
  sql: string;
}

/** As migrações do pacote, na ordem do instalador: a 0099 (permissões) sempre por último. */
export function migracoesDoPacote(arquivos: Map<string, Uint8Array>, raiz: string): Migracao[] {
  const pasta = `${raiz}/nuvem/migracoes/`;
  const todas = [...arquivos.keys()]
    .filter((n) => n.startsWith(pasta) && !n.slice(pasta.length).includes("/"))
    .map((n) => n.slice(pasta.length))
    .filter((n) => n.endsWith(".sql") && !n.startsWith("."))
    .sort()
    .map((nome) => ({ nome, sql: texto.decode(arquivos.get(pasta + nome)!) }));
  if (!todas.length) throw new Error("o pacote não tem as migrações da nuvem");
  return [...todas.filter((m) => !m.nome.startsWith("0099")), ...todas.filter((m) => m.nome.startsWith("0099"))];
}

function hex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(dados: Uint8Array | string): Promise<string> {
  const b = typeof dados === "string" ? new TextEncoder().encode(dados) : dados;
  return hex(await crypto.subtle.digest("SHA-256", b));
}

/** O resumo de uma migração: o mesmo do instalador (sha256 do texto, com o fim de linha em LF). */
export const hashDe = (sql: string) => sha256(sql.replace(/\r\n/g, "\n"));
/** Os resumos que valem para o mesmo arquivo: o de hoje (LF) e o que um clone com CRLF registrou antes da 0.3.1. */
export async function hashesAceitos(sql: string): Promise<string[]> {
  const lf = sql.replace(/\r\n/g, "\n");
  return [await sha256(lf), await sha256(lf.replace(/\n/g, "\r\n"))];
}
export const reaplicavel = (m: Migracao) => /^-- reaplicável/m.test(m.sql);

/** O que aplicar (a regra do instalador, provisionar.mjs), com o resumo de cada uma. */
export async function planoMigracoes(todas: Migracao[], feitas: Map<string, string>): Promise<(Migracao & { hash: string })[]> {
  if (!feitas.size) throw new Error("a nuvem não tem o registro das migrações: atualize pelo instalador no computador que criou a instalação");
  const aplicar: (Migracao & { hash: string })[] = [];
  for (const m of todas) {
    const antes = feitas.get(m.nome);
    const hash = await hashDe(m.sql);
    if (antes !== undefined && (await hashesAceitos(m.sql)).includes(antes)) continue;
    if (antes !== undefined && !reaplicavel(m)) {
      throw new Error(`${m.nome} mudou depois de aplicada e mexe em tabela: a mudança precisa ir numa migração nova`);
    }
    aplicar.push({ ...m, hash });
  }
  const perm = todas.find((m) => m.nome.startsWith("0099"));
  if (aplicar.length && perm && !aplicar.some((m) => m.nome === perm.nome)) aplicar.push({ ...perm, hash: await hashDe(perm.sql) });
  return aplicar;
}

/**
 * Migração que não cabe numa transação (controle de transação próprio, índice concurrently, vacuum) não roda aqui: a
 * atualização para antes de começar e diz por quê.
 */
export function foraDeTransacao(m: Migracao): string | null {
  if (/^\s*(begin|commit|rollback|start\s+transaction|end\s+transaction)\s*;/im.test(m.sql)) return `${m.nome} controla a própria transação`;
  if (/\bconcurrently\b/i.test(m.sql)) return `${m.nome} cria índice concurrently, que não roda numa transação`;
  if (/^\s*vacuum\b/im.test(m.sql)) return `${m.nome} roda vacuum, que não roda numa transação`;
  return null;
}

/**
 * O resumo das partes que precisam de credencial para ir ao ar: as Edge Functions (com o provisionar, que publica
 * segredos e o login) e o painel (com o build e a publicação). Se a versão nova tem o mesmo resumo da que está no ar, a
 * parte não precisa ser publicada de novo. Ficam de fora testes, arquivos ocultos e o que o build gera.
 */
export const PARTES = {
  funcoes: { pastas: ["nuvem/funcoes/"], arquivos: ["nuvem/provisionar.mjs"] },
  painel: { pastas: ["painel/"], arquivos: ["instalador/lib/painel.mjs", "instalador/lib/vercel.mjs"] },
} as const;

const FORA_DO_RESUMO = /(^|\/)(\.[^/]*|node_modules|dist|capturas|testes)(\/|$)|\.test\.[a-z]+$/;

export async function impressoesDoPacote(arquivos: Map<string, Uint8Array>, raiz: string): Promise<{ funcoes: string; painel: string }> {
  const r: Record<string, string> = {};
  for (const [parte, def] of Object.entries(PARTES)) {
    const linhas: string[] = [];
    for (const [nome, conteudo] of arquivos) {
      if (!nome.startsWith(`${raiz}/`)) continue;
      const rel = nome.slice(raiz.length + 1);
      const dentro = def.pastas.some((p) => rel.startsWith(p)) || (def.arquivos as readonly string[]).includes(rel);
      if (!dentro || FORA_DO_RESUMO.test(rel)) continue;
      linhas.push(`${rel}\0${await sha256(conteudo)}\n`);
    }
    if (!linhas.length) throw new Error(`o pacote não tem ${parte === "funcoes" ? "as funções da nuvem" : "o painel"}`);
    r[parte] = await sha256(linhas.sort().join(""));
  }
  return r as { funcoes: string; painel: string };
}

/** Das 3h às 5h no fuso da instalação (a mesma janela do "de madrugada" dos computadores). */
export function naMadrugada(epochMs: number, fuso: unknown): boolean {
  const hora = (tz: string) => Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(new Date(epochMs)));
  let h: number;
  try {
    h = hora(typeof fuso === "string" && fuso ? fuso : FUSO_PADRAO);
  } catch {
    h = hora(FUSO_PADRAO);
  }
  return h >= 3 && h < 5;
}

// ------------------------------------------------------------------------------------------------ o banco

/**
 * A conexão. `consulta`: uma instrução, com as linhas como objetos. `executar`: um texto com várias instruções (uma
 * migração), pelo protocolo simples, sem ler as linhas (cada instrução pode devolver colunas diferentes).
 */
export interface Banco {
  consulta(sql: string, parametros?: unknown[]): Promise<Record<string, unknown>[]>;
  executar(sql: string): Promise<void>;
}

const PAPEL = /^[A-Za-z_][A-Za-z0-9_.-]{0,62}$/;

/**
 * A conexão da função pode trocar o banco do Reveza? Ela precisa ser dona (ou herdar o papel dono) das tabelas e funções
 * que as migrações refazem. Se não for, para antes de mexer, com o nome dos papéis, e a nuvem segue pelo instalador.
 */
export async function conferirDono(banco: Banco): Promise<string | null> {
  const [l] = await banco.consulta(`select current_user::text as eu,
      pg_get_userbyid(c.relowner)::text as dono_tabela, pg_has_role(current_user, c.relowner, 'USAGE') as tabela,
      pg_get_userbyid(p.proowner)::text as dono_funcao, pg_has_role(current_user, p.proowner, 'USAGE') as funcao
    from pg_class c, pg_proc p
   where c.oid = 'public.config'::regclass and p.oid = 'public.painel_config(text, jsonb)'::regprocedure`);
  if (!l) return "não achei as tabelas do Reveza nesta nuvem";
  if (l.tabela === true && l.funcao === true) return null;
  const nome = (v: unknown) => (typeof v === "string" && PAPEL.test(v) ? v : "?");
  return `a conexão da função (papel ${nome(l.eu)}) não é dona do banco do Reveza (tabelas de ${nome(l.dono_tabela)}, funções de ${nome(l.dono_funcao)}): atualize pelo instalador no computador que criou a instalação`;
}

/** As migrações que a nuvem já aplicou (nome e resumo). */
export async function migracoesFeitas(banco: Banco): Promise<Map<string, string>> {
  const [t] = await banco.consulta("select to_regclass('public.reveza_migracoes') is not null as tem");
  if (t?.tem !== true) return new Map();
  const linhas = await banco.consulta("select nome, hash from public.reveza_migracoes");
  return new Map(linhas.map((l) => [String(l.nome), String(l.hash)]));
}

/**
 * Aplica uma migração inteira ou nada: numa transação, com a trava, conferindo dentro dela se outra rodada já aplicou
 * esta mesma versão do arquivo. Espera trava por até 15 s (o pg_cron do Reveza roda a cada minuto); trava ocupada tenta
 * mais duas vezes.
 */
export async function aplicarUma(banco: Banco, m: Migracao & { hash: string }): Promise<boolean> {
  if (!/^[0-9a-z_.]+$/.test(m.nome) || !/^[0-9a-f]{64}$/.test(m.hash)) throw new Error("migração com nome inesperado");
  for (let tentativa = 1; ; tentativa++) {
    await banco.executar("begin");
    try {
      await banco.executar(`set local lock_timeout = '15s'; set local statement_timeout = '120s'; select pg_advisory_xact_lock(${TRAVA_MIGRACOES})`);
      const [ja] = await banco.consulta("select hash from public.reveza_migracoes where nome = $1", [m.nome]);
      if (ja && (await hashesAceitos(m.sql)).includes(String(ja.hash))) {
        await banco.executar("rollback");
        return false;
      }
      await banco.executar(m.sql);
      await banco.consulta(
        "insert into public.reveza_migracoes (nome, hash) values ($1, $2) on conflict (nome) do update set hash = excluded.hash, aplicada_em = now()",
        [m.nome, m.hash],
      );
      await banco.executar("commit");
      return true;
    } catch (e) {
      await banco.executar("rollback").catch(() => undefined);
      const codigo = (e as { fields?: { code?: string }; code?: string }).fields?.code ?? (e as { code?: string }).code;
      if (codigo === "55P03" && tentativa < 3) continue;
      throw new Error(`a migração ${m.nome} não entrou (nada dela ficou): ${String((e as Error).message ?? e).slice(0, 200)}`);
    }
  }
}

// ------------------------------------------------------------------------------------------------ a atualização

export type Por = "painel" | "sozinho";

export interface Resultado {
  ok: boolean;
  estado: "atualizada" | "em_dia" | "desligada" | "fora_da_hora" | "atualizando" | "parada" | "falhou";
  de?: string | null;
  para?: string;
  aplicadas?: string[];
  motivo?: string;
}

export interface Opcoes {
  banco: Banco;
  fetch: typeof fetch;
  por: Por;
  agora?: number;
}

async function chamar(banco: Banco, sql: string, parametros: unknown[] = []): Promise<Record<string, unknown>> {
  const [l] = await banco.consulta(sql, parametros);
  const r = l?.r;
  return (typeof r === "string" ? JSON.parse(r) : r ?? {}) as Record<string, unknown>;
}

const versaoOuNull = (v: unknown) => (typeof v === "string" && VERSAO_VALIDA.test(v) ? v : null);

/**
 * A atualização da nuvem, do começo ao fim. Pelo painel (administrador) vai até a versão mais nova e destrava a
 * publicação que tinha parado; sozinha (pg_cron), segue a escolha da instalação (desligada, de madrugada, assim que
 * sair) e não tenta de novo a versão que já falhou (quem destrava é o administrador, pelo painel).
 */
export async function atualizarNuvem(o: Opcoes): Promise<Resultado> {
  const { banco } = o;
  // antes de tudo: a conexão é dona do banco? (se não for, nem as funções da nuvem ela alcança; nada muda)
  const recusa = await conferirDono(banco).catch((e) => `não consegui conferir o dono do banco (${String((e as Error).message ?? e).slice(0, 150)})`);
  if (recusa) return { ok: false, estado: "falhou", motivo: recusa };
  const estado = await chamar(banco, "select public.servico_nuvem_estado() as r");
  if (o.por === "sozinho") {
    if (estado.atualizar_sozinho === "desligada") return { ok: true, estado: "desligada" };
    if (estado.atualizar_sozinho === "madrugada" && !naMadrugada(o.agora ?? Date.now(), estado.fuso)) return { ok: true, estado: "fora_da_hora" };
  }
  const atual = versaoOuNull(estado.versao);
  const alvo = await versaoMaisNova(o.fetch);
  if (atual && compararVersao(alvo, atual) <= 0) {
    if (o.por === "painel") await chamar(banco, "select public.servico_nuvem_destravar() as r");
    return { ok: true, estado: "em_dia", de: atual, para: atual };
  }
  const anterior = (estado.atualizacao ?? null) as Record<string, unknown> | null;
  if (o.por === "sozinho" && anterior?.estado === "falhou" && anterior.para === alvo) {
    return { ok: false, estado: "parada", para: alvo, motivo: String(anterior.motivo ?? "") };
  }
  const comecou = await chamar(banco, "select public.servico_nuvem_comecar($1, $2) as r", [alvo, o.por]);
  if (comecou.ok !== true) return { ok: false, estado: "atualizando", para: String(comecou.para ?? alvo) };
  if (o.por === "painel") await chamar(banco, "select public.servico_nuvem_destravar() as r");
  try {
    const arquivos = lerTar(await gunzip(await baixarPacote(o.fetch, alvo)));
    const raiz = raizDoPacote(arquivos, alvo);
    const todas = migracoesDoPacote(arquivos, raiz);
    const plano = await planoMigracoes(todas, await migracoesFeitas(banco));
    for (const m of plano) {
      const motivo = foraDeTransacao(m);
      if (motivo) throw new Error(`${motivo}: atualize pelo instalador no computador que criou a instalação`);
    }
    const impressoes: Record<string, { funcoes: string; painel: string }> = { [alvo]: await impressoesDoPacote(arquivos, raiz) };
    // o resumo do que está no ar (se ainda não se sabe), para saber se a versão nova mexeu nas funções ou no painel
    const publicado = (estado.publicado ?? {}) as Record<string, unknown>;
    const conhecidas = (estado.impressoes ?? {}) as Record<string, unknown>;
    for (const v of new Set([versaoOuNull(publicado.funcoes), versaoOuNull(publicado.painel)])) {
      if (!v || v === alvo || conhecidas[v] || compararVersao(v, alvo) > 0) continue;
      try {
        const a = lerTar(await gunzip(await baixarPacote(o.fetch, v)));
        impressoes[v] = await impressoesDoPacote(a, raizDoPacote(a, v));
      } catch {
        // sem o resumo da que está no ar, a parte conta como pendente (o passo manual aparece)
      }
    }
    await banco.executar(SQL_FECHAR_PADRAO);
    const aplicadas: string[] = [];
    for (const m of plano) if (await aplicarUma(banco, m)) aplicadas.push(m.nome);
    await chamar(banco, "select public.servico_nuvem_terminou($1, $2::jsonb, $3::jsonb) as r", [alvo, JSON.stringify(aplicadas), JSON.stringify(impressoes)]);
    return { ok: true, estado: "atualizada", de: atual, para: alvo, aplicadas };
  } catch (e) {
    const motivo = String((e as Error).message ?? e).slice(0, 300);
    await chamar(banco, "select public.servico_nuvem_falhou($1, $2) as r", [alvo, motivo]).catch(() => undefined);
    return { ok: false, estado: "falhou", de: atual, para: alvo, motivo };
  }
}
