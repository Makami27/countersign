# FEASIBILITY: Countersign

Run: 2026-10-30. Workspace: offline for sponsor hosts (Tatum, Walrus relayer and Sui endpoints refused by the workspace's network policy with 403; npm unreachable). GitHub reachable.

## Results

| # | Test | Result | Evidence |
|---|---|---|---|
| F1 | Sui personal-message signing rebuilt from scratch (intent `[3,0,0]` + ULEB length + message → BLAKE2b-256 → Ed25519; `flag‖sig‖pubkey`) matches Mysten's published vectors **byte for byte**, and three Rust-keytool private keys derive the right addresses | **14/14 PASS** | `feasibility/evidence/f1-signatures.json`, `feasibility/f1_sui_signatures.py` |
| F1 | Binding: signature can't move to another payee, another new address, a later expiry; raw signature without intent rejected; non-Ed25519 → UNSUPPORTED, never VALID | PASS | same |
| F1 | **Design check:** an attacker can always prove control of *their own* address. So control alone must never authorise a change (D4 confirmed) | PASS | C06b |
| F2 | Core engine prototype (change machine, look-alike, verbatim check, signed records, restore, spend gate on SQLite): 15 behaviour tests | **15/15 PASS** | `feasibility/f2/core.test.mjs` |
| F2 | Property test: 2,000 random attacks with a **fully compromised model** never make an attacker address payable | PASS | P1 |
| F2 | Logic-level measurement K1–K8, 25 trials each: naive memory agent paid the attacker **200/200**; Countersign **0/200** | PASS | `feasibility/evidence/f2-measurement.json` |
| F2 | Caps hold under 10 concurrent attempts (one conditional UPDATE) | PASS (3 of 10 reserved, as the cap allows) | C09 |
| F2 | Wipe index → rebuild from memory → identical state; forged, unsigned and raw-JSON records ignored | PASS | C10, C12 |
| F3 | Largest memory record (full continuity evidence) ≈ **1.1 KB**; relayer bulk limit 64 KiB per item | fits | measured |
| F3 | Relayer budget: remember = 5 points; 30 points/min per delegate key (≈6 writes/min); 500 points/hour per account (≈100 writes/hour); 1 GB quota | fits demo; **live measurement must be throttled** | MemWal `docs/relayer/overview.md` |
| F3 | Write latency ≈ 24 s on mainnet (measured by an entrant on 2026-09-21; to re-measure in S2) | acceptable if a change only becomes payable after its record is confirmed | Remora `packages/memory/src/policy.ts` |

## What F2's 200/200 baseline does and doesn't mean
The naive agent was *given* the attacker's proposal (model assumed fully
fooled), so 200/200 is by construction, not a finding. The finding is the
other column: **even with a fully fooled model, Countersign's logic paid the
attacker 0 times.** The real measurement (PRD "Preregistered measurement")
still needs a real model, a real relayer and testnet payments.

## Design changes found by feasibility
1. **Rebuild-from-memory needs a completeness check (D6).** `listMemories` returns metadata only, and `recall` is top-K similarity search (max 100), so "fetch everything" doesn't exist. Fix: one namespace per payee (`countersign:<owner>:payee:<id>`), recall with `topK: 100` and no `maxDistance`, and require `recalled == listed` (and `dropped_count == 0`); otherwise `MEMORY_INCOMPLETE` blocks payment. **Needs spike S12.**
2. **Tatum gRPC is native gRPC, not gRPC-Web.** The SDK's default transport fails with "unexpected response content type: application/grpc". Use `@protobuf-ts/grpc-transport` + `@grpc/grpc-js` with `host: sui-mainnet-grpc.gateway.tatum.io:443` and `meta: {"x-api-key": …}` (found in AFTERMATH's adapter; to confirm in S5).
3. **Throttle the live measurement.** 200 trials × ~2 writes exceeds the hourly relayer budget. Run the logic on the mock, and run a smaller live sample (e.g. 8 attacks × 5 trials) on the real relayer, with the denominator stated.

## Still unproven (needs keys) → `spikes/`
S1 Tatum GraphQL · S5 Tatum native gRPC · S6 address history + retention · **S10 Tatum VerifySignature on PersonalMessage** · S2 mainnet write latency · **S12 recall completeness** · S13/S11 payment through Tatum + detection latency.

## Verdict
**Feasible.** The cryptography matches Sui exactly, the core security property
holds under a fully compromised model, and budgets fit. The two load-bearing
unknowns are S10 and S12. If S10 fails, verify with the Sui SDK locally and
say so (Tatum is then used only for history and payments). If S12 fails,
switch the index rebuild to Walrus blob reads through `restore` and record it
as a decision.
