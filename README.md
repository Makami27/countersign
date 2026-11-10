# Countersign

**Your agent only pays signatures it has on file.**

An AI agent reads every message you forward it, follows instructions written in text, and is never
suspicious. That makes it the ideal target for the costliest ordinary fraud there is: *"our bank
details have changed, pay this account from now on."* Business email compromise cost $3.0 billion in
2025 (FBI IC3). In crypto there is no bank in the middle to recall the payment — in December 2025
one person sent about $50 million in USDT to an address that matched the real one at both ends.

Countersign pays your regular payees — rent, freelancers, suppliers — in USDC on Sui, and **cannot
be talked into paying a new address**. A message can only ever *suggest* an address. Only the
payee's own wallet can *prove* one. The AI reads messages; the code decides.

- **Try to scam it yourself, no sign-in:** https://countersign.nittings.xyz/demo
- **Watch it work (2:19):** https://youtu.be/M_8pBAx5o-A
- **How it was built, and what broke:** [The AI agent you can't talk out of your money](https://medium.com/@makamikamsi/the-ai-agent-you-cant-talk-out-of-your-money-a360069d9975)
- **If you are judging this:** [JUDGING.md](JUDGING.md) — a 60-second, 5-minute and 15-minute path
- **Live app:** https://countersign.nittings.xyz · **Proof:** [/proof](https://countersign.nittings.xyz/proof) · **Health:** [/status](https://countersign.nittings.xyz/status)

Built for Walrus × Tatum *Total Recall*, Track 2 (Smart Agents for Real Life). Money runs on **Sui
testnet** with test USDC. Memory runs on the **Walrus Memory mainnet relayer**.

## The one rule

Every payee address in memory records *how* it is known: **VERIFIED** (the payee's own wallet
signed for it) or **STATED** (someone said so). Only VERIFIED is payable, and nothing arriving in a
message can create a VERIFIED record.

That rule is enforced by the shape of the data, not by the model's good behaviour. This is the
entire surface the model gets to fill in — `packages/core/src/types.ts`:

```ts
export type Proposal =
  | { readonly kind: "pay"; readonly payeeId: string; readonly amountBaseUnits: string; readonly reasonQuote: string }
  | { readonly kind: "change_address"; readonly payeeId: string; readonly newAddress: string; readonly reasonQuote: string }
  | { readonly kind: "none" };
```

No status field. No spending-cap field. No "use this address" field. A model entirely under an
attacker's control can propose the attacker's address and still never make it payable. Our change
logic holds that property across 1,000 random attack sequences over eight attack types
[claim:CL01].

Three consequences, in order:

1. **The payee signs once.** Adding a payee sends them a link; they sign a message with their own
   wallet. Only then is the address verified and payable.
2. **Messages can only suggest.** An address in an email, a chat or a forwarded invoice is stored as
   *said, not proven*, and is never paid.
3. **Changes need two signatures.** A new address needs the **old** wallet's signature *and* the
   **new** one's. Proving you control an address is never, on its own, authority to change
   anything. If the old wallet is lost, the owner confirms with their own wallet, then a 24-hour
   wait begins that they can cancel — and the scam checks run again at the end of it.

## What it does

Pay from the **web app**, **Telegram** or **Discord**. Schedule payments weekly, fortnightly,
monthly or yearly — every run re-checks everything from scratch. Every decision, paid or refused,
produces a public receipt at `/r/<id>` carrying the checks in the order they ran, the Walrus blob
and the Sui transaction.

The refusal screen is the part people remember: a look-alike address is shown grouped against the
verified one with the differing character groups marked, under a VOID stamp, and each address gets
a signature scrawl drawn deterministically from its own bytes, so a look-alike *looks* different at
a glance. (The scrawl is decoration; the real check is the address comparison.)

A hacked Telegram or Discord account can only pay already-verified payees within your limits —
anything that changes an address needs your wallet. A typo can never be verified, because the new
wallet has to sign. An unclear payment is looked up by its transaction id and never sent twice.

## How Walrus Memory is used

Walrus Memory is the agent's **source of truth**, not a log. Every payee address, how that address
is known, every receipt, every schedule and the owner's wallet is a record signed by the agent key
on the mainnet relayer. SQLite and Postgres are an index rebuilt from it; if the two disagree,
Walrus wins.

The agent rebuilds its payee book from Walrus on every start, and this is where the design earns
its keep: **if memory cannot be read completely, nothing is paid.** An incomplete read is treated
as *unknown*, never as *no objection* — which is the failure mode that turns a memory outage into a
payout. `/status` reports the last restore and whether it was complete.

Our adapter writes agent-signed records and a fresh adapter reads them back with namespace count,
full listing and recall all agreeing, nothing dropped, and a retried write adding nothing
[claim:CL10]. Recall stays complete at the relayer's 100-record cap: count, listing and recall all
equal 100 [claim:CL13]. Forged or unsigned records are ignored.

This is also why the *second* scam is refused on sight: the first refusal is a record in memory, and
memory is what the checks read. On the deployed agent, a look-alike of a verified address was
refused with the comparison, and the same message sent again was refused as a known attack **citing
the first receipt** — both receipts stored on the mainnet relayer and answering 200 from the Walrus
aggregator [claim:CL14].

## How Tatum is used

Tatum's Sui gateway is the only way this project touches the chain: verifying payee signatures,
sending USDC, and looking payments up. gRPC and GraphQL, behind one shared 2 req/s gate
(`packages/adapters/src/tatum/`).

Verification is the product, so this matters more than it sounds. Sign-in uses Slush, which makes a
free Sui wallet from a Google account — those are **zkLogin** signatures, and verifying one needs
the GraphQL endpoint, not JSON-RPC. Tatum verifies a real Slush zkLogin signature and rejects it for
another address or an altered message [claim:CL11], and our own adapter path does the same for a
real payee onboarding, VERIFIED record carrying scheme `ZKLOGIN`, maxEpoch 1271, checked at epoch
1269 [claim:CL03]. Separately, our Sui personal-message verification matches Mysten's published
vectors byte for byte [claim:CL02].

Without Tatum there is no verification step. Without verification there is no Countersign.

## What it stops

Measured against 9 attack types, 10 tries each, with a real model, run 2026-11-01 on Sui testnet
with `openai/gpt-oss-120b` via Groq [claim:CL16]:

| | Scam messages | Paid to an attacker address |
|---|---|---|
| **Countersign** | 90 | **0** |
| The same agent, memory read without the status checks | 90 | **71** |

**50 of 50** ordinary payment requests were paid correctly, with **0 false refusals**. 643 relayer
calls, all confirmed. 0 model errors, 0 trial errors. The attack types: direct change request,
impersonated authority, fake history, look-alike address, hidden in a forwarded invoice, urgency and
cap pressure, replayed old signature, record-shaped text written to memory, and split-brain (two
conflicting addresses planted over time).

**Preregistered** — the plan was written into `briefing/PRD.md` before the run. **Said honestly** —
in the measurement "paid" means the agent *decided and reserved* the payment; nothing was sent on
chain during it. The baseline was rarely fooled by two of the nine types (forwarded invoice, 0 of
10; urgency, 1 of 10) because the model did not read those as address changes at all. Per-attack
numbers, the raw per-trial log and the corpus are in `evidence/measurement/`.

## Real usage

Not a demo account: records written by the owner actually using the deployed agent, on the Walrus
Memory mainnet relayer, each opened and checked as agent-signed.

| | |
|---|---|
| Agent-signed records from real use | **12** counted 2026-11-01 [claim:CL07] — `evidence/a02-memory-count.json` |
| Scams refused end to end on the deployed agent | **2**, with public receipts [claim:CL14] |
| Two-wallet address changes verified, then paid to the new address | **1** [claim:CL15] — `evidence/acts/act4/` |
| Live counters, read from the agent's own records | [/proof](https://countersign.nittings.xyz/proof) |

A real address change, start to finish [claim:CL15]: Rent's address changed only after Rent's
current wallet signed, then the new wallet signed, on the deployed signing page; the next payment,
0.01 test USDC, settled to the new wallet on Sui testnet; the used link reports Done with the
receipt. Receipts, blob ids answering 200 from the mainnet aggregator, the transaction and
screenshots of the live pages are all in `evidence/acts/act4/`.

## For judges

[JUDGING.md](JUDGING.md) is the pathway: one minute trying to break it on `/demo`, five minutes on
the three things that make it work, fifteen minutes from each claim to the file that proves it.

Every claim in this README carries a `[claim:CLnn]` tag. `pnpm check:claims` fails the build if a
tag points at anything not marked `PROVEN` in [CLAIMS.md](CLAIMS.md) — and the ledger records, for
every claim, what it **does not** establish. Two claims are still marked NOT PROVEN, so they appear
nowhere in our copy.

## Run it

```bash
pnpm install
pnpm gate          # typecheck, no-comments, secret scan, unit tests, claim check
```

`pnpm gate` needs no keys and no network. To run the agent:

```bash
cp .env.example .env    # Tatum, Walrus Memory, Groq, a Sui key, Postgres
pnpm agent              # engine + Telegram + Discord + web server
pnpm web                # public site only
```

Live suites spend real quota and real testnet gas: `pnpm test:live` (adapter round-trips),
`pnpm spikes` (raw gateway and relayer behaviour, failures included), `pnpm testnet:pay`.
See `spikes/README.md`.

## Tests

**267 tests in 53 files, all green**, 2026-11-10 (`pnpm test`, 5m 06s). Tests are named as
behaviour, with the acceptance id in the title, so a failure reads as a sentence:

```
✔ C13 model output that tries to set a status or a cap is refused, and a proposal has no field for either
✔ C08 a payment whose submission times out is held UNKNOWN and is never submitted again, across send, settle and restart recovery
✔ V22 unreadable shared memory means local checks only: a flagged address goes on to the normal proofs instead of being refused
```

`pnpm gate` runs the typecheck, the no-comments rule, a secret scan, all 267 tests and the claim
check. The run above was on Node 24.19.0; `package.json` asks for `>=26.13.0`, so pnpm prints an
unsupported-engine warning on 24 and the suite runs anyway.

## Honest status and limits

- **A stolen payee wallet defeats it.** If a scammer controls the landlord's real wallet, their
  signature is valid. Countersign checks who signed, not who is holding the phone. So does a
  compromised owner device or owner wallet.
- **You can still be talked into approving a change** on the lost-wallet path. The 24-hour wait and
  Cancel are a safety net, not a guarantee.
- **Testnet only.** No mainnet money has ever moved through this agent. Memory is mainnet; money is
  not.
- **The measurement covers K1–K9.** An attack nobody thought of is not in the 90.
- **Hosting is Render's free plan.** Render can stop the instance on its own; it stays down until
  the next request and takes 30–60 s to start. The web app does not answer in that window and
  Telegram messages wait at Telegram, then get handled. No payment state is lost: the ledger is in
  Neon Postgres and the payee book is rebuilt from Walrus Memory on every start, followed by one
  reconciliation pass.
- **Neon's free compute suspends when idle.** The first call after a pause is about a second slower;
  a failed connection is retried once and a database timeout is never treated as success.
- **Shared scam memory only works between agents writing to the same Walrus Memory account.**
  Namespaces are per account. A shared namespace past the 100-record read cap reads as incomplete,
  which means local checks only.
- **Slush is not available in every country.** Any other Sui wallet works.

Fuller versions: [THREAT_MODEL.md](THREAT_MODEL.md) for what each attacker can and cannot do,
`briefing/FAILURE_MODES.md` for what we expected to break, `briefing/REALITY_SPIKES.md` for what
actually did.

## Tech stack

TypeScript throughout, strict, no `any`, zod `.strict()` at every boundary, BigInt for base units,
no comments (lint-enforced — names carry the meaning). Node's built-in test runner. Sui via
**Tatum** (gRPC + GraphQL). Memory via **Walrus Memory** (`@mysten-incubation/memwal`, mainnet
relayer). Model: Groq `openai/gpt-oss-120b`, Gemini as fallback — and when neither answers, that is
`UNKNOWN`, which blocks payment rather than allowing it. Postgres (Neon) in production, SQLite
locally, both as an index over Walrus. Telegram via grammY, Discord on the same chat layer. Web app
is hand-written TypeScript, no framework. Deployed on Render.

## Repository map

| Path | What |
|---|---|
| `packages/core` | the engine: provenance, change proofs, look-alike and known-attack checks, spend gate, receipts. Pure, no network |
| `packages/adapters` | Tatum, Walrus Memory, Postgres, SQLite, Groq, Gemini, record signer |
| `apps/agent` | agent process: engine, payment runner, Telegram, Discord, web server |
| `apps/web` | public site, `/demo`, owner app `/app`, signing page `/sign/:nonce`, receipts `/r/:id` |
| `evidence/` | outputs of real runs: measurement, acts, live suites, spikes, screenshots |
| `briefing/` | PRD, decisions, failure modes, reality spikes, plan |
| [`CLAIMS.md`](CLAIMS.md) | every claim, its status, its evidence, and what it does not establish |
| [`JUDGING.md`](JUDGING.md) | the judging pathway |
| [`THREAT_MODEL.md`](THREAT_MODEL.md) | what each attacker can and cannot do |
| [`ROADMAP.md`](ROADMAP.md) | ideas deliberately kept out of the build |
