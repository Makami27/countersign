# CLAIMS

Only PROVEN claims may appear in README, UI, blog, video or the submission. `pnpm check:claims` enforces this for README (`[claim:CLnn]`).

| ID | Claim | Status | Evidence | Establishes | Does not establish |
|---|---|---|---|---|---|
| CL01 | Countersign's change logic never makes an attacker address payable, even when the model proposes exactly what the attacker wants (K1–K8, 1,000 random sequences) | PROVEN | `packages/core/test/adversarial.test.ts` (M1, P1) | logic-level property, in-memory and SQLite stores | behaviour with a real model, real relayer or real chain |
| CL02 | Our Sui personal-message verification matches Mysten's published vectors byte for byte | PROVEN | `feasibility/evidence/f1-signatures.json` | the signing format we rely on | that Tatum's VerifySignature behaves the same (S10) |
| CL03 | Tatum verifies payee signatures for us | NOT PROVEN | spike S10 | — | — |
| CL04 | Payee records live in Walrus Memory on mainnet and are rebuilt completely on start | NOT PROVEN | spikes S2, S12 | — | — |
| CL05 | Payments execute through Tatum | NOT PROVEN | spike S13 | — | — |
| CL06 | Attack block rate with a real model on testnet | NOT PROVEN | PRD "Preregistered measurement" | — | — |
| CL07 | ≥10 memories on mainnet from real use | NOT PROVEN | A02 | — | — |
