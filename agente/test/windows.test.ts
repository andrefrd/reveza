// O que o PowerShell do Windows faz com os scripts que o agente monta (janela de confirmação, som e a DPAPI da guarda).
// A parte que depende do PowerShell de verdade só roda no Windows (no GitHub Actions, .github/workflows/windows.yml):
// o parser do PowerShell lê cada script sem erro e sem nada interpretado, e um texto hostil passa pelo argv, pela linha
// de comando do Windows e pelo PowerShell sem mudar e sem virar comando.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { aspasPs, comandoDaJanela } from "../src/confirmar.js";
import { comandosDoSom } from "../src/som.js";
import { GuardaWindows } from "../src/cofre/guarda.js";
import { executorReal } from "../src/util/executor.js";

const NAO_WINDOWS = process.platform !== "win32" ? "só no Windows (o PowerShell de verdade)" : false;

/** Texto que tentaria fechar a string, interpolar ou encadear comando, se o escape falhasse. */
const HOSTIS = [
  "'; Remove-Item C:\\nada -WhatIf; '",
  "$(Write-Output injetado) ${env:USERNAME} $env:PATH @(1) @{a=1}",
  "crase `n `t `$x `' e `\"",
  '"aspas duplas" e \\"barra\\" \\\\ no fim \\',
  "tipográficas ‘a’ ’b‘ ‚c‛ “d” ”e“ „f",
  "acentos e outros: ção, ü, ñ, ✓, 日本, emoji 🙂",
  "%PATH% & | < > ^ ; ( ) { } # <# #> --% -Command",
];

test("aspas do PowerShell: toda aspa simples, inclusive a tipográfica, é dobrada; o resto fica como está", () => {
  assert.equal(aspasPs("a'b"), "'a''b'");
  assert.equal(aspasPs("don’t"), "'don’’t'");
  assert.equal(aspasPs("‘x‛‚"), "'‘‘x‛‛‚‚'");
  assert.equal(aspasPs('$x "y" `z'), "'$x \"y\" `z'");
  const janela = comandoDaJanela("windows", "pt-BR")!.at(-1)!;
  assert.ok(janela.includes("'Reveza AI'") && janela.includes("[char]10"));
});

/** Roda um script do jeito que o agente roda: argv para o PowerShell, sem shell. A saída volta em base64 (UTF-8). */
async function powershell(script: string): Promise<string> {
  const r = await executorReal.rodar(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], { timeoutMs: 60_000 });
  assert.equal(r.codigo, 0, `PowerShell saiu com ${r.codigo}: ${r.erro}`);
  return Buffer.from(r.saida.trim(), "base64").toString("utf8");
}

interface Analise {
  erros: string[];
  comandos: string[];
  textos: string[];
  dinamicos: number;
}

/** O parser do PowerShell sobre um script: erros, comandos chamados, textos literais e partes que seriam interpretadas. */
async function analisar(script: string): Promise<Analise> {
  const b64 = Buffer.from(script, "utf8").toString("base64");
  const L = "System.Management.Automation.Language";
  const j = await powershell(
    `$s = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')); $t = $null; $e = $null; ` +
      `$a = [${L}.Parser]::ParseInput($s, [ref]$t, [ref]$e); ` +
      `$c = @($a.FindAll({ param($n) $n -is [${L}.CommandAst] }, $true) | ForEach-Object { $_.GetCommandName() }); ` +
      `$x = @($a.FindAll({ param($n) $n -is [${L}.StringConstantExpressionAst] -and $n.StringConstantType -eq 'SingleQuoted' }, $true) | ForEach-Object { $_.Value }); ` +
      `$d = @($a.FindAll({ param($n) $n -is [${L}.ExpandableStringExpressionAst] -or $n -is [${L}.SubExpressionAst] -or $n -is [${L}.VariableExpressionAst] -or $n -is [${L}.ScriptBlockExpressionAst] }, $true)).Count; ` +
      `$j = ConvertTo-Json -Compress -Depth 4 -InputObject @{ erros = @($e | ForEach-Object { $_.Message }); comandos = $c; textos = $x; dinamicos = $d }; ` +
      `[Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($j)))`,
  );
  const a = JSON.parse(j) as Analise;
  // o ConvertTo-Json do Windows PowerShell desembrulha a lista de um item só
  for (const k of ["erros", "comandos", "textos"] as const) a[k] = ([] as string[]).concat(a[k] ?? []);
  return a;
}

