# Walrus Memory (MemWal)

Researched: 2026-10-30
Primary sources:
- https://github.com/MystenLabs/MemWal (cloned at `d59075a`, 2026-10-30): `packages/sdk/README.md`, `packages/sdk/src/memwal.ts`, `src/types.ts`, `src/errors.ts`, `docs/relayer/public-relayer.md`, `docs/relayer/self-hosting.md`, `docs/relayer/api-reference.md`, `docs/sdk/api-reference.md`, `docs/api/memory-read-api.md`
- https://docs.wal.app/walrus-memory

## What it actually is
A memory layer for AI agents. You send text to a relayer. It embeds the text,
encrypts it with Seal, uploads it to Walrus, and indexes the vector. Recall is
a semantic search scoped to `owner + namespace` (a "memory space"). Sui
contracts record ownership and delegate keys. Status: **beta**, changing daily
(three server fixes landed on 2026-10-29/30).

## Core concepts you need before building
- **Account + delegate key.** Create an account at memory.walrus.xyz; add a delegate key (ed25519). The SDK takes the delegate *private* key and the account ID. The form's `MEMWAL_AGENT_ID` is the delegate **public** key.
- **Namespace** = your partition (`"default"` if omitted). Isolation is per owner + namespace.
- **Writes are async jobs.** `remember()` returns a job; `rememberAndWait()` polls until `done`. Job states: `pending`, `running`, `uploaded`, `done`, `failed`, `not_found`.
- **Recall returns `{ results: [{ blob_id, text, distance, ... }], total, dropped_count? }`.** Lower distance = closer. `dropped_count` = matches lost to download/decrypt failure. Never treat a short list as "nothing exists".
- **Recall order** is relevance by default; `sort: "recent"` gives the newest of the semantic matches. Optional `scoring_weights` (semantic / recency / importance).
- **Write-time field** on results lets you do "newest wins" without parsing dates out of text.
- **Managed relayer pays** WAL storage and SUI gas for relayed writes. Mainnet memory is free to you, but usage-limited.
- **No browser CORS** on the managed relayer's main API: call it **server-side only**, keep the delegate key off the client.
- **Relayer sees plaintext** during embedding/encryption. Don't put secrets or other people's private data in memory text.

## Canonical repo / spec location
`github.com/MystenLabs/MemWal` (Mysten Labs org). npm package
`@mysten-incubation/memwal` (SDK at 0.1.12 in the repo). MCP server:
`@mysten-incubation/memwal-mcp`. Python SDK in `packages/python-sdk-memwal`.

## Minimal working shape
```ts
import { MemWal } from "@mysten-incubation/memwal";

const memwal = MemWal.create({
  key: env.MEMWAL_PRIVATE_KEY,
  accountId: env.MEMWAL_ACCOUNT_ID,
  serverUrl: "https://relayer.memory.walrus.xyz",
  namespace: "myapp:user:<id>",
});

const written = await memwal.rememberAndWait(text, { idempotencyKey, timeoutMs: 30_000 });
const hits = await memwal.recall({ query, topK: 10, maxDistance: 0.8 });
```
Other methods: `rememberBulk[AndWait]`, `analyze[AndWait]` (extract facts, each stored separately), `restore(namespace)`, `listNamespaces`, `listMemories`, `health`, `compatibility`, `forget(blobId)` (mock lists it).
Offline tests: `MemWalMock.create({ namespace })`, deterministic, no network.

## Defaults and ordering that matter
- Use the **object form** `recall({ query, topK, namespace })`. Positional `recall(query, limit, namespace)` is deprecated, and `recall(query, namespace)` throws.
- `maxDistance` 0.8 is only a starting point; calibrate on our own memories.
- `idempotencyKey` and `dedupe: true` exist on remember. Use a content-hash key so retries don't write duplicates.
- `waitForRememberJob` retries 429/5xx itself; on deadline it throws `MemWalRememberJobTimeoutError` (504). **Timeout ≠ failure**: the write may still land. Treat it as UNKNOWN and re-check by idempotency key.
- Bulk wait throws `MemWalRateLimitedError` (429) when every status read was rate-limited: writes unconfirmed, not failed.

## Known gotchas / traps
- Peer-dependency matrix: `@mysten/sui ^2.16.2`, `@mysten/seal ^1.1.3`, `@mysten/walrus ^1.1.7`. `@mysten/walrus@0.x` pulls sui v1 and breaks install with ERESOLVE.
- Node: 22.23.4+ / 24.22.1+ / 26.12.1+ (October 2026 security release).
- Rate limits: the read API defaults to 200 weighted requests/min per delegate key. Self-host defaults (60/min per user, 500/hour per user, 30/min per delegate key) hint at the managed limits, but the managed relayer's actual numbers aren't published. One entrant measured about 1000 weighted requests/hour (Remora ADR-0060). That's unverified, so measure it ourselves.
- Status reads count against the same delegate-key budget as writes; polling burns quota.
- HTTP 426 → `MemWalCompatibilityError` (SDK too old for the relayer). Pin exact SDK version and check `compatibility()` at startup.

## Unverified: confirm with a reality spike
- Managed-relayer write rate limit and per-account storage cap (S3).
- End-to-end write latency on mainnet (S2): sets how the demo feels.
- Forgetting a memory: `forget(blobId)` exists **only on `MemWalMock`**. The real client in `memwal.ts` has no `forget` method (checked at `d59075a`). Design for append-only memory plus a "revoked" record, or check the security-delete API (`docs/api/security-delete.md`).
- Whether "10 memories" is counted per account, per delegate key or per namespace (ask organisers or count all three).

## Explicitly out of scope for this build
Self-hosted relayer, manual Seal flow (`/manual`), Nautilus TEE, Python SDK.
