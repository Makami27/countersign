import type { MemoryPort, RecordSigner, SignatureVerifier } from "@countersign/core";
import type { SharedAttackList } from "@countersign/core/shared";
import type { SqlRows } from "@countersign/adapters/sql";
import { OwnerApprovals } from "../../src/ownerApprovals.ts";
import { OwnerWallets } from "../../src/ownerWallet.ts";
import { Schedules } from "../../src/schedules.ts";

export type Extras = { readonly wallets: OwnerWallets; readonly approvals: OwnerApprovals; readonly notify: (text: string) => Promise<void>; readonly notices: string[]; readonly schedules: Schedules; readonly shared: SharedAttackList; readonly telegram: { readonly link: () => Promise<{ readonly url: string; readonly expires: string } | null>; readonly linked: () => Promise<boolean> } };

export async function ownerExtras(rows: SqlRows, deps: { readonly memory: MemoryPort; readonly signer: RecordSigner; readonly signatures: SignatureVerifier; readonly shared: SharedAttackList }, now: () => number = Date.now): Promise<Extras> {
  const notices: string[] = [];
  return {
    wallets: await OwnerWallets.open({ rows, memory: deps.memory, signer: deps.signer, ownerId: "owner1", now }),
    approvals: await OwnerApprovals.open(rows, "owner1", (m, s, a) => deps.signatures.verifyPersonalMessage(m, s, a), now),
    notify: async (text) => void notices.push(text),
    notices,
    shared: deps.shared,
    telegram: { link: async () => ({ url: "https://t.me/countersign_test_bot?start=0123456789abcdef0123456789abcdef", expires: new Date(Date.now() + 600_000).toISOString() }), linked: async () => false },
    schedules: await Schedules.open({ rows, memory: deps.memory, signer: deps.signer, ownerId: "owner1", now }),
  };
}
