# Countersign

**Your AI agent pays your bills. Someone just told it your landlord changed wallets. It won't believe them.**

Built for Walrus × Tatum *Total Recall*, Track 2 (Smart Agents for Real Life).

## Status (updated 2026-10-30)
| Part | State |
|---|---|
| Core engine (`packages/core`): payee records with provenance, change verification, look-alike check, spend gate, signed memory records, restore | **built, 19 tests green** [claim:CL01] |
| SQLite index + Gemini extraction guard (`packages/adapters`) | built, 4 tests green |
| Walrus Memory adapter, Tatum gRPC/GraphQL adapters, payments | written, **not yet run against live services** (spikes pending) |
| Telegram agent (`apps/agent`) | wired, not run |
| Public site with live attack lab (`apps/web`): runs the real core engine in a per-visitor sandbox, check-by-check decision trace, payee slip with verified/stated records | **built, 4 tests green**; responsive to 390px, light and dark |
| Proof section | built; reads the live agent's database when `PROOF_DATABASE_PATH` is set, otherwise says it isn't connected |
| Owner app (wallet signing for changes, owner confirmation with cooldown) | **not built** |
| Attack measurement with a real model | not run |

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
| `apps/agent` | Telegram bot |
| `apps/web` | owner app + proof page (not built) |
| `briefing/` | research, PRD, plan, decisions, failure modes |
| `feasibility/` | offline feasibility tests and evidence |
| `spikes/` | live integration checks to run with real keys |
