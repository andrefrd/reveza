#!/usr/bin/env node
// Prova de ponta a ponta num Windows de verdade (.github/workflows/windows.yml, numa máquina descartável do GitHub):
//   - o instalador cria a tarefa agendada do agente, o agente sobe sozinho e sem janela, o `reveza` responde, a
//     atualização troca o agente que está rodando, o agente volta sozinho se cair, e a desinstalação tira a tarefa e
//     para o agente. O Node e o programa ficam em pastas com espaço e acento (C:\Users\João Silva\...), de propósito;
//   - a janela de confirmação (InputBox) aparece de verdade e alguém digita nela; o som (SoundPlayer) toca;
//   - o Claude Code de verdade (o do npm) é achado pelo agente e lê o login e a conta onde o agente grava.
// Recusa rodar fora do GitHub Actions: mexe no perfil do usuário de verdade (tarefa agendada, ~\.reveza, ~\.claude, o
// Path do usuário).
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

if (process.platform !== "win32") {
  console.error("e2e-windows: só no Windows");
  process.exit(2);
}
if (process.env.GITHUB_ACTIONS !== "true") {
  console.error("e2e-windows: recuso rodar fora do GitHub Actions (mexe no perfil de verdade: tarefa agendada, ~\\.reveza, ~\\.claude, Path)");
  process.exit(2);
}

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMP = process.env.RUNNER_TEMP || os.tmpdir();
const PROVAS = path.join(TEMP, "provas");
mkdirSync(PROVAS, { recursive: true });
const HOME = os.homedir();
const BASE = path.join(HOME, ".reveza");
// espaço e acento no caminho do Node e do programa, como no computador de quem se chama João Silva
const DIFICIL = path.join(process.env.PUBLIC || "C:\\Users\\Public", "João Silva ção");
const NODE = path.join(DIFICIL, "Node com espaço", "node.exe");
const PASTA_APP = path.join(DIFICIL, "Reveza AI", "app");
const APP = path.join(PASTA_APP, "agente", "dist", "src");
const LANCADOR = path.join(BASE, "bin", "reveza.cmd");
const TAREFA = "Reveza AI agente";
const PORTA = 7788;
const CODIGO = "K7Q2M9";

const resultados = [];
const conferir = (nome, ok, detalhe = "") => {
  resultados.push({ nome, ok: !!ok });
  console.log(`${ok ? "ok   " : "FALHA"} ${nome}${detalhe ? `: ${String(detalhe).trim().slice(0, 600)}` : ""}`);
};
const info = (nome, detalhe = "") => console.log(`info  ${nome}${detalhe ? `: ${String(detalhe).trim().slice(0, 1500)}` : ""}`);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const guardar = (nome, texto) => writeFileSync(path.join(PROVAS, nome), texto);
const modulo = (nome) => import(pathToFileURL(path.join(APP, nome)).href);
const lerTexto = (arq) => { try { return readFileSync(arq, "utf8"); } catch { return ""; } };
const lerJson = (arq) => { try { return JSON.parse(readFileSync(arq, "utf8")); } catch { return null; } };

function rodar(cmd, args = [], { env, cwd, entrada, shell = false, timeout = 300_000 } = {}) {
  const r = spawnSync(cmd, args, { cwd, env: env ?? process.env, input: entrada, encoding: "utf8", windowsHide: true, shell, maxBuffer: 64 << 20, timeout });
  return { codigo: r.status ?? -1, saida: r.stdout ?? "", erro: `${r.stderr ?? ""}${r.error ? String(r.error) : ""}` };
}
const codificado = (script) => Buffer.from(script, "utf16le").toString("base64");
/** PowerShell com o script codificado (nada de aspas pelo caminho); a saída volta em UTF-8. */
const ps = (script, op = {}) =>
  rodar("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand",
    codificado(`[Console]::OutputEncoding = [Text.Encoding]::UTF8\n$ProgressPreference = 'SilentlyContinue'\n${script}`)], op);
const aspasPs = (t) => `'${String(t).replace(/['\u2018\u2019\u201A\u201B]/g, "$&$&")}'`;

