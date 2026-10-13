// Problema visto de longe: disco cheio, gravação que falha e erro do log chegando ao painel (13/10/2026: o Mac mini
// ficou sem disco por alguns minutos e o erro só existia no log local).
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { gravarAtomico } from "../src/util/arquivos.js";
import { logEmArquivo } from "../src/util/log.js";
import { doctor, DISCO_AVISO, DISCO_FALHA } from "../src/doctor.js";
import { ERRO_DO_LOG_REPETIDO_S, ERROS_DO_LOG_POR_HORA } from "../src/agente.js";
import { CredenciaisFalsas } from "../src/credenciais/falsa.js";
import { GuardaFalsa } from "../src/cofre/guarda.js";
import { ApiFalsa, BancoFalso, blob, CliFalsa, montar, NuvemFalsa, pastaTemporaria, T0, type Montado } from "./falsos.js";

const pastas: string[] = [];
let m: Montado | undefined;
afterEach(() => {
  m?.limpar();
  m = undefined;
  for (const d of pastas.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const pasta = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "reveza-erros-"));
  pastas.push(d);
  return d;
};

test("gravação que falha não deixa o temporário ao lado do arquivo", () => {
  const d = pasta();
  const alvo = path.join(d, "estado.json");
  fs.mkdirSync(alvo); // no lugar do arquivo há uma pasta com conteúdo: o rename falha
  fs.writeFileSync(path.join(alvo, "x"), "1");
  assert.throws(() => gravarAtomico(alvo, "{}"));
  assert.deepEqual(fs.readdirSync(d), ["estado.json"], "nada de estado.json.tmp.* sobrando");
});

test("o log em arquivo avisa quem roda o agente a cada erro, e um aviso que falha não derruba nada", () => {
  const d = pasta();
  const log = logEmArquivo(path.join(d, "agente.log"));
  const vistos: string[] = [];
  log.erro("antes de ligar");
  log.aoErro = (t) => vistos.push(t);
  log.erro("não consegui salvar o estado: ENOSPC");
  log.info("info não avisa");
  log.aoErro = () => {
    throw new Error("x");
  };
  log.erro("segue");
  assert.deepEqual(vistos, ["não consegui salvar o estado: ENOSPC"]);
  assert.match(fs.readFileSync(path.join(d, "agente.log"), "utf8"), /\[erro\] segue/);
});

describe("erro do log no painel", () => {
  const doLog = (banco: BancoFalso) => banco.eventos.filter((e) => (e.dados as Record<string, unknown>).log === true);

  test("sobe como erro, sem a pasta do usuário, uma vez a cada 30 min por erro (números não contam)", async () => {
    const banco = new BancoFalso();
    m = await montar({ nuvem: new NuvemFalsa(banco, "pc-1") });
    const home = m.c.home;
    m.agente.erroDoLog(`não consegui salvar o estado: ENOSPC: no space left on device, open '${home}/.reveza/estado.json.tmp.85448.f1f66123de4cf281'`);
    m.agente.erroDoLog(`não consegui salvar o estado: ENOSPC: no space left on device, open '${home}/.reveza/estado.json.tmp.91234.aa11bb22cc33dd44'`);
    await new Promise((r) => setImmediate(r));
    let ev = doLog(banco);
    assert.equal(ev.length, 1, "o mesmo erro com outro temporário é o mesmo erro");
    assert.equal(ev[0]!.tipo, "erro");
    assert.match(ev[0]!.texto, /^Erro no agente: não consegui salvar o estado: ENOSPC/);
    assert.ok(!ev[0]!.texto.includes(home), "a pasta do usuário vira ~");
    assert.match(ev[0]!.texto, /'~\/\.reveza\/estado\.json/);

    m.relogio.t += ERRO_DO_LOG_REPETIDO_S;
    m.agente.erroDoLog("não consegui salvar o estado: ENOSPC: no space left on device, open 'x.tmp.1.ffffffffffff'");
    await new Promise((r) => setImmediate(r));
    ev = doLog(banco);
    assert.equal(ev.length, 2, "passados 30 min, sobe de novo");
  });

  test("no máximo 10 por hora; o que já é evento ([erro] do trocador) não sobe de novo; sombra não sobe", async () => {
    const banco = new BancoFalso();
    m = await montar({ nuvem: new NuvemFalsa(banco, "pc-1") });
    m.agente.erroDoLog("[erro] a troca falhou");
    await new Promise((r) => setImmediate(r));
    assert.equal(doLog(banco).length, 0, "o [erro] do trocador já sobe como evento próprio");
    for (let i = 0; i < 15; i++) m.agente.erroDoLog(`erro diferente ${String.fromCharCode(97 + i)}`);
    await new Promise((r) => setImmediate(r));
    assert.equal(doLog(banco).length, ERROS_DO_LOG_POR_HORA);
    m.relogio.t += 3600;
    m.agente.erroDoLog("erro diferente z");
    await new Promise((r) => setImmediate(r));
    assert.equal(doLog(banco).length, ERROS_DO_LOG_POR_HORA + 1, "passada a hora, volta a subir");
    m.limpar();

    const banco2 = new BancoFalso();
    m = await montar({ nuvem: new NuvemFalsa(banco2, "pc-2"), sombra: true });
    m.agente.erroDoLog("erro em sombra");
    await new Promise((r) => setImmediate(r));
    assert.equal(doLog(banco2).length, 0);
  });
});

test("doctor: disco com pouco espaço é aviso, quase cheio é falha", async () => {
  const tmp = pastaTemporaria();
  try {
    const cred = new CredenciaisFalsas();
    cred.d.set("principal", blob("A1"));
    const base = {
      c: tmp.c,
      cred,
      guarda: new GuardaFalsa(),
      cli: new CliFalsa(),
      api: new ApiFalsa(),
      statusServico: async () => ({ instalado: true, rodando: true, detalhe: "rodando" }),
      ponte: async () => null,
      nuvemConfigurada: async () => null,
      horaNuvem: async () => null,
      agora: () => T0,
    };
    const disco = async (livre: number) => (await doctor({ ...base, espacoLivre: () => livre })).find((c) => c.id === "disco")!;
    assert.equal((await disco(DISCO_AVISO + 1)).situacao, "ok");
    const aviso = await disco(DISCO_AVISO - 1);
    assert.equal(aviso.situacao, "aviso");
    assert.match(aviso.fazer!, /libere espaço/);
    const falha = await disco(DISCO_FALHA - 1);
    assert.equal(falha.situacao, "falha");
    assert.match((await disco(3.9 * 1024 ** 3)).detalhe, /^3,9 GB livres$/);
    const semLeitura = (await doctor({ ...base, espacoLivre: () => { throw new Error("sem statfs"); } })).find((c) => c.id === "disco")!;
    assert.equal(semLeitura.situacao, "aviso");
    // de fábrica, lê o disco de verdade
    const real = (await doctor(base)).find((c) => c.id === "disco")!;
    assert.match(real.detalhe, /GB livres$/);
  } finally {
    tmp.limpar();
  }
});
