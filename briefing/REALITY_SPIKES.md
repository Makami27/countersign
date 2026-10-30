# REALITY_SPIKES

Queued 2026-10-30. Sponsor hosts are blocked from Claude's workspace, so live spikes run from `spikes/` on your machine (see spikes/README.md). Offline feasibility results: FEASIBILITY.md.

| # | Claim (from docs/SDK) | Source | Spike command / call | Result | Date | Decision |
|---|---|---|---|---|---|---|
| S1 | Tatum Sui mainnet serves GraphQL at `/graphql` with `x-api-key`; JSON-RPC on `/` may 404 | docs.tatum.io vs gateway llms.txt vs AFTERMATH | POST `{ chainIdentifier }` to `/graphql`; POST `sui_getChainIdentifier` to `/`; GET `/_methods` | — | — | — |
| S2 | `rememberAndWait` returns a blob id on mainnet; recall finds it | MemWal SDK README | write one labelled test memory, time it, recall it in a fresh process | — | — | — |
| S3 | Managed relayer rate limit ≈ 1000 weighted req/hour | Remora ADR-0060 (secondary) | burst 20 writes, record 429s and `Retry-After` | — | — | — |
| S4 | Transfer history readable far enough back for our use | Anchor notes pruned genesis | query a wallet's transactions 30 / 90 days back | — | — | — |
| S5 | Tatum gRPC works with `x-api-key` metadata | entrant code | `LedgerService.GetServiceInfo` on gRPC host | — | — | — |
| S6 | Tatum's Sui GraphQL serves `transactions(filter:{affectedAddress})` with `effects.balanceChanges`; its retention window | Sui GraphQL guide (30–90 days typical) | `serviceConfig { availableRange(type:"Query", field:"transactions", filters:["affectedAddress"]) }` + `maxPageSize` on Tatum's `/graphql` | — | — | — |
| S7 | Point lookup `transaction(digest)` works for old digests (archival) | Sui GraphQL guide | look up a >120-day-old digest via Tatum | — | — | — |
| S9 | Tatum Sui GraphQL can list objects an address owns filtered by type `…::blob::Blob`, with `storage.end_epoch`; current Walrus epoch readable on chain | Walrus managing-blobs docs | `address(address:…){ objects(filter:{type:"<walrus pkg>::blob::Blob"}) { nodes { contents { json } } } }` | — | — | — |
| S10 | Tatum gRPC `SignatureVerificationService.VerifySignature` verifies a Sui PersonalMessage signature and matches `address` | QuickNode gRPC reference; Tatum lists the service | sign "Countersign: change payee X to Y, nonce N" with a test wallet, call VerifySignature via Tatum gRPC | — | — | — |
| S11 | Incoming transfers can be detected without webhooks (Tatum Notifications don't list Sui) | Tatum notifications chain list | poll GraphQL `transactions(filter:{affectedAddress})` vs gRPC `SubscriptionService` checkpoint stream; measure latency | — | — | — |
| S12 | recall(topK 100, no maxDistance) returns every record of a small namespace; count == listMemories | MemWal SDK types (list = metadata only; recall capped at 100) | `spikes/run.mjs` S12 | — | — | — |
| S13 | SUI transfer executes through Tatum native gRPC (protobuf-ts GrpcTransport) | AFTERMATH adapter notes | `spikes/run.mjs --pay` | — | — | — |
| S8 | Tatum OHLCV returns SUI candles; behaviour before earliest data | Tatum reference | `GET /v4/data/rate/symbol/OHLCV?symbol=SUI&time=…&interval=1h` | — | — | — |
