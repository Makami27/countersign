# Judging Countersign

A pathway through the project, shortest first. Everything here is live or in this repo; nothing
asks you to take our word for it.

- **Live:** https://countersign.nittings.xyz
- **No sign-in needed:** https://countersign.nittings.xyz/demo
- **Video (2:19):** https://youtu.be/M_8pBAx5o-A
- **Write-up:** https://medium.com/@makamikamsi/the-ai-agent-you-cant-talk-out-of-your-money-a360069d9975

Money is **Sui testnet, test USDC**. Memory is the **Walrus Memory mainnet relayer**. Both labels
appear on every screen that shows either.

---

## 60 seconds — try to scam it yourself

Open **https://countersign.nittings.xyz/demo**. No wallet, no sign-in. The sandbox agent has two
payees whose own wallets proved their addresses, and every message you send runs through the real
Countersign engine and the real model on the deployed instance.

1. Pick **"My wallet changed"** — an address that copies the first and last characters of the real
   one — and send it. It is refused, with the differing character groups marked and a VOID stamp.
2. Send it again. It is refused on sight.
3. Paste your own message in the box and try to get it to pay an address you chose.

If you get it to pay a new address, you have broken the central claim. That is the test we want you
to run.

---

## 5 minutes — the three things that make it work

### 1. The model's output type cannot say "verified"

`packages/core/src/types.ts` lines 13–16, the whole surface the model gets to fill in:

```ts
export type Proposal =
  | { readonly kind: "pay"; readonly payeeId: string; readonly amountBaseUnits: string; readonly reasonQuote: string }
  | { readonly kind: "change_address"; readonly payeeId: string; readonly newAddress: string; readonly reasonQuote: string }
  | { readonly kind: "none" };
```

No status field. No cap field. No "which address to use" field. A model that is fully owned by the
attacker can say *"the landlord's address changed to 0x…"* and that is all it can say. Whether that
address becomes payable is decided by code, from signatures, in `packages/core/src/engine.ts` and
`packages/core/src/changeProofs.ts`.

Only a payee version with status `VERIFIED`, signed by the agent key, is payable
(`packages/core/src/payeeBook.ts`). Nothing in an inbound message can create one.

### 2. Three real receipts, on the live site, backed by Walrus blobs

