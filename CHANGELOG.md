# Versões

Formato: [versão semântica](https://semver.org/lang/pt-BR/). A versão de cada entrega fica no `package.json`, na tag do
Git (`vX.Y.Z`) e na página de versões do GitHub, sempre iguais.

- **X.0.0**: mudança grande, que pode exigir reinstalar ou mudar o jeito de usar.
- **X.Y.0**: melhoria ou recurso novo que não quebra nada.
- **X.Y.Z**: correção.

## 0.1.3 · 11/10/2026

Computador novo em qualquer sistema. Quem tem a 0.1.2 atualiza com `npx github:dantaspaulo/reveza#v0.1.3 --atualizar`.

- **O painel mostra o passo a passo do sistema do computador novo** (macOS, Windows ou Linux), já aberto no sistema de
  quem está olhando: como abrir o terminal, o comando e o que precisa estar instalado.
- **Sem precisar do Git:** o comando do painel baixa o pacote da versão direto do GitHub
  (`npx https://github.com/dantaspaulo/reveza/archive/refs/tags/vX.Y.Z.tar.gz --ligar`). O `npx github:...` pedia o Git,
  que o Windows não traz, e o computador novo fica na mesma versão dos outros.
- **Instalação conferida de verdade nos três sistemas:** a cada envio, o GitHub instala o Reveza no macOS, no Linux e no
  Windows (de dentro de um `node_modules`, como o npx deixa) e roda os testes do agente em cada um.
- README: compartilhar no WhatsApp leva ao site, que tem a imagem de compartilhamento.

## 0.1.2 · 11/10/2026

Apoio ao projeto e versão num lugar só. Quem tem a 0.1.1 atualiza com `npx github:dantaspaulo/reveza#v0.1.2 --atualizar`.

- **Apoie o projeto:** no README, contribuição de R$ 100 pelo Asaas (Pix, cartão ou boleto), Pix direto para valores
  maiores e o botão de mandar o Reveza no WhatsApp.
- **Toda correção sai com versão:** `node scripts/versao.mjs lancar X.Y.Z` sobe a versão em todos os lugares (pacotes,
  travas, agente, README), publica, marca a tag e cria a release com o texto desta página. O `npm test` confere que
  tudo está na mesma versão, e o pre-push (`.githooks`) recusa empurrar para a main mudança no que se instala sem
  versão nova.

## 0.1.1 · 11/10/2026

Correção: computador novo instalado pelo `npx github:dantaspaulo/reveza` parava em "agente/package-lock.json ausente".
Pelo npx, o repositório chega dentro de uma pasta `node_modules`, e o filtro que deixa de fora as dependências olhava o
caminho inteiro e jogava fora tudo. Agora olha só o caminho dentro do programa, e o teste de ponta a ponta roda a
instalação de dentro de um `node_modules`, do mesmo jeito que o npx deixa.

**Para quem parou nesse erro:** rode de novo `npx github:dantaspaulo/reveza#v0.1.1 --ligar`.

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
