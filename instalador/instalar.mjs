#!/usr/bin/env node
// Instalador do Reveza AI: gestor de várias contas do assistente de código, com painel na nuvem da própria pessoa.
//   1. confere o computador          5. o painel na Vercel (e o domínio)
//   2. instala o agente e o mod      6. contas e modo de troca
//   3. a nuvem no Supabase           7. alertas, com mensagem de teste
//   4. o serviço                     8. prova final
//
//   npx github:dantaspaulo/reveza                 interativo
//   ... --atualizar                               atualiza agente, mod, banco e painel; contas, uso e configuração ficam
//   ... --sem-nuvem                               só neste computador: agente, mod e contas, sem painel online
//   ... --com-nuvem                               põe a nuvem e o painel numa instalação que estava só no computador
//   ... --ligar                                   liga este computador a uma instalação que já existe (código do painel)
//   ... --sombra                                  ao lado de outro gestor de contas, sem trocar nada (porta 7789)
//   ... --sair-da-sombra                          o outro gestor já parou: o Reveza passa a trocar (com --atualizar)
//   ... --importar <pasta>                        copia contas e uso de outro gestor (a origem não muda)
//   ... --demo                                    abre o painel com dados de exemplo, sem nuvem e sem mexer em conta
//   ... --doctor                                  confere a instalação
//   ... --desinstalar                             tira o serviço e o mod (logins, chave do cofre e nuvem ficam)
//   ... --idioma en                               perguntas em inglês
//   ... --sim                                     sem perguntas (lê SUPABASE_ACCESS_TOKEN, VERCEL_TOKEN e REVEZA_* do ambiente)
//   ... --pasta <dir> | --sem-servico | --sem-react-bits | --versao | --ajuda
//
// Requisitos: Node 20+ e o Claude Code instalado (o Reveza funciona com o Claude Code). Instalar não apaga nada.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Gerencia, provisionar, trocarSite } from "../nuvem/provisionar.mjs";
import { acharChatTelegram, segredoWebhook, testar } from "./lib/alertas.mjs";
import { dnsPronto, dominioValido, passosCloudflare } from "./lib/dominio.mjs";
import { computadorDoEmail, esperarComando, pedirComando, salvarAlerta, salvarTroca } from "./lib/nuvem.mjs";
import { construir, prepararPasta } from "./lib/painel.mjs";
import {
  acrescentarPath, ambienteLimpo, criarLancador, existe, gravarConfigLocal, gravarInstalacao, instalarMod, instalarPrograma, lerInstalacao,
  linhaPath, npm, portaOcupada, removerMod, rodar,
  copiarEstado, voltarAtualizacao,
} from "./lib/programa.mjs";
import { conferirToken, criarProjeto, organizacoes, projetos, REGIOES, regiaoSugerida } from "./lib/supabase.mjs";
import { emailValido, fraco, info, mascara, nao, negrito, ok, perguntador, senhaForte, t, titulo, usarIdioma, verde } from "./lib/texto.mjs";
import { Vercel } from "./lib/vercel.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSAO = JSON.parse(readFileSync(path.join(RAIZ, "package.json"), "utf8")).version;
const REPO = "dantaspaulo/reveza";

// ── argumentos ────────────────────────────────────────────────────────────────
const FLAGS = ["--atualizar", "--sem-nuvem", "--com-nuvem", "--sair-da-sombra", "--ligar", "--sombra", "--importar", "--demo", "--doctor", "--desinstalar", "--idioma",
  "--sim", "--pasta", "--sem-servico", "--sem-react-bits", "--versao", "--ajuda", "--help", "-h"];
const COM_VALOR = ["--importar", "--idioma", "--pasta"];
export function lerArgs(argv) {
  const a = { flags: new Set(), valores: {} };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (!FLAGS.includes(x)) return { erro: `opção desconhecida: ${x}` };
    if (COM_VALOR.includes(x)) {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) return { erro: `${x} pede um valor` };
      a.valores[x] = argv[++i];
    } else a.flags.add(x);
  }
  return a;
}
const uso = () => readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//   ")).map((l) => l.slice(5)).join("\n");

// ── caminhos ──────────────────────────────────────────────────────────────────
const HOME = os.homedir();
const BASE = process.env.REVEZA_HOME || path.join(HOME, ".reveza");
const ARQ_INST = path.join(BASE, "instalacao.json");
const BUILD = path.join(BASE, "painel-build");
const BIN = path.join(BASE, "bin");

function emailDoClaude() {
  try {
    const j = JSON.parse(readFileSync(path.join(HOME, ".claude.json"), "utf8"));
    return j.oauthAccount && j.oauthAccount.emailAddress ? String(j.oauthAccount.emailAddress).toLowerCase() : null;
  } catch { return null; }
}

// ── passos ────────────────────────────────────────────────────────────────────
async function conferir(ctx) {
  titulo(t("1/8 Conferência do computador", "1/8 Checking this computer"));
  // 20.19: o painel (vite 8) pede, e todo Node daí em diante tem a correção de argumento de .cmd no Windows (CVE-2024-27980)
  const [maior, menor] = process.versions.node.split(".").map(Number);
  if (maior < 20 || (maior === 20 && menor < 19)) throw new Error(t(`Node 20.19 ou mais novo é necessário (este tem ${process.versions.node}): https://nodejs.org`,
    `Node 20.19 or newer is required (this one is ${process.versions.node}): https://nodejs.org`));
  ok(`Node ${process.versions.node}, ${{ darwin: "macOS", linux: "Linux", win32: "Windows" }[process.platform] || process.platform}`);
  if (!existe(npm.replace(/\.cmd$/, ""))) throw new Error(t("npm não encontrado", "npm not found"));
  ctx.temClaude = existe("claude");
  if (ctx.temClaude) ok(t("Claude Code encontrado", "Claude Code found"));
  else nao(t("Claude Code não encontrado no PATH: o Reveza funciona com o Claude Code. Instale (https://claude.com/claude-code) e rode de novo para o mod e o login das contas.",
    "Claude Code not found on PATH: Reveza works with Claude Code. Install it (https://claude.com/claude-code) and run again for the mod and account logins."));
  const ocupada = await portaOcupada(7788);
  const nosso = ctx.inst && !ctx.inst.sombra;
  if (ocupada && !nosso && !ctx.sombra) {
    nao(t("Já existe um programa na porta 7788 (outro gestor de contas?).", "Something already listens on port 7788 (another account manager?)."));
    ctx.sombra = await ctx.p.sim(t("Instalar em modo sombra (lê e mostra o que faria, sem trocar conta)?", "Install in shadow mode (reads and shows what it would do, without switching)?"), true);
  }
  if (ctx.sairDaSombra && ocupada && ctx.inst?.sombra) {
    throw new Error(t("ainda há um programa na porta 7788: pare o outro gestor de contas antes de sair do modo sombra",
      "something still listens on port 7788: stop the other account manager before leaving shadow mode"));
  }
  if (ctx.sombra && ctx.inst?.sombra && !ctx.forcarSombra && !ocupada) {
    nao(t("O outro gestor de contas não está mais rodando.", "The other account manager is no longer running."));
    if (ctx.sairDaSombra || (await ctx.p.sim(t("Sair do modo sombra (o Reveza passa a trocar as contas)?", "Leave shadow mode (Reveza starts switching accounts)?"), false))) ctx.sombra = false;
  }
  if (ctx.sombra) ok(t("modo sombra: porta 7789, nenhuma troca de conta", "shadow mode: port 7789, no account switching"));
}

