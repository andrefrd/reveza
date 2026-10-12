// A página do token abre sozinha só quando há tela e pergunta; o comando do sistema é um dublê (nada abre de verdade).
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import {
  abrirNavegador, comandoDoNavegador, mostrarPaginaDoToken, PAGINA_TOKEN_SUPABASE, PAGINA_TOKEN_VERCEL, podeAbrirNavegador,
} from "../lib/navegador.mjs";
import { prepararCasa, SEM_SH } from "./apoio-instalador.mjs";

const pode = (extra) => podeAbrirNavegador({ interativo: true, tokenDoAmbiente: false, env: {}, ...extra });

test("quando abre: só com pergunta, token fora do ambiente e uma tela", () => {
  assert.equal(pode({ plataforma: "darwin" }), true, "macOS na frente do computador");
  assert.equal(pode({ plataforma: "win32" }), true, "Windows na frente do computador");
  assert.equal(pode({ plataforma: "linux", env: { DISPLAY: ":0" } }), true, "Linux com X");
  assert.equal(pode({ plataforma: "linux", env: { WAYLAND_DISPLAY: "wayland-0" } }), true, "Linux com Wayland");
  assert.equal(pode({ plataforma: "linux", env: { SSH_CONNECTION: "1 2 3 4", DISPLAY: "localhost:10.0" } }), true, "SSH com a tela encaminhada");

  assert.equal(pode({ plataforma: "darwin", interativo: false }), false, "--sim ou sem terminal");
  assert.equal(pode({ plataforma: "darwin", tokenDoAmbiente: true }), false, "token já veio do ambiente");
  assert.equal(pode({ plataforma: "linux" }), false, "Linux sem tela (VPS)");
  assert.equal(pode({ plataforma: "linux", env: { SSH_TTY: "/dev/pts/0" } }), false, "SSH sem tela");
  assert.equal(pode({ plataforma: "darwin", env: { SSH_CONNECTION: "1 2 3 4" } }), false, "SSH num Mac: abriria na tela de outra sessão");
  assert.equal(pode({ plataforma: "darwin", env: { SSH_CLIENT: "1 2 3" } }), false);
  assert.equal(pode({ plataforma: "win32", env: { SSH_CONNECTION: "1 2 3 4" } }), false, "SSH num Windows");
});

test("o comando de cada sistema", () => {
  assert.deepEqual(comandoDoNavegador(PAGINA_TOKEN_SUPABASE, "darwin"), ["open", [PAGINA_TOKEN_SUPABASE]]);
  assert.deepEqual(comandoDoNavegador(PAGINA_TOKEN_VERCEL, "linux"), ["xdg-open", [PAGINA_TOKEN_VERCEL]]);
  assert.deepEqual(comandoDoNavegador(PAGINA_TOKEN_VERCEL, "win32"), ["explorer.exe", [PAGINA_TOKEN_VERCEL]]);
  assert.deepEqual(comandoDoNavegador(PAGINA_TOKEN_VERCEL, "freebsd"), ["xdg-open", [PAGINA_TOKEN_VERCEL]]);
});

/** Um `spawn` dublê: anota o pedido e emite o evento escolhido (spawn, error, nenhum) ou lança. */
function dubleSpawn(evento) {
  const pedidos = [];
  const iniciar = (cmd, args, opcoes) => {
    pedidos.push({ cmd, args, opcoes });
    if (evento === "lanca") throw new Error("EPERM");
    const p = new EventEmitter();
    p.unref = () => { p.soltou = true; };
    if (evento === "spawn") setImmediate(() => p.emit("spawn"));
    if (evento === "error") setImmediate(() => p.emit("error", Object.assign(new Error("spawn xdg-open ENOENT"), { code: "ENOENT" })));
    return p;
  };
  return { iniciar, pedidos };
}

