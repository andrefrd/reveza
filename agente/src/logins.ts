// Conectar conta pelo login oficial, numa pasta própria (~/.reveza/contas/<id> vira o CLAUDE_CONFIG_DIR dela).
// O login só vale se a conta que voltou é a pedida: o navegador já logado em outra conta autorizaria a errada.

import * as fs from "node:fs";
import { randomBytes } from "node:crypto";
import type { Cli } from "./claudecli.js";
import type { Credenciais } from "./credenciais/tipos.js";
import type { Trocador } from "./troca.js";
import type { Processo } from "./util/executor.js";
import type { Relogio } from "./util/tempo.js";

export type EstadoLogin = "aguardando" | "ok" | "erro";

export interface Login {
  id: string;
  email: string | null;
  estado: EstadoLogin;
  url: string | null;
  mensagem: string;
  iniciadaEm: number;
  conta: string | null;
  pasta: string;
  saida: string[];
  proc: Processo;
  /** Resolve quando o login terminou e foi conferido. */
  concluido: Promise<void>;
}

// Só letras, números e . _ % + - (começando por letra ou número): um hífen na frente viraria opção na linha de comando
// do login, e nenhum caractere especial de shell chega ao programa, nem no Windows (auditoria de 11/10/2026).
export const EMAIL_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

/**
 * O que dizer a quem conecta, com o endereço na mão. O navegador do computador pode não abrir, ou abrir no perfil de
 * outra conta (quem usa vários perfis do Chrome caiu nisso, 12/10/2026): numa janela anônima não há conta aberta.
 */
export const TEXTO_DO_LOGIN =
  "Abra o endereço do login (de preferência numa janela anônima, para não entrar com a conta que já está aberta no navegador), entre na conta e cole aqui o código que a página mostrar.";

export class Logins {
  mapa = new Map<string, Login>();

  constructor(
    private trocador: Trocador,
    private cred: Credenciais,
    private cli: Cli,
    private relogio: Relogio,
    private aoTerminar: (login: Login, id: string | null) => Promise<void>,
  ) {}

  /** Pastas com login em andamento: a arrumação de pastas não mexe nelas. */
  pastas(): Set<string> {
    return new Set([...this.mapa.values()].filter((l) => l.estado === "aguardando").map((l) => l.pasta));
  }

  publico(): Record<string, unknown>[] {
    const t = this.relogio.agora();
    return [...this.mapa.values()]
      .filter((l) => t - l.iniciadaEm < 3600)
      .map(({ id, email, estado, url, mensagem, iniciadaEm }) => ({ id, email, estado, url, mensagem, iniciadaEm }));
  }

  iniciar(email: string | null): Login {
    if (email !== null && !EMAIL_VALIDO.test(email)) throw new Error("e-mail inválido");
    const id = randomBytes(16).toString("hex");
    const pasta = this.trocador.novaPasta();
    const proc = this.cli.login(pasta, email);
    const login: Login = {
      id,
      email: email ? email.toLowerCase() : null,
      estado: "aguardando",
      url: null,
      mensagem: "Abrindo o login oficial…",
      iniciadaEm: this.relogio.agora(),
      conta: null,
      pasta,
      saida: [],
      proc,
      concluido: Promise.resolve(),
    };
    this.mapa.set(id, login);
    proc.aoLinha((linha) => {
      login.saida.push(linha.slice(0, 300));
      login.saida.splice(0, Math.max(0, login.saida.length - 40));
      // o primeiro endereço https da saída é o do login oficial (o Claude Code 2.1.29x imprime "If the browser didn't
      // open, visit: https://claude.com/cai/oauth/authorize?..."); sem pontuação grudada no fim
      const m = /https:\/\/[^\s"'<>]+/.exec(linha);
      if (m && !login.url) {
        login.url = m[0].replace(/[).,;]+$/, "");
        login.mensagem = TEXTO_DO_LOGIN;
      }
    });
    login.concluido = new Promise<void>((resolve) => {
      proc.aoFim(() => void this.finalizar(login).catch(() => undefined).finally(resolve));
    });
    void this.vigiar(login);
    this.trocador.evento("conexao", `Login iniciado${email ? ` para ${email}` : ""}.`, { login: id });
    return login;
  }

