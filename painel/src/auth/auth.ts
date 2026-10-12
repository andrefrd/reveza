// Autenticação do painel: e-mail e senha, verificação em duas etapas (TOTP), convite, esqueci a senha e troca de senha
// com reautenticação. Duas implementações, como a camada de dados: demonstração e Supabase Auth.

export interface EstadoAuth {
  logado: boolean
  email: string | null
  aal: "aal1" | "aal2" | null
  /** Tem fator TOTP verificado mas a sessão ainda está em aal1: falta digitar o código. */
  falta2fa: boolean
  /** Sessão aberta pelo link de "esqueci a senha": a próxima tela é a de nova senha. */
  recuperacao: boolean
}

export interface InicioTotp {
  fatorId: string
  /** otpauth://... (vira QR no próprio painel, sem imagem de fora). */
  uri: string
  segredo: string
}

export interface Autenticacao {
  readonly demo: boolean
  estado(): Promise<EstadoAuth>
  aoMudar(cb: () => void): () => void
  entrar(email: string, senha: string): Promise<EstadoAuth>
  verificarCodigo(codigo: string): Promise<void>
  sair(todas?: boolean): Promise<void>
  esqueci(email: string): Promise<void>
  definirSenha(nova: string): Promise<void>
  trocarSenha(atual: string, nova: string, codigo?: string): Promise<void>
  aceitarConvite(dados: { convite: string; senha: string }): Promise<void>
  totpIniciar(): Promise<InicioTotp>
  totpConfirmar(fatorId: string, codigo: string): Promise<void>
  totpRemover(fatorId: string): Promise<void>
}

export const SENHA_MINIMA = 12

/** Regras da senha nova (o Supabase confere de novo do lado dele). */
export function problemaSenha(senha: string, email?: string | null): string | null {
  if (senha.length < SENHA_MINIMA) return "curta"
  if (!/[a-zA-Z]/.test(senha) || !/[0-9]/.test(senha)) return "letras_numeros"
  if (email && senha.toLowerCase().includes(email.split("@")[0].toLowerCase())) return "parecida_email"
  return null
}

export class AuthDemo implements Autenticacao {
  readonly demo = true
  private ouvintes = new Set<() => void>()
  private logado = true

  private emitir() {
    for (const o of this.ouvintes) o()
  }

  async estado(): Promise<EstadoAuth> {
    return {
      logado: this.logado,
      email: this.logado ? "admin@exemplo.com" : null,
      aal: this.logado ? "aal2" : null,
      falta2fa: false,
      recuperacao: false,
    }
  }

  aoMudar(cb: () => void) {
    this.ouvintes.add(cb)
    return () => {
      this.ouvintes.delete(cb)
    }
  }

  async entrar(): Promise<EstadoAuth> {
    this.logado = true
    this.emitir()
    return this.estado()
  }

  async verificarCodigo(codigo: string) {
    if (!/^\d{6}$/.test(codigo)) throw new Error("codigo_invalido")
  }

  async sair() {
    this.logado = false
    this.emitir()
  }

  async esqueci() {}

  async definirSenha(nova: string) {
    const p = problemaSenha(nova)
    if (p) throw new Error(`senha_${p}`)
  }

  async trocarSenha(atual: string, nova: string) {
    if (!atual) throw new Error("senha_atual_errada")
    const p = problemaSenha(nova)
    if (p) throw new Error(`senha_${p}`)
  }

  async aceitarConvite({ senha }: { convite: string; senha: string }) {
    const p = problemaSenha(senha)
    if (p) throw new Error(`senha_${p}`)
    this.logado = true
    this.emitir()
  }

  async totpIniciar(): Promise<InicioTotp> {
    const segredo = "JBSWY3DPEHPK3PXP"
    return {
      fatorId: "fator-demo",
      segredo,
      uri: `otpauth://totp/Reveza%20AI:admin%40exemplo.com?secret=${segredo}&issuer=Reveza%20AI`,
    }
  }

  async totpConfirmar(_fatorId: string, codigo: string) {
    if (!/^\d{6}$/.test(codigo)) throw new Error("codigo_invalido")
  }

  async totpRemover() {}
}
