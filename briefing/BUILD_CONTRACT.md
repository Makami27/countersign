# BUILD_CONTRACT

## Frozen decisions
D1–D4 in DECISIONS.md. Changes require a new D-entry.

## Never fabricate
- No placeholder data shown as real. Show `—` until a real value exists.
- No fallback that returns fake success (no hard-coded verdict on an API error).
- No test counts, block rates or memory counts reported before they are produced.
- Demo, testnet and attack-lab data labelled as such in the UI, the blog and the video.

## No silent fallback
- No `|| default` on values that matter; config validated at startup (zod).
- No empty `catch`. Every caught error is handled, typed or rethrown.
- Any `UNKNOWN` from Tatum, Walrus Memory or the model blocks payment.

## Traceable numbers
Every reported number records: denominator, run IDs, commit, network (mainnet/testnet), and classification (real / simulated / provisional).

## Failures stay on record
Failed runs, false refusals and attacks that got through are kept. Claims that don't replicate are demoted, not deleted.

## Protected critical path
`packages/core/{changeMachine,spendGate,lookalike,proposal,records}.ts`, `adapters/tatum/{verifySignature,execute}.ts`, `adapters/memwal/*`. No change may merge without the gate passing.

## Code bar
See the code-bar reference in the skill. Planning quality does not excuse code quality.

## Gate
`pnpm gate` from a clean clone: install (frozen lockfile), typecheck, lint (no comments, no `any`), unit + property + adversarial tests, claims-ledger check, secret scan.

## Proof priority
1. A real mainnet payment and a real refused attack, each with a receipt linking memory blobs + a Sui digest.
2. Preregistered block-rate measurement.
3. ≥10 mainnet memories from real use.
4. Live attack lab.