test("abrir: o comando sobe solto, sem segredo no ambiente; falha ou demora devolvem false sem lançar", async () => {
  const antes = process.env.SUPABASE_ACCESS_TOKEN;
  process.env.SUPABASE_ACCESS_TOKEN = "sbp_nao_pode_descer";
  try {
    const d = dubleSpawn("spawn");
    assert.equal(await abrirNavegador(PAGINA_TOKEN_SUPABASE, { plataforma: "darwin", iniciar: d.iniciar }), true);
    assert.equal(d.pedidos.length, 1);
    const { cmd, args, opcoes } = d.pedidos[0];
    assert.deepEqual([cmd, args], ["open", [PAGINA_TOKEN_SUPABASE]]);
    assert.equal(opcoes.stdio, "ignore");
    assert.equal(opcoes.detached, true);
    assert.equal(opcoes.env.SUPABASE_ACCESS_TOKEN, undefined, "o navegador não herda o token");
  } finally {
    if (antes === undefined) delete process.env.SUPABASE_ACCESS_TOKEN;
    else process.env.SUPABASE_ACCESS_TOKEN = antes;
  }
  assert.equal(await abrirNavegador(PAGINA_TOKEN_VERCEL, { plataforma: "linux", iniciar: dubleSpawn("error").iniciar }), false, "xdg-open ausente");
  assert.equal(await abrirNavegador(PAGINA_TOKEN_VERCEL, { plataforma: "win32", iniciar: dubleSpawn("lanca").iniciar }), false, "spawn que lança");
  assert.equal(await abrirNavegador(PAGINA_TOKEN_VERCEL, { plataforma: "darwin", iniciar: dubleSpawn("nada").iniciar, esperaMs: 20 }), false, "nem subiu nem falhou");
  const d = dubleSpawn("spawn");
  for (const ruim of ["file:///etc/passwd", "http://exemplo.com/x", "https://exemplo.com/a b", "-a Calculator", "https://exemplo.com/?a=1&b=2"]) {
    assert.equal(await abrirNavegador(ruim, { plataforma: "darwin", iniciar: d.iniciar }), false, ruim);
  }
  assert.equal(d.pedidos.length, 0, "endereço fora do padrão nem chega ao sistema");
});

test("na hora do token: o endereço sai sempre; a página só abre quando pode, e só diz que abriu quando abriu", async () => {
  const caso = async (opcoes, resultadoAbrir = true) => {
    const linhas = [];
    const abertos = [];
    const abriu = await mostrarPaginaDoToken(PAGINA_TOKEN_SUPABASE, {
      aviso: `Crie em ${PAGINA_TOKEN_SUPABASE}`, abriu: "Abri essa página no navegador.", info: (l) => linhas.push(l),
      abrir: async (url) => { abertos.push(url); return resultadoAbrir; }, plataforma: "darwin", env: {}, ...opcoes,
    });
    return { abriu, linhas, abertos };
  };
  let r = await caso({ interativo: true, tokenDoAmbiente: false });
  assert.deepEqual(r, { abriu: true, linhas: [`Crie em ${PAGINA_TOKEN_SUPABASE}`, "Abri essa página no navegador."], abertos: [PAGINA_TOKEN_SUPABASE] });
  r = await caso({ interativo: true, tokenDoAmbiente: false }, false);
  assert.deepEqual(r, { abriu: false, linhas: [`Crie em ${PAGINA_TOKEN_SUPABASE}`], abertos: [PAGINA_TOKEN_SUPABASE] }, "falhou: fica o endereço");
  r = await caso({ interativo: false, tokenDoAmbiente: false });
  assert.deepEqual(r, { abriu: false, linhas: [`Crie em ${PAGINA_TOKEN_SUPABASE}`], abertos: [] }, "--sim");
  r = await caso({ interativo: true, tokenDoAmbiente: true });
  assert.deepEqual(r.abertos, [], "token no ambiente");
  r = await caso({ interativo: true, tokenDoAmbiente: false, env: { SSH_TTY: "/dev/ttys001" } });
  assert.deepEqual(r.abertos, [], "SSH sem tela");
});

test("instalador com --sim: mostra onde criar o token e não chama o navegador", { skip: SEM_SH }, () => {
  const c = prepararCasa();
  try {
    // dublês de open e xdg-open no PATH: anotam se alguém os chamou
    const log = path.join(c.tmp, "navegador.log");
    for (const nome of ["open", "xdg-open"]) {
      writeFileSync(path.join(c.tmp, "bin", nome), `#!/bin/sh\necho "${nome} $*" >> "${log}"\n`);
      chmodSync(path.join(c.tmp, "bin", nome), 0o755);
    }
    c.env.DISPLAY = ":0";
    const r = c.rodar(["--sim", "--sem-servico", "--sem-react-bits"]);
    assert.equal(r.status, 1, "sem token do Supabase a instalação nova com nuvem para");
    assert.match(r.saida, /Crie um token pessoal em https:\/\/supabase\.com\/dashboard\/account\/tokens/);
    assert.match(r.saida, /sem token do Supabase não dá para criar a nuvem/);
    assert.ok(!/Abri essa página/.test(r.saida));
    assert.equal(existsSync(log) ? readFileSync(log, "utf8") : "", "", "nenhum navegador aberto");
  } finally {
    c.limpar();
  }
});
