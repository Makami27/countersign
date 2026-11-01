import { imitatesAny } from "./address.ts";
import { repeatOf } from "./knownAttacks.ts";
import { seenElsewhere } from "./sharedFlags.ts";
import type { EngineDeps } from "./engineDeps.ts";
import { refuse } from "./engineWrites.ts";
import { CheckTrail as Trail } from "./receipts.ts";
import type { Refused, SeenElsewhere, SuiAddress } from "./types.ts";
import type { CheckCode, ReasonCode } from "./vocabulary.ts";

export type OwnerPathFlag = {
  readonly reason: Extract<ReasonCode, "KNOWN_ATTACK_PATTERN" | "LOOKALIKE_ADDRESS" | "SEEN_BY_OTHER_AGENT">;
  readonly check: CheckCode;
  readonly cites: string | null;
  readonly seen: { readonly seenElsewhere?: SeenElsewhere };
};

export async function ownerPathFlag(d: EngineDeps, toAddress: SuiAddress, trail: Trail): Promise<OwnerPathFlag | null> {
  const repeat = await repeatOf(d.index, toAddress, false);
  if (repeat) return { reason: repeat.reason, check: "NOT_KNOWN_ATTACK", cites: repeat.cites, seen: repeat.seen };
  trail.pass("NOT_KNOWN_ATTACK");
  if (imitatesAny(toAddress, await d.index.verifiedAddresses())) return { reason: "LOOKALIKE_ADDRESS", check: "NOT_LOOKALIKE", cites: null, seen: {} };
  trail.pass("NOT_LOOKALIKE");
  const flagged = await seenElsewhere(d, toAddress);
  if (flagged) return { reason: "SEEN_BY_OTHER_AGENT", check: "NOT_SEEN_ELSEWHERE", cites: null, seen: { seenElsewhere: flagged } };
  trail.pass("NOT_SEEN_ELSEWHERE");
  return null;
}

export async function screenOwnerConfirmation(d: EngineDeps, nonce: string): Promise<Refused | null> {
  const change = await d.index.pendingChange(nonce);
  if (!change) return null;
  const trail = new Trail();
  const flag = await ownerPathFlag(d, change.toAddress, trail);
  if (!flag) return null;
  return refuse(d, "CHANGE_REJECTED", flag.reason, { ref: nonce, payeeId: change.payeeId, address: change.toAddress, ...flag.seen }, trail, flag.check, flag.cites);
}

export async function cancelChange(d: EngineDeps, nonce: string): Promise<Refused | null> {
  const change = await d.index.pendingChange(nonce);
  if (!change || !(await d.index.consumePendingChange(nonce))) return null;
  return refuse(d, "CHANGE_REJECTED", "CANCELLED_BY_OWNER", { ref: nonce, payeeId: change.payeeId, address: change.toAddress }, new Trail());
}
