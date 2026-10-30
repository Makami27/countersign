# DECISIONS

## D1: Build Countersign
Context: 11+ candidates checked (IDEA_CHECK*.md, STAKEHOLDERS.md).
Decision: Countersign, Track 2 Smart Agents for Real Life; also aims at Best Walrus Memory.
Rejected: Forward, because the forward window before 10 Nov is too short for honest results; Closebook, because Sui transfers have no memo, so matching is ambiguous; storage expiry watchdog, because Walrus Console now auto-renews.
Consequence: all briefing work now targets Countersign.
Where: briefing/IDEA_CHECK_FINAL.md
Date: 2026-10-30 (team decision)

## D2: Walrus Memory is the source of truth; the local DB is a rebuildable index
Context: we need transactions and UNIQUE constraints (nonces, digests), but the event's deletion test needs Walrus Memory to be essential.
Decision: every payee version, change request, verdict and receipt is written to Walrus Memory as an **agent-signed** record. SQLite holds an index rebuilt from Walrus Memory (`listMemories` + recall) on start.
Rejected: DB as source of truth (memory becomes decorative); memory only, no DB (no atomic nonce or digest uniqueness).
Consequence: a "wipe the DB, restore from Walrus, same state" test is part of the gate.

## D3: Memory records are signed by the agent's own key
Context: poisoning can arrive as text shaped like a record (K8), or through any writer with relayer access.
Decision: each record carries an ed25519 signature by the Countersign agent key over its canonical JSON. Unsigned or badly signed recalls are dropped and counted.
Consequence: "the memory said so" is never enough; "*we* wrote it and signed it" is.

## D4: Proof of control is never proof of identity
Context: an attacker can sign for, or round-trip from, their own address.
Decision: a change needs **continuity** (signature from the current verified address) **or** owner confirmation out of band plus a cooldown, **plus** proof of control of the new address.
Where: PRD §6.

## D5: Defaults pending team confirmation
TypeScript/Node 24, MemWal SDK (TS), `@mysten/sui` v2, Gemini for extraction, Telegram channel, SQLite, Vercel or Railway for hosting. Change by adding a D-entry.

## D6: One Walrus Memory namespace per payee + a completeness check
Context: feasibility F3. `listMemories` is metadata only; `recall` is top-K (≤100) similarity search, so there's no "fetch all".
Decision: namespace `countersign:<owner>:payee:<id>`; rebuild via `recall({ topK: 100 })` with no `maxDistance`; require recalled count == listed count and `dropped_count == 0`, else `MEMORY_INCOMPLETE` (blocks payment). Cap at 100 records per payee; past that, roll over to a new namespace with a signed pointer.
Rejected: one big namespace (incompleteness undetectable); trusting the local DB (breaks D2).
Consequence: spike S12 is load-bearing.

## D7: Tatum gRPC through native transport
Decision: `@protobuf-ts/grpc-transport` + `@grpc/grpc-js` for `SuiGrpcClient`; GraphQL over fetch for address history.
Pins (from working entrants, to confirm on install): `@mysten/sui` 2.37.0, `@mysten-incubation/memwal` 0.1.12, `@protobuf-ts/grpc-transport` 2.11.1, `@grpc/grpc-js` 1.13.6, `@mysten/seal` 1.4.19, `@mysten/walrus` 1.2.34.