async function programa(ctx) {
  titulo(t("2/8 Agente e mod", "2/8 Agent and mod"));
  ctx.cli = instalarPrograma(RAIZ, ctx.app, { log: info });
  ok(t(`agente ${VERSAO} em ${ctx.app}`, `agent ${VERSAO} in ${ctx.app}`));
  const lanc = criarLancador(BIN, ctx.cli);
  ok(t(`comando reveza em ${lanc}`, `reveza command at ${lanc}`));
  const l = linhaPath(BIN);
  if (l && !(process.env.PATH || "").split(path.delimiter).includes(BIN)) {
    if (await ctx.p.sim(t(`Acrescentar ${BIN} ao PATH em ${l.arquivo}?`, `Add ${BIN} to PATH in ${l.arquivo}?`), !ctx.semPerguntas)) {
      if (acrescentarPath(BIN)) ok(t("PATH atualizado (vale nos terminais novos)", "PATH updated (applies to new terminals)"));
      else nao(t(`não consegui mudar o PATH: use ${l.linha}`, `could not change PATH: use ${l.linha}`));
    } else info(t(`Para usar o comando reveza: ${l.linha}`, `To use the reveza command: ${l.linha}`));
  }
  if (ctx.importar) {
    const de = path.resolve(ctx.importar.replace(/^~(?=$|\/)/, HOME));
    const r = reveza(ctx, ["importar", "--de", de, ...(ctx.sombra ? ["--sombra"] : [])], true);
    r.ok ? ok(t("contas e uso copiados (a origem não mudou)", "accounts and usage copied (the source did not change)"))
      : nao(t("a importação não terminou: veja a mensagem acima", "the import did not finish: see the message above"));
  }
}

function reveza(ctx, args, mostrar = false, env) {
  return rodar(process.execPath, [ctx.cli, ...args], { mostrar, env: ambienteLimpo(env) });
}

async function perguntarTroca(ctx) {
  titulo(t("Troca de conta", "Account switching"));
  info(t("A troca automática começa DESLIGADA: você liga no painel quando quiser (ou agora).", "Automatic switching starts OFF: turn it on in the panel whenever you want (or now)."));
  const modos = ["limite", "limiar", "rodizio"];
  const i = await ctx.p.escolha(t("Como trocar quando estiver ligada?", "How to switch when on?"), [
    t("só quando a conta bater no limite", "only when the account hits its limit"),
    t("antes do limite: avisa num percentual e troca em outro", "before the limit: warn at one percentage and switch at another"),
    t("rodízio durante o dia, entre as contas livres", "rotate during the day among free accounts"),
  ], 2);
  const cfg = { modo: modos[i], aviso: 90, troca: 95, auto: false };
  if (cfg.modo === "limiar") {
    cfg.aviso = Number(await ctx.p.perguntar(t("Avisar em (%)", "Warn at (%)"), "90"));
    cfg.troca = Number(await ctx.p.perguntar(t("Trocar em (%)", "Switch at (%)"), "95"));
    if (!(cfg.aviso >= 1 && cfg.troca <= 100 && cfg.aviso < cfg.troca)) {
      nao(t("o aviso precisa ser menor que a troca: fico com 90 e 95", "warning must be below the switch: using 90 and 95"));
      Object.assign(cfg, { aviso: 90, troca: 95 });
    }
  }
  cfg.auto = await ctx.p.sim(t("Ligar a troca automática agora?", "Turn automatic switching on now?"), false);
  ctx.troca = cfg;
}

