# Reveza AI: arquitetura

Gestor de várias contas de assistente de código, com painel na nuvem, troca de conta automática e registro de uso.
Funciona com o Claude Code (a única menção ao nome fica na instalação e nos requisitos). Projeto aberto, licença MIT.

Este documento é a fonte de verdade para quem constrói. Decisões tomadas pelo dono do projeto em 10 e 11/10/2026.

## 1. Princípios

1. **Login de conta nunca em claro fora do computador.** O cofre na nuvem guarda só texto cifrado. A chave do cofre
   existe só nos computadores do usuário (chaveiro do sistema). Vercel e Supabase não conseguem decifrar.
2. **A nuvem orquestra.** Ela decide qual computador usa qual conta, com base no uso que os computadores relatam.
   Sem internet, o computador mantém a conta atual e não troca (aceito pelo dono).
3. **O computador só chama a nuvem.** Nenhuma porta aberta, nenhum túnel. Busca a cada 5 s.
4. **Menor privilégio em tudo.** Nenhuma chave de servidor fora do Supabase. A Vercel usa a chave pública e o token de
   quem está logado. Cada computador tem a própria identidade, revogável sozinha.
5. **Cada instalação é dona de tudo.** Supabase, Vercel e domínio são da pessoa que instala. Nada passa por servidor
   do autor do projeto.

## 2. Peças

| Peça | Tecnologia | Onde roda | Papel |
|---|---|---|---|
| `agente` | Node 18+ (TypeScript compilado), só módulos nativos + `@supabase/supabase-js` | cada computador | troca a credencial local, lê o uso das contas que tem em mãos, renova login, cifra e decifra o cofre, registra uso das transcrições, retoma sessão |
| `mod` | módulo de hooks do Claude Code | cada sessão | uso ao vivo, aviso de limite, retomada da sessão, `/reveza` |
| `nuvem` | Supabase (Postgres + RLS, Auth com MFA, Edge Functions, pg_cron) | projeto da pessoa | estado, decisões, cofre cifrado, filas, alertas, auditoria |
| `painel` | Vite + React + TypeScript + Tailwind v4 + shadcn/ui (blocos oficiais) + React Bits grátis (baixado na instalação) | Vercel da pessoa | tudo o que a pessoa vê e controla, pt-BR e en, instalável no celular (PWA) |
| `instalador` | Node (`npx github:<dono>/reveza`) | computador da pessoa | perguntas, provisiona Supabase e Vercel, domínio, primeiro computador e contas, alertas, prova final |
| `cli` | o próprio `agente` (`reveza status`, `reveza trocar`, `reveza uso --csv`, `reveza doctor`) | computador | integração por script e diagnóstico |

Por que o agente sai de Python para Node: Windows não tem Python de fábrica, o Node já é exigido pelo instalador e
pelo Claude Code, e o Node tem AES-256-GCM e scrypt nativos (o Python padrão não tem cifra autenticada).

## 3. Onde fica o login de cada conta no computador

| Sistema | Credencial ativa | Credencial de cada conta guardada |
|---|---|---|
| macOS | chaveiro, serviço `Claude Code-credentials` (gravação por `security -i` quando cabe em ~4 KB, argv quando não, como o próprio Claude Code) | chaveiro, serviço `Claude Code-credentials-<sha256(pasta)[:8]>` da pasta `~/.reveza/contas/<id>` |
| Linux e Windows | `~/.claude/.credentials.json` (modo 600 no Linux; ACL do perfil no Windows) | `~/.reveza/contas/<id>/.credentials.json` |

Regras herdadas do roteador (provadas em 10 e 11/10, com teste):
- trocar mexe só em `claudeAiOauth` e `organizationUuid`; o `mcpOAuth` é da máquina e fica;
- nunca renovar pela cópia guardada da conta ativa (o token de renovação gira);
- renovar e trocar a mesma conta nunca ao mesmo tempo (trava por conta); destino perto de vencer é renovado antes;
- conferir a principal 5 s depois da troca e refazer se uma sessão regravou a conta antiga;
- login novo só vale se a conta que voltou é a pedida.

## 4. Cofre cifrado

