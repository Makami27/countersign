# FAILURE_MODES

Researched: 2026-10-30. Guards decided before code. "Test" names the test that must exist.

## Tatum Sui gateway (GraphQL + gRPC)
| Mode | Can it happen? | Guard chosen | Where (file) | Test |
|---|---|---|---|---|
| Replay | a test-transfer return seen twice | `UNIQUE(digest)` on `observed_transfers`, inside the transaction that consumes it | `core/proofs.ts`, db schema | "counts a return transfer once even if observed twice" |
| Retry (reads) | 429 / 5xx / network | retry reads with backoff + jitter, max 3; then `UNKNOWN` | `adapters/tatum/http.ts` | "returns UNKNOWN after three 429s, never NOT_FOUND" |
| Retry (writes: payments) | timeout after submit | **never resubmit**; status `UNKNOWN`; reconcile by digest | `core/spend.ts` | "holds a timed-out payment as UNKNOWN and never resends" |
| Timeout | yes | per-call deadline; outcome `UNKNOWN` | adapters | as above |
| 429 | free plan is 3 req/s | client-side token bucket at 2 req/s, persisted across restarts | `adapters/tatum/limiter.ts` | "limiter survives restart" |
| Ambiguity | two return transfers match | `AMBIGUOUS` → no verification, ask the owner | `core/proofs.ts` | "two matching returns verify nothing" |
| Partial | GraphQL page truncated / outside the available range | `INCOMPLETE`, never "no transfer" | `adapters/tatum/graphql.ts` | "an outside-range error is INCOMPLETE" |
| Ordering | balance-change list order | match on digest + coin type + amount, never on position | `core/proofs.ts` | property test: shuffled input, same verdict |
| Wrong coin | look-alike USDC | full coin-type equality against a constant | `core/coins.ts` | "rejects a token named USDC with a different type" |
| Secrets | API key in logs | redact `x-api-key` at any depth; output scanner test | `util/redact.ts` | "no secret appears in any log or evidence file" |

## Signature verification (Tatum gRPC VerifySignature / SDK via Tatum GraphQL)
| Mode | Guard | Test |
|---|---|---|
| Invalid signature | `REJECTED(SIGNATURE_INVALID)` | "rejects a change signed by the new address only" |
| Network failure | `UNKNOWN`, change stays `PENDING_PROOF` | "a verifier timeout never verifies" |
| Replay of an old valid signature (K7) | nonce single-use `UNIQUE`, expiry ≤ 24h, payee id + both addresses in the message | "rejects a valid signature reused for another payee", "…after expiry" |
| Unsupported scheme (multisig, passkey) | `UNSUPPORTED_SIGNATURE` → owner path only | "multisig signature falls back to owner path" |

## Walrus Memory (managed relayer)
| Mode | Guard | Test |
|---|---|---|
| Write timeout (`MemWalRememberJobTimeoutError`) | `UNKNOWN`; idempotency key = sha256(canonical record); re-check before rewriting | "retries a write with the same idempotency key" |
| Rate limit (429 / `MemWalRateLimitedError`) | queue writes; never drop; surface "memory pending" in the UI | "pending writes survive restart" |
| Recall drops (`dropped_count > 0`) | treat recall as incomplete → payee `UNKNOWN` → no payment | "a recall with dropped results blocks payment" |
| Forged / unsigned record (K8) | agent signature check on every recalled record; drop + count | "ignores a record without a valid agent signature" |
| Conflicting records (K9) | two VERIFIED versions without a supersedes chain → `CONFLICT` | "two unchained versions freeze the payee" |
| Relayer outage | read path: last signed index (SQLite) marked stale → **no payments while stale** | "stale index blocks payment" |
| DB lost | rebuild index from Walrus Memory on start | "wipe DB, restore, identical state" |

## LLM (Gemini)
| Mode | Guard | Test |
|---|---|---|
| Malformed output | strict schema, parsed as `unknown`; refuse, never repair | "malformed extraction becomes NO_PROPOSAL" |
| Model invents an address | extracted address must appear **verbatim** in the source message | "address not present in the message is discarded" |
| Model says "verified" | model output has no field that can set status | type-level: proposal type has no status field |
| Outage | message queued as `UNPROCESSED`; nothing changes | "LLM outage changes no payee" |

## Payments (USDC on Sui via Tatum TransactionExecutionService)
| Mode | Guard | Test |
|---|---|---|
| Double spend (concurrent sends) | reserve-then-settle: one conditional update on the period budget inside a transaction | concurrency test: `Promise.all` of 10 sends, cap respected |
| Paying a non-verified version | spend gate reads the payee's head version; must be `VERIFIED` and not `CONFLICT` / stale | "refuses to pay a STATED address" |
| Cap pressure (K6) | per-payee and per-day caps are code constants plus owner settings; the model can't raise them | "a message asking to double the amount changes nothing" |
| Unknown broadcast | intent row before send; `UNKNOWN` until a digest is seen; no resubmit edge | "UNKNOWN has no transition back to SENDING" |

## Telegram
| Mode | Guard |
|---|---|
| Spoofed owner | owner identity = Telegram user id bound at setup; owner confirmations require a fresh code shown in the web app |
| Duplicate updates | `UNIQUE(update_id)` |