async function nuvem(ctx) {
  titulo(t("3/8 A nuvem (Supabase)", "3/8 The cloud (Supabase)"));
  info(t("O painel, o cofre cifrado e a decisão de troca moram num projeto Supabase SEU. O plano grátis basta.",
    "The panel, the encrypted vault and the switching decision live in a Supabase project of YOURS. The free plan is enough."));
  info(t("Token pessoal: supabase.com/dashboard/account/tokens (Generate new token). Ele não é guardado.",
    "Personal token: supabase.com/dashboard/account/tokens (Generate new token). It is not stored."));
  if (ctx.atualizar && ctx.inst?.nuvem) {
    info(t("Para atualizar só este computador (sem mexer na nuvem e no painel), deixe em branco e tecle Enter.",
      "To update only this computer (leaving the cloud and the panel as they are), leave it blank and press Enter."));
  }
  let token = "";
  for (let i = 0; i < 3 && !token; i++) {
    token = await ctx.p.segredo(t("Token do Supabase:", "Supabase token:"), "SUPABASE_ACCESS_TOKEN");
    if (!token) break;
    const g = new Gerencia(token);
    const c = await conferirToken(g);
    if (!c.ok) { nao(c.erro); token = ""; }
  }
  if (!token && ctx.atualizar && ctx.inst?.nuvem) {
    // atualização só do computador: a nuvem e o painel que já estão no ar ficam como estão
    info(t("Sem token: a nuvem e o painel ficam como estão; o computador é atualizado.", "No token: the cloud and the panel stay as they are; this computer is updated."));
    ctx.manterNuvem = true;
    return;
  }
  if (!token) throw new Error(t("sem token do Supabase não dá para criar a nuvem (ou use --sem-nuvem)", "without a Supabase token the cloud cannot be created (or use --sem-nuvem)"));
  ok(t(`token aceito (${mascara(token)})`, `token accepted (${mascara(token)})`));
  ctx.gerencia = new Gerencia(token);

  if (ctx.atualizar && ctx.inst?.nuvem?.ref) {
    ctx.ref = ctx.inst.nuvem.ref;
  } else {
    const lista = await projetos(ctx.gerencia);
    const opcoes = [t("criar um projeto novo", "create a new project"), ...lista.map((p) => `${p.nome} (${p.ref}, ${p.regiao})`)];
    const i = await ctx.p.escolha(t("Projeto do Supabase", "Supabase project"), opcoes, process.env.REVEZA_SUPABASE_REF ? 0 : 1);
    if (process.env.REVEZA_SUPABASE_REF) ctx.ref = process.env.REVEZA_SUPABASE_REF;
    else if (i === 0) {
      const orgs = await organizacoes(ctx.gerencia);
      if (!orgs.length) throw new Error(t("o token não vê nenhuma organização", "the token sees no organization"));
      const o = orgs.length === 1 ? 0 : await ctx.p.escolha(t("Organização", "Organization"), orgs.map((x) => x.nome), 1);
      const sugerida = regiaoSugerida();
      let regiao = await ctx.p.perguntar(t("Região", "Region"), sugerida);
      if (!REGIOES.includes(regiao)) regiao = sugerida;
      ctx.ref = await criarProjeto(ctx.gerencia, { org: orgs[o].slug, nome: "reveza", regiao });
      ok(t(`projeto criado (${ctx.ref}); a senha do banco é aleatória e não fica guardada`, `project created (${ctx.ref}); the database password is random and not stored`));
    } else ctx.ref = lista[i - 1].ref;
  }
  if (!/^[a-z0-9]{20}$/.test(ctx.ref || "")) throw new Error(t("projeto do Supabase inválido", "invalid Supabase project"));

  if (ctx.nuvemNova) {
    titulo(t("  Administrador do painel", "  Panel administrator"));
    let email = process.env.REVEZA_ADMIN_EMAIL || emailDoClaude() || "";
    email = (await ctx.p.perguntar(t("E-mail", "E-mail"), email)).toLowerCase();
    if (!emailValido(email)) throw new Error(t("e-mail inválido", "invalid e-mail"));
    let senha = "";
    for (let i = 0; i < 3; i++) {
      senha = await ctx.p.segredo(t("Senha (12+ caracteres, com maiúscula, minúscula e número):", "Password (12+ characters, with upper, lower case and a number):"), "REVEZA_ADMIN_SENHA");
      if (!senhaForte(senha)) { nao(t("senha fraca", "weak password")); senha = ""; continue; }
      if (ctx.semPerguntas || process.env.REVEZA_ADMIN_SENHA) break;
      const de2 = await ctx.p.segredo(t("De novo:", "Again:"));
      if (de2 === senha) break;
      nao(t("não bateu", "did not match"));
      senha = "";
    }
    if (!senha) throw new Error(t("sem senha do administrador", "no administrator password"));
    ctx.admin = { email, senha };
    info(t("No primeiro login o painel pede a verificação em duas etapas (app autenticador).", "On first login the panel asks for two-step verification (authenticator app)."));

    titulo(t("  E-mail do painel (convites e recuperação de senha)", "  Panel e-mail (invites and password recovery)"));
    info(t("Sem um envio próprio, o Supabase só manda e-mail para quem é da organização dele, e convite para outra pessoa não chega.",
      "Without your own sender, Supabase only e-mails members of its organization, and invites to other people do not arrive."));
    if (await ctx.p.sim(t("Configurar agora com o Resend (grátis até 3 mil e-mails por mês)?", "Set it up now with Resend (free up to 3,000 e-mails a month)?"), false)) {
      const chave = await ctx.p.segredo(t("Chave da API do Resend (resend.com/api-keys):", "Resend API key (resend.com/api-keys):"), "REVEZA_RESEND_CHAVE");
      const remetente = await ctx.p.perguntar(t("Remetente (de um domínio verificado no Resend)", "Sender (from a domain verified in Resend)"), "");
      if (chave && emailValido(remetente)) {
        ctx.smtp = { host: "smtp.resend.com", porta: 465, usuario: "resend", senha: chave, remetente };
        ctx.resendChave = chave;
      } else nao(t("ficou sem envio próprio: dá para configurar depois no Supabase (Authentication → SMTP)", "no own sender: set it later in Supabase (Authentication → SMTP)"));
    }
  }
}

async function perguntarPainel(ctx) {
  titulo(t("  Painel na Vercel", "  Panel on Vercel"));
  info(t("Token: vercel.com/account/tokens (Create). Ele não é guardado.", "Token: vercel.com/account/tokens (Create). It is not stored."));
  const token = await ctx.p.segredo(t("Token da Vercel:", "Vercel token:"), "VERCEL_TOKEN");
  if (!token) throw new Error(t("sem token da Vercel não dá para publicar o painel (ou use --sem-nuvem)", "without a Vercel token the panel cannot be published (or use --sem-nuvem)"));
  let v = new Vercel(token);
  const eu = await v.quemSou();
  ok(t(`Vercel: ${eu.usuario}`, `Vercel: ${eu.usuario}`));
  let equipe = ctx.inst?.painel?.equipe ?? null;
  if (!ctx.inst?.painel && eu.equipes.length) {
    // padrão: a equipe padrão da conta (na Vercel de hoje, a conta pessoal também é uma equipe); REVEZA_VERCEL_EQUIPE escolhe
    const pedida = process.env.REVEZA_VERCEL_EQUIPE;
    const indice = pedida ? eu.equipes.findIndex((x) => x.id === pedida || x.slug === pedida) : eu.equipes.findIndex((x) => x.id === eu.padrao);
    const i = await ctx.p.escolha(t("Onde publicar", "Where to publish"), [t("conta pessoal", "personal account"), ...eu.equipes.map((x) => x.nome)], indice >= 0 ? indice + 2 : 1);
    equipe = i === 0 ? null : eu.equipes[i - 1].id;
  }
  ctx.vercel = new Vercel(token, { equipe });
  ctx.projetoVercel = ctx.inst?.painel?.projeto || (await ctx.p.perguntar(t("Nome do projeto na Vercel", "Vercel project name"), process.env.REVEZA_VERCEL_PROJETO || "reveza")).toLowerCase();
  if (!ctx.inst?.painel) {
    const d = await ctx.p.escolha(t("Endereço do painel", "Panel address"), [
      t(`o da Vercel (${ctx.projetoVercel}.vercel.app)`, `Vercel's (${ctx.projetoVercel}.vercel.app)`),
      t("um subdomínio meu (ex.: contas.meudominio.com)", "a subdomain of mine (e.g. accounts.mydomain.com)"),
    ], 1);
    if (d === 1) {
      ctx.dominio = dominioValido(await ctx.p.perguntar(t("Subdomínio", "Subdomain"), process.env.REVEZA_DOMINIO || ""));
      if (!ctx.dominio) nao(t("domínio inválido: fico com o da Vercel", "invalid domain: using Vercel's"));
    }
  } else ctx.dominio = dominioValido(process.env.REVEZA_DOMINIO || "") || ctx.inst?.painel?.dominio || null; // atualização: REVEZA_DOMINIO liga ou troca o domínio
  ctx.equipe = equipe;
}