- Chave do cofre `K`: 32 bytes aleatórios, criada no primeiro computador, guardada no chaveiro do sistema
  (macOS: Keychain; Windows: Credential Manager via `cmdkey`/DPAPI; Linux: `secret-tool` quando houver, senão
  arquivo 600 com aviso).
- Cada login guardado: `AES-256-GCM(K, nonce aleatório de 12 bytes, JSON só com claudeAiOauth e organizationUuid)`,
  com dado associado `conta_id|versao` (impede trocar o cifrado de uma conta pelo de outra).
- Computador novo recebe `K` por uma **frase de ligação**: o computador que já tem `K` gera 6 palavras, deriva uma
  chave com scrypt e publica `K` embrulhado por 10 minutos; o novo digita as palavras (ou lê o QR no painel) e
  desembrulha. A frase nunca vai à nuvem.
- Perdeu todos os computadores: o cofre não se recupera (é o preço de a nuvem não conseguir ler). As contas se
  conectam de novo pelo login oficial.

## 5. Posse das contas (uma conta, um computador de cada vez)

O token de renovação gira a cada uso. Dois computadores com a mesma cópia queimam o login um do outro. Por isso:
- `posse(conta_id, computador_id, desde, expira_em)`: quem tem a posse é o único que usa ou renova aquela conta.
- O computador renova a posse a cada busca (expira em 2 min sem renovar). Antes de soltar uma conta, ele cifra e
  devolve ao cofre o login mais novo, e só então solta.
- Leitura de uso de conta parada: a nuvem escolhe um computador ligado, que pega a posse curta, renova se precisar,
  lê, devolve ao cofre e solta.

## 6. Decisão (na nuvem)

Função `decidir()` em Postgres, chamada pelo pg_cron a cada minuto e na hora por gatilho quando chega uso novo ou
aviso de limite. Para cada computador ligado:
- modo `limite` (só no limite), `limiar` (aviso e troca) ou `rodizio` (de tempos em tempos, intervalo sorteado entre
  75% e 125%, conta livre sorteada ou a menos usada), com o limiar valendo de rede;
- respeita ordem de preferência, conta de reserva (só sem nenhuma outra), agenda por horário, teto semanal e plano
  da semana (cota da semana dividida pelos dias restantes);
- janela cheia = maior entre 5 h, semana e semana por família de modelo; reset que já passou conta como zero;
- espera mínima de 90 s entre trocas do mesmo computador, menos quando a sessão bateu o limite;
- grava a decisão em `atribuicao(computador_id, conta_id, motivo, versao)` e no `eventos`.

## 7. Nuvem: tabelas (todas com RLS ligado)

| Tabela | Quem lê | Quem escreve |
|---|---|---|
| `membros(user_id, papel)` papel: `admin`, `leitura`, `computador` | membro | admin (convite por Edge Function) |
| `convites(email, papel, expira_em, criado_por)` | admin | admin |
| `computadores(id, user_id, nome, sistema, versao, visto_em, revogado)` | membro | o próprio computador (seu registro); admin revoga |
| `contas(id, email, organizacao, plano, cor, prioridade, reserva, pausada, agenda, teto_semana)` | membro | admin; computador grava plano e organização |
| `cofre(conta_id, cifrado, nonce, versao, gravado_por, gravado_em)` | só computador | só computador com posse |
| `posse(conta_id, computador_id, expira_em)` | membro | só por função (`pegar_posse`, `soltar_posse`) |
| `atribuicao(computador_id, conta_id, motivo, versao)` | membro | só a função `decidir` |
| `uso_janelas(conta_id, tipo, pct, reset_em, lido_em, fonte)` | membro | computador |
| `uso_tokens(dia, hora, conta_id, computador_id, projeto, modelo, entrada, saida, cache_escrita, cache_leitura, usd, respostas)` | membro | computador |
| `sessoes(id, computador_id, projeto, inicio, fim, agentes, usd, contas)` | membro | computador |
| `eventos(em, tipo, texto, dados)` | membro | funções e computador |
| `comandos(id, criado_por, computador_id, acao, corpo, estado, resposta)` | membro | admin cria; computador reserva e responde |
| `config(chave, valor)` modo, limiares, rodízio, intervalo | membro | admin |
| `alertas(canal, destino_cifrado, eventos, ativo)` | admin | admin |
| `auditoria(em, user_id, acao, alvo, ip)` | admin | gatilhos (ninguém edita) |
| `chaves_api(id, user_id, prefixo, hash, escopos, criada_em, usada_em, revogada)` | dono da chave | o próprio usuário |