function portaAberta(porta) {
  return new Promise((resolve) => {
    const s = net.connect({ port: porta, host: "127.0.0.1" });
    const fim = (v) => { s.destroy(); resolve(v); };
    s.once("connect", () => fim(true));
    s.once("error", () => fim(false));
    s.setTimeout(800, () => fim(false));
  });
}
async function ate(cond, segundos) {
  const fim = Date.now() + segundos * 1000;
  while (Date.now() < fim) {
    if (await cond()) return true;
    await esperar(1000);
  }
  return !!(await cond());
}
const pidDoAgente = () => lerJson(path.join(BASE, "ponte.json"))?.pid ?? null;
function processo(pid) {
  if (!pid) return null;
  const r = ps(`$p = Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}"; if ($p) { "$($p.Name)|$($p.SessionId)|$($p.ParentProcessId)|$($p.CommandLine)" }`);
  const [nome, sessao, pai, ...cmd] = r.saida.trim().split("|");
  return nome ? { nome, sessao: Number(sessao), pai: Number(pai), linha: cmd.join("|") } : null;
}
const tarefaXml = () => rodar("schtasks", ["/Query", "/TN", TAREFA, "/XML"]);
/** O comando `reveza` como num terminal: o reveza.cmd pelo cmd. */
const reveza = (...args) => rodar(`"${LANCADOR}" ${args.join(" ")}`, [], { shell: true });

function captura(nome) {
  const r = ps(`Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
[System.Drawing.Graphics]::FromImage($bmp).CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
$bmp.Save(${aspasPs(path.join(PROVAS, nome))}, [System.Drawing.Imaging.ImageFormat]::Png)
"$($b.Width)x$($b.Height)"`);
  return r.codigo === 0 ? `${nome} (${r.saida.trim()})` : `sem captura: ${r.erro.trim().slice(0, 300)}`;
}

