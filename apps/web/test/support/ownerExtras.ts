import type { MemoryPort, RecordSigner, SignatureVerifier } from "@countersign/core";
import type { SqlRows } from "@countersign/adapters/sql";
import { OwnerApprovals } from "../../src/ownerApprovals.ts";
import { OwnerWallets } from "../../src/ownerWallet.ts";

export type Extras = { readonly wallets: OwnerWallets; readonly approvals: OwnerApprovals; readonly notify: (text: string) => Promise<void>; readonly notices: string[] };

export async function ownerExtras(rows: SqlRows, deps: { readonly memory: MemoryPort; readonly signer: RecordSigner; readonly signatures: SignatureVerifier }, now: () => number = Date.now): Promise<Extras> {
  const notices: string[] = [];
  return {
    wallets: await OwnerWallets.open({ rows, memory: deps.memory, signer: deps.signer, ownerId: "owner1", now }),
    approvals: await OwnerApprovals.open(rows, "owner1", (m, s, a) => deps.signatures.verifyPersonalMessage(m, s, a), now),
    notify: async (text) => void notices.push(text),
    notices,
  };
}
