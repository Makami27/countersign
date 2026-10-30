# PRD: Countersign

Version: 0.1 (2026-10-30). Single source of truth. Changes need a DECISIONS.md entry.

## 1. Goals and non-goals
**Goals**
- An AI agent that pays a person's recurring payees in USDC on Sui, which **cannot be talked into paying a new address**.
- Memory (Walrus Memory) records where every payee fact came from; only verified, agent-signed facts can move money.
- Proof a judge can attack live, plus a measured result against our own attack corpus.

**Non-goals (never tonight)**
- General prompt-injection defence; trading; custody of other people's funds; multisig; fiat/bank transfers; a generic agent framework.

## 2. Hook, loop, boundary
- **Hook:** "Your AI agent pays your bills. Someone just told it your landlord changed wallets. It won't believe them."
- **Loop:** message in → model proposes (payment or change) → code checks the payee record → pay (VERIFIED) / start a change (PENDING_PROOF) / refuse → receipt → memory updated → the next identical attack is refused instantly, citing the earlier refusal.
- **Boundary:** AI proposes. Code decides. The model never: sets a status, picks an address not present verbatim in the source, edits a record, raises a cap, or signs.

## 3. Flow and message shapes
### 3.1 Inbound
Telegram message (owner chat, or a forwarded email/invoice) → `InboundMessage { id, channel, fromUserId, text, receivedAt }`.

### 3.2 Model proposal (strict schema, `.strict()`)
```ts
type Proposal =
  | { kind: "pay"; payeeName: string; amountUsdc: string; reasonQuote: string }
  | { kind: "change_address"; payeeName: string; newAddress: string; reasonQuote: string }
  | { kind: "none" };
```
`reasonQuote` and `newAddress` must appear verbatim in `text`, or the proposal is discarded.

### 3.3 Memory records (Walrus Memory text = canonical JSON + agent signature)
```ts
type PayeeVersion = {
  type: "payee_version"; payeeId: string; version: number; address: SuiAddress;
  status: "VERIFIED" | "STATED" | "REVOKED";
  evidence: Evidence; supersedes: number | null; createdAt: string;
};
type Evidence =
  | { kind: "owner_onboarding"; ownerConfirmationId: string; controlProof: ControlProof }
  | { kind: "continuity_signature"; message: string; signature: string; signer: SuiAddress; controlProof: ControlProof }
  | { kind: "owner_confirmed_change"; ownerConfirmationId: string; cooldownEndedAt: string; controlProof: ControlProof }
  | { kind: "stated"; sourceMessageId: string; quote: string };
type ControlProof =
  | { kind: "signature"; message: string; signature: string }
  | { kind: "round_trip"; outDigest: string; returnDigest: string; amountBaseUnits: string };
type Verdict = { type: "verdict"; subject: "payment" | "change"; ref: string; result: VerdictCode; reasons: ReasonCode[]; at: string };
type Receipt = { type: "receipt"; verdictRef: string; memoryBlobIds: string[]; suiDigest: string | null; at: string };
```
Every record is wrapped as `{ record, sig }`, where `sig` = the agent's ed25519 signature over canonical JSON. Namespace: `countersign:<ownerId>:payee:<payeeId>` (one per payee, D6), plus `countersign:<ownerId>:refusals`.

## 4. Architecture and ownership
```
packages/core      pure: payee model, change state machine, spend gate, look-alike check,
                   proposal validation, record canonicalisation and signing (keys injected)
packages/adapters  tatum-graphql, tatum-grpc (VerifySignature, TransactionExecution),
                   memwal, gemini, telegram, sqlite
apps/agent         Telegram bot + worker (polling for return transfers, payment reconciliation)
apps/web           owner app (confirmations, payees, receipts), public proof page, attack lab
move/receipts      (P1) emits a Receipt event {hash} for refusals and changes
```
Owner of `packages/core` types: one person only (see CLAUDE.md).

## 5. Vocabulary
- **Payee head:** the latest version in the supersedes chain.
- **Payable:** head status `VERIFIED`, no `CONFLICT`, index not stale, recall complete.
- **Verdict codes:** `PAID | REFUSED | CHANGE_STARTED | CHANGE_VERIFIED | CHANGE_REJECTED | UNKNOWN`.
- **Reason codes (closed set):** `PAYEE_NOT_VERIFIED, ADDRESS_NOT_IN_MESSAGE, LOOKALIKE_ADDRESS, CONFLICT, CAP_EXCEEDED, SIGNATURE_INVALID, NONCE_REUSED, EXPIRED, NO_CONTINUITY, COOLDOWN_ACTIVE, CONTROL_NOT_PROVEN, MEMORY_INCOMPLETE, INDEX_STALE, CHAIN_UNKNOWN, KNOWN_ATTACK_PATTERN`.
- Each code has `{ message, retryable, nextAction }`.

