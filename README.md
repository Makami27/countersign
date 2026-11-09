# Countersign

**Your AI agent pays your bills. Someone just told it your landlord changed wallets. It won't believe them.**

Built for Walrus × Tatum *Total Recall*, Track 2 (Smart Agents for Real Life).

## Status (updated 2026-10-31, Phase 3 of 5)
`pnpm gate`: 71 tests green. Money runs on **Sui testnet** (test USDC); memory runs on the **Walrus Memory mainnet relayer**. Full detail and next steps: `briefing/PLAN.md` → "Where we are".

| Part | State |
|---|---|
| Core engine: payee provenance, onboarding only after the payee's wallet signs, two-signature changes, owner path with cooldown, look-alike and known-attack checks, spend gate, digest-first payments, one signed receipt per final outcome | built and tested [claim:CL01] |
| Tatum (GraphQL + native gRPC, shared 2 req/s gate) | live suite green on testnet; payee signatures verified through our adapter, including a real Slush zkLogin signature [claim:CL03] |
| Walrus Memory (signed records, completeness check, restore) | live on the mainnet relayer [claim:CL10]; relayer outage 30 Oct 22:37 → 31 Oct ~06:00 UTC recorded (REALITY_SPIKES R3) |
| Payments | testnet payments settle through Tatum; Act 1 (model → engine → payment → receipt on Walrus mainnet) and Act 4 (two-wallet address change, then the next payment goes to the new wallet) [claim:CL15] recorded in `evidence/acts/` |
| Telegram bot (`apps/agent`) | built (preview + confirm, refusals with comparison and a receipt link; /login replies with the wallet sign-in link) |
| Discord bot (`apps/agent`, optional) | built on the same chat layer as Telegram: slash commands (/link, /pay, /payees, /balance, /schedules, /check, /cancel, /help), ephemeral replies, notices by DM with Activity as the fallback; off when `DISCORD_BOT_TOKEN` is unset. Discord, like Telegram, can only pay verified payees within caps; sensitive actions need your wallet. |
| Owner web app (`/app`) and signing page (`/sign/:nonce`) | built; sign in with your Sui wallet (one-time message verified through Tatum, V23); tested over HTTP, screen-checked at 390 and 1440 px in light and dark |
| Public site with attack lab (`/`) | built; lab payees go through the same onboarding rules as the agent |
| Real use (≥10 mainnet memories) | 12 agent-signed records from the owner's own use on the mainnet relayer [claim:CL07] |
| Deploy | live at https://countersign.nittings.xyz (Render free, Neon Postgres, D19); `/api/health` reports the deployed commit. Testnet payments, mainnet Walrus Memory |
| Receipt page `/r/:receipt` | built (V14): verdict, money sentence, checks in order, comparison, Walrus blob and Sui links |
| Status | `/status` (and `/api/status`) times Postgres, Tatum gRPC and GraphQL, the Walrus relayer and Telegram polling, and shows the network, deployed commit and last restore |
| Proof page `/proof` | built (V15): live counters from the agent's records, memories per namespace, the preregistered measurement (not run yet), the claims ledger |
| Proof page, measurement | not built (Phase 4); the landing's claims table is generated from CLAIMS.md |

## Known limits
- **Hosting is Render's free plan.** Render can stop the instance on its own (seen once on 31 Oct, with no deploy). It stays down until the next request; an external ping every 5 minutes wakes it, and the start takes 30–60 s. During that window the web app doesn't answer and Telegram messages wait at Telegram; they are handled after the restart. No payment state is lost: the ledger is in Neon Postgres and the payee book is rebuilt from Walrus Memory on every start, followed by one reconciliation pass.
- **Neon's free compute suspends when idle.** The first database call after a pause takes about a second longer; the agent retries a failed connection once and never treats a database timeout as success.
- **Shared scam memory works only between agents that write to the same Walrus Memory account.** Walrus Memory keeps namespaces separate per account, so agents on different accounts don't see each other's reports; each still has its own local checks. A shared namespace past the 100-record read cap reads as incomplete, which means local checks only.

## How it works
AI proposes. Code decides.
- Every payee address in memory records *how* it is known: **VERIFIED** (proven) or **STATED** (someone said so). Only VERIFIED can be paid.
- An address change needs the payee's **current** wallet to sign it (or the owner to confirm it, then a cooldown), **and** the new wallet to prove control. Proving control of your own address is never enough on its own.
- Memory records are signed by the agent's key; forged or unsigned records are ignored.
- If memory can't be read completely, or the chain gives no definite answer, nothing is paid.

## Run
```bash
pnpm install
pnpm gate          # typecheck, no-comments, secrets, tests, claims
cp .env.example .env
pnpm agent
```
Live spikes against Tatum and Walrus Memory: see `spikes/README.md`.

## Repository map
| Path | What |
|---|---|
| `packages/core` | pure engine, no network |
| `packages/adapters` | SQLite, Walrus Memory, Tatum, Gemini, record signer |
| `apps/agent` | agent process: engine, payment runner, Telegram bot, Discord bot (optional), web server |
| `apps/web` | public site and lab, owner app (`/app`), signing page (`/sign/:nonce`) |
| `briefing/` | research, PRD, plan, decisions, failure modes |
| `feasibility/` | offline feasibility tests and evidence |
| `spikes/` | live integration checks to run with real keys |
| `evidence/` | outputs of real runs: spikes, live tests, acts, screenshots |
