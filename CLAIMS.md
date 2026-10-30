# CLAIMS

Only PROVEN claims may appear in README, UI, blog, video or the submission. `pnpm check:claims` enforces this for README (`[claim:CLnn]`).

| ID | Claim | Status | Evidence | Establishes | Does not establish |
|---|---|---|---|---|---|
| CL01 | Countersign's change logic never makes an attacker address payable, even when the model proposes exactly what the attacker wants (K1–K8, 1,000 random sequences) | PROVEN | `packages/core/test/adversarial.test.ts` (M1, P1) | logic-level property, in-memory and SQLite stores | behaviour with a real model, real relayer or real chain |
| CL02 | Our Sui personal-message verification matches Mysten's published vectors byte for byte | PROVEN | `feasibility/evidence/f1-signatures.json` | the signing format we rely on | that Tatum's VerifySignature behaves the same (S10) |
| CL03 | Tatum verifies payee signatures for us | NOT PROVEN | needs `pnpm test:live` through `adapters/tatum/signatures.ts`, and a zkLogin signature (S10z); see CL08 for the gateway itself | — | — |
| CL04 | Payee records live in Walrus Memory on mainnet and are rebuilt completely on start | NOT PROVEN | needs `pnpm test:live` restore on a payee namespace; see CL09 for the relayer itself | — | — |
| CL05 | Payments execute through Tatum | NOT PROVEN | spike S13, Act 1 | — | — |
| CL06 | Attack block rate with a real model on testnet | NOT PROVEN | PRD "Preregistered measurement" | — | — |
| CL07 | ≥10 memories on mainnet from real use | NOT PROVEN | A02 | — | — |
| CL08 | Tatum's Sui gateway verifies an Ed25519 personal-message signature and rejects it for a different address or an altered message (mainnet gRPC `VerifySignature`, 2026-10-30) | PROVEN | `evidence/spikes/spikes-2026-10-30T20-48-55-762Z.json` (S10) | the gateway call and its address binding, for one Ed25519 signature from a spike wallet | zkLogin signatures (Slush), our adapter code path, testnet, behaviour under the 3 req/s limit (run 1 got HTTP 429: `evidence/spikes/spikes-2026-10-30T20-46-45-854Z.json`) |
| CL09 | A Walrus Memory mainnet write returns a blob id in about 20–23 s, and recall returned all 3 records of a 3-record namespace with none dropped (2026-10-30) | PROVEN | `evidence/spikes/spikes-2026-10-30T20-46-45-854Z.json` (S2, S12) | the managed mainnet relayer accepts our delegate key; completeness for a 3-record namespace | completeness for larger namespaces or near the 100-record cap; that these were product records (they are labelled spike data); the dev relayer (401 for our key, REALITY_SPIKES R2) |