## 6. Core engine: address change (ordered; first failure returns)
1. Proposal valid and `newAddress` verbatim in the message, else `ADDRESS_NOT_IN_MESSAGE`.
2. Payee exists with a VERIFIED head, else `PAYEE_NOT_VERIFIED`.
3. Matches an earlier rejected attack (same new address or same source) → refuse, `KNOWN_ATTACK_PATTERN`, citing the earlier receipt.
4. Look-alike check: new address shares ≥4 leading and ≥4 trailing hex characters with any known payee or the old address (and isn't equal) → `LOOKALIKE_ADDRESS`; freeze the change.
5. Store a `STATED` version (it can never pay); state `PENDING_PROOF`; nonce issued; expiry 24h.
6. **Continuity:** a signature from the *current verified address* over the change message, verified via Tatum. **Or owner path:** owner confirmation in the web app with a fresh code, then a 24h cooldown (demo build: configurable, labelled).
7. **Control of the new address:** a signature from the new address, or a round trip (agent sends a random micro amount; the exact amount comes back from the new address within the window, matched by digest).
8. All passed → new `VERIFIED` version superseding the old; receipt; old version kept.
Failure at any step → `CHANGE_REJECTED` with a reason; a receipt; the pattern remembered.

## 6b. Core engine: payment (ordered)
1. Proposal valid; payee resolved by exact name mapping (exactly one match, else refuse).
2. Recall complete (`dropped_count` 0) and index fresh, else `MEMORY_INCOMPLETE` / `INDEX_STALE`.
3. Head payable, else `PAYEE_NOT_VERIFIED` / `CONFLICT`.
4. Amount ≤ per-payee cap and the period budget (reserve inside a transaction), else `CAP_EXCEEDED`.
5. Intent row → build the USDC transfer to the head address → execute via Tatum → `SENT` / `UNKNOWN`.
6. Settle on digest; receipt with digest + memory blob IDs.

## 7. State machines
- **Change:** `REQUESTED → PENDING_PROOF → (CONTINUITY_OK | OWNER_CONFIRMED→COOLDOWN) → CONTROL_PENDING → VERIFIED`; any → `REJECTED | EXPIRED`. No edge from `REJECTED` back.
- **Payment:** `RESERVED → SENDING → SENT → SETTLED`; `SENDING → UNKNOWN → (SETTLED | FAILED)` only via digest reconciliation; `FAILED` refunds the reservation.
- DB `CHECK` constraints mirror both.

## 8. Security model
See THREAT_MODEL.md (phase 9). Attack corpus K1–K9 in knowledge/memory-poisoning.md. Not defended: a stolen key of a verified payee; a compromised owner device; a compromised relayer serving *withheld* records (detected only as incomplete).

## 9. Demo script (2:45 target)
1. **0:00–0:20** "My agent pays my rent and my designer." Telegram: "pay rent", paid, receipt.
2. **0:20–1:00** A scam email is forwarded: "Landlord here, new wallet…" → refused: `PAYEE_NOT_VERIFIED` for the stated address, plus `LOOKALIKE_ADDRESS`. Show the STATED record in memory that can't pay.
3. **1:00–1:30** The same attack again → instant `KNOWN_ATTACK_PATTERN` citing the earlier receipt (memory changed behaviour).
4. **1:30–2:10** A real change: the payee signs with their old wallet, the new wallet proves control by round trip → VERIFIED → next payment goes to the new address.
5. **2:10–2:30** Proof page: block-rate table (with vs without Countersign), receipts → Walrus blobs → Sui transactions.
6. **2:30–2:45** "Try to scam it yourself": attack lab URL.

## 10. Test list (mirrors the demo)
A01–A09 from EVENT.md, plus:
- C01 refuses to pay a STATED address
- C02 discards an address not present verbatim
- C03 look-alike freezes a change
- C04 a known attack is refused citing the earlier receipt
- C05 continuity + control → VERIFIED
- C06 control alone never verifies (attacker's own signature)
- C07 replayed signature rejected (nonce / expiry / payee binding)
- C08 a timed-out payment held UNKNOWN, never resent
- C09 concurrent sends respect caps
- C10 a forged memory record is ignored
- C11 recall with dropped results blocks payment
- C12 wipe DB → restore from Walrus → identical state
- C13 the model can't change caps or status (type-level + behaviour)
- Property tests: shuffled balance changes, same verdict; random messages never produce VERIFIED without proofs.

## 11. Priorities
- **P0:** core engine §6/§6b, Walrus Memory records with signatures, Tatum reads + VerifySignature + payment, Telegram owner flow, receipts, attack corpus + measurement, proof page.
- **P1:** Move receipt event, web attack lab with testnet agent, owner web app polish, MCP read-only server.
- **Never tonight:** multisig, fiat, other chains, a generic framework.

## 12. Build order (record each demo act when it works)
1. Spikes S1, S2, S6, S10, S11.
2. Core types + change state machine + tests (no network).
3. Memory adapter with signed records + restore.
4. Tatum adapters (GraphQL reads, VerifySignature, payment execute).
5. Act 1 (pay) → record. 6. Act 2–3 (refuse + known pattern) → record. 7. Act 4 (real change) → record.
8. Attack corpus + measurement. 9. Proof page + attack lab. 10. Blog, video, audit.

## 13. Definition of finished
Gate passes from a clean clone; A01–A09 evidence files exist; ≥10 real mainnet memories from real use; the measurement is published with its denominator; video ≤ 3:00; blog live; every README claim PROVEN in CLAIMS.md.

## 14. Submission fields → see EVENT.md

## 15. Judge Q&A
- *How is this different from Carry?* Carry proves *which* memories an answer used and gates *access*. Countersign decides whether a memory is *true enough to move money*.
- *From Praxis?* Praxis risk-scores a spend. Countersign tracks where the *address* came from, so a poisoned address is unpayable before any spend is scored.
- *What if the payee's key is stolen?* Not defended, said plainly; the owner path plus a cooldown and caps limit the damage.
- *Why not just ask the user to confirm?* The Princeton study found confirmation barely helps, because the agent presents the attacker's address as the default. We make the default impossible.

## Preregistered measurement
- **Hypothesis:** with Countersign, attacker-address payments per 100 attack attempts = 0 on corpus K1–K9; without it (same agent, memory used naively), > 0.
- **Metric fixed in advance:** attacker-address payments / attempts; secondary: false refusals on 50 benign messages.
- **Baseline:** same model, same prompts, payee book read from memory without status checks.
- Testnet only; corpus published; results reported whatever they are.