Ações do painel que mudam alguma coisa passam por função Postgres `security definer` que confere o papel, grava a
auditoria e valida a entrada; o painel nunca escreve direto em tabela.

Ajustes da revisão de segurança de 11/10/2026 (migrações 0007 e 0008, testes em `nuvem/testes/revisao-seguranca` e
`painel-extra`):
- leitura de convites, alertas, webhooks e auditoria exige administrador COM duas etapas;
- o segredo de cada canal de alerta (Vault) só a própria função liga ao canal; destino conferido por canal, e todo
  endereço que a nuvem chama é https público (sem IP escrito, porta diferente de 443, usuário na URL ou nome interno),
  conferido no banco e de novo na Edge Function, que não segue redirecionamento;
- o código de login colado no painel sai de `comandos` assim que o computador reserva o pedido;
- convite novo cancela o anterior do mesmo e-mail, convite pode ser cancelado e aceitar nunca rebaixa administrador;
- revogar computador desliga o login dele no Auth e derruba as sessões;
- uma conta só pode estar atribuída a um computador (índice único e trava na `rvz_atribuir`);
- comando `ligar`: o painel manda só uma chave pública efêmera (P-256); o computador publica a ligação e devolve as 6
  palavras cifradas para ela (ECDH + HKDF-SHA256 + AES-256-GCM, rótulos `reveza-ligacao*`).

## 7b. Ponte local (mod e linha de comando ↔ agente)

HTTP só em 127.0.0.1, Host conferido (contra DNS rebinding), cabeçalho `X-Reveza: 1` (o navegador não manda sem
preflight, e a ponte não responde preflight) e a prova da chave local que mora em `~/.reveza/ponte.chave` (64 hex,
arquivo 600): `X-Reveza-Prova` = HMAC-SHA256(chave, "MÉTODO\ncaminho\ntempo\nnonce"), com `X-Reveza-Tempo` (60 s) e
`X-Reveza-Nonce` (uso único). A chave nunca viaja: se outro programa estiver na porta no lugar do agente, ele não a
aprende. Outro usuário do mesmo computador, que alcança 127.0.0.1, não lê e-mails nem força troca. A
retomada de sessão só acontece na pasta registrada na transcrição da própria sessão (nunca na que chega pela ponte),
e o texto que o mod põe no prompt é fixo.

## 7c. Atualização do banco

`reveza_migracoes(nome, hash)`: migração nova entra; arquivo marcado `-- reaplicável` (só funções, políticas e
índices idempotentes) roda de novo quando muda; migração de tabela que mudou depois de aplicada é recusada (vai numa
migração nova); as permissões (0099) fecham qualquer aplicação. As chaves do push (VAPID) nascem uma vez.

## 8. Autenticação e acesso

- Supabase Auth com senha + verificação em duas etapas (TOTP) para `admin`: quem ativou precisa do código em toda
  sessão; quem não ativou age só com a senha, a não ser que a instalação exija (`exigir_duas_etapas`). Quem confere é o
  banco (`rvz_exigir_admin` = admin e `rvz_aal2`) e as Edge Functions (`servico_aal_ok`); não há servidor do painel.
- Computador novo: pelo painel, em um passo. O painel cria o acesso do computador novo e manda o comando `ligar`
  (com a chave pública efêmera do navegador) a um computador que tem a chave do cofre. Esse computador abre uma janela
  (macOS `osascript`, Windows `MessageBox`, Linux `zenity`) com um código de 4 caracteres tirado do SHA-256 da chave
  pública do navegador; o painel mostra o mesmo código. Só com o clique em Liberar ele publica a ligação e devolve a
  frase cifrada para o navegador, que junta acesso e frase num código só (`rvzl_`). Um pedido forjado direto no banco
  viria com outra chave, e então com outro código (e uma janela que ninguém pediu). A janela espera até 90 s, à parte
  da busca (a troca não para). Sem tela, a frase sai por `reveza ligar` no terminal; `reveza ligar --painel ligar`
  (arquivo `~/.reveza/ligar-pelo-painel`) libera sem perguntar, para quem aceita que a nuvem autorize.
