// Autenticação pelo Supabase Auth da instalação (senha + TOTP). O cadastro público fica desligado no projeto: só
// entra quem recebe convite (a Edge Function "aceitar-convite" cria o usuário a partir do token do link).

import type { Session } from "@supabase/supabase-js"

import { supabase } from "@/dados/cliente"
import { problemaSenha, type Autenticacao, type EstadoAuth, type InicioTotp } from "./auth"

const RECUPERACAO = "reveza.recuperacao"

function marcarRecuperacao(sim: boolean) {
  try {
    if (sim) sessionStorage.setItem(RECUPERACAO, "1")
    else sessionStorage.removeItem(RECUPERACAO)
  } catch {
    // sem armazenamento: a tela de nova senha ainda abre pelo endereço
  }
}

function emRecuperacao() {
  try {
    return sessionStorage.getItem(RECUPERACAO) === "1"
  } catch {
    return false
  }
}

export class AuthSupabase implements Autenticacao {
  readonly demo = false

  private async fatorVerificado() {
    const { data, error } = await supabase().auth.mfa.listFactors()
    if (error) throw error
    return data.totp.find((f) => f.status === "verified") ?? null
  }

  async estado(): Promise<EstadoAuth> {
    const sb = supabase()
    const { data } = await sb.auth.getSession()
    const sessao: Session | null = data.session
    if (!sessao) return { logado: false, email: null, aal: null, falta2fa: false, recuperacao: false }
    const { data: nivel } = await sb.auth.mfa.getAuthenticatorAssuranceLevel()
    const aal = (nivel?.currentLevel ?? "aal1") as "aal1" | "aal2"
    return {
      logado: true,
      email: sessao.user.email ?? null,
      aal,
      falta2fa: nivel?.nextLevel === "aal2" && aal === "aal1",
      recuperacao: emRecuperacao(),
    }
  }

  aoMudar(cb: () => void) {
    const { data } = supabase().auth.onAuthStateChange((evento) => {
      if (evento === "PASSWORD_RECOVERY") marcarRecuperacao(true)
      if (evento === "SIGNED_OUT") marcarRecuperacao(false)
      // fora do callback: o supabase-js pede para não chamar o cliente de dentro dele
      setTimeout(cb, 0)
    })
    return () => data.subscription.unsubscribe()
  }

  async entrar(email: string, senha: string) {
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim().toLowerCase(), password: senha })
    if (error) throw new Error(error.status === 429 ? "muitas_tentativas" : "credenciais")
    return this.estado()
  }

  async verificarCodigo(codigo: string) {
    const fator = await this.fatorVerificado()
    if (!fator) throw new Error("sem_fator")
    const { error } = await supabase().auth.mfa.challengeAndVerify({ factorId: fator.id, code: codigo })
    if (error) throw new Error("codigo_invalido")
  }

  async sair(todas = false) {
    marcarRecuperacao(false)
    await supabase().auth.signOut({ scope: todas ? "global" : "local" })
  }

  async esqueci(email: string) {
    // O Supabase só aceita redirecionar para endereços da lista de URLs permitidas do projeto (o domínio do painel).
    const { error } = await supabase().auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/nova-senha`,
    })
    if (error && error.status === 429) throw new Error("muitas_tentativas")
    // Qualquer outro erro fica calado de propósito: a tela não revela se o e-mail existe.
  }

  async definirSenha(nova: string) {
    const p = problemaSenha(nova)
    if (p) throw new Error(`senha_${p}`)
    const { error } = await supabase().auth.updateUser({ password: nova })
    if (error) throw new Error("senha_recusada")
    marcarRecuperacao(false)
  }

  async trocarSenha(atual: string, nova: string, codigo?: string) {
    const sb = supabase()
    const { data } = await sb.auth.getUser()
    const email = data.user?.email
    if (!email) throw new Error("sem_sessao")
    const p = problemaSenha(nova, email)
    if (p) throw new Error(`senha_${p}`)
    // Reautenticação: confere a senha atual e, com duas etapas ligada, o código de novo.
    const { error: e1 } = await sb.auth.signInWithPassword({ email, password: atual })
    if (e1) throw new Error("senha_atual_errada")
    const fator = await this.fatorVerificado()
    if (fator) {
      if (!codigo) throw new Error("codigo_necessario")
      const { error: e2 } = await sb.auth.mfa.challengeAndVerify({ factorId: fator.id, code: codigo })
      if (e2) throw new Error("codigo_invalido")
    }
    const { error: e3 } = await sb.auth.updateUser({ password: nova })
    if (e3) throw new Error("senha_recusada")
  }

  async aceitarConvite({ convite, senha }: { convite: string; senha: string }) {
    const p = problemaSenha(senha)
    if (p) throw new Error(`senha_${p}`)
    const sb = supabase()
    // O link do e-mail já abriu a sessão (convite do Auth); falta a senha e marcar o convite como aceito.
    const { data: sessao } = await sb.auth.getSession()
    if (!sessao.session) throw new Error("convite_invalido")
    const { error: e1 } = await sb.auth.updateUser({ password: senha })
    if (e1) throw new Error("senha_recusada")
    const { data, error } = await sb.functions.invoke<{ ok?: boolean; erro?: string }>("convite", {
      body: { acao: "aceitar", convite },
    })
    if (error || !data?.ok) throw new Error("convite_invalido")
  }

  async totpIniciar(): Promise<InicioTotp> {
    const sb = supabase()
    // Fatores TOTP começados e não confirmados atrapalham um novo começo: remove antes.
    const { data: lista } = await sb.auth.mfa.listFactors()
    for (const f of lista?.all ?? []) {
      if (f.factor_type === "totp" && f.status !== "verified") await sb.auth.mfa.unenroll({ factorId: f.id })
    }
    const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "Reveza AI" })
    if (error || !data) throw new Error("totp_falhou")
    return { fatorId: data.id, uri: data.totp.uri, segredo: data.totp.secret }
  }

  async totpConfirmar(fatorId: string, codigo: string) {
    const { error } = await supabase().auth.mfa.challengeAndVerify({ factorId: fatorId, code: codigo })
    if (error) throw new Error("codigo_invalido")
  }

  async totpRemover(fatorId: string) {
    const { error } = await supabase().auth.mfa.unenroll({ factorId: fatorId })
    if (error) throw new Error("totp_falhou")
  }
}
