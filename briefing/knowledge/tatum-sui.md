# Tatum Sui gateway

Researched: 2026-10-30
Primary sources:
- https://docs.tatum.io/reference/rpc-sui
- https://sui-mainnet.gateway.tatum.io/llms.txt
- Secondary (entrant code that ran against it, used only to point at what to spike): itzebe/aftermath `src/lib/adapters/tatum-sui*.ts`, angelraph/anchor `src/chain/sui.ts` + `docs/BLOG_TOTAL_RECALL.md`, zcsaqueeb/recallos-ai `src/lib/tatum/grpc.ts`

## What it actually is
Tatum runs hosted Sui nodes behind an API key. The judging line "successful
Tatum Sui RPC integration" means our chain reads (and any writes) go through
these hosts, not the public Sui fullnode.

## Core concepts you need before building
- **Three interfaces, and the sources disagree about one of them:**
  - **GraphQL:** `https://sui-mainnet.gateway.tatum.io/graphql`. The gateway's own `llms.txt` lists only GraphQL. One operation per POST; no batching, no subscriptions. Queries and mutations are billed separately.
  - **gRPC:** `https://sui-mainnet-grpc.gateway.tatum.io` (also `-testnet-`, `-devnet-`). Services: `LedgerService`, `StateService`, `TransactionExecutionService`, `SubscriptionService`, `NameService`, `MovePackageService`, `SignatureVerificationService`, `CheckpointSummaryService`.
  - **JSON-RPC:** the docs page still lists `sui_*` / `suix_*` on `https://sui-mainnet.gateway.tatum.io`. But the gateway's `llms.txt` lists only GraphQL, and AFTERMATH reports `POST /` returning 404. **Conflict: settle it with spike S1.** Anchor and RecallOS note that Sui's public JSON-RPC is deprecated ecosystem-wide.
- **Auth:** API key from dashboard.tatum.io, sent as `x-api-key` (HTTP header for GraphQL, gRPC metadata for gRPC). Three entrants use this header; the docs page doesn't state it. Keyless access is rate-limited (RecallIQ).
- **Discovery:** each base URL serves `/_methods` (machine-readable list) and `/llms.txt`. Any docs page + `.md` returns markdown.
- **Server-side only:** the key must never ship to the browser. Entrants let wallets talk to the public fullnode for signing UX, and do all *judged* reads server-side through Tatum.

## Canonical repo / spec location
Docs: https://docs.tatum.io/reference/rpc-sui. Sui GraphQL schema: the Sui
TypeScript SDK's GraphQL client works against Tatum's `/graphql` (Anchor).

## Minimal working shape
```ts
const res = await fetch("https://sui-mainnet.gateway.tatum.io/graphql", {
  method: "POST",
  headers: { "content-type": "application/json", "x-api-key": env.TATUM_API_KEY },
  body: JSON.stringify({ query: "{ chainIdentifier }" }),
});
```
(Exact query shape to be confirmed in spike S1; don't build on it until it passes.)

## Defaults and ordering that matter
- A failed or timed-out read is **UNKNOWN**, never "no transaction". Keep `not_found`, `malformed`, `timeout`, `auth` and `rate_limited` as separate results (AFTERMATH's taxonomy is a good model).
- Anything that executes a transaction (`TransactionExecutionService`): **never auto-retry** after a timeout; reconcile by digest.

## Address history and prices (added 2026-10-30)
- Tatum's wallet history API `/v4/data/transaction/history` **does not list Sui** ([ref](https://docs.tatum.io/reference/gettransactionhistoryv4.md)).
- Tatum gRPC has **no address-based transaction query**, only by digest or checkpoint ([migration guide](https://docs.tatum.io/docs/sui-migration-guide-from-json-rpc-to-grpc.md)). gRPC NOT_FOUND (code 5) usually means pruned data.
- So address history = Sui GraphQL `transactions(filter: { affectedAddress | sentAddress })`, with `effects { status checkpoint balanceChanges }`. Retention for that store is **~30–90 days typical**; digest lookups can be indefinite ([Sui GraphQL guide](https://docs.sui.io/guides/developer/accessing-data/query-with-graphql)). Check `serviceConfig.availableRange` on Tatum's gateway (S6).
- Prices: `GET /v4/data/rate/symbol/OHLCV` includes SUI, one candle per call, 50 credits ([ref](https://docs.tatum.io/reference/getsymbolohlcv.md)). `/v4/data/rate/history` returns `price: 0` when it has no data. **Treat 0 as UNKNOWN.**

## Known gotchas / traps
- **Tatum gRPC is native gRPC (HTTP/2, `application/grpc`), not gRPC-Web.** `@mysten/sui/grpc`'s default `GrpcWebFetchTransport` throws "unexpected response content type". Use `new GrpcTransport({ host: 'sui-mainnet-grpc.gateway.tatum.io:443', channelCredentials: ChannelCredentials.createSsl(), meta: { 'x-api-key': KEY } })` from `@protobuf-ts/grpc-transport` + `@grpc/grpc-js`, passed as `transport` to `SuiGrpcClient`. Source: AFTERMATH `src/lib/adapters/tatum-sui-grpc.ts` (secondary; confirm in S5).
- Raw verify call: `client.signatureVerificationService.verifySignature({ message: { name: 'PersonalMessage', value: bcs.byteVector().serialize(msg) }, signature: { bcs: { value } }, address, jwks: [] })` → `{ isValid, reason }` (from `@mysten/sui` 2.38 `src/grpc/core.ts`).
- Pruned genesis checkpoint and 429s handled specially by Anchor. Old history may not be available. Spike how far back transfers can be read.
- JSON-RPC 404 (above).

## Unverified: confirm with a reality spike
S1 interface + auth, S4 history depth, S5 rate limit on our plan. See REALITY_SPIKES.md.

## Explicitly out of scope for this build
Other chains, Tatum notifications/webhooks (unless the idea needs them).
