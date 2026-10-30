# PLAN: Countersign, 30 Oct → 10 Nov 2026

Deadline: **Tue 10 Nov, 17:00 UTC = 18:00 WAT.** Internal submit target: **Tue 10 Nov, 14:00 WAT** (4 h buffer).
No feature commits after 17:00 UTC on 10 Nov unless organisers confirm it's allowed (EVENT.md open question 2).

## Workstreams (assign names)
| Stream | Owns | Person |
|---|---|---|
| **A: Core + chain** | `packages/core` (sole owner of `types.ts`), Tatum adapters, payments, reconciliation | TBD |
| **B: Memory + agent** | MemWal adapter, signed records, restore/completeness, Gemini extraction, Telegram bot | TBD |
| **C: Web + proof + story** | owner app, proof page, attack lab, receipts UI, blog, video, posts | TBD |

Solo? Run A → B → C in the day order below; the cut lines matter more.

## Day by day
| Day | Date | Goal (definition of done) | Stream | Demo act recorded |
|---|---|---|---|---|
| D0 | Fri 30 Oct | Plan + scaffold + core engine in TS with tests green (`pnpm test:core`). **Team runs `spikes/` and sends the evidence file.** | all | — |
| D1 | Sat 31 Oct | Spike results in REALITY_SPIKES.md; decisions updated if S10/S12 failed. Tatum GraphQL + native gRPC adapters with UNKNOWN handling; MemWal adapter (signed envelope, idempotency key, completeness check) | A, B | — |
| D2 | Sun 1 Nov | SQLite index store (`node:sqlite`) implementing `IndexStore`; restore-from-Walrus on boot; C12 passes against the **real** relayer (testnet namespace) | B | — |
| D3 | Mon 2 Nov | USDC payment via Tatum `TransactionExecutionService`; intent row → digest → settle; UNKNOWN reconciliation; caps | A | **Act 1** (pay rent, receipt) |
| D4 | Tue 3 Nov | Telegram bot + Gemini strict extraction (verbatim check) → engine; refusal receipts with blob IDs | B | **Act 2 + 3** (scam refused; repeat refused as known pattern) |
| D5 | Wed 4 Nov | Change flow end to end: continuity signature (wallet signs in owner app) + control proof (signature or round trip) + owner path with cooldown | A, C | **Act 4** (real change verified, next payment goes to the new address) |
| D6 | Thu 5 Nov | Owner web app (payees, pending changes, confirmations with fresh code) + public proof page (receipts → Walrus blobs → Suiscan) | C | — |
| D7 | Fri 6 Nov | Attack corpus K1–K9 live on testnet: naive baseline vs Countersign, real Gemini, throttled to the relayer budget; results file + table. Attack lab page live | B, C | **Act 5** (proof page with measured table) |
| D8 | Sat 7 Nov | **Real use:** real payees, small real payments; ≥10 mainnet memories from real use (A02). THREAT_MODEL.md, CLAIMS.md, DECISIONS current | all | — |
| D9 | Sun 8 Nov | README (status first), blog draft with real numbers, demo rehearsal; P1 extras only if green | C | — |
| D10 | Mon 9 Nov | Record video (≤3:00); publish blog; X + LinkedIn posts tagging @Tatum_io @WalrusFoundation; **pre-submit audit from a clean clone** | all | full video |
| D11 | Tue 10 Nov | Buffer + fixes only. Fill the form (Tatum ID, SUI address, account ID, MEMWAL_AGENT_ID, video, repo, blog). **Submit by 14:00 WAT.** | all | — |

## Cut lines (decide at the end of the named day)
- **End of D3:** if payments via Tatum aren't working → pay via the Sui SDK on the public fullnode, keep all *reads* and signature checks on Tatum, and disclose it. (It hurts "Tatum Sui RPC integration"; avoid if possible.)
- **End of D5:** if the change flow isn't done → drop the round-trip path; keep continuity signature + owner path.
- **End of D6:** cut the attack lab to a recorded walkthrough; keep the measured table.
- **End of D8:** cut every P1 (Move receipt event, MCP server, owner-app polish).
- **Never cut:** refusing STATED addresses, signed records, completeness check, UNKNOWN blocks payment, receipts, ≥10 real mainnet memories, honest labels.

## Daily ritual (15 min, end of day)
1. `pnpm gate` green from a clean clone.
2. Update CLAIMS.md (PROVEN / NOT PROVEN) and the README status table.
3. Commit with a behavioural message (what's true now, how it was verified, test count).
4. If a demo act works, record it **today**.

## Risks to watch daily
| Risk | Trigger | Response |
|---|---|---|
| S10 fails (Tatum can't verify PersonalMessage) | spike | verify with `@mysten/sui/verify` against Tatum GraphQL for zkLogin; disclose |
| S12 fails (recall incomplete) | spike | rebuild via `restore()` + per-record recall by idempotency token; new D-entry |
| Relayer rate limits | 429 during measurement | smaller live sample, mock for logic, state the denominator |
| Tatum credits (100k free) | dashboard | cache reads; poll at most every 10 s; one-off reads at startup |
| Mainnet USDC for demo | D3 | keep amounts tiny (≤ $0.10 per payment); caps in code |
