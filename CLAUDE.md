# CLAUDE.md: Countersign

Read `briefing/PRD.md` for the section you're working on before writing code. Do not derive requirements from memory.

## What this is
An AI agent that pays recurring payees in USDC on Sui and cannot be talked into paying a new address. AI proposes; code decides.

## Invariants the code cannot show
- Only a payee version with status `VERIFIED`, signed by the agent key, can be paid. Nothing in an inbound message can create a `VERIFIED` version.
- The model's output type has **no** status, cap or address-selection field. An address from the model is used only if it appears verbatim in the source message.
- Proof of control of an address never authorises a change on its own (D4).
- `UNKNOWN` (Tatum, Walrus Memory, model) blocks payment. `UNKNOWN` payments have no resubmit edge.
- Walrus Memory is the source of truth; SQLite is an index rebuilt from it (D2).
- Only one person edits `packages/core/src/types.ts` (owner: TBD).

## Framework notes (check installed versions; these may be newer than your training data)
- `@mysten/sui` v2: `verifyPersonalMessageSignature(msg, sig, { address, client })` from `@mysten/sui/verify`; zkLogin needs a GraphQL client (point it at Tatum's `/graphql`).
- Tatum Sui: GraphQL at `https://sui-mainnet.gateway.tatum.io/graphql`, gRPC at `https://sui-mainnet-grpc.gateway.tatum.io`, header `x-api-key`. JSON-RPC may 404. No Tatum Notifications for Sui: poll.
- MemWal SDK `@mysten-incubation/memwal`: use `recall({ query, topK, namespace })` (object form). Writes are async jobs; a timeout is UNKNOWN, not failure. Server-side only (no CORS).
- USDC mainnet coin type: `0xdba3…900e7::usdc::USDC`, 6 decimals. Compare full types.

## Honesty rules
Copy of BUILD_CONTRACT.md "Never fabricate" and "No silent fallback". Label testnet and demo data everywhere.

## Conventions
- No comments (lint-enforced). Names carry meaning; split files past ~180 lines.
- Strict TS, no `any`, zod `.strict()` at every boundary, BigInt for base units.
- Closed error codes with `{message, retryable, nextAction}`.
- Tests named as behaviour, with acceptance IDs (`A0x`, `C0x`) in titles.
- Never pipe test output through `tail` in a way that hides failures. Run `pnpm gate` from a clean clone before claiming done.
- Commit as you go with behavioural messages; no history rewriting. No feature commits after 2026-11-10 17:00 UTC unless the organisers confirm it's allowed.
- New ideas go to `ROADMAP.md`, not into the build.