## D8: Toolchain is Node 26.13.0 + pnpm 10.34.9, one lockfile
Context: the owner's machine runs Node v26.13.0; CI pinned 22.23.4 and `engines` said `>=22.23.4`, so CI and local runs used different runtimes. An earlier `npm i` left `package-lock.json` files, and `spikes/` was a separate npm package with its own lockfile. Node 26 ships without corepack.
Decision: run and test on Node 26.13.0 everywhere (`engines: >=26.13.0`, CI `node-version: 26.13.0`, deploy image to match). pnpm 10.34.9 is installed with `npm i -g pnpm@10.34.9` (it exists on the registry; the `packageManager` pin is unchanged). `spikes/` joins the pnpm workspace as `@countersign/spikes`; `pnpm-lock.yaml` is the only lockfile and npm/yarn lockfiles are gitignored. `@types/node` moves to 26.6.5 to match the runtime.
Verified on 2026-10-30 with Node v26.13.0: `node:sqlite` opens a database (SQLite 3.54.0); native `.ts` imports work (`process.features.typescript` = `strip`); `@grpc/grpc-js` 1.13.6, `@protobuf-ts/grpc-transport` 2.11.1, `@mysten-incubation/memwal` 0.1.12 and `@mysten/sui` 2.37.0 (`/grpc`, `/verify`) all import. Live calls are verified by the spikes and `pnpm test:live`, not by this entry.
Rejected: staying on Node 22 in CI (tests would not cover the runtime we ship); corepack (removed from Node 26); keeping npm for `spikes/` (two lockfiles, two dependency trees).
Consequence: the hosting choice in Phase 5 must offer Node 26.13.0 or a Docker image of it.
Where: `package.json`, `.github/workflows/gate.yml`, `pnpm-workspace.yaml`, `.gitignore`, `spikes/package.json`

## D9: Two Walrus Memory environments, labelled everywhere
Context: R2 showed our delegate key works on the mainnet relayer only. The owner wants tests and the measurement off mainnet, and real use on mainnet, with the environment labelled wherever a record or number appears.
Decision: `MEMWAL_DEV_PRIVATE_KEY` / `MEMWAL_DEV_ACCOUNT_ID` (owner to add) with `relayer.dev.memwal.ai` for live tests and the measurement; `MEMWAL_PRIVATE_KEY` / `MEMWAL_ACCOUNT_ID` with `relayer.memory.walrus.xyz` for real use only. Until the dev keys exist, live memory tests run on the mainnet relayer in namespaces starting `countersign-test:`, throttled to the relayer budget, and every real-use memory count (A02, `/proof`) counts only `countersign:<OWNER_ID>:` namespaces. Each evidence file, receipt and screen names the relayer it used.
Rejected: tests on mainnet for good (pollutes the real-use record and burns the hourly budget); mock-only memory tests (S2/S12 showed the real relayer behaves differently from docs in latency).
Consequence: the S12 completeness check at ~100 records runs on the dev account once it exists.
Where: `packages/adapters/src/memwal/*`, `.env.example`, live test suite

## D10: Extraction model and who converts amounts
Context: G1–G3 in REALITY_SPIKES. The model put a decimal into a base-units field; a pinned model name was answered by a newer version; newer Flash models returned 503 on the free tier.
Decision: `GEMINI_MODEL=gemini-3.5-flash`. The model returns `amountText` exactly as written; `usdcToBaseUnits` in code converts it (6 decimals, strict pattern, > 0) and the number must stand alone in the message, so "10" can't become "1". Model output is parsed with a zod `.strict()` schema: an unexpected field (e.g. `status`) refuses the whole output as no proposal, where before it was dropped silently. An outage, 429, 503 or empty answer is `UNKNOWN`: nothing changes and the owner is told to resend. Every READ result carries the `modelVersion` that answered.
Rejected: asking the model for base units (G1); dropping unknown fields (a model that tries to set a status should not have its other fields trusted); the `-latest` aliases (not reproducible).
Where: `packages/adapters/src/gemini/{proposal,extract}.ts`, tests X01–X06

