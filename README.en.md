<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0E1116,100:1D3B5C&height=200&section=header&text=Reveza%20AI&fontColor=FFFFFF&fontSize=56&fontAlignY=36&desc=account%20manager%20for%20your%20coding%20assistant&descAlignY=58&descSize=18" width="100%" alt="Reveza AI" />

<a href="#install"><img src="https://img.shields.io/badge/npx%20github%3Adantaspaulo%2Freveza-3B82F6?style=for-the-badge&logo=npm&logoColor=white" alt="Install" /></a>
<img src="https://img.shields.io/badge/license-MIT-0E1116?style=for-the-badge" alt="MIT license" />
<a href="README.md"><img src="https://img.shields.io/badge/Portugu%C3%AAs-0E1116?style=for-the-badge" alt="Português" /></a>

<br/><br/>

You have more than one account and each has its own limit. **Reveza AI** keeps each account's login, tracks usage and
switches the account on your computer when the one in use gets close to its limit, without stopping what your sessions
are doing. Everything in a panel that is **yours**: on your Supabase, your Vercel, your domain.

</div>

## What it does

| | |
|---|---|
| 🔁 **Account switching** | only at the limit, before the limit (warn at one percentage, switch at another) or rotating during the day. Starts off; you turn it on in the panel. |
| 📊 **Usage and cost** | tokens, replies, agents and sessions per day, account, model and computer, with the equivalent pay-as-you-go cost in dollars. Heat map, ranking, depletion forecast, spreadsheet export. |
| 🗓️ **Weekly plan** | each account's weekly quota split by day, how much is gone and pace alerts. |
| 🖥️ **Several computers** | macOS, Linux and Windows. One account is on one computer at a time; the cloud decides who uses which. |
| 🔔 **Alerts** | Telegram, ntfy, e-mail, webhook or phone push. The installer helps set it up and sends a test message. |
| 👥 **Team** | single-use invite links, roles (administrator and read-only), mandatory two-step verification for administrators, audit log. |
| 🔌 **Integrations** | API with personal keys and scopes, signed webhooks, examples for n8n, curl and scripts. |
| 📱 **On the phone** | the panel installs on the home screen (PWA). |
| 🌎 **Portuguese and English** | in the panel and the installer. |
| 🧪 **Demo** | `--demo` opens the panel with sample data, no cloud and no account touched. |

## How it works

```
 your computer                          your cloud (Supabase)                 your panel (Vercel)
┌──────────────────────────┐          ┌───────────────────────────┐         ┌──────────────────────┐
│ agent (service)          │  polls   │ database with row-level   │  login  │ accounts, usage,     │
│ · each account's login   │ ───────► │ security, switch decision,│ ◄────── │ switching, alerts,   │
│ · ENCRYPTED vault here   │ every    │ vault holding ciphertext  │  + 2    │ team, health         │
│ · switches the account   │   5 s    │ only, queues, alerts      │  steps  │                      │
│ mod in sessions          │          └───────────────────────────┘         └──────────────────────┘
└──────────────────────────┘
```

1. Each account signs in through the **official login**, on the computer itself.
2. Each login goes into an **encrypted vault** (AES-256-GCM). The vault key exists only on your computers; the cloud
   stores ciphertext and cannot open it.
3. The agent reports account usage. The **cloud decides** which computer uses which account (limit, threshold or
   rotation, with schedule, priority and reserve).
4. The computer **switches the account in use** and open sessions keep working. A session that stopped at the limit is
   resumed.
5. Without internet, the computer keeps the current account and does not switch.

The computer **only calls the cloud**: no open port, no tunnel.

## Requirements