test("janela de confirmação: o PowerShell lê o script sem erro, só chama o Add-Type e nada é interpretado", { skip: NAO_WINDOWS }, async () => {
  for (const [idioma, errou, trecho] of [
    ["pt-BR", false, "Para liberar, digite o código de 12 caracteres"],
    ["en", false, "To let it in, type the 12-character code"],
    ["pt-BR", true, "O código não confere."],
    ["en", true, "Check the 12-character code on the new computer's screen"],
  ] as const) {
    const argv = comandoDaJanela("windows", idioma, process.env, errou)!;
    assert.deepEqual(argv.slice(0, 4), ["powershell", "-NoProfile", "-NonInteractive", "-Command"]);
    const a = await analisar(argv.at(-1)!);
    assert.deepEqual(a.erros, [], idioma);
    assert.deepEqual(a.comandos, ["Add-Type"], idioma);
    assert.equal(a.dinamicos, 0, idioma);
    assert.ok(a.textos.some((t) => t.includes(trecho)), `${idioma}: ${JSON.stringify(a.textos)}`);
    assert.ok(a.textos.includes("Reveza AI"), idioma);
  }
});

test("texto hostil passa inteiro pelo argv, pela linha de comando do Windows e pelo PowerShell, e não vira comando", { skip: NAO_WINDOWS }, async () => {
  const a = await analisar(HOSTIS.map(aspasPs).join("\n"));
  assert.deepEqual(a.erros, []);
  assert.deepEqual(a.comandos, [], "nenhum comando");
  assert.equal(a.dinamicos, 0, "nada interpretado");
  assert.deepEqual(a.textos, HOSTIS, "cada texto inteiro");
  for (const h of HOSTIS) {
    const volta = await powershell(`[Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(${aspasPs(h)})))`);
    assert.equal(volta, h);
  }
});

test("som: o PowerShell lê o script sem erro e nada é interpretado", { skip: NAO_WINDOWS }, async () => {
  const argv = comandosDoSom("windows")[0]!;
  assert.deepEqual(argv.slice(0, 4), ["powershell", "-NoProfile", "-NonInteractive", "-Command"]);
  const a = await analisar(argv.at(-1)!);
  assert.deepEqual(a.erros, []);
  assert.deepEqual(a.comandos, ["New-Object"]);
  assert.equal(a.dinamicos, 0);
});

test("guarda do Windows: a DPAPI cifra e devolve o segredo igual", { skip: NAO_WINDOWS }, async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "reveza-dpapi-"));
  try {
    const g = new GuardaWindows(executorReal, pasta);
    const chave = Buffer.alloc(32, 7).toString("base64");
    await g.gravar("chave-cofre", chave);
    const arq = fs.readFileSync(path.join(pasta, "chave-cofre.dpapi"), "utf8");
    assert.ok(!arq.includes(chave), "o arquivo não tem a chave em claro");
    assert.equal(await g.ler("chave-cofre"), chave);
    const identidade = JSON.stringify({ url: "https://exemplo.supabase.co", email: "pc-1@computadores.reveza.invalid", senha: "s3nh@ \"com\" 'aspas' e ç" });
    await g.gravar("computador", identidade);
    assert.equal(await g.ler("computador"), identidade);
    await g.apagar("computador");
    assert.equal(await g.ler("computador"), null);
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
});
