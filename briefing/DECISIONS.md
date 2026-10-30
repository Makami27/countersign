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