async function aplicarNuvem(ctx) {
  // Na primeira instalação o painel ainda não tem endereço: até publicar, o login só aceita voltar para o próprio
  // computador. Antes era <projeto>.vercel.app, um nome que pode ser de outra pessoa (a Vercel dá outro quando ele já
  // existe), e uma instalação que parasse no meio deixava o link de login apontando para lá (auditoria, 11/10/2026).
  ctx.siteProvisorio = ctx.inst?.painel?.url || "http://localhost:5173";
  const r = await provisionar({
    gerencia: ctx.gerencia, ref: ctx.ref, site: ctx.siteProvisorio, admin: ctx.admin || null, smtp: ctx.smtp, computador: ctx.nuvemNova, log: info,
  });
  ctx.url = r.url;
  ctx.anon = r.anon;
  ctx.adminId = r.adminId || ctx.inst?.nuvem?.adminId || null;
  ctx.vapidPublica = r.vapidPublica || ctx.inst?.nuvem?.vapidPublica || null;
  ok(t(`nuvem pronta em ${r.url} (${r.regiao})`, `cloud ready at ${r.url} (${r.regiao})`));
  if (r.computador) {
    const e = reveza(ctx, ["nuvem", "entrar", "--url", r.url, "--chave-publica", r.anon, "--email", r.computador.email], false, { REVEZA_SENHA: r.computador.senha });
    if (!e.ok) throw new Error(t(`não consegui guardar a identidade do computador: ${e.erro.slice(-200)}`, `could not store this computer's identity: ${e.erro.slice(-200)}`));
    ctx.emailComputador = r.computador.email;
    ok(t("identidade deste computador no chaveiro do sistema", "this computer's identity in the system keychain"));
    const c = reveza(ctx, ["cofre", "iniciar"]);
    c.ok ? ok(t("chave do cofre criada (só existe nos seus computadores)", "vault key created (exists only on your computers)"))
      : nao(t(`chave do cofre: ${c.erro.slice(-200)}`, `vault key: ${c.erro.slice(-200)}`));
  }
  // nuvem nova numa instalação que já existia: a troca que valia neste computador passa a valer na nuvem
  if (!ctx.troca && ctx.nuvemNova) ctx.troca = trocaLocal();
  if (ctx.troca && ctx.adminId) {
    await salvarTroca(consultar(ctx), ctx.adminId, { ...ctx.troca, fuso: Intl.DateTimeFormat().resolvedOptions().timeZone });
    ok(t(`troca: modo ${ctx.troca.modo}, automática ${ctx.troca.auto ? "ligada" : "desligada"}`, `switching: ${ctx.troca.modo} mode, automatic ${ctx.troca.auto ? "on" : "off"}`));
  }
}

const consultar = (ctx) => (sql, parametros) => ctx.gerencia.sql(ctx.ref, sql, parametros);

/** A configuração de troca que já vale neste computador (estado do agente), no formato da nuvem. */
export function trocaLocal(arquivo = path.join(BASE, "estado.json")) {
  try {
    const c = JSON.parse(readFileSync(arquivo, "utf8")).config;
    if (!c || !["limite", "limiar", "rodizio"].includes(c.modo)) return null;
    const aviso = Number(c.aviso) || 90;
    const troca = Number(c.troca) || 95;
    return { auto: c.auto === true, modo: c.modo, ...(aviso < troca ? { aviso, troca } : { aviso: 90, troca: 95 }) };
  } catch {
    return null;
  }
}

async function servico(ctx) {
  titulo(t("4/8 Serviço", "4/8 Service"));
  if (ctx.semServico) nao(t("sem serviço (--sem-servico): rode `reveza rodar` para testar", "no service (--sem-servico): run `reveza rodar` to test"));
  else {
    const r = reveza(ctx, ["servico", "instalar", ...(ctx.sombra ? ["--sombra"] : [])]);
    r.ok ? ok(r.saida.trim()) : nao(t(`o serviço não subiu: ${(r.saida + r.erro).trim().slice(-300)}`, `the service did not start: ${(r.saida + r.erro).trim().slice(-300)}`));
    if (!r.ok && /systemctl.*ENOENT|Failed to connect to bus/i.test(r.erro + r.saida)) {
      info(t(`Sem systemd de usuário aqui: rode "${BIN}/reveza rodar" num terminal, ou ponha no crontab: @reboot ${BIN}/reveza rodar`,
        `No user systemd here: run "${BIN}/reveza rodar" in a terminal, or add to crontab: @reboot ${BIN}/reveza rodar`));
    }
  }
  if (ctx.sombra) info(t("O mod entra quando sair do modo sombra (dois mods nas mesmas sessões disputariam a linha de status e a retomada).",
    "The mod is added when leaving shadow mode (two mods in the same sessions would fight over the status line and resuming)."));
  else if (ctx.temClaude) {
    const m = instalarMod(ctx.app, { porta: 7788 });
    m.ok ? ok(t("mod nas sessões do Claude Code (vale nas sessões novas; /reveza mostra as contas)", "mod in Claude Code sessions (applies to new sessions; /reveza shows the accounts)"))
      : nao(t(`mod: ${m.erro}`, `mod: ${m.erro}`));
  }
}

/** A versão do agente que está respondendo na ponte local (pelo `reveza status --json` do programa instalado). */
function versaoRodando(ctx) {
  const r = reveza(ctx, ["status", "--json", ...(ctx.sombra ? ["--sombra"] : [])]);
  try {
    const e = JSON.parse(r.saida);
    return e.parado ? null : e.programa ?? null;
  } catch {
    return null;
  }
}

/**
 * Depois de atualizar: o agente novo precisa responder na porta local. Se não responder em 30 s, volta o programa
 * anterior e a configuração da cópia, sobe o serviço de novo e para com erro (nada se perde: contas e logins ficam).
 */
