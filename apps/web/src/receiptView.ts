import { REASONS, formatUsdc, headOf, type CheckCode, type ReceiptRecord, type SuiAddress } from "@countersign/core";
import type { OwnerContext } from "./ownerContext.ts";

const WALRUS_AGGREGATOR = "https://aggregator.walrus-mainnet.walrus.space/v1/blobs/";
const WALRUSCAN = "https://walruscan.com/mainnet/blob/";

const VERDICT_WORDS: Record<ReceiptRecord["verdict"], { readonly words: string; readonly tone: "verified" | "stated" | "refused" }> = {
  PAID: { words: "Paid", tone: "verified" },
  PAYMENT_FAILED: { words: "Not paid", tone: "stated" },
  REFUSED: { words: "Refused", tone: "refused" },
  CHANGE_VERIFIED: { words: "Address change verified", tone: "verified" },
  CHANGE_REJECTED: { words: "Address change refused", tone: "refused" },
};

export const CHECK_WORDS: Record<CheckCode, string> = {
  ADDRESS_IN_MESSAGE: "The address appears word for word in the message",
  PAYEE_VERIFIED: "The payee has exactly one verified address",
  NOT_KNOWN_ATTACK: "The address was not refused before",
  NOT_LOOKALIKE: "The address is not a look-alike of a known address",
  MEMORY_COMPLETE: "Walrus Memory was read completely",
  AMOUNT_VALID: "The amount is a valid USDC amount",
  WITHIN_CAPS: "The payment is within the spending caps",
  CONTINUITY: "The payee's current wallet signed the change",
  OWNER_CONFIRMED: "The owner confirmed with a fresh one-time code",
  COOLDOWN_ELAPSED: "The waiting period had passed",
  CONTROL: "The new wallet proved it is in control",
  SETTLED_ON_CHAIN: "The transfer settled on chain",
};

export type BlobLink = { readonly id: string; readonly raw: string | null; readonly explorer: string | null };

export type ReceiptView = {
  readonly id: string;
  readonly verdict: { readonly words: string; readonly tone: "verified" | "stated" | "refused" };
  readonly payeeName: string | null;
  readonly money: string;
  readonly reason: { readonly message: string; readonly nextAction: string } | null;
  readonly checks: readonly { readonly words: string; readonly passed: boolean }[];
  readonly attempt: { readonly address: SuiAddress; readonly verified: SuiAddress | null } | null;
  readonly cites: string | null;
  readonly receiptBlob: BlobLink | null;
  readonly evidenceBlobs: readonly BlobLink[];
  readonly memoryLabel: string;
  readonly transaction: { readonly digest: string; readonly url: string } | null;
  readonly network: "mainnet" | "testnet";
  readonly at: string;
};

function blobLink(id: string, onWalrus: boolean): BlobLink {
  return { id, raw: onWalrus ? `${WALRUS_AGGREGATOR}${id}` : null, explorer: onWalrus ? `${WALRUSCAN}${id}` : null };
}

function moneySentence(record: ReceiptRecord, name: string): string {
  const amount = record.amountBaseUnits ? `${formatUsdc(BigInt(record.amountBaseUnits))} ${record.network === "mainnet" ? "USDC" : "test USDC"}` : "The payment";
  switch (record.verdict) {
    case "PAID": return `${amount} was paid to ${name} on Sui ${record.network}.`;
    case "PAYMENT_FAILED": return "No USDC moved.";
    case "CHANGE_VERIFIED": return `No money moved. Payments to ${name} now go to the newly verified address.`;
    case "CHANGE_REJECTED": return "No money moved and the payee's address did not change.";
    case "REFUSED": return "No money moved and nothing was changed.";
  }
}

export async function receiptView(ctx: OwnerContext, id: string): Promise<ReceiptView | null> {
  const record = await ctx.index.receipt(id);
  if (!record) return null;
  const versions = record.payeeId ? await ctx.index.payeeVersions(record.payeeId) : [];
  const head = headOf(versions);
  const name = [...versions].sort((a, b) => b.version - a.version)[0]?.name ?? record.payeeId ?? "the payee";
  const refused = record.verdict === "REFUSED" || record.verdict === "CHANGE_REJECTED";
  const verified = head.kind === "verified" ? head.version.address : null;
  const earlier = record.reason === "KNOWN_ATTACK_PATTERN" && record.address ? await ctx.index.earlierRefusalFor(record.address) : null;
  const relayer = ctx.memory().relayer;
  const onWalrus = relayer === "mainnet relayer";
  const blobId = await ctx.index.receiptBlobId(id);
  return {
    id,
    verdict: VERDICT_WORDS[record.verdict],
    payeeName: record.payeeId ? name : null,
    money: moneySentence(record, name),
    reason: record.reason ? { message: REASONS[record.reason].message, nextAction: REASONS[record.reason].nextAction } : null,
    checks: record.checks.map((c) => ({ words: CHECK_WORDS[c.check], passed: c.result === "PASS" })),
    attempt: refused && record.address && record.address !== verified ? { address: record.address, verified } : null,
    cites: earlier && earlier.receipt !== id ? earlier.receipt : null,
    receiptBlob: blobId ? blobLink(blobId, onWalrus) : null,
    evidenceBlobs: record.memoryBlobIds.map((b) => blobLink(b, onWalrus)),
    memoryLabel: onWalrus ? "Walrus Memory, mainnet relayer" : `${relayer}`,
    transaction: record.suiDigest ? { digest: record.suiDigest, url: `https://suiscan.xyz/${record.network}/tx/${record.suiDigest}` } : null,
    network: record.network,
    at: record.createdAt,
  };
}
