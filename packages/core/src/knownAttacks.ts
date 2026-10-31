import { headOf } from "./payeeBook.ts";
import type { IndexStore } from "./ports.ts";
import type { ReceiptRecord, SeenElsewhere, SuiAddress } from "./types.ts";
import type { ReasonCode } from "./vocabulary.ts";

export type Repeat = { readonly reason: Extract<ReasonCode, "KNOWN_ATTACK_PATTERN" | "SEEN_BY_OTHER_AGENT">; readonly cites: string; readonly seen: { readonly seenElsewhere?: SeenElsewhere } };

export async function knownAttackFor(index: IndexStore, address: SuiAddress): Promise<ReceiptRecord | null> {
  const earlier = await index.earlierRefusalFor(address);
  if (!earlier) return null;
  const heads = await Promise.all((await index.payeeIds()).map(async (payeeId) => headOf(await index.payeeVersions(payeeId))));
  return heads.some((h) => h.kind === "verified" && h.version.address === address) ? null : earlier;
}

export async function repeatOf(index: IndexStore, address: SuiAddress, continuityMayOverride: boolean): Promise<Repeat | null> {
  const earlier = await knownAttackFor(index, address);
  if (!earlier) return null;
  const secondHand = earlier.reason === "SEEN_BY_OTHER_AGENT";
  if (secondHand && continuityMayOverride) return null;
  return { reason: secondHand ? "SEEN_BY_OTHER_AGENT" : "KNOWN_ATTACK_PATTERN", cites: earlier.receipt, seen: earlier.seenElsewhere ? { seenElsewhere: earlier.seenElsewhere } : {} };
}