async function conferirSubiu(ctx) {
  const porta = ctx.sombra ? 7789 : 7788;
  for (let i = 0; i < 30; i++) {
    if (versaoRodando(ctx) === VERSAO) return ok(t(`o agente ${VERSAO} está rodando`, `agent ${VERSAO} is running`));
    await new Promise((r) => setTimeout(r, 1000));
  }
  nao(t("o agente novo não respondeu em 30 s: voltando para a versão anterior", "the new agent did not answer in 30 s: going back to the previous version"));
  if (!voltarAtualizacao(ctx.app, BASE, ctx.copia)) throw new Error(t("não havia versão anterior para voltar; veja os logs em ~/.reveza/logs", "there was no previous version to go back to; see the logs in ~/.reveza/logs"));
  ctx.cli = path.join(ctx.app, "agente", "dist", "src", "cli.js");
  criarLancador(BIN, ctx.cli);
  reveza(ctx, ["servico", "instalar", ...(ctx.sombra ? ["--sombra"] : [])]);
  let voltou = false;
  for (let i = 0; i < 30 && !voltou; i++) {
    voltou = await portaOcupada(porta);
    if (!voltou) await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(voltou
    ? t(`a versão ${VERSAO} não subiu; voltei para a anterior, que está rodando. Contas e logins ficaram como estavam. Cópia: ${ctx.copia}`,
      `version ${VERSAO} did not start; went back to the previous one, which is running. Accounts and logins stayed as they were. Copy: ${ctx.copia}`)
    : t(`a versão ${VERSAO} não subiu e a anterior também não respondeu: rode reveza doctor. Cópia do estado: ${ctx.copia}`,
      `version ${VERSAO} did not start and the previous one did not answer either: run reveza doctor. State copy: ${ctx.copia}`));
}

async function painel(ctx) {
  titulo(t("5/8 Painel", "5/8 Panel"));
  prepararPasta(RAIZ, BUILD);
  const proj = await ctx.vercel.projeto(ctx.projetoVercel);
  const publicar = async (dominio, vercelHost) => {
    const b = construir(BUILD, { supabaseUrl: ctx.url, anon: ctx.anon, dominio, vercelHost, repo: REPO, versao: VERSAO, vapid: ctx.vapidPublica, reactBits: !ctx.semReactBits, log: info });
    if (b.componentes) info(t(`${b.componentes} componentes do React Bits nesta máquina`, `${b.componentes} React Bits components on this machine`));
    return await ctx.vercel.publicar(proj, b.dist, { log: info });
  };
  // atualização com o domínio já apontado: publica uma vez só, já com o redirecionamento
  const vercelAntes = ctx.inst?.painel?.urlVercel;
  let reg = null;
  let pronto = false;
  if (ctx.dominio && vercelAntes) {
    reg = await ctx.vercel.adicionarDominio(proj, ctx.dominio);
    pronto = reg.configurado || (await dnsPronto(ctx.dominio, reg.registro));
  }
  let pub = await publicar(pronto ? ctx.dominio : null, pronto ? new URL(vercelAntes).host : null);
  // atualização: o endereço do projeto na Vercel é o mesmo de antes (a implantação nova vai para ele)
  if (vercelAntes) pub = { ...pub, url: vercelAntes };
  ctx.urlVercel = pronto ? vercelAntes : pub.url;
  ok(t(`painel no ar: ${pub.url}`, `panel online: ${pub.url}`));
  let site = pronto ? `https://${ctx.dominio}` : pub.url;
  if (ctx.dominio && !pronto) {
    reg = reg || (await ctx.vercel.adicionarDominio(proj, ctx.dominio));
    pronto = reg.configurado || (await dnsPronto(ctx.dominio, reg.registro));
    if (!pronto) {
      console.log("");
      for (const l of passosCloudflare(reg.registro, t)) console.log(`    ${l}`);
      if (!ctx.semPerguntas && (await ctx.p.sim(t("Criou o registro? Confiro por até 5 minutos", "Created the record? I will check for up to 5 minutes"), true))) {
        for (let i = 0; i < 20 && !pronto; i++) {
          await new Promise((r) => setTimeout(r, 15000));
          pronto = (await dnsPronto(ctx.dominio, reg.registro)) || (await ctx.vercel.registroDns(ctx.dominio)).configurado;
        }
      }
    }
    if (pronto) {
      site = `https://${ctx.dominio}`;
      pub = await publicar(ctx.dominio, new URL(ctx.urlVercel).host);
      ok(t(`domínio próprio: ${site} (o endereço da Vercel redireciona para ele)`, `own domain: ${site} (the Vercel address redirects to it)`));
    } else nao(t(`o DNS de ${ctx.dominio} ainda não responde: o painel segue em ${pub.url}. Depois rode --atualizar para trocar.`,
      `${ctx.dominio} DNS does not answer yet: the panel stays at ${pub.url}. Later run --atualizar to switch.`));
  }
  if (site !== ctx.siteProvisorio) await trocarSite(ctx.gerencia, ctx.ref, site);
  ctx.site = site;
}

async function contas(ctx) {
  titulo(t("6/8 Contas", "6/8 Accounts"));
  const atual = emailDoClaude();
  atual ? ok(t(`conta em uso no Claude Code: ${atual} (o agente adota sozinho)`, `account in use in Claude Code: ${atual} (the agent adopts it)`))
    : nao(t("nenhuma conta conectada no Claude Code ainda", "no account connected in Claude Code yet"));
  if (ctx.sombra || ctx.semServico || !ctx.temClaude || ctx.semPerguntas) {
    info(t("Para conectar outra conta depois: reveza contas conectar <e-mail> (ou pelo painel).", "To connect another account later: reveza contas conectar <e-mail> (or from the panel)."));
    return;
  }
  for (;;) {
    const email = (await ctx.p.perguntar(t("Conectar mais uma conta? E-mail (enter para seguir)", "Connect one more account? E-mail (enter to continue)"), "")).toLowerCase();
    if (!email) break;
    if (!emailValido(email)) { nao(t("e-mail inválido", "invalid e-mail")); continue; }
    info(t("O navegador abre o login oficial: entre com ESTA conta.", "The browser opens the official login: sign in with THIS account."));
    reveza(ctx, ["contas", "conectar", email], true);
  }
}

async function alertas(ctx) {
  titulo(t("7/8 Alertas", "7/8 Alerts"));
  if (!ctx.adminId || ctx.semPerguntas) return info(t("Canais de alerta: no painel, em Alertas.", "Alert channels: in the panel, under Alerts."));
  // o ntfy saiu dos canais (12/10/2026); a notificação no celular se liga no próprio painel, em Alertas
  const canais = ["telegram", "email", "webhook"];
  const i = await ctx.p.escolha(t("Onde avisar (conta sem folga, login vencendo, computador parado)", "Where to alert (no free account, login expiring, computer stopped)"), [
    "Telegram", t("e-mail (Resend)", "e-mail (Resend)"), t("webhook (n8n, Make, script)", "webhook (n8n, Make, script)"),
    t("agora não (dá para fazer no painel, inclusive a notificação no celular)", "not now (can be done in the panel, including phone notifications)"),
  ], 4);
  if (i === 3) return;
  const canal = canais[i];
  let destino = {};
  let segredo = "";
  if (canal === "telegram") {
    info(t("1) No Telegram, fale com @BotFather, mande /newbot e copie o token.", "1) In Telegram, talk to @BotFather, send /newbot and copy the token."));
    segredo = await ctx.p.segredo(t("Token do bot:", "Bot token:"));
    info(t("2) Abra o seu bot e mande qualquer mensagem (ex.: oi).", "2) Open your bot and send any message (e.g. hi)."));
    await ctx.p.perguntar(t("Enter quando tiver mandado", "Enter when sent"), "");
    const chats = await acharChatTelegram(segredo).catch((e) => { nao(e.message); return []; });
    if (!chats.length) return nao(t("não achei a conversa: configure depois no painel", "conversation not found: set it up later in the panel"));
    // mesmo com uma conversa só, confirma pelo nome: quem mandou mensagem ao bot antes da pessoa receberia os alertas
    const c = chats.length === 1 ? 0 : await ctx.p.escolha(t("Conversa", "Chat"), chats.map((x) => x.nome), 1);
    if (chats.length === 1 && !(await ctx.p.sim(t(`Mandar os alertas para "${chats[0].nome}"?`, `Send alerts to "${chats[0].nome}"?`), true))) {
      return nao(t("conversa não confirmada: configure depois no painel", "chat not confirmed: set it up later in the panel"));
    }
    destino = { chat_id: chats[c].id };
  } else if (canal === "email") {
    segredo = ctx.resendChave || (await ctx.p.segredo(t("Chave da API do Resend (resend.com/api-keys):", "Resend API key (resend.com/api-keys):")));
    destino = { de: await ctx.p.perguntar(t("Remetente (domínio verificado no Resend)", "Sender (domain verified in Resend)"), ctx.smtp?.remetente || ""), para: await ctx.p.perguntar(t("Para", "To"), ctx.admin?.email || "") };
  } else {
    destino = { url: await ctx.p.perguntar(t("Endereço https do webhook", "Webhook https address"), "") };
    segredo = segredoWebhook();
  }
  const r = await testar(canal, destino, segredo);
  if (!r.ok) return nao(t(`o teste não chegou (${r.erro}): configure no painel, em Alertas`, `the test did not arrive (${r.erro}): set it up in the panel, under Alerts`));
  ok(t("mensagem de teste enviada", "test message sent"));
  await salvarAlerta(consultar(ctx), ctx.adminId, { canal, destino, segredo });
  ok(t("canal salvo (o segredo fica no cofre do Supabase)", "channel saved (the secret stays in the Supabase vault)"));
  if (canal === "webhook") info(t(`Segredo da assinatura (cabeçalho X-Reveza-Assinatura, HMAC-SHA256): ${segredo}  Guarde agora: não aparece de novo.`,
    `Signature secret (X-Reveza-Assinatura header, HMAC-SHA256): ${segredo}  Save it now: it is not shown again.`));
}

async function prova(ctx) {
  titulo(t("8/8 Prova final", "8/8 Final check"));
  // o serviço acabou de subir: dá até 15 s para a ponte local responder antes do doctor
  for (let i = 0; i < 15 && !ctx.semServico && !(await portaOcupada(ctx.sombra ? 7789 : 7788)); i++) await new Promise((r) => setTimeout(r, 1000));
  reveza(ctx, ["doctor", ...(ctx.sombra ? ["--sombra"] : [])], true);
  if (!ctx.gerencia || ctx.semServico || !ctx.emailComputador) return;
  let pc = null;
  for (let i = 0; i < 15 && !pc; i++) {
    pc = await computadorDoEmail(consultar(ctx), ctx.emailComputador);
    if (!pc) await new Promise((r) => setTimeout(r, 2000));
  }
  if (!pc) return nao(t("o computador ainda não apareceu na nuvem (o agente busca a cada 5 s): confira com reveza doctor", "this computer has not shown up in the cloud yet (the agent polls every 5 s): check with reveza doctor"));
  ok(t("este computador apareceu na nuvem", "this computer showed up in the cloud"));
  if (ctx.sombra || !ctx.adminId) return;
  const id = await pedirComando(consultar(ctx), ctx.adminId, pc, "atualizar");
  const e = await esperarComando(consultar(ctx), id);
  e && e.estado === "feito" ? ok(t("um comando do painel chegou a este computador e voltou", "a panel command reached this computer and came back"))
    : nao(t("o comando de teste não voltou a tempo: confira em Saúde, no painel", "the test command did not come back in time: check Health in the panel"));
}

// ── modos especiais ───────────────────────────────────────────────────────────
async function demo(ctx) {
  titulo(t("Painel em modo demonstração (dados de exemplo, nada é instalado)", "Panel in demo mode (sample data, nothing is installed)"));
  prepararPasta(RAIZ, BUILD);
  let r = rodar(npm, ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error", "--legacy-peer-deps"], { cwd: BUILD, mostrar: true });
  if (!r.ok) throw new Error("npm ci");
  if (!ctx.semReactBits) rodar(process.execPath, ["scripts/baixar-react-bits.mjs"], { cwd: BUILD, mostrar: true });
  info(t("Abrindo http://localhost:5173/?demo=1 (Ctrl+C para sair)", "Opening http://localhost:5173/?demo=1 (Ctrl+C to quit)"));
  rodar(npm, ["run", "dev", "--", "--open", "/?demo=1"], { cwd: BUILD, mostrar: true });
}

async function doctor(ctx) {
  titulo(t("Conferência da instalação", "Installation check"));
  if (!ctx.inst) return nao(t("nada instalado ainda", "nothing installed yet"));
  ctx.cli = path.join(ctx.inst.app, "agente", "dist", "src", "cli.js");
  reveza(ctx, ["doctor", ...(ctx.inst.sombra ? ["--sombra"] : [])], true);
  if (ctx.inst.nuvem?.url) {
    const r = await fetch(`${ctx.inst.nuvem.url}/auth/v1/health`, { headers: { apikey: ctx.inst.nuvem.anon } }).catch(() => null);
    r && r.ok ? ok(t("nuvem responde", "cloud answers")) : nao(t("a nuvem não respondeu", "the cloud did not answer"));
  }
  if (ctx.inst.painel?.url) {
    const r = await fetch(ctx.inst.painel.url, { redirect: "manual" }).catch(() => null);
    if (!r) return nao(t("o painel não respondeu", "the panel did not answer"));
    const faltam = ["content-security-policy", "strict-transport-security", "permissions-policy"].filter((h) => !r.headers.get(h));
    r.status < 400 ? ok(t(`painel responde (${r.status})`, `panel answers (${r.status})`)) : nao(t(`painel respondeu ${r.status}`, `panel answered ${r.status}`));
    faltam.length ? nao(t(`cabeçalhos de segurança faltando: ${faltam.join(", ")}`, `missing security headers: ${faltam.join(", ")}`)) : ok(t("cabeçalhos de segurança no lugar", "security headers in place"));
  }
}

async function desinstalar(ctx) {
  titulo(t("Desinstalar", "Uninstall"));
  if (ctx.inst) {
    ctx.cli = path.join(ctx.inst.app, "agente", "dist", "src", "cli.js");
    if (existsSync(ctx.cli)) {
      const r = reveza(ctx, ["servico", "remover"]);
      r.ok ? ok(r.saida.trim()) : nao(r.erro.trim());
    }
  }
  removerMod() ? ok(t("mod removido", "mod removed")) : nao(t("o mod não estava instalado", "the mod was not installed"));
  console.log("");
  info(t(`Ficaram: ${BASE} (os logins de cada conta, uso, estado), o projeto no Supabase e o projeto na Vercel.`, `Kept: ${BASE} (each account's login, usage, state), the Supabase project and the Vercel project.`));
  // a auditoria de 11/10/2026 notou que a mensagem calava o que fica com poder: a chave do cofre e o computador ativo
  info(t("A chave do cofre e a senha deste computador ficam no chaveiro do sistema (\"Reveza AI\"), e o computador segue ativo na nuvem.",
    "The vault key and this computer's password stay in the system keychain (\"Reveza AI\"), and the computer stays active in the cloud."));
  if (ctx.inst?.nuvem) {
    info(t("Se este computador sai de vez: no painel, Computadores → Revogar; depois apague a pasta acima e os itens \"Reveza AI\" do chaveiro.",
      "If this computer is leaving for good: in the panel, Computers → Revoke; then delete the folder above and the \"Reveza AI\" keychain items."));
  }
  info(t("A conta em uso no Claude Code continua conectada.", "The account in use in Claude Code stays connected."));
}

/**
 * Código que o painel mostra em Computadores → Ligar computador novo. O de um passo só (rvzl_) leva o endereço, a chave
 * pública, o e-mail e a senha do computador novo e a frase de 6 palavras; o antigo (rvzpc_), tudo menos a frase.
 */
export function lerCodigoDeAcesso(codigo) {
  const m = /^(rvzpc|rvzl)_([A-Za-z0-9_-]+)$/.exec(String(codigo || "").trim());
  if (!m) return null;
  try {
    const a = JSON.parse(Buffer.from(m[2], "base64url").toString("utf8"));
    if (!a || ![a.u, a.k, a.e, a.s].every((x) => typeof x === "string" && x)) return null;
    const r = { url: a.u, anon: a.k, email: a.e, senha: a.s };
    if (m[1] === "rvzl") {
      const frase = typeof a.f === "string" ? a.f.trim().toLowerCase() : "";
      if (!/^[\p{L}]+( [\p{L}]+){5}$/u.test(frase)) return null;
      r.frase = frase;
    }
    return r;
  } catch {
    return null;
  }
}

async function ligar(ctx) {
  titulo(t("Ligar este computador a uma instalação que já existe", "Join this computer to an existing installation"));
  info(t("No painel: Computadores → Ligar computador novo → Gerar o código de ligação. Cole aqui o código (rvzl_...).",
    "In the panel: Computers → Link new computer → Generate the link code. Paste the code (rvzl_...) here."));
  const codigo = await ctx.p.segredo(t("Código de ligação:", "Link code:"), "REVEZA_CODIGO");
  const doCodigo = lerCodigoDeAcesso(codigo);
  if (codigo && !doCodigo) throw new Error(t("código de acesso inválido (copie de novo do painel)", "invalid access code (copy it again from the panel)"));
  const url = doCodigo?.url ?? (await ctx.p.perguntar(t("Endereço da nuvem (https://....supabase.co)", "Cloud address (https://....supabase.co)"), process.env.REVEZA_URL || ""));
  const anon = doCodigo?.anon ?? (await ctx.p.perguntar(t("Chave pública", "Public key"), process.env.REVEZA_CHAVE_PUBLICA || ""));
  const email = doCodigo?.email ?? (await ctx.p.perguntar(t("E-mail do computador", "Computer e-mail"), process.env.REVEZA_EMAIL_COMPUTADOR || ""));
  const senha = doCodigo?.senha ?? (await ctx.p.segredo(t("Senha do computador:", "Computer password:"), "REVEZA_SENHA"));
  if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url) || !anon || !emailValido(email) || !senha) throw new Error(t("dados incompletos", "incomplete data"));
  const e = reveza(ctx, ["nuvem", "entrar", "--url", url, "--chave-publica", anon, "--email", email], false, { REVEZA_SENHA: senha });
  if (!e.ok) throw new Error(e.erro.slice(-300));
  ok(t("identidade guardada no chaveiro do sistema", "identity stored in the system keychain"));
  // o código de um passo só já traz a frase; com o código antigo, ela sai de `reveza ligar` noutro computador
  let frase = doCodigo?.frase;
  if (!frase) {
    info(t("Agora a frase de 6 palavras: num computador que já tem o Reveza, rode: reveza ligar",
      "Now the 6-word phrase: on a computer that already has Reveza, run: reveza ligar"));
    frase = await ctx.p.segredo(t("As 6 palavras:", "The 6 words:"), "REVEZA_FRASE");
  }
  // a frase vai pelo ambiente do filho, não pela linha de comando (que outros programas do computador enxergam)
  const l = reveza(ctx, ["ligar"], true, { REVEZA_FRASE: frase });
  if (!l.ok) throw new Error(t("a frase não abriu a chave do cofre", "the phrase did not open the vault key"));
  ctx.ligado = { url, anon };
}

