<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0E1116,100:1D3B5C&height=200&section=header&text=Reveza%20AI&fontColor=FFFFFF&fontSize=56&fontAlignY=36&desc=gestor%20de%20v%C3%A1rias%20contas%20do%20assistente%20de%20c%C3%B3digo&descAlignY=58&descSize=18" width="100%" alt="Reveza AI" />

<a href="#instalar"><img src="https://img.shields.io/badge/npx%20github%3Adantaspaulo%2Freveza-3B82F6?style=for-the-badge&logo=npm&logoColor=white" alt="Instalar" /></a>
<img src="https://img.shields.io/badge/licen%C3%A7a-MIT-0E1116?style=for-the-badge" alt="Licença MIT" />
<a href="README.en.md"><img src="https://img.shields.io/badge/English-0E1116?style=for-the-badge" alt="English" /></a>

<br/><br/>

Você tem mais de uma conta e cada uma tem o seu limite. O **Reveza AI** guarda o login de cada conta, acompanha o uso
e troca de conta no computador quando a que está em uso chega perto do limite, sem parar o que as sessões estão fazendo.
Tudo num painel que é **seu**: no seu Supabase, na sua Vercel, no seu domínio.

</div>

## O que ele faz

| | |
|---|---|
| 🔁 **Troca de conta** | só no limite, antes do limite (avisa num percentual e troca em outro) ou em rodízio durante o dia. Começa desligada; você liga no painel. |
| 📊 **Uso e custo** | tokens, respostas, agentes e sessões por dia, conta, modelo e computador, com o custo equivalente em dólar se você pagasse por uso. Mapa de calor, ranking, previsão de esgotar, planilha. |
| 🗓️ **Plano da semana** | a cota semanal de cada conta dividida pelos dias, quanto já foi e alerta de ritmo. |
| 🖥️ **Vários computadores** | macOS, Linux e Windows. Uma conta fica com um computador de cada vez; a nuvem decide quem usa qual. |
| 🔔 **Alertas** | Telegram, ntfy, e-mail, webhook ou push no celular. O instalador ajuda a configurar e manda uma mensagem de teste. |
| 👥 **Time** | convite por link de uso único, papéis (administrador e leitura), verificação em duas etapas obrigatória para administrador, auditoria. |
| 🔌 **Integrações** | API com chave pessoal e escopos, webhooks assinados, exemplos para n8n, curl e script. |
| 📱 **No celular** | o painel instala na tela inicial (PWA). |
| 🌎 **Português e inglês** | no painel e no instalador. |
| 🧪 **Demonstração** | `--demo` abre o painel com dados de exemplo, sem nuvem e sem mexer em conta nenhuma. |

## Como funciona

```
 seu computador                         sua nuvem (Supabase)                  seu painel (Vercel)
┌──────────────────────────┐          ┌───────────────────────────┐         ┌──────────────────────┐
│ agente (serviço)         │  busca   │ banco com segurança de    │  login  │ contas, uso, troca,  │
│ · login de cada conta    │ ───────► │ linha, decisão de troca,  │ ◄────── │ alertas, time, saúde │
│ · cofre CIFRADO aqui     │ a cada   │ cofre só com texto        │  + 2    │                      │
│ · troca a conta em uso   │   5 s    │ cifrado, filas, alertas   │ etapas  │                      │
│ mod nas sessões          │          └───────────────────────────┘         └──────────────────────┘
└──────────────────────────┘
```

1. Cada conta entra pelo **login oficial**, no próprio computador.
2. O login de cada conta vai para um **cofre cifrado** (AES-256-GCM). A chave do cofre existe só nos seus computadores;
   a nuvem guarda texto cifrado e não consegue abrir.
3. O agente relata o uso das contas. A **nuvem decide** qual computador usa qual conta (limite, limiar ou rodízio, com
   agenda, prioridade e reserva).
4. O computador **troca a conta em uso** e as sessões abertas seguem trabalhando. Sessão que parou no limite é retomada.
5. Sem internet, o computador mantém a conta atual e não troca.

O computador **só chama a nuvem**: nenhuma porta aberta, nenhum túnel.

## Requisitos

