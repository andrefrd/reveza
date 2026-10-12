#!/usr/bin/env node
// Mutação das regras críticas: quebra uma regra de cada vez no código, compila, roda os testes que deviam pegar e
// confere que eles FALHAM. Mutante que sobrevive = teste cego para aquela regra.
//   node scripts/mutacao.mjs            (todas)
//   node scripts/mutacao.mjs cofre      (só as que têm "cofre" no nome)
// O arquivo original volta sempre, mesmo se o processo for interrompido no meio de um teste.

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsc = path.join(raiz, "node_modules", "typescript", "bin", "tsc");

const MUTANTES = [
  ["troca: só o login muda (mcpOAuth fica)", "src/credenciais/blob.ts", 'export const CHAVES_DO_LOGIN = ["claudeAiOauth", "organizationUuid"] as const;', 'export const CHAVES_DO_LOGIN = ["claudeAiOauth", "organizationUuid", "mcpOAuth"] as const;', ["troca", "credenciais"]],
  ["troca: nunca renovar pela cópia da ativa", "src/troca.ts", "if (!c || id === this.estado.ativa) return false;", "if (!c) return false;", ["troca"]],
  ["troca: trava por conta entre renovar e trocar", "src/troca.ts", "const r = await this.travaConta(destino).com(async () => {", "const r = await (async <T>(f: () => Promise<T>) => f())(async () => {", ["troca"]],
  ["troca: destino perto de vencer é renovado antes", "src/troca.ts", "if (blobAlvo && expiraEm(blobAlvo) < this.agora() + RENOVAR_ANTES_S", "if (blobAlvo && expiraEm(blobAlvo) < this.agora() - RENOVAR_ANTES_S", ["troca"]],
  ["troca: conferência agendada 5 s depois", "src/troca.ts", "    this.relogio.agendar(() => void this.conferirTroca(destino, de, 1), CONFERIR_TROCA_MS);", "", ["troca"]],
  ["troca: refaz se a sessão regravou a conta antiga", "src/troca.ts", "if (id && id === de && tentativa <= 3) {", "if (id && id === de && tentativa <= 0) {", ["troca"]],
  ["troca: guarda o último token visto antes de aceitar mudança por fora", "src/troca.ts", "if (anterior && this.ultimaPrincipal && this.ultimaPrincipal[0] === anterior", "if (anterior && this.ultimaPrincipal && this.ultimaPrincipal[0] === anterior + \"x\"", ["troca"]],
  ["troca: oauthAccount do ~/.claude.json acompanha", "src/troca.ts", "    await this.copiarConta(this.claudeJsonDa(alvo), this.c.claudeJson);", "", ["troca"]],
  ["troca: sem identificar a principal, não troca", "src/troca.ts", "if (atual && !(await this.identidade(atual))) {", "if (false) {", ["troca"]],
  ["troca: destino sem token de renovação é recusado", "src/troca.ts", "if (!temRenovacao(blobAlvo)) {", "if (!blobAlvo) {", ["troca"]],
  ["troca: modo sombra não troca", "src/troca.ts", "    if (this.sombra) {\n      const chave = `${destino}|${motivo}`;", "    if (this.sombra && destino === \"nunca\") {\n      const chave = `${destino}|${motivo}`;", ["troca"]],
  ["troca: medida logo depois da troca é ignorada", "src/troca.ts", "t - (this.estado.trocadaEm || 0) < IGNORAR_MEDIDA_APOS_TROCA_S) return false;", "false) return false;", ["troca"]],
  ["troca: limite de versão velha não esgota a nova", "src/troca.ts", "if (typeof v === \"number\" && Number.isInteger(v) && v < this.estado.versao) {", "if (false) {", ["troca"]],
  ["login: só vale a conta pedida", "src/logins.ts", "if (pedido && entrou !== pedido) {", "if (pedido && entrou !== pedido && pedido === \"nunca\") {", ["troca"]],
  ["decisão: espera entre trocas", "src/decisao.ts", "if (limite || t - (estado.trocadaEm || 0) >= espera) return [\"trocar\", cand];", "return [\"trocar\", cand];", ["decisao"]],
  ["decisão: reset que passou conta como zero", "src/decisao.ts", "valores.push(j.resetEm && j.resetEm <= t ? 0 : Number(j.pct));", "valores.push(Number(j.pct));", ["decisao"]],
  ["chaveiro: linha grande vai pelo argv", "src/credenciais/macos.ts", "if (linha.length <= LIMITE_LINHA) return", "if (true) return", ["credenciais"]],
  ["cofre: dado associado com a versão", "src/cofre/cifra.ts", "return `${contaId}|${versao}`;", "return `${contaId}`;", ["cofre", "nuvem"]],
  ["cofre: frase normalizada antes do scrypt", "src/cofre/frase.ts", "return scryptSync(normalizar(frase), sal, TAMANHO_CHAVE, SCRYPT);", "return scryptSync(frase, sal, TAMANHO_CHAVE, SCRYPT);", ["cofre"]],
  ["posse: devolve ao cofre antes de soltar", "src/posse.ts", "      if (await this.devolver(id).catch(() => false)) {\n        await this.soltar(id).catch(() => undefined);\n        this.soltarDepois.delete(id);", "      if (true) {\n        await this.soltar(id).catch(() => undefined);\n        this.soltarDepois.delete(id);", ["nuvem"]],
  ["posse: cofre nunca por cima da conta em uso", "src/posse.ts", "    if (id === this.estado().ativa) return;\n    const local", "    const local", ["nuvem"]],
  ["posse: cofre mais novo entra no lugar da cópia local", "src/posse.ts", "if (c.versaoCofre !== null && cofre.versao <= c.versaoCofre && local) return;", "if (local) return;", ["nuvem"]],
  ["posse: dado associado da versão NOVA (anterior + 1)", "src/posse.ts", "const nova = anterior + 1;", "const nova = anterior;", ["nuvem"]],
  ["posse: registro regravado com conta_id|versão", "src/posse.ts", "const ok = await this.com(id, \"login\", async () => true, { sincronizar: false, devolverSempre: true });", "const ok = true;", ["nuvem-real"]],
  ["agente: parada só lida com posse", "src/agente.ts", "if (!this.posse || this.d.sombra || id === this.estado.ativa || !c.contaId) return this.trocador.lerUso(id, forcar);", "if (!this.posse || this.d.sombra || id === this.estado.ativa || !c.contaId || c.contaId !== \"nunca\") return this.trocador.lerUso(id, forcar);", ["nuvem"]],
  ["agente: sombra não responde comando", "src/agente.ts", "    if (this.d.sombra) {\n      this.d.log.faria(`reservar", "    if (false) {\n      this.d.log.faria(`reservar", ["nuvem"]],
  ["agente: sombra não pega posse nem troca pela nuvem", "src/agente.ts", "    if (this.d.sombra) {\n      const chave = `${a.conta_id}#${a.versao}`;", "    if (this.d.sombra && a.conta_id === \"nunca\") {\n      const chave = `${a.conta_id}#${a.versao}`;", ["nuvem"]],
  ["agente: sombra roda a decisão local e registra o que faria", "src/agente.ts", "if (this.comNuvem && !this.d.sombra) return;", "if (this.comNuvem) return;", ["nuvem"]],
  ["agente: sombra não aplica a configuração da nuvem", "src/agente.ts", "if (!this.d.sombra) this.aplicarConfig(r.config);", "this.aplicarConfig(r.config);", ["nuvem"]],
  ["agente: posse antiga solta na primeira busca", "src/agente.ts", "if (!this.possesLimpas) await this.limparPossesAntigas();", "this.possesLimpas = true;", ["nuvem"]],
  ["agente: registro tentado de novo quando a nuvem volta", "src/agente.ts", "        await this.registrarPendentes();\n", "", ["nuvem"]],
  ["agente: relê a chave do cofre que chegou depois", "src/agente.ts", "      await this.recarregarChave();\n", "", ["nuvem"]],
  ["registro: cede a vez ao resto do agente", "src/registro/contador.ts", "        await this.ceder();\n", "", ["registro"]],
  ["agente: desligar sobe a conta em uso ao cofre", "src/agente.ts", "        await this.posse.devolver(id).catch(() => false);\n        if (id !== this.estado.ativa)", "        if (id !== this.estado.ativa)", ["nuvem"]],
  ["agente: lista de contas permitidas", "src/agente.ts", "if (lista && !lista.has(email))", "if (false)", ["nuvem"]],
  ["agente: comando não roda duas vezes", "src/agente.ts", "    if (this.comandosVistos.has(id)) return;\n", "", ["nuvem"]],
  ["registro: resposta repetida conta uma vez", "src/registro/contador.ts", "    if (this.vistos.has(mid)) return;\n", "", ["registro"]],
  ["registro: linha zerada não marca o id", "src/registro/contador.ts", "if (!mid || t.ent + t.sai + t.c5 + t.c1h + t.cl === 0) return;", "if (!mid) return;", ["registro"]],
  ["registro: projeto só com a pasta final", "src/registro/contador.ts", "return path.basename(cwd.replace(/[\\\\/]+$/, \"\").replace(/\\\\/g, \"/\"));", "return cwd;", ["registro"]],
  ["registro: linha pela metade fica para depois", "src/registro/contador.ts", "      this.e.arquivos[caminho] = lidoAte;", "      this.e.arquivos[caminho] = pos;", ["registro"]],
  ["ponte: cabeçalho X-Reveza obrigatório", "src/ponte.ts", "if (req.headers[\"x-reveza\"] !== \"1\")", "if (false)", ["ponte"]],
  ["ponte: Host conferido", "src/ponte.ts", "if (!hosts.has(host))", "if (false)", ["ponte"]],
  ["importar: só copia, nunca move", "src/importar.ts", "copiados = copiarPasta(ca.pasta, conta.pasta);", "fs.renameSync(ca.pasta, conta.pasta);", ["importar"]],
  ["~/.claude.json: não regravar arquivo ilegível", "src/claudejson.ts", "        const v = JSON.parse(bruto);", "        let v; try { v = JSON.parse(bruto); } catch { v = {}; }", ["doctor-cli"]],
];