## D11: Payment intents are digest-first, kept in SQLite, and settle by digest only
Context: V07 and FAILURE_MODES ("persist intent before effects", "UNKNOWN has no resubmit edge"). The SDK can build and sign a transaction locally, which fixes its digest before anything is sent, and address-balance gas gives every transaction a validity window that ends at the next epoch (P1).
Decision: the engine reserves the day's budget and inserts a RESERVED intent in one transaction (`PaymentLedger.reservePayment`). The runner builds and signs locally, stores the digest and last valid epoch while moving to SENDING (a CHECK forbids SENDING without a digest; digests are UNIQUE), then submits once. A thrown submit is UNKNOWN. SENT and UNKNOWN are reconciled only by looking the digest up through Tatum: found with the exact USDC credit → SETTLED; found and failed → FAILED; not found → FAILED only after the validity window has passed and never from SENT. A payment found still SENDING at startup is moved to UNKNOWN first. FAILED gives the reservation back. A SQLite trigger generated from `PAYMENT_TRANSITIONS` rejects any other state move, even from raw SQL. Malformed or zero amounts are `AMOUNT_INVALID` (new reason code); a payee with records but no verified version is `PAYEE_NOT_VERIFIED`, one with no records `UNKNOWN_PAYEE`.
Intents live in SQLite only (on the persistent volume), not in Walrus Memory: a 20 s memory write before every send would double payment latency, and the intent row is an operational ledger like nonces (D2). The final outcome is written to Walrus Memory as an agent-signed receipt (pending the types.ts change).
Rejected: resubmitting on timeout (double payment); writing intents to memory before sending (latency, and a timed-out memory write would block the payment for no safety gain); a SENDING → SETTLED edge (the PRD machine stays as written; interrupted sends go through UNKNOWN).
Where: `packages/core/src/payments.ts`, `packages/adapters/src/sqlite/paymentLedger.ts`, `packages/adapters/src/tatum/payments.ts`, `packages/adapters/src/payments/runner.ts`

## D12: One receipt type for every final outcome
Context: V14 needs a receipt page for every outcome; the owner approved one general receipt (2026-10-30).
Decision: `ReceiptRecord` replaces `RefusalRecord`. Verdicts PAID, PAYMENT_FAILED, REFUSED, CHANGE_VERIFIED, CHANGE_REJECTED; a closed `reason` code (no free text); ordered `checks` from `CHECK_CODES` (OWNER_CONFIRMED and COOLDOWN_ELAPSED cover the owner path); `memoryBlobIds` naming the payee version a payment used or a change created; `suiDigest`; `network`. Receipts are written only for final outcomes; UNKNOWN payments stay in the ledger until reconciled. They live in `countersign:<owner>:receipts` (replacing `:refusals`). Known-attack matching reads REFUSED/CHANGE_REJECTED receipts whose reason is not retryable. Old `refusal` records are skipped on restore and counted as `legacy`, not as forgeries. V13: an expired request is EXPIRED, a reused one NONCE_REUSED, and a signature from the wrong wallet WRONG_WALLET (the verifier asks Tatum again without the address; if the signature is valid for someone else it is WRONG_SIGNER). Memory reads now return blob ids (`StoredText`). A payment receipt id is derived from the payment id so a retried write is identical.
Where: `packages/core/src/{types,vocabulary,receipts,engine,memoryBook}.ts`, `adapters/src/sqlite/indexStore.ts`, tests in `packages/core/test/receipts.test.ts`

## D13: Payee signatures are verified once, at the time of the change
Context: S10z. A zkLogin signature stops verifying after its maxEpoch (the owner's was 1298), so re-checking it later would turn a valid history into INVALID.
Decision: the change is verified through Tatum when it happens. The agent-signed VERIFIED record stores, per signature, its role, signer, scheme (ED25519 / ZKLOGIN), maxEpoch and the epoch it was checked at. Restore trusts the agent's signature on that record and never re-verifies payee signatures; payment never consults the verifier. Any public "verify it yourself" view must say that zkLogin signatures stop verifying after maxEpoch and show the epoch it was checked at, instead of showing a later re-check as INVALID.
Test: "D13 a zkLogin-verified payee stays payable after the signature's maxEpoch, including after a restore" in `packages/core/test/receipts.test.ts`.
