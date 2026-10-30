# Sui personal-message signatures and USDC

Researched: 2026-10-30
Primary sources:
- https://sdk.mystenlabs.com/sui/cryptography.md (Mysten TS SDK v2)
- https://docs.sui.io/guides/developer/stablecoins
- https://www.quicknode.com/docs/sui/sui-grpc/signature-verification/verify-signature (gRPC VerifySignature reference; Tatum's gateway lists the same `SignatureVerificationService`)

## What it actually is
A Sui wallet can sign an arbitrary "personal message". The signature is
domain-separated from transactions by an intent prefix, so a signed message
can't be replayed as a transaction. We use this as proof that the owner of a
specific address approved a specific payee change.

## Core concepts you need before building
- Sign: `keypair.signPersonalMessage(bytes)` → `{ bytes, signature }`. Wallets expose the same through the wallet standard (`signPersonalMessage`).
- Verify: `verifyPersonalMessageSignature(message, signature, { address })` from `@mysten/sui/verify`. It **throws** if the signature isn't valid for that address. Use the `address` option, not `publicKey.toSuiAddress() === x` (zkLogin can have two valid address forms).
- **zkLogin signatures need a GraphQL client** to verify. Pass `client: new SuiGraphQLClient({ url })`. Point `url` at **Tatum's** `https://sui-mainnet.gateway.tatum.io/graphql` (with `x-api-key`) so verification runs through Tatum (spike S10).
- Server-side alternative: gRPC `SignatureVerificationService.VerifySignature`, which supports `PersonalMessage` and `TransactionData`, with an optional `address` that must match. Response: `isValid`, `reason` (field name to confirm against the proto).
- The message must include a **nonce + expiry + both addresses + payee id**, so an old signature can't be replayed for a different change.

## Canonical repo / spec location
`@mysten/sui` (MystenLabs/ts-sdks). Intent signing: https://docs.sui.io/develop/transactions/transaction-auth/intent-signing

## Minimal working shape
```ts
const text = [
  "Countersign payee change v1",
  `payee:${payeeId}`, `from:${oldAddr}`, `to:${newAddr}`,
  `nonce:${nonce}`, `expires:${expiresIso}`,
].join("\n");
await verifyPersonalMessageSignature(new TextEncoder().encode(text), sig, {
  address: oldAddr,
  client: tatumGraphQLClient,
});
```

## USDC on Sui
| Network | Coin type | Decimals |
|---|---|---|
| Mainnet (native, Circle) | `0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC` | 6 |
| Testnet | `0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC` | 6 |

Match on the **full coin type**, never on a symbol. Look-alike "USDC" tokens exist.

## Known gotchas / traps
- A signature proves *control of a key*, not identity. An attacker can always sign for **their own** address. So proof of control over the new address never authorises a change on its own (see PRD §6).
- zkLogin verification fails offline; network failure → `UNKNOWN`, not `INVALID`.

## Unverified: confirm with a reality spike
- S10: Tatum gRPC `VerifySignature` on PersonalMessage, and the SDK verify through Tatum GraphQL for zkLogin.

## Explicitly out of scope
Multisig payees, passkey signatures (handle as `UNSUPPORTED_SIGNATURE`, not a pass).