/**
 * Atualização só do programa deste computador, sem perguntar token nenhum: computador que entrou numa instalação pelo
 * código do painel (a nuvem dele não tem `ref`) não cuida da nuvem nem do painel, quem cuida é o computador que criou a
 * instalação. Antes ele pedia o token do Supabase (12/10/2026, MacBook do Paulo).
 */
export function soEsteComputador(inst, atualizar) {
  return !!atualizar && !!inst?.nuvem && !inst.nuvem.ref;
}

// ── principal ─────────────────────────────────────────────────────────────────
async function main() {
  const a = lerArgs(process.argv.slice(2));
  if (a.erro) {
    console.error(`${a.erro}\n\n${uso()}`);
    process.exit(2);
  }
  const tem = (f) => a.flags.has(f);
  usarIdioma(a.valores["--idioma"] || "pt");
  if (tem("--versao")) return console.log(VERSAO);
  if (tem("--ajuda") || tem("--help") || tem("-h")) return console.log(`Reveza AI ${VERSAO}\n\n${uso()}`);
  console.log(`\n${verde("◆ Reveza AI")} ${fraco(`v${VERSAO}`)}  ${fraco(t("gestor de contas do assistente de código", "account manager for your coding assistant"))}`);

  const inst = lerInstalacao(ARQ_INST);
  const semPerguntas = tem("--sim") || !process.stdin.isTTY;
  const ctx = {
    inst, semPerguntas, p: perguntador({ semPerguntas }),
    app: a.valores["--pasta"] ? path.resolve(a.valores["--pasta"]) : inst?.app || path.join(BASE, "app"),
    atualizar: tem("--atualizar"), sombra: tem("--sombra") || !!inst?.sombra, forcarSombra: tem("--sombra"), sairDaSombra: tem("--sair-da-sombra"),
    importar: a.valores["--importar"],
    semNuvem: tem("--sem-nuvem") || (!!inst && !inst.nuvem && !tem("--com-nuvem") && (tem("--atualizar") || !process.stdin.isTTY || tem("--sim"))),
    nuvemNova: !inst?.nuvem, semServico: tem("--sem-servico"), semReactBits: tem("--sem-react-bits"),
  };
  try {
    if (tem("--demo")) return await demo(ctx);
    if (tem("--doctor")) return await doctor(ctx);
    if (tem("--desinstalar")) return await desinstalar(ctx);
    if (ctx.atualizar && !inst) throw new Error(t("não há instalação para atualizar: rode sem --atualizar", "nothing to update: run without --atualizar"));
    // computador novo: entra numa instalação que já existe (código do painel) ou cria uma nova
    ctx.ligar = tem("--ligar") || (!inst && /^rvz(l|pc)_/.test(process.env.REVEZA_CODIGO || ""));
    if (!inst && !ctx.ligar && !ctx.atualizar && !ctx.importar && !tem("--com-nuvem") && !tem("--sem-nuvem") && !ctx.semPerguntas) {
      const i = await ctx.p.escolha(t("Este computador", "This computer"), [
        t("vai entrar numa instalação que já existe (tenho o código do painel)", "joins an existing installation (I have the panel code)"),
        t("cria uma instalação nova (primeiro computador)", "creates a new installation (first computer)"),
      ], 2);
      ctx.ligar = i === 0;
    }
    if (!ctx.atualizar && inst && !ctx.ligar) {
      ctx.atualizar = await ctx.p.sim(t("Já existe uma instalação aqui. Atualizar (mantém contas, uso e configuração)?", "There is already an installation here. Update it (keeps accounts, usage and settings)?"), true);
      if (!ctx.atualizar) throw new Error(t("para instalar do zero, use --desinstalar antes", "to install from scratch, run --desinstalar first"));
    }

    await conferir(ctx);
    if (inst) {
      // antes de mexer em qualquer coisa: cópia conferida do estado (contas, logins, uso, configuração, identidade)
      ctx.copia = copiarEstado(BASE, `antes-${VERSAO}`);
      ok(t(`cópia do estado antes de atualizar: ${ctx.copia}`, `state copy before updating: ${ctx.copia}`));
    }
    await programa(ctx);
    if (ctx.ligar) await ligar(ctx);
    else if (!ctx.atualizar && !ctx.importar) await perguntarTroca(ctx);
    else if (ctx.importar) info(t("Troca: fica a configuração importada (ajuste no painel).", "Switching: the imported settings stay (adjust in the panel)."));
    ctx.soEsteComputador = soEsteComputador(inst, ctx.atualizar);
    if (ctx.soEsteComputador) {
      info(t("Computador ligado a uma instalação: atualizo só o programa deste computador. A nuvem e o painel são atualizados no computador que criou a instalação.",
        "Computer joined to an installation: only this computer's program is updated. The cloud and the panel are updated on the computer that created the installation."));
    } else if (!ctx.semNuvem && !ctx.ligar) {
      await nuvem(ctx);
      if (!ctx.manterNuvem) {
        await perguntarPainel(ctx);
        await aplicarNuvem(ctx);
      }
    } else if (ctx.troca) {
      gravarConfigLocal(path.join(BASE, "estado.json"), { auto: ctx.troca.auto, modo: ctx.troca.modo, aviso: ctx.troca.aviso, troca: ctx.troca.troca });
      ok(t(`troca: modo ${ctx.troca.modo}, automática ${ctx.troca.auto ? "ligada" : "desligada"} (neste computador)`, `switching: ${ctx.troca.modo} mode, automatic ${ctx.troca.auto ? "on" : "off"} (this computer)`));
    }
    await servico(ctx);
    if (ctx.atualizar && !ctx.semServico) await conferirSubiu(ctx);
    if (ctx.gerencia && ctx.vercel) await painel(ctx);
    // computador ligado: as contas vêm da nuvem (o cofre), nada para conectar aqui
    if (!ctx.atualizar && !ctx.ligar) await contas(ctx);
    if (ctx.nuvemNova && ctx.gerencia) await alertas(ctx);
    ctx.p.fechar();
    await prova(ctx);

    gravarInstalacao(ARQ_INST, {
      versao: VERSAO, app: ctx.app, sombra: !!ctx.sombra, atualizadoEm: new Date().toISOString(),
      instaladoEm: inst?.instaladoEm || new Date().toISOString(),
      nuvem: ctx.url ? { ref: ctx.ref, url: ctx.url, anon: ctx.anon, adminId: ctx.adminId, vapidPublica: ctx.vapidPublica } : ctx.ligado || inst?.nuvem || null,
      painel: ctx.site ? { url: ctx.site, urlVercel: ctx.urlVercel, projeto: ctx.projetoVercel, equipe: ctx.equipe, dominio: ctx.dominio || null } : inst?.painel || null,
    });

    titulo(t(`Pronto: Reveza AI ${VERSAO}`, `Done: Reveza AI ${VERSAO}`));
    if (ctx.site) console.log(`  ${t("Painel", "Panel")}: ${verde(ctx.site)}  ${fraco(ctx.admin ? `(${ctx.admin.email})` : "")}`);
    console.log(`  ${t("No terminal", "In the terminal")}: ${verde("reveza status")}, ${verde("reveza contas")}, ${verde("reveza uso")}, ${verde("reveza doctor")}`);
    console.log(`  ${t("Nas sessões do Claude Code", "In Claude Code sessions")}: ${verde("/reveza")}`);
    if (ctx.sombra) console.log(`  ${negrito(t("Modo sombra", "Shadow mode"))}: ${t("nada troca. Quando parar o outro gestor, rode --atualizar: ele pergunta se sai do modo sombra.", "nothing switches. After stopping the other manager, run --atualizar: it asks whether to leave shadow mode.")}`);
    console.log(fraco(t("  Cada pessoa responde pelo uso das próprias contas e pelos termos do serviço de IA que usa.\n", "  Each person is responsible for the use of their own accounts and for the terms of the AI service they use.\n")));
  } catch (e) {
    ctx.p.fechar();
    const causa = e.cause && e.cause.message ? ` (${e.cause.message})` : "";
    console.error(`\n  ${t("Parei", "Stopped")}: ${e.message}${causa}\n`);
    if (process.env.REVEZA_DEPURAR) console.error(e.stack, e.cause);
    process.exit(1);
  }
}

const chamado = (() => { try { return realpathSync(process.argv[1] || ""); } catch { return ""; } })();
if (chamado === fileURLToPath(import.meta.url)) main();