- **Node 20.19 ou mais novo** ([nodejs.org](https://nodejs.org)).
- **Claude Code** instalado: o Reveza funciona com o Claude Code.
- Uma conta grátis no **[Supabase](https://supabase.com)** e outra na **[Vercel](https://vercel.com)** (só para o painel online; sem elas, use `--sem-nuvem`).
- Opcional: um domínio (o instalador ensina a apontar um subdomínio pela Cloudflare).

## Instalar

```bash
npx github:dantaspaulo/reveza
```

O instalador pergunta e faz, nesta ordem:

1. confere o computador (e, se outro gestor de contas já estiver rodando, oferece o **modo sombra**: lê e mostra o que faria, sem trocar nada);
2. instala o agente, o comando `reveza` e o mod das sessões;
3. o modo de troca (a troca automática começa desligada);
4. a nuvem: com um token pessoal do Supabase, cria o projeto (ou usa um que você já tem), o banco, as funções e o administrador;
5. o painel: compila na sua máquina, baixa os componentes grátis do [React Bits](https://reactbits.dev) e publica na Vercel;
6. o domínio: o da Vercel ou um subdomínio seu, com o passo a passo da Cloudflare e a conferência do DNS;
7. as contas: a que já está conectada entra sozinha; as outras, pelo login oficial;
8. os alertas, com mensagem de teste;
9. a prova final: `reveza doctor` e um comando do painel indo até o computador e voltando.

Os tokens do Supabase e da Vercel **não ficam guardados** em lugar nenhum.

| Opção | Para quê |
|---|---|
| `--atualizar` | atualiza agente, mod, banco e painel; contas, uso e configuração ficam |
| `--sem-nuvem` | só neste computador: agente, mod e contas, sem painel online |
| `--ligar` | liga mais um computador a uma instalação que já existe: pede só o código de ligação do painel |
| `--sombra` | ao lado de outro gestor de contas, sem trocar nada (porta 7789) |
| `--importar <pasta>` | copia contas e uso de outro gestor; a origem não muda |
| `--demo` | o painel com dados de exemplo, sem nuvem |
| `--doctor` | confere a instalação: agente, serviço, nuvem, painel e cabeçalhos de segurança |
| `--desinstalar` | tira o serviço e o mod; logins das contas, uso, chave do cofre (no chaveiro) e o computador na nuvem ficam: para tirar de vez, revogue o computador no painel |
| `--idioma en` | perguntas em inglês |
| `--sim` | sem perguntas (lê `SUPABASE_ACCESS_TOKEN`, `VERCEL_TOKEN`, `REVEZA_ADMIN_EMAIL`, `REVEZA_ADMIN_SENHA`, `REVEZA_SUPABASE_REF` e `REVEZA_DOMINIO` do ambiente) |

## No terminal

```bash
reveza status            # conta em uso, uso de cada conta, próxima troca
reveza contas conectar a@exemplo.com
reveza trocar a@exemplo.com
reveza uso --csv         # registro de uso em planilha
reveza ligar             # mostra 6 palavras para ligar outro computador
reveza som testar        # som do sistema a cada troca de conta (ligado de fábrica; som desligar para tirar)
reveza doctor            # diagnóstico
```

Nas sessões, o comando **`/reveza`** mostra as contas e a linha de status mostra a conta em uso e a janela de 5 horas.

## API e integrações

Crie uma chave em **Integrações**, no painel, com os escopos que precisar.

```bash
curl -H "Authorization: Bearer rvz_..." https://<projeto>.supabase.co/functions/v1/api/estado
curl -H "Authorization: Bearer rvz_..." "https://<projeto>.supabase.co/functions/v1/api/uso?dias=7"
curl -X POST -H "Authorization: Bearer rvz_..." -d '{"computador":"<id>","conta":"<id>"}' https://<projeto>.supabase.co/functions/v1/api/trocar
```

Os webhooks levam o cabeçalho `X-Reveza-Assinatura: sha256=<HMAC-SHA256 do corpo com o seu segredo>`. Confira antes de confiar:

```js
const esperado = "sha256=" + crypto.createHmac("sha256", segredo).update(corpoBruto).digest("hex");
```

## Segurança

- **Login de conta nunca em claro fora do computador.** O cofre na nuvem só tem texto cifrado, com dado associado
  `conta|versão` (não dá para trocar o cifrado de uma conta pelo de outra).
- **Menor privilégio.** Nenhuma chave de servidor fora do Supabase; o painel usa a chave pública e o login de quem
  entra. Cada computador tem identidade própria, revogável sozinha. Toda tabela tem segurança de linha, e as funções são
  liberadas uma a uma.
- **Login do painel**: sem cadastro aberto, só por convite; senha forte; verificação em duas etapas para
  administrador (quem ativou precisa do código em toda sessão, e a instalação pode exigir de todos); sessão curta com
  renovação.
- **Painel publicado**: CSP restrita, HSTS, `frame-ancestors 'none'`, Permissions-Policy e um domínio só.
- **No computador**: o agente só fala com a nuvem (nenhuma porta aberta para fora) e a ponte local com o mod exige a
  prova de uma chave que só o dono do computador lê (a chave em si nunca viaja).
- **Computador novo, em um passo**: no painel, Computadores → Ligar computador novo → Gerar o código de ligação. O
  computador que já tem a chave do cofre abre uma janela pedindo o código de 4 caracteres que o painel mostra; você
  digita e clica em Liberar. O painel junta o acesso do computador novo e a frase de 6 palavras num código só
  (`rvzl_...`, vale 10 minutos); no computador novo, `npx github:dantaspaulo/reveza --ligar`, cola o código e pronto.
  A nuvem sozinha não consegue liberar: quem libera digita, na tela do computador, o código que só o painel dela mostra. Sem tela (servidor), a frase sai pelo terminal (`reveza ligar`), ou o computador libera sem perguntar se você
  quiser (`reveza ligar --painel ligar`).
- **Perdeu todos os computadores?** O cofre não se recupera (é o preço de a nuvem não conseguir ler). As contas se
  conectam de novo pelo login oficial.

> Cada pessoa responde pelo uso das próprias contas e pelos termos do serviço de IA que usa.

## Para quem desenvolve

```bash
cd agente && npm install && npm test        # agente: troca, cofre, posse, nuvem falsa e contra Postgres local
cd nuvem && npm install && npm test         # banco (PGlite com as migrações) e Edge Functions
npm test                                    # instalador
cd painel && npm install && npm run react-bits && npm run dev   # painel (http://localhost:5173/?demo=1)
```

A arquitetura está em [docs/ARQUITETURA.md](docs/ARQUITETURA.md). Ligue a trava do repositório num clone novo:
`git config core.hooksPath .githooks` (ela recusa segredo, dado pessoal e componente do React Bits no commit; a licença
do React Bits não deixa redistribuir, por isso o instalador baixa na máquina de quem usa).

## Licença

MIT.