| Receipt | What it shows | Walrus blob (mainnet aggregator) |
|---|---|---|
| [`rcpt_2c31ae5f…`](https://countersign.nittings.xyz/r/rcpt_2c31ae5f14f5cbe5a50da5690bc9993f) | A look-alike address refused, with the grouped comparison and the VOID stamp | [`Vv6WzuQc…`](https://aggregator.walrus-mainnet.walrus.space/v1/blobs/Vv6WzuQcSXz5XJSRriIb3dLtnRalgAwv6VIkzTFNDLw) |
| [`rcpt_dab6cd85…`](https://countersign.nittings.xyz/r/rcpt_dab6cd850380599887fb5bb1b25577ff) | The same message again, refused as a known attack, **citing the first receipt** | [`ZXlWmbWG…`](https://aggregator.walrus-mainnet.walrus.space/v1/blobs/ZXlWmbWG2Pr1LpPyAUG5o0OwZkhzuM6ozs7kdvduO4A) |
| [`rcpt_2b838f7e…`](https://countersign.nittings.xyz/r/rcpt_2b838f7ed1d4fe337c2ecd079870fddb) | 0.01 test USDC paid, after a two-wallet address change, with the [Sui testnet transaction](https://suiscan.xyz/testnet/tx/DghoXibMbMuCAnNH4Wt2i2GpMistfkYPDf5oF3PyZqyZ) | [`2ZwTJ4u1…`](https://aggregator.walrus-mainnet.walrus.space/v1/blobs/2ZwTJ4u14emxiYEUgEig-QmHIFpQz5ycaYspCFqDeZk) |

The blob links answer **HTTP 200** from the Walrus mainnet aggregator and return **encrypted
bytes** — record contents are encrypted at rest, so the raw blob is ciphertext by design. The
decrypted record is what `/r/<id>` renders, and the receipt page links both.

### 3. The numbers, and the plan that was written before the run

Open **https://countersign.nittings.xyz/proof**.

| | Scam messages | Paid to an attacker address |
|---|---|---|
| Countersign | 90 | **0** |
| The same agent, memory read without the status checks | 90 | **71** |

50 of 50 benign payment requests paid correctly, **0 false refusals**. 9 attack types × 10 trials,
Sui testnet, model `openai/gpt-oss-120b` via Groq, run 2026-11-01, 643 relayer calls all confirmed,
0 model errors, 0 trial errors. Raw per-trial log:
`evidence/measurement/raw-2026-11-01T15-11-00-564Z.jsonl`.

**Read this before you quote the numbers.** In the measurement, "paid" means *the agent decided and
reserved the payment*. Nothing was sent on chain during the measurement. The baseline was rarely
fooled by two of the nine attack types (K5 forwarded invoice: 0 of 10; K6 urgency: 1 of 10) because
the model did not read those as address changes at all — so the 71 is concentrated in the seven
types where the model *did* propose the attacker's address. Per-attack breakdown is in
`evidence/measurement/results.json`.

---

## 15 minutes — claim to evidence

Every claim in this repo's copy carries a `[claim:CLnn]` tag, and `pnpm check:claims` fails the
build if any tag points at a claim that is not `PROVEN` in `CLAIMS.md`. The ledger also records, for
each claim, what it **does not** establish.

| Want to check | Open |
|---|---|
| The claim ledger itself, with the "does not establish" column | [`CLAIMS.md`](CLAIMS.md) |
| The preregistered measurement: results, per-attack, raw trials, corpus | [`evidence/measurement/`](evidence/measurement/) |
| The adversarial property test (1,000 random sequences, K1–K8) | [`packages/core/test/adversarial.test.ts`](packages/core/test/adversarial.test.ts) |
| A real payee onboarding: STATED → VERIFIED only after the wallet signed | [`evidence/acts/onboarding-rent/records.json`](evidence/acts/onboarding-rent/records.json) |
| The look-alike refusal and the repeat refusal, end to end on the deployed agent | [`evidence/acts/act2/`](evidence/acts/act2/), [`evidence/acts/act3/`](evidence/acts/act3/) |
| A two-wallet address change, then the next payment going to the new wallet | [`evidence/acts/act4/`](evidence/acts/act4/) |
| Tatum verifying a real Slush **zkLogin** signature, and rejecting it when altered | [`evidence/spikes/s10z-2026-10-30T21-01-30-353Z.json`](evidence/spikes/) |
| Walrus Memory recall returning all 100 records at the cap, nothing dropped | [`evidence/live/s12-scale-2026-10-31T05-57-57-893Z.json`](evidence/live/) |
| What each attacker can and cannot do | [`THREAT_MODEL.md`](THREAT_MODEL.md) |
| Why each design call was made, and what was rejected | [`briefing/DECISIONS.md`](briefing/DECISIONS.md) |
| What we expected to go wrong, and what did | [`briefing/FAILURE_MODES.md`](briefing/FAILURE_MODES.md), [`briefing/REALITY_SPIKES.md`](briefing/REALITY_SPIKES.md) |
| The requirements the code was written against | [`briefing/PRD.md`](briefing/PRD.md) |
| Ideas deliberately kept out of the build | [`ROADMAP.md`](ROADMAP.md) |

### Run it yourself

```bash
pnpm install
pnpm gate          # typecheck, no-comments, secret scan, unit tests, claim check
```

`pnpm gate` needs no keys and no network. The live suites do:

| Command | Needs | What it writes |
|---|---|---|
| `pnpm test:live` | Tatum + Walrus Memory keys in `.env` | `evidence/live/` — adapter round-trips against the real relayer and gateway |
| `pnpm spikes` | the same | `evidence/spikes/` — raw gateway and relayer behaviour, including the failures |
| `pnpm testnet:pay` | a funded testnet wallet | `evidence/live/testnet-payment-*.json` — spends real testnet gas |

---

## What this does **not** do

We would rather you hear it from us.

- **A stolen payee wallet defeats it.** If a scammer controls the landlord's real wallet, their
  signature is valid and the change goes through. Countersign checks *who signed*, not *who is
  holding the phone*.
- **A compromised owner device or owner wallet defeats it.**
- **You can still be talked into approving a change** on the lost-wallet path. The 24-hour wait and
  the Cancel button are a safety net, not a guarantee.
- **The measurement covers K1–K9 only.** An attack we did not think of is not in the 90.
- **Payments are testnet.** No mainnet money has ever moved through this agent.
- **Shared scam memory works only between agents writing to the same Walrus Memory account.**
  Namespaces are per account, so agents on different accounts do not see each other's reports.
- **Hosting is Render's free plan.** The instance can be stopped and takes 30–60 s to wake. No
  payment state is lost: the ledger is in Postgres and the payee book is rebuilt from Walrus Memory
  on every start, followed by one reconciliation pass. `/status` shows the last restore.

`CLAIMS.md` carries the same honesty per claim: `CL04` (engine restore of real payee namespaces) and
`CL06` (block rate superseded by the preregistered `CL16`) are still marked **NOT PROVEN**, and so
they appear nowhere in our copy.

---

## Where each sponsor's technology sits

**Tatum** is the only way this project touches Sui. Every payee signature check — including Google
sign-in (zkLogin) wallets, which need the GraphQL endpoint — every USDC transfer, and every
payment lookup goes through Tatum's Sui gateway (gRPC + GraphQL, shared 2 req/s gate).
`packages/adapters/src/tatum/`. Without it there is no verification step, and verification *is* the
product.

**Walrus Memory** is the agent's source of truth, not a log. Every payee address, how that address
is known, every receipt, schedule and owner wallet is an agent-signed record on the mainnet relayer.
The agent rebuilds its payee book from it on every start, and if memory cannot be read **completely**,
nothing is paid — an incomplete read is treated as unknown, never as "no objection".
`packages/adapters/src/memwal/`. That completeness rule is why the second scam is refused on sight:
the first refusal is in memory, and memory is what the checks read.