function rodar(argv) {
  return spawnSync(process.execPath, argv, { cwd: raiz, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

const filtro = process.argv[2];
const lista = MUTANTES.filter(([nome]) => !filtro || nome.includes(filtro));
const resultados = [];
for (const [nome, arquivo, de, para, testes] of lista) {
  const caminho = path.join(raiz, arquivo);
  const original = readFileSync(caminho, "utf8");
  const vezes = original.split(de).length - 1;
  if (vezes !== 1) {
    resultados.push([nome, `TRECHO NÃO ACHADO (${vezes}x)`]);
    continue;
  }
  const restaurar = () => writeFileSync(caminho, original);
  process.once("SIGINT", () => (restaurar(), process.exit(130)));
  try {
    writeFileSync(caminho, original.replace(de, para));
    const c = rodar([tsc, "-p", "tsconfig.json"]);
    if (c.status !== 0) {
      resultados.push([nome, "não compilou (conta como morto, mas reveja o mutante)"]);
      continue;
    }
    let morto = false;
    for (const f of testes) {
      if (rodar(["scripts/testar.mjs", f]).status !== 0) {
        morto = true;
        break;
      }
    }
    resultados.push([nome, morto ? "morto (o teste pegou)" : "SOBREVIVEU"]);
  } finally {
    restaurar();
  }
}
rodar([tsc, "-p", "tsconfig.json"]);
let sobreviventes = 0;
for (const [nome, r] of resultados) {
  if (!r.startsWith("morto")) sobreviventes += 1;
  console.log(`${r.startsWith("morto") ? "ok  " : "!!  "} ${nome}: ${r}`);
}
console.log(`\n${resultados.length - sobreviventes} de ${resultados.length} mutantes mortos.`);
process.exit(sobreviventes ? 1 : 0);