- **Node 20.19 or newer** ([nodejs.org](https://nodejs.org)).
- **Claude Code** installed: Reveza works with Claude Code.
- A free **[Supabase](https://supabase.com)** account and a **[Vercel](https://vercel.com)** account (only for the online panel; without them, use `--sem-nuvem`).
- Optional: a domain (the installer shows how to point a subdomain through Cloudflare).

## Install

```bash
npx github:dantaspaulo/reveza --idioma en
```

The installer asks and does, in this order:

1. checks the computer (and, if another account manager is already running, offers **shadow mode**: reads and shows what it would do, without switching anything);
2. installs the agent, the `reveza` command and the session mod;
3. the switching mode (automatic switching starts off);
4. the cloud: with a Supabase personal token, creates the project (or uses one you have), the database, functions and administrator;
5. the panel: builds on your machine, downloads the free [React Bits](https://reactbits.dev) components and publishes to Vercel;
6. the domain: Vercel's or a subdomain of yours, with Cloudflare steps and a DNS check;
7. accounts: the one already signed in is adopted; the others through the official login;
8. alerts, with a test message;
9. the final check: `reveza doctor` and a panel command travelling to the computer and back.

The Supabase and Vercel tokens are **not stored** anywhere.

| Option | What for |
|---|---|
| `--atualizar` | updates agent, mod, database and panel; accounts, usage and settings stay |
| `--sem-nuvem` | this computer only: agent, mod and accounts, no online panel |
| `--ligar` | joins one more computer to an existing installation: asks only for the panel's link code |
| `--sombra` | next to another account manager, switching nothing (port 7789) |
| `--importar <folder>` | copies accounts and usage from another manager; the source does not change |
| `--demo` | the panel with sample data, no cloud |
| `--doctor` | checks the installation: agent, service, cloud, panel and security headers |
| `--desinstalar` | removes the service and the mod; account logins, usage, the vault key (in the keychain) and the computer in the cloud stay: to remove it for good, revoke the computer in the panel |
| `--idioma en` | questions in English |
| `--sim` | no questions (reads `SUPABASE_ACCESS_TOKEN`, `VERCEL_TOKEN`, `REVEZA_ADMIN_EMAIL`, `REVEZA_ADMIN_SENHA`, `REVEZA_SUPABASE_REF` and `REVEZA_DOMINIO` from the environment) |

## In the terminal

```bash
reveza status            # account in use, usage per account, next switch
reveza contas conectar a@example.com
reveza trocar a@example.com
reveza uso --csv         # usage log as a spreadsheet
reveza ligar             # shows 6 words to join another computer
reveza som testar        # system sound on every account switch (on by default; som desligar turns it off)
reveza doctor            # diagnostics
```

In sessions, the **`/reveza`** command shows the accounts and the status line shows the account in use and the 5-hour window.

## API and integrations

Create a key under **Integrations** in the panel, with the scopes you need.

```bash
curl -H "Authorization: Bearer rvz_..." https://<project>.supabase.co/functions/v1/api/estado
curl -H "Authorization: Bearer rvz_..." "https://<project>.supabase.co/functions/v1/api/uso?dias=7"
curl -X POST -H "Authorization: Bearer rvz_..." -d '{"computador":"<id>","conta":"<id>"}' https://<project>.supabase.co/functions/v1/api/trocar
```

Webhooks carry `X-Reveza-Assinatura: sha256=<HMAC-SHA256 of the body with your secret>`. Check it before trusting:

```js
const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
```

## Security

- **Account logins are never in clear text outside the computer.** The cloud vault holds only ciphertext, bound to
  `account|version` (one account's ciphertext cannot be swapped for another's).
- **Least privilege.** No server key outside Supabase; the panel uses the public key and the signed-in user's login.
  Each computer has its own identity, revocable on its own. Every table has row-level security and functions are granted
  one by one.
- **Panel login**: no open sign-up, invite only; strong password; two-step verification for administrators (whoever
  turned it on needs the code in every session, and the installation can require it from everyone); short sessions with
  refresh.
- **Published panel**: strict CSP, HSTS, `frame-ancestors 'none'`, Permissions-Policy and a single domain.
- **On the computer**: the agent only talks to the cloud (no port open to the outside) and the local bridge with the
  mod requires proof of a key only the computer's owner can read (the key itself never travels).
- **New computer, in one step**: in the panel, Computers → Link new computer → Generate the link code. The computer
  that already holds the vault key opens a window asking for the 4-character code shown in the panel; you type it and
  click Release. The panel joins the new computer's access and the 6-word phrase into a single code (`rvzl_...`, valid for
  10 minutes); on the new computer, `npx github:dantaspaulo/reveza --ligar`, paste the code and that's it. The cloud
  alone cannot release it: whoever releases types, on the computer's screen, the code that only their own panel shows. Without a screen (a server), the phrase comes from the terminal (`reveza ligar`), or the
  computer releases without asking if you want (`reveza ligar --painel ligar`).
- **Lost every computer?** The vault cannot be recovered (the price of a cloud that cannot read it). Accounts sign in
  again through the official login.

> Each person is responsible for the use of their own accounts and for the terms of the AI service they use.

## For developers

```bash
cd agente && npm install && npm test        # agent: switching, vault, ownership, fake cloud and local Postgres
cd nuvem && npm install && npm test         # database (PGlite with the migrations) and Edge Functions
npm test                                    # installer
cd painel && npm install && npm run react-bits && npm run dev   # panel (http://localhost:5173/?demo=1)
```

The architecture is in [docs/ARQUITETURA.md](docs/ARQUITETURA.md) (Portuguese). Turn on the repository guard in a new
clone: `git config core.hooksPath .githooks` (it refuses secrets, personal data and React Bits components in commits;
the React Bits license does not allow redistribution, so the installer downloads them on the user's machine).

## License

MIT.
