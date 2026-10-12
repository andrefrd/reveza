# Versões

Formato: [versão semântica](https://semver.org/lang/pt-BR/). A versão de cada entrega fica no `package.json`, na tag do
Git (`vX.Y.Z`) e na página de versões do GitHub, sempre iguais.

- **X.0.0**: mudança grande, que pode exigir reinstalar ou mudar o jeito de usar.
- **X.Y.0**: melhoria ou recurso novo que não quebra nada.
- **X.Y.Z**: correção.

## 0.1.0 · 11/10/2026

Primeira versão aberta. Várias contas do Claude Code, revezando sozinhas: o Reveza troca de conta antes do limite e a
sessão continua na conta nova.

- **Troca automática** por limiar (avisa em 90% e troca em 95%, o padrão), só no limite ou em rodízio ao longo do dia,
  com ordem de preferência, conta de reserva, agenda por horário e teto semanal. Perto do gatilho, a conta em uso é
  lida a cada 15 segundos.
- **A sessão continua:** as sessões abertas seguem na conta nova sem reiniciar; uma sessão sem ninguém que parou no
  limite é retomada sozinha na conta seguinte. A cada troca, o computador toca um som (`reveza som desligar` tira).
- **Cofre cifrado:** cada login é cifrado no computador (AES-256-GCM); a chave mora só no chaveiro do sistema e a
  nuvem guarda texto que não consegue ler.
- **Painel na sua nuvem** (Supabase e Vercel, planos grátis): visão geral, contas, computadores, troca, uso e custo
  equivalente, plano da semana, alertas (Telegram, ntfy, e-mail, webhook, celular), time com papéis e auditoria, API com
  chave pessoal e webhooks assinados. Em português e inglês, instala no celular, e tem modo demonstração.
- **Computador novo com um código só:** o painel gera o código; o computador que já tem a chave pede, numa janela, o
  código de 4 caracteres que o painel mostra; no computador novo, `npx github:dantaspaulo/reveza --ligar` e colar.
- **Instalador de um comando** (`npx github:dantaspaulo/reveza`), em macOS, Linux (inclusive VPS sem tela) e Windows,
  com Node 20.19 ou mais novo: cria a nuvem, publica o painel, conecta as contas, configura os alertas e faz a prova
  final. `--sem-nuvem`, `--demo`, `--sombra` e `--importar` para outros jeitos de começar.
- **Segurança:** auditoria completa com a skill de auditoria de segurança da Cloudflare, com os achados confirmados
  corrigidos; versões travadas e instalação sem scripts de terceiros; a trava do repositório recusa segredo, dado
  pessoal e componente do React Bits em todo commit.

**Instalar:** `npx github:dantaspaulo/reveza` · **atualizar:** `npx github:dantaspaulo/reveza --atualizar` (contas, uso
e configuração ficam).
