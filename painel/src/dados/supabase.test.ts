// Só as partes puras da FonteSupabase. As chamadas ao banco ficam para os testes com um banco de pé para o painel.
import { describe, expect, it } from "vitest"

import { rotuloDestino } from "./rotulos"
import { CHAVES_CONFIG, CONFIG_PADRAO, codigoDoErro, paraDiagnostico } from "./supabase"

describe("FonteSupabase (partes puras)", () => {
  it("mensagens das funções do banco viram códigos traduzíveis", () => {
    expect(codigoDoErro("confirme a verificação em duas etapas")).toBe("precisa_aal2")
    expect(codigoDoErro("só administrador")).toBe("sem_permissao")
    expect(codigoDoErro("o aviso precisa ser menor que a troca")).toBe("aviso_maior_que_troca")
    expect(codigoDoErro("rodízio de 15 a 480 minutos")).toBe("rodizio_fora")
    expect(codigoDoErro("a conta está em uso em outro computador")).toBe("conta_ocupada")
    expect(codigoDoErro("conta sem login guardado")).toBe("conta_precisa_login")
    expect(codigoDoErro("o último administrador não pode deixar de ser administrador")).toBe("ultimo_admin")
    expect(codigoDoErro("qualquer coisa", "42501")).toBe("sem_permissao")
    expect(codigoDoErro("qualquer coisa")).toBe("falha")
  })

  it("chaves de configuração e padrões iguais aos do banco", () => {
    expect(Object.values(CHAVES_CONFIG).sort()).toEqual(
      [
        "auto",
        "aviso",
        "espera_entre_trocas_s",
        "exigir_duas_etapas",
        "fuso",
        "intervalo_s",
        "modo",
        "retomar_terminal",
        "rodizio_minutos",
        "rodizio_ordem",
        "troca",
      ].sort()
    )
    expect(CONFIG_PADRAO).toMatchObject({
      auto: false,
      modo: "limiar",
      aviso: 90,
      troca: 95,
      rodizioOrdem: "aleatoria",
    })
  })

  it("o rótulo do destino de um alerta nunca mostra segredo", () => {
    expect(rotuloDestino("telegram", { chat_id: "123", bot_token: "segredo" })).toBe("chat 123")
    // canal que saiu (ntfy, 12/10/2026) ou desconhecido: sem rótulo, nunca o destino cru
    expect(rotuloDestino("ntfy", { servidor: "https://ntfy.sh", vault_id: "x" })).toBe("")
    expect(rotuloDestino("webhook", { url: "https://n8n.exemplo.com/webhook/x?token=segredo", segredo: "s" })).toBe(
      "n8n.exemplo.com/webhook/x"
    )
    expect(rotuloDestino("email", { para: "a@exemplo.com", de: "b@exemplo.com" })).toBe("a@exemplo.com")
  })
})

describe("diagnóstico do agente", () => {
  it("o formato que o agente manda vira o das telas (hora em segundos, conferências com situação)", () => {
    const d = paraDiagnostico(
      { em: 1791700000, conferencias: [{ id: "agente", nome: "Agente", situacao: "ok", detalhe: "versão 0.1.0" }, { id: "mod", nome: "Mod", situacao: "aviso", detalhe: "não carregado" }, { id: "nuvem", nome: "Nuvem", situacao: "falha", detalhe: "não responde" }] },
      "0.1.0"
    )!
    expect(d.em).toBe(new Date(1791700000 * 1000).toISOString())
    expect(d.itens.map((i) => i.ok)).toEqual([true, null, false])
    expect(d.itens[0]!.detalhe).toBe("Agente: versão 0.1.0")
    expect(paraDiagnostico({ em: "lixo" }, "1")).toBeNull()
    // escrito por um computador comprometido: não derruba o painel de ninguém
    expect(paraDiagnostico({ em: 1e20 }, "1")).toBeNull()
    expect(paraDiagnostico({ em: -1e17 }, "1")).toBeNull()
    expect(paraDiagnostico({ em: 1760000000, itens: [null, 7, [], { id: "a", ok: true }] }, "1")?.itens).toEqual([
      { id: "a", ok: true, detalhe: undefined },
    ])
    expect(paraDiagnostico(null, "1")).toBeNull()
  })
})
