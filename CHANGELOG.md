# Versões

Formato: [versão semântica](https://semver.org/lang/pt-BR/). A versão de cada entrega fica no `package.json`, na tag do
Git (`vX.Y.Z`) e na página de versões do GitHub, sempre iguais.

- **X.0.0**: mudança grande, que pode exigir reinstalar ou mudar o jeito de usar.
- **X.Y.0**: melhoria ou recurso novo que não quebra nada.
- **X.Y.Z**: correção.

## 0.3.0 · 12/10/2026

A nuvem e o painel também se atualizam sozinhos. Esta versão traz mudança no banco e uma função nova da nuvem: atualize
UMA vez o computador que criou a instalação com `npx https://github.com/dantaspaulo/reveza/archive/refs/tags/v0.3.0.tar.gz --atualizar`
(com os tokens do Supabase e da Vercel); depois disso a nuvem se atualiza pelo painel, sem token, e os outros
computadores pelo botão.

- **Atualizar a nuvem** (Computadores → Atualizações → Nuvem e painel): a própria nuvem baixa a versão oficial mais
  nova e aplica só as migrações que faltam, cada uma inteira ou nada, sem guardar token nenhum. A linha mostra a versão
  da nuvem, das funções e do painel, e em que pé estão.
- **Na ordem, inclusive sozinho:** Atualizar sozinho (Desligada, De madrugada, Assim que sair) vale também para a
  nuvem: nuvem, depois funções e painel, depois os computadores. Um passo que falha para os seguintes, aparece no painel
  e manda o alerta "Atualização sozinha parou".
- **Atualização completa (opcional, desligada de fábrica):** `reveza atualizacao-completa ligar` guarda os tokens do
  Supabase e da Vercel na nuvem cifrados com a chave do cofre (a nuvem não consegue ler), e um computador da instalação
  publica sozinho as funções e o painel novos. Quem tem um computador da instalação passa a ter esses tokens: use
  tokens de alcance curto e com validade. Desliga com `reveza atualizacao-completa desligar` ou no painel. O fim da
  instalação oferece (padrão: não).
- Sem a atualização completa, o painel mostra o passo manual só quando a versão mexe nas funções ou no painel.
- **Domínio do painel:** `--dominio contas.meudominio.com` põe ou troca o subdomínio (na instalação ou no
  `--atualizar`) e `--dominio vercel` volta ao endereço gratuito da Vercel; o passo a passo do DNS vale para qualquer
  provedor. Sem escolher, o painel fica no endereço gratuito da Vercel (`<projeto>.vercel.app`, com HTTPS).
- O aviso da versão que precisa da nuvem primeiro aponta para o Atualizar a nuvem.

## 0.2.1 · 12/10/2026

Verificar atualização na hora e escolher como os computadores se atualizam sozinhos. Atualize primeiro o computador que
criou a instalação com `npx https://github.com/dantaspaulo/reveza/archive/refs/tags/v0.2.1.tar.gz --atualizar` (com os
tokens do Supabase e da Vercel: esta versão traz mudança no banco e o painel novo); os outros, pelo botão do painel.

- **Verificar atualização** (Computadores): cada computador ligado confere na hora a versão publicada, sem esperar as
  6 horas, e o painel mostra "Todos na versão mais nova" ou "Versão Y disponível", com Atualizar todos.
- **Atualizar sozinho vira uma escolha:** Desligada (o padrão), De madrugada (3h às 5h) ou **Assim que sair** (o
  computador se atualiza assim que acha a versão nova). Sempre um computador por vez e só com ele calmo (sem troca de
  conta em andamento nem sessão no limite); se um voltar para a versão anterior, os outros param e sai um alerta. Quem
  já tinha ligado continua de madrugada. O cartão mostra o andamento de cada computador.
- **Trava de compatibilidade:** um computador não troca o programa por uma versão que traz mudança na nuvem ainda não
  aplicada. O painel avisa: "A versão Y precisa da nuvem e do painel atualizados primeiro: rode a atualização no
  computador principal". Depois disso, eles seguem sozinhos.
- **Segurança (revisão de código da 0.2.0):** o computador novo recusa a chave do cofre quando a nuvem não tem a
  impressão da chave da instalação; quem libera grava a impressão antes de entregar. Quem escrevesse direto no banco
  poderia apagar a impressão e plantar uma chave dele no computador novo.
- **Nada sai sem passar antes nos três sistemas:** `node scripts/ensaio.mjs` roda os testes daqui e leva a mudança aos
  testes do GitHub (instalação em macOS, Linux e Windows, Windows de verdade e ponta a ponta) antes de publicar; o
  lançamento e o envio para a main recusam código sem esse ensaio verde. O teste do Windows tira o tamanho do código de
  ligação do próprio agente.
- Computadores numa versão anterior à 0.2.1 só se atualizam sozinhos de madrugada; com "Assim que sair", o painel deixa
  o Atualizar todos para eles.

## 0.2.0 · 12/10/2026

Computador novo sem segredo na tela, e instalação mais curta. Atualize primeiro o computador que criou a instalação
com `npx https://github.com/dantaspaulo/reveza/archive/refs/tags/v0.2.0.tar.gz --atualizar` (com os tokens do Supabase
e da Vercel: esta versão traz mudança no banco e o painel novo); os outros computadores, pelo botão Atualizar do painel
(ou o mesmo comando, que não pede token). O computador que libera um computador novo precisa estar na 0.2.0 (o painel
avisa).

- **Ligar computador novo sem segredo na tela** (achado 2 da revisão de segurança de 11/10/2026). O painel mostra um
  código de acesso (`rvzc_`) que só deixa o computador novo **pedir** para entrar: não abre o cofre. O computador novo
  mostra em letras grandes um código de 8 caracteres; você digita esse código na janela que abre no computador que já
  usa o Reveza (sem tela: `reveza ligar XXXX-XXXX`). A chave do cofre vai cifrada só para o computador novo (ECDH +
  HKDF-SHA256 + AES-256-GCM), a nuvem só vê texto cifrado e o apaga na primeira leitura. O pedido vale 10 minutos, um
  por vez (dois ao mesmo tempo são recusados), e três códigos errados recusam o pedido.
- A identidade de um computador novo só vira computador depois de receber a chave do cofre. O painel acompanha cada
  passo e mostra quem liberou; a janela abre na língua do painel.
- **A troca automática já vem ligada** na instalação nova, antes do limite (avisa em 90%, troca em 95%), sem perguntas.
  Uma linha diz isso e onde mudar (no painel, em Troca automática). Quem importa de outro gestor fica com a configuração
  de lá; atualizar não muda a troca de ninguém.
- **A página de criar cada token abre sozinha** no navegador (Supabase e Vercel), na hora em que o instalador pede. Não
  abre com `--sim`, sem terminal, por SSH sem tela nem com o token já no ambiente.
- **Etapas numeradas de 1 até o total do seu caminho** (antes eram sempre "de 8", com números pulados), e perguntas
  mais claras, cada uma dizendo para que serve.
- **Saiu:** o código `rvzl_` (levava a senha do computador e a frase do cofre) e o `rvzpc_`, que o instalador agora
  recusa pedindo um código novo; a frase cifrada para o navegador; e `reveza ligar --painel ligar` (liberar sem
  perguntar). A frase de 6 palavras fica só como emergência, para um computador já ligado que perdeu a chave
  (`reveza ligar --mostrar-frase` / `--frase`).

## 0.1.7 · 12/10/2026

Saúde que conserta, atualizar pelo painel, notificações e a tela de Alertas de volta. Atualize primeiro o computador que
criou a instalação com `npx https://github.com/dantaspaulo/reveza/archive/refs/tags/v0.1.7.tar.gz --atualizar` (com os
tokens do Supabase e da Vercel: esta versão traz mudanças no banco e o painel novo); nos outros computadores, o mesmo
comando, que não pede token; daqui em diante, o botão Atualizar do painel.

- **`reveza doctor` conserta o que tem conserto seguro:** serviço parado ou não instalado, mod ausente nas sessões e
  Claude Code sem login (põe a conta que a nuvem mandou, ou a melhor livre). Cada linha diz "corrigido" ou o que fazer;
  o que não tem conserto automático (entrar de novo numa conta, chave do cofre, relógio, Claude Code ausente ou velho)
  só explica. `reveza doctor --so-ver` só confere.
- **Corrigir na tela Saúde e no cartão do computador** (só administrador), com o resultado item a item. A tela diz que é
  o `reveza doctor` de cada computador, e o Rodar agora mostra na hora o que o computador mandou (antes mostrava o
  resultado guardado, de até 10 minutos antes).
- **Atualizar pelo painel:** "Versão X disponível · Atualizar" em cada computador e "Atualizar todos" em Computadores. O
  computador só aceita versão oficial publicada e mais nova que a dele, baixada do GitHub do projeto, e atualiza com a
  cópia conferida e a volta sozinha da 0.1.6. O painel e a nuvem continuam sendo atualizados pelo instalador no
  computador principal.
- **Atualizar sozinho de madrugada** (opção em Computadores, desligada de fábrica): com versão nova publicada, cada
  computador se atualiza entre 3h e 5h, sem troca de conta nem sessão no limite naquele momento, um por vez. Se um
  voltar para a versão anterior, os outros param e sai um alerta.
- **Tela de Alertas que abria quebrada depois de uma atualização do painel:** a aba aberta antes da versão nova pedia um
  pedaço do painel que não existe mais. Agora a página se recarrega sozinha; se alguma tela quebrar, a caixa de erro
  mostra a mensagem e tem "Copiar detalhes" (sem senha, token nem e-mail).
- **Notificação no celular de ponta a ponta:** crie o alerta em Alertas, o navegador pede a permissão e o aparelho passa
  a receber, com o texto do alerta (cifrado só para aquele aparelho). No iPhone e no iPad, só com o painel instalado
  na tela inicial.
- **Aviso de troca de conta no navegador:** em Alertas ou Minha conta, "Neste navegador" liga uma notificação e um sinal
  curto a cada troca de conta enquanto o painel está aberto.
- **O ntfy saiu dos canais de alerta** (painel, nuvem e instalador). A atualização da nuvem apaga algum alerta ntfy que
  tenha sobrado.
- A instalação e a atualização não acusam mais "nenhum login" enquanto a conta que a nuvem mandou está chegando.
- **Correção:** com o Claude Code sem login, a troca de conta podia gravar o vazio por cima do login guardado da conta
  que estava em uso (vinha da 0.1.4).

## 0.1.6 · 12/10/2026

Cores por workspace e atualização que não perde nada. Quem tem a 0.1.5 atualiza com
`npx https://github.com/dantaspaulo/reveza/archive/refs/tags/v0.1.6.tar.gz --atualizar` (no computador que criou a
instalação, com os tokens do Supabase e da Vercel para o painel subir junto).

- **Contas do mesmo workspace com a mesma cor.** O workspace é a organização da conta ou, sem ela, o domínio do e-mail
  (gmail.com, outlook.com e outros provedores públicos não juntam contas). A cor de cada workspace é a da conta mais
  antiga dele, e dois workspaces não dividem cor enquanto houver cor livre.
- **Nos gráficos, um tom por conta.** Em Uso por dia, na janela de 5 horas e nas sessões, cada conta aparece num tom da
  cor do workspace, e as do mesmo workspace ficam juntas na pilha e na legenda.
- **Trocar a cor vale para o workspace inteiro.** Na gaveta da conta, o campo virou "Cor do workspace", mostra o tom de
  cada conta e põe cadeado nas cores que já são de outro workspace.
- **Atualizar não perde nada.** Antes de mexer em qualquer coisa, o instalador copia contas, logins, uso, configuração e
  identidade para `~/.reveza/copias` e confere a cópia arquivo a arquivo (ficam as 5 mais novas). Depois de atualizar,
  confere que o agente da versão nova está rodando; se não estiver em 30 segundos, volta sozinho para a versão anterior,
  com a configuração da cópia, e as contas e os logins ficam como estavam.
- **Barra lateral do painel:** no topo, o que o Reveza é (antes aparecia o identificador do projeto no Supabase); a
  versão do painel fica embaixo, no rodapé.
- Demonstração e fotos do site com a versão de verdade do Reveza (antes apareciam 0.4.1 e 0.4.2 fixos).
- O teste de ponta a ponta da instalação roda no GitHub a cada envio, nos dois jeitos de instalar.

## 0.1.5 · 12/10/2026

Atualizar um computador ligado não pede mais token. Quem tem a 0.1.4 atualiza com
`npx https://github.com/dantaspaulo/reveza/archive/refs/tags/v0.1.5.tar.gz --atualizar`.

- **Computador novo, atualização sem perguntas:** no computador que entrou pelo código do painel, o `--atualizar`
  perguntava o token do Supabase e seguia como se fosse uma instalação nova. Agora ele atualiza só o programa daquele
  computador; a nuvem e o painel continuam com o computador que criou a instalação.
- No computador que criou a instalação, a pergunta do token avisa que deixar em branco atualiza só ele.
- O teste de ponta a ponta atualiza o segundo computador com os tokens no ambiente e confere que nada vai à nuvem.

## 0.1.4 · 12/10/2026

Windows de verdade e ligação de computador novo mais segura. Quem tem a 0.1.3 atualiza com
`npx github:dantaspaulo/reveza#v0.1.4 --atualizar` (no Windows sem o Git,
`npx https://github.com/dantaspaulo/reveza/archive/refs/tags/v0.1.4.tar.gz --atualizar`). Atualize também o painel (o
`--atualizar` com os tokens do Supabase e da Vercel): para ligar computador novo, painel e computador precisam estar os
dois na 0.1.4.

- **Segurança: um pedido de ligação por vez, e código de 6 caracteres.** Se dois pedidos de ligar computador novo chegam
  juntos, o computador recusa os dois (com som e aviso) e pede para gerar de novo no painel. O código que se digita na
  janela passou de 4 para 6 caracteres. Isso fecha o caso, achado na revisão de segurança, em que alguém com acesso
  direto ao banco da nuvem forjava um segundo pedido com o mesmo código do verdadeiro e levava a chave do cofre.
- **O computador novo recebe a conta mesmo com o Claude Code sem login.** Antes, a troca ficava adiada para sempre com
  "não consegui identificar a conta em uso".
- **Windows, provado num Windows de verdade a cada envio** (o GitHub instala, derruba, atualiza e desinstala o Reveza
  numa máquina Windows, com acento e espaço no caminho):
  - o serviço instala sem administrador (antes, num terminal comum, dava "Acesso negado" e o agente não subia);
  - o agente roda sem janela (antes abria um terminal na tela, e fechar a janela derrubava o agente);
  - não para depois de 3 dias, roda na bateria e não para ao tirar da tomada;
  - volta sozinho em até um minuto se cair, e o `--atualizar` troca o agente que está rodando (antes a versão antiga
    seguia rodando);
  - a janela de confirmação de computador novo aparece (antes ficava escondida, e o pedido era recusado em 90 s);
  - o agente acha o Claude Code instalado pelo npm (o pacote de hoje traz um `.exe`), para conectar, renovar e retomar;
  - o comando `reveza` funciona com acento no caminho (`C:\Users\João`), e o instalador oferece pôr o `reveza` no Path
    do usuário.
- **Linux: o `--atualizar` reinicia o agente** (antes a versão antiga seguia rodando até o computador reiniciar).
- Painel: a caixa de ligar computador novo mostra o comando e o código inteiros (antes cortava à direita).

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
