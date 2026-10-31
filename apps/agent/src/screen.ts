import { addressesIn, headOf, isLookalike, knownAttackFor, type IndexStore, type Proposal } from "@countersign/core";
import type { Extraction } from "@countersign/adapters/gemini";

export type ChangeProposal = Extract<Proposal, { kind: "change_address" }>;
export type Reading = { readonly status: "READ"; readonly by: "code" | "model"; readonly proposal: Proposal } | Extract<Extraction, { status: "UNKNOWN" }>;

export async function screenAddresses(index: IndexStore, text: string): Promise<ChangeProposal | null> {
  const found = addressesIn(text);
  if (found.length === 0) return null;
  const heads = await Promise.all((await index.payeeIds()).map(async (payeeId) => ({ payeeId, head: headOf(await index.payeeVersions(payeeId)) })));
  for (const address of found) {
    const earlier = await knownAttackFor(index, address);
    if (earlier?.payeeId) return { kind: "change_address", payeeId: earlier.payeeId, newAddress: address, reasonQuote: address };
    const imitated = heads.find((h) => h.head.kind === "verified" && isLookalike(address, h.head.version.address));
    if (imitated) return { kind: "change_address", payeeId: imitated.payeeId, newAddress: address, reasonQuote: address };
  }
  return null;
}

export async function readMessage(index: IndexStore, extract: (text: string, payeeIds: readonly string[]) => Promise<Extraction>, text: string): Promise<Reading> {
  const screened = await screenAddresses(index, text);
  if (screened) return { status: "READ", by: "code", proposal: screened };
  const extraction = await extract(text, await index.payeeIds());
  return extraction.status === "READ" ? { status: "READ", by: "model", proposal: extraction.proposal } : extraction;
}