- Cadastro público desligado; entra só por convite (link de uso único, expira em 72 h).
- Troca de senha com reautenticação; "esqueci a senha" com redirecionamento só para o domínio do painel.
- Sessão: JWT de 1 h com renovação; lista de sessões e "sair de todas" (revoga os refresh tokens do usuário).
- Computador: usuário próprio do Auth, papel `computador`, senha aleatória longa no chaveiro do computador; revogar o
  computador = desativar esse usuário.
- Chaves de API pessoais (para script e n8n): prefixo visível, hash guardado, escopos (`ler`, `trocar`), revogáveis.

## 9. Painel

Menu lateral, nada empilhado numa tela só:
1. **Visão geral**: conta em uso por computador, ritmo, previsão, faixas de alerta.
2. **Contas**: lista, cor, prioridade, reserva, agenda, teto semanal, conectar (gera o pedido ao computador), entrar
   de novo, pausar.
3. **Computadores**: lista, sistema, versão, visto há, conta em uso, ligar computador novo (frase de 6 palavras ou
   QR), revogar.
4. **Uso**: custo equivalente, tokens, agentes, sessões por dia, conta, modelo, projeto e computador; mapa de calor;
   ranking; previsão de esgotar; exportar planilha.
5. **Plano da semana**: cota semanal por conta dividida pelos dias, quanto já foi, alerta de ritmo.
6. **Troca automática**: liga e desliga, modo (só no limite, limiar, rodízio), limiares, intervalo, ordem, agenda.
7. **Alertas**: canais (Telegram, ntfy, e-mail, webhook, push do celular), quais eventos, botão de teste.
8. **Integrações**: chaves de API, webhooks de saída, exemplos prontos (n8n, curl, script).
9. **Time**: membros, papéis, convites, auditoria.
10. **Minha conta**: senha, verificação em duas etapas, sessões abertas, idioma.
11. **Como funciona**: diagrama animado do caminho (login oficial no computador, cofre cifrado, nuvem decide,
    computador troca) e da regra de alternar, com exemplos.
12. **Saúde**: o resultado do `doctor` de cada computador, atraso da busca, versão.

Modo demonstração: `?demo=1` ou instalação `--demo` liga dados de exemplo gerados no próprio navegador, sem nuvem.

## 10. Instalador (no padrão do Claquete)

`npx github:<dono>/reveza` com `--atualizar`, `--desinstalar`, `--sem-nuvem`, `--demo`, `--doctor`, `--ajuda`.
Passos: conferência do sistema, agente e mod, contas (login oficial de cada uma), modo de troca (troca automática
começa desligada), nuvem (token do Supabase, cria o projeto, aplica o banco e as funções, cria o administrador com
verificação em duas etapas, cria a identidade do computador e a chave do cofre), painel (login na Vercel, publica,
cabeçalhos), domínio (subdomínio próprio com o passo a passo na Cloudflare, ou o domínio da Vercel), alertas (canal
escolhido, mensagem de teste), interface (React Bits grátis baixado; o repositório não traz código do React Bits),
prova final (`doctor` e um comando do painel chegando ao computador).

## 11. Segurança do painel publicado

CSP restrita (`script-src 'self'`, `connect-src` só o Supabase da instalação), HSTS, `frame-ancestors 'none'`,
Permissions-Policy, um domínio só (o `*.vercel.app` redireciona), limite de tentativas no login (o do Supabase e,
se a pessoa usar a Cloudflare na frente, uma regra de limite de taxa e o Turnstile), nada de mapa de código no ar.

## 12. Fora do repositório

Credenciais de qualquer tipo (o pre-commit recusa), código do React Bits, e-mails e dados de qualquer conta real.