/** Janelas visíveis na tela (programa e título). */
function janelas() {
  const r = ps(`Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class Janelas {
  delegate bool Proc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(Proc f, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static List<string> Listar() {
    var r = new List<string>();
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h)) return true;
      var s = new StringBuilder(512); GetWindowText(h, s, 512);
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (s.Length > 0) r.Add(pid + "|" + s);
      return true;
    }, IntPtr.Zero);
    return r;
  }
}
"@
foreach ($l in [Janelas]::Listar()) { $p2, $t = $l -split '\\|', 2; $n = (Get-Process -Id $p2 -ErrorAction SilentlyContinue).ProcessName; "$n|$p2|$t" }`);
  return r.saida.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/** Alguém na frente da tela: espera a janela "Reveza AI", tira uma foto e digita as teclas. */
function digitador(teclas, foto = "", segundos = 40) {
  const d = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", codificado(`
$ws = New-Object -ComObject WScript.Shell
for ($i = 0; $i -lt ${segundos * 2}; $i++) {
  if ($ws.AppActivate('Reveza AI')) {
    Start-Sleep -Milliseconds 700
    if ($env:REVEZA_FOTO) {
      Add-Type -AssemblyName System.Windows.Forms, System.Drawing
      $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
      $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
      [System.Drawing.Graphics]::FromImage($bmp).CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
      $bmp.Save($env:REVEZA_FOTO, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    $ws.SendKeys($env:REVEZA_TECLAS)
    exit 0
  }
  Start-Sleep -Milliseconds 500
}
exit 3`)], { env: { ...process.env, REVEZA_TECLAS: teclas, REVEZA_FOTO: foto ? path.join(PROVAS, foto) : "" }, stdio: "ignore", windowsHide: true });
  return new Promise((r) => d.on("close", r));
}

// ── 0. a máquina ──────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const r = ps(`$adm = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
"sessão $((Get-Process -Id $PID).SessionId), interativo $([Environment]::UserInteractive), administrador $adm, usuário $env:USERNAME"
(Get-CimInstance Win32_OperatingSystem).Caption + ' ' + [Environment]::OSVersion.Version
"página de código: " + (chcp)`);
  info("máquina", r.saida.replace(/\r?\n+/g, " · "));
  mkdirSync(path.dirname(NODE), { recursive: true });
  copyFileSync(process.execPath, NODE);
  info("Node", `${process.version}, copiado para ${NODE}`);
}

// ── 1. instalar com o serviço, de dentro de um node_modules (como o npx deixa) ────────────────────────────────────────
const NPX = path.join(TEMP, "npx", "node_modules", "reveza");
rmSync(NPX, { recursive: true, force: true });
cpSync(RAIZ, NPX, { recursive: true, filter: (f) => !/[\\/](\.git|node_modules|dist)([\\/]|$)/.test(`/${path.relative(RAIZ, f)}`) });
const instalar = (...extra) => rodar(NODE, ["instalador/instalar.mjs", "--sim", "--sem-nuvem", "--sem-react-bits", "--pasta", PASTA_APP, ...extra], { cwd: NPX });
{
  const r = instalar();
  guardar("1-instalador.txt", r.saida + r.erro);
  conferir("instalador termina sem erro, com o serviço", r.codigo === 0 && /Pronto: Reveza AI/.test(r.saida), r.codigo === 0 ? "" : (r.saida + r.erro).slice(-800));
  conferir("o instalador registra a tarefa agendada", /tarefa "Reveza AI agente" criada/.test(r.saida), (r.saida.match(/.*(tarefa|serviço não subiu).*/i) || [""])[0]);
  conferir("o mod entra nas sessões do Claude Code", /mod nas sessões do Claude Code/.test(r.saida), (r.saida.match(/.*mod.*/gi) || []).join(" / "));
  conferir("a prova final do instalador acha o Claude Code", /ok\s+Assistente de código/.test(r.saida), (r.saida.match(/.*Assistente de código.*/) || [""])[0]);
}

// ── 2. a tarefa ───────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const r = tarefaXml();
  // o arquivo da tarefa (UTF-16) em vez da saída do schtasks, que sai na página de código do console e estraga o acento
  const arqTarefa = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "Tasks", TAREFA);
  const xml = existsSync(arqTarefa) ? readFileSync(arqTarefa).toString("utf16le").replace(/^\uFEFF/, "") : "";
  guardar("2-tarefa.xml", xml || r.saida + r.erro);
  conferir("a tarefa existe no Agendador", r.codigo === 0 && /<Task/.test(xml), r.erro);
  const tag = (t) => (new RegExp(`<${t}>([^<]*)</${t}>`).exec(xml) || [])[1];
  info("tarefa", ["LogonType", "RunLevel", "ExecutionTimeLimit", "DisallowStartIfOnBatteries", "StopIfGoingOnBatteries", "MultipleInstancesPolicy", "Interval", "Command", "Arguments"]
    .map((t) => `${t}=${tag(t)}`).join(" · "));
  conferir("roda como o usuário, sem privilégio elevado", tag("LogonType") === "InteractiveToken" && tag("RunLevel") === "LeastPrivilege");
  conferir("não para o agente depois de 3 dias", tag("ExecutionTimeLimit") === "PT0S", `ExecutionTimeLimit=${tag("ExecutionTimeLimit")}`);
  conferir("roda e segue rodando na bateria", tag("DisallowStartIfOnBatteries") === "false" && tag("StopIfGoingOnBatteries") === "false");
  conferir("gatilho de entrada só deste usuário (não pede administrador)", /<LogonTrigger>[\s\S]*?<UserId>[^<]+<\/UserId>[\s\S]*?<\/LogonTrigger>/.test(xml));
  conferir("gatilho de minuto em minuto, uma instância por vez", tag("Interval") === "PT1M" && tag("MultipleInstancesPolicy") === "IgnoreNew");
  conferir("roda pelo conhost sem janela, com espaço e acento inteiros", /conhost\.exe$/i.test(tag("Command") || "") && (tag("Arguments") || "").includes(`--headless &quot;${NODE}&quot; &quot;${path.join(APP, "cli.js")}&quot; rodar --vigiar-pai`)
    || (tag("Arguments") || "").includes(`--headless "${NODE}" "${path.join(APP, "cli.js")}" rodar --vigiar-pai`), tag("Arguments"));
}

// ── 3. o agente sobe sozinho e responde ───────────────────────────────────────────────────────────────────────────────
{
  const subiu = await ate(() => portaAberta(PORTA), 30);
  conferir("o agente sobe pela tarefa e responde na porta local", subiu, subiu ? "" : lerTexto(path.join(BASE, "logs", "agente.log")).slice(-600));
  const pid = pidDoAgente();
  const p = processo(pid);
  info("processo do agente", p ? `${p.nome}, pid ${pid}, sessão ${p.sessao}, pai ${processo(p.pai)?.nome ?? p.pai}: ${p.linha}` : "não achei");
  conferir("o agente é o Node da pasta com acento, chamado pelo conhost", p && p.linha.includes(NODE) && /conhost/i.test(processo(p.pai)?.nome ?? ""), p?.linha);
  const st = reveza("status");
  conferir("reveza status (pelo reveza.cmd, com acento no caminho) diz que o agente está rodando", st.codigo === 0 && /Agente: rodando na porta 7788/.test(st.saida), st.saida + st.erro);
  const ss = reveza("servico", "status");
  conferir("reveza servico status: instalado e rodando", ss.codigo === 0 && /instalado, rodando/.test(ss.saida), ss.saida + ss.erro);
  const dr = reveza("doctor", "--json");
  guardar("3-doctor.json", dr.saida + dr.erro);
  let d = [];
  try { d = JSON.parse(dr.saida); } catch { /* fica vazio */ }
  const item = (id) => d.find((x) => x.id === id) || {};
  conferir("doctor: serviço, ponte e Claude Code ok", ["servico", "ponte", "assistente"].every((i) => item(i).situacao === "ok"),
    d.map((x) => `${x.id}=${x.situacao} (${x.detalhe})`).join(" · "));
  conferir("doctor: mod ok", item("mod").situacao === "ok", item("mod").detalhe);

  const c1 = reveza("cofre", "iniciar");
  const protegido = lerTexto(path.join(BASE, "segredos", "chave-cofre.dpapi")).trim();
  conferir("cofre iniciar guarda a chave pela DPAPI (arquivo cifrado, não a chave)", c1.codigo === 0 && /criada/.test(c1.saida) && protegido.startsWith("AQAAANCMnd8BFdERjHoAwE"), c1.saida + c1.erro);
  const c2 = reveza("cofre", "iniciar");
  conferir("a chave guardada se lê de volta (cofre iniciar de novo não cria outra)", c2.codigo === 0 && /já tem a chave/.test(c2.saida), c2.saida + c2.erro);
  const som = reveza("som", "testar");
  conferir("o agente da tarefa toca o som (reveza som testar)", som.codigo === 0 && /ligado/.test(som.saida) && !/não tem tocador/.test(som.saida), som.saida + som.erro);
}

// ── 4. a tela: nenhuma janela do agente ───────────────────────────────────────────────────────────────────────────────
{
  info("captura com o agente rodando", captura("4-agente-rodando.png"));
  const js = janelas();
  guardar("4-janelas.txt", js.join("\n"));
  const doAgente = js.filter((l) => /node|cli\.js|reveza|conhost/i.test(l));
  conferir("o agente não abre janela de terminal na tela", doAgente.length === 0, doAgente.join(" / ") || `${js.length} janelas visíveis, nenhuma do agente`);
}

// ── 5. o comando reveza: código de saída e página de código ───────────────────────────────────────────────────────────
{
  const teste = path.join(TEMP, "lancador-teste.cmd");
  writeFileSync(teste, ["@echo off", "chcp 850 >nul", `call "${LANCADOR}" comando-que-nao-existe >nul 2>&1`, "echo saida=%errorlevel%", "chcp", ""].join("\r\n"));
  const r = rodar("cmd.exe", ["/d", "/c", teste]);
  conferir("reveza.cmd devolve o código de saída do agente e volta à página de código de antes", /saida=2\b/.test(r.saida) && /850/.test(r.saida.split(/\r?\n/).filter(Boolean).at(-1) || ""), r.saida.split(/\r?\n/).filter((l) => /saida=|850|65001/.test(l)).join(" / "));
  const { acrescentarPath } = await import(pathToFileURL(path.join(NPX, "instalador", "lib", "programa.mjs")).href);
  const bin = path.dirname(LANCADOR);
  ps(`[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment').SetValue('Path', '%USERPROFILE%\\ferramentas', [Microsoft.Win32.RegistryValueKind]::ExpandString)`);
  const ok = acrescentarPath(bin);
  const reg = ps(`$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment'); $k.GetValueKind('Path').ToString() + '|' + $k.GetValue('Path', '', 'DoNotExpandEnvironmentNames')`).saida.trim();
  conferir("acrescentar ao Path do usuário: entra o bin, o %USERPROFILE% de antes fica como estava (REG_EXPAND_SZ)", ok && reg === `ExpandString|%USERPROFILE%\\ferramentas;${bin}`, reg);
  const doRegistro = ps(`[Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')`).saida.trim();
  const ambiente = { ...process.env };
  for (const k of Object.keys(ambiente)) if (k.toLowerCase() === "path") delete ambiente[k];
  const novo = rodar("reveza versao", [], { shell: true, env: { ...ambiente, Path: doRegistro } });
  conferir("num terminal novo, `reveza versao` responde pelo Path", novo.codigo === 0 && /^\d+\.\d+\.\d+/.test(novo.saida.trim()), novo.saida + novo.erro);
}

// ── 6. a janela de confirmação de verdade e o som ─────────────────────────────────────────────────────────────────────
{
  const conf = await modulo("confirmar.js");
  const somM = await modulo("som.js");
  const { executorReal } = await modulo("util/executor.js");
  const t0 = Date.now();
  info("som: tocarSom", `${await somM.tocarSom(executorReal, "windows")} em ${Date.now() - t0} ms`);
  // o jeito antigo: o PowerShell escondido esconde também a InputBox (a pessoa nunca vê a janela)
  const antigo = digitador("{ESC}", "", 15);
  await executorReal.rodar(conf.comandoDaJanela("windows", "pt-BR"), { timeoutMs: 20_000 });
  info("o jeito antigo (PowerShell escondido): a janela apareceu?", String((await antigo) === 0));
  for (const [teclas, esperado, nome, foto] of [[`${CODIGO}{ENTER}`, "liberou", "o código certo libera", "6-janela-de-confirmacao.png"], ["K7Q2{ENTER}", "recusou", "só os 4 primeiros recusam", ""], ["{ESC}", "recusou", "Esc recusa", ""]]) {
    const d = digitador(teclas, foto);
    const t1 = Date.now();
    const r = await conf.pedirConfirmacao(executorReal, "windows", CODIGO, "pt-BR");
    const cod = await d;
    conferir(`janela de confirmação de verdade: ${nome}`, r === esperado && cod === 0, `${r} em ${Date.now() - t1} ms; a janela ${cod === 0 ? "apareceu" : "não apareceu"}`);
    if (cod !== 0) break;
  }
}

// ── 7. atualizar com o agente rodando troca o agente ──────────────────────────────────────────────────────────────────
{
  const antes = pidDoAgente();
  const r = instalar("--atualizar");
  guardar("7-atualizar.txt", r.saida + r.erro);
  conferir("atualizar com o agente rodando termina sem erro", r.codigo === 0 && /Pronto: Reveza AI/.test(r.saida), (r.saida + r.erro).slice(-800));
  await ate(async () => (await portaAberta(PORTA)) && pidDoAgente() !== antes, 30);
  const depois = pidDoAgente();
  conferir("depois de atualizar, roda um agente novo (o antigo saiu)", depois && depois !== antes && !processo(antes) && (await portaAberta(PORTA)), `antes ${antes}, depois ${depois}, antigo vivo: ${!!processo(antes)}`);
}

// ── 8. o agente cai e volta; a tarefa para e o agente para junto ──────────────────────────────────────────────────────
{
  const antes = pidDoAgente();
  rodar("taskkill", ["/F", "/PID", String(antes)]);
  const caiu = await ate(async () => !(await portaAberta(PORTA)), 10);
  const t0 = Date.now();
  const voltou = caiu && (await ate(async () => (await portaAberta(PORTA)) && pidDoAgente() !== antes, 100));
  conferir("o agente que cai volta sozinho (em até 1 minuto e pouco)", voltou, `${caiu ? "caiu" : "não caiu"}; ${voltou ? `voltou em ${Math.round((Date.now() - t0) / 1000)} s` : "não voltou em 100 s"}`);
  const vivo = pidDoAgente();
  const fim = rodar("schtasks", ["/End", "/TN", TAREFA]);
  const parou = await ate(async () => !(await portaAberta(PORTA)) && !processo(vivo), 10);
  conferir("schtasks /End para o agente junto (não fica órfão segurando a porta)", parou, `${fim.saida.trim()} · vivo: ${!!processo(vivo)}`);
  await ate(() => portaAberta(PORTA), 100);
}

// ── 9. desinstalar tira a tarefa e para o agente ──────────────────────────────────────────────────────────────────────
{
  const vivo = pidDoAgente();
  const r = rodar(NODE, ["instalador/instalar.mjs", "--desinstalar"], { cwd: NPX });
  guardar("9-desinstalar.txt", r.saida + r.erro);
  conferir("desinstalar termina sem erro", r.codigo === 0, (r.saida + r.erro).slice(-500));
  conferir("desinstalar tira o mod", /mod removido/.test(r.saida));
  conferir("a tarefa sumiu do Agendador", tarefaXml().codigo !== 0);
  conferir("o arquivo da tarefa sumiu (C:\\Windows\\System32\\Tasks e o XML do Reveza)",
    !existsSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "Tasks", TAREFA)) && !existsSync(path.join(BASE, "tarefa-windows.xml")));
  const parou = await ate(async () => !(await portaAberta(PORTA)) && !processo(vivo), 15);
  conferir("o agente parou", parou, parou ? "" : `pid ${vivo} ainda vivo`);
  await esperar(70_000);
  conferir("e não volta (o gatilho de minuto em minuto saiu junto)", !(await portaAberta(PORTA)));
  info("ficam por escolha (o instalador avisa)", ["instalacao.json", "estado.json", "segredos", "bin"].filter((f) => existsSync(path.join(BASE, f))).join(", "));
}

// ── 10. o Claude Code de verdade: binário, login e conta onde o agente grava ──────────────────────────────────────────
{
  const where = rodar("where", ["claude"], { shell: true });
  const cmd = where.saida.split(/\r?\n/).map((l) => l.trim()).find((l) => /\.cmd$/i.test(l));
  if (cmd) guardar("10-claude.cmd.txt", readFileSync(cmd, "utf8"));
  const { acharBinario, ClaudeCli } = await modulo("claudecli.js");
  const { executorReal } = await modulo("util/executor.js");
  const bin = acharBinario();
  const v = await new ClaudeCli(executorReal).versao();
  conferir("o agente acha e roda o Claude Code instalado pelo npm (o claude.cmd chama um .exe)", !!v && /\.exe$/i.test(bin), `${where.saida.replace(/\r?\n/g, " ")} → ${bin} → ${v}`);
  const { caminhos } = await modulo("config.js");
  const c = caminhos();
  conferir("caminhos: %USERPROFILE%\\.claude e %USERPROFILE%\\.claude.json", c.principalDir === path.join(process.env.USERPROFILE, ".claude") && c.claudeJson === path.join(process.env.USERPROFILE, ".claude.json"),
    `${c.principalDir} · ${c.claudeJson}`);
  if (v) {
    const { CredenciaisArquivo } = await modulo("credenciais/arquivo.js");
    const { ClaudeJson } = await modulo("claudejson.js");
    const { relogioReal } = await modulo("util/tempo.js");
    const cred = new CredenciaisArquivo(c.principalDir);
    const cj = new ClaudeJson(relogioReal);
    // login de mentira (nenhuma conta de verdade): só para ver ONDE o Claude Code lê
    const login = (quem) => ({ claudeAiOauth: { accessToken: `falso-acesso-${quem}`, refreshToken: `falso-renova-${quem}`, expiresAt: Date.now() + 3_600_000,
      scopes: ["user:inference", "user:profile", "user:sessions:claude_code"], subscriptionType: "max", rateLimitTier: "default_claude_max_5x" } });
    const conta = (quem) => ({ accountUuid: `00000000-0000-4000-8000-00000000000${quem === "a" ? 1 : 2}`, emailAddress: `conta-${quem}@exemplo.com`,
      organizationUuid: "00000000-0000-4000-8000-000000000009", organizationName: "Exemplo", organizationRole: "admin", displayName: `Conta ${quem}` });
    const pasta = path.join(BASE, "contas", "e2e-b");
    mkdirSync(pasta, { recursive: true });
    await cred.gravar("principal", login("a"));
    await cj.gravarConta(c.claudeJson, conta("a"));
    await cred.gravar(pasta, login("b"));
    await cj.gravarConta(path.join(pasta, ".claude.json"), conta("b"));
    const limpo = { ...process.env };
    for (const k of Object.keys(limpo)) if (k === "CLAUDE_CONFIG_DIR" || k.startsWith("ANTHROPIC_") || k.startsWith("CLAUDE_CODE_")) delete limpo[k];
    const a = rodar(bin, ["auth", "status", "--json"], { env: limpo, timeout: 60_000 });
    const b = rodar(bin, ["auth", "status", "--json"], { env: { ...limpo, CLAUDE_CONFIG_DIR: pasta }, timeout: 60_000 });
    guardar("10-claude-auth-status.txt", `principal (${a.codigo}):\n${a.saida}\n${a.erro}\n\npasta da conta (${b.codigo}):\n${b.saida}\n${b.erro}\n`);
    conferir("o Claude Code lê o login e a conta que o agente gravou em %USERPROFILE%", /"email": "conta-a@exemplo\.com"/.test(a.saida) && /"loggedIn": true/.test(a.saida), a.saida + a.erro);
    conferir("com CLAUDE_CONFIG_DIR, o Claude Code lê o login e a conta da pasta da conta", /"email": "conta-b@exemplo\.com"/.test(b.saida) && b.saida.includes(JSON.stringify(pasta).slice(1, -1)), b.saida + b.erro);
    rmSync(path.join(c.principalDir, ".credentials.json"), { force: true });
  }
}

// ── 11. sem administrador (o token filtrado de quem roda o npx num terminal comum) ────────────────────────────────────
{
  const sid = /"(S-1-[0-9-]+)"/.exec(rodar("whoami", ["/user", "/fo", "csv", "/nh"]).saida)?.[1];
  const { xmlTarefa } = await modulo("servico.js");
  const dir = path.join(process.env.PUBLIC || "C:\\Users\\Public", "reveza-comum");
  mkdirSync(dir, { recursive: true });
  const xml = xmlTarefa({ sistema: "windows", home: HOME, node: NODE, script: path.join(APP, "cli.js"), logs: dir, exec: null }, sid).replace("Reveza AI: agente", "Reveza AI: ensaio");
  writeFileSync(path.join(dir, "tarefa.xml"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, "utf16le")]));
  writeFileSync(path.join(dir, "teste.cmd"), [
    "@echo off",
    `whoami /groups > "${dir}\\grupos.txt" 2>&1`,
    `schtasks /Create /F /TN "Reveza comum antigo" /SC ONLOGON /RL LIMITED /TR "cmd /c exit" > "${dir}\\antigo.txt" 2>&1`,
    `schtasks /Create /F /TN "Reveza comum xml" /XML "${dir}\\tarefa.xml" > "${dir}\\xml.txt" 2>&1`,
    `schtasks /Delete /F /TN "Reveza comum xml" > "${dir}\\apagar.txt" 2>&1`,
    `echo fim > "${dir}\\fim.txt"`,
    "",
  ].join("\r\n"));
  rodar("runas", ["/trustlevel:0x20000", path.join(dir, "teste.cmd")], { timeout: 20_000 });
  const terminou = await ate(() => existsSync(path.join(dir, "fim.txt")), 40);
  const grupos = lerTexto(path.join(dir, "grupos.txt"));
  const semAdm = /BUILTIN\\Administrators[^\r\n]*(Group used for deny only|Usado para negar)/i.test(grupos) || /Medium Mandatory Level/i.test(grupos);
  info("sem administrador (runas /trustlevel)", `terminou ${terminou}; token sem administrador: ${semAdm}` +
    ` · antigo (/SC ONLOGON): ${lerTexto(path.join(dir, "antigo.txt")).trim()} · XML (gatilho só do usuário): ${lerTexto(path.join(dir, "xml.txt")).trim()} · apagar: ${lerTexto(path.join(dir, "apagar.txt")).trim()}`);
  conferir("sem administrador, a tarefa por XML (gatilho só do usuário) é criada; a do jeito antigo, não",
    terminou && semAdm && /SUCCESS/i.test(lerTexto(path.join(dir, "xml.txt"))) && /denied|negado/i.test(lerTexto(path.join(dir, "antigo.txt"))), lerTexto(path.join(dir, "xml.txt")));
  rodar("schtasks", ["/Delete", "/F", "/TN", "Reveza comum antigo"]);
  rodar("schtasks", ["/Delete", "/F", "/TN", "Reveza comum xml"]);
}

const falhas = resultados.filter((r) => !r.ok);
console.log(`\n${resultados.length - falhas.length}/${resultados.length} conferências ok`);
process.exit(falhas.length ? 1 : 0);