  /** O login pode terminar pedindo Enter: quando a credencial aparece, confirma e encerra. Desiste em 15 min. */
  private async vigiar(login: Login): Promise<void> {
    const limite = this.relogio.agora() + 15 * 60;
    while (login.proc.vivo && login.estado === "aguardando") {
      if (this.relogio.agora() > limite) {
        login.proc.terminar();
        return;
      }
      if (await this.cred.ler(login.pasta)) {
        login.proc.escrever("\n");
        for (let i = 0; i < 20 && login.proc.vivo; i++) await this.relogio.dormir(500);
        if (login.proc.vivo) login.proc.terminar();
        return;
      }
      await this.relogio.dormir(2000);
    }
  }

  codigo(id: string, codigo: string): { ok: boolean; erro?: string } {
    const l = this.mapa.get(id);
    if (!l) return { ok: false, erro: "login desconhecido" };
    const c = codigo.trim();
    if (!c || c.length > 4000) return { ok: false, erro: "código vazio" };
    if (/[\r\n\0]/.test(c)) return { ok: false, erro: "o código é uma linha só" };
    if (!l.proc.vivo || !l.proc.escrever(c + "\n")) return { ok: false, erro: "o login já terminou" };
    return { ok: true };
  }

  /** Desligamento do agente: encerra os logins em andamento. */
  encerrar(): void {
    for (const l of this.mapa.values()) if (l.proc.vivo) l.proc.terminar();
  }

  cancelar(id: string): { ok: boolean; erro?: string } {
    const l = this.mapa.get(id);
    if (!l) return { ok: false, erro: "login desconhecido" };
    if (l.proc.vivo) l.proc.terminar();
    l.estado = "erro";
    l.mensagem = "Cancelado.";
    return { ok: true };
  }

  async finalizar(login: Login): Promise<void> {
    const blob = await this.cred.ler(login.pasta);
    if (!blob) {
      if (login.estado === "aguardando") {
        login.estado = "erro";
        const ultimo = [...login.saida].reverse().find((l) => l.trim()) ?? "";
        login.mensagem = `O login não terminou. ${ultimo}`.trim();
      }
      fs.rmSync(login.pasta, { recursive: true, force: true });
      return;
    }
    const perfil = await this.trocador.identidade(blob);
    if (!perfil) {
      login.estado = "erro";
      login.mensagem = "Login feito, mas não consegui ler o perfil da conta.";
      return;
    }
    const pedido = (login.email ?? "").toLowerCase();
    const entrou = (perfil.email ?? "").toLowerCase();
    if (pedido && entrou !== pedido) {
      await this.cred.apagar(login.pasta);
      fs.rmSync(login.pasta, { recursive: true, force: true });
      login.estado = "erro";
      login.mensagem =
        `O navegador entrou como ${perfil.email}, não como ${login.email}. Saia da conta no navegador ` +
        "(ou abra o link numa janela anônima) e tente de novo.";
      this.trocador.evento("erro", `Login pedido para ${login.email} entrou como ${perfil.email}; descartado.`, { login: login.id });
      await this.aoTerminar(login, null);
      return;
    }
    const id = await this.trocador.geral.com(async () => {
      const existente = this.trocador.contaDoPerfil(perfil);
      let id: string;
      let texto: string;
      if (existente) {
        const c = this.trocador.estado.contas[existente]!;
        const antiga = c.pasta;
        Object.assign(c, { pasta: login.pasta, precisaLogin: false, erro: null, versaoCofre: c.versaoCofre });
        if (antiga !== login.pasta) await this.cred.apagar(antiga);
        id = existente;
        texto = `${perfil.email} entrou de novo.`;
      } else {
        id = this.trocador.registrar(perfil, login.pasta, blob);
        texto = `${perfil.email} (${perfil.org ?? "sem organização"}) conectada.`;
      }
      login.estado = "ok";
      login.mensagem = texto;
      login.conta = id;
      this.trocador.evento("conexao", texto, { conta: id, login: login.id });
      return id;
    });
    await this.aoTerminar(login, id);
  }
}
