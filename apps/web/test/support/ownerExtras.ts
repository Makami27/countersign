import type { MemoryPort, RecordSigner, SignatureVerifier, SuiAddress } from "@countersign/core";
import type { DepositPort } from "../../src/ownerContext.ts";
import type { SharedAttackList } from "@countersign/core/shared";
import type { SqlRows } from "@countersign/adapters/sql";
import { OwnerApprovals } from "../../src/ownerApprovals.ts";
import { OwnerWallets } from "../../src/ownerWallet.ts";
import { Schedules } from "../../src/schedules.ts";
import { QuotaMeter } from "../../src/quota.ts";
import type { Reading } from "../../src/screen.ts";

export type DepositCall = { readonly sender: SuiAddress; readonly usdcBaseUnits: bigint; readonly suiBaseUnits: bigint };

export type Extras = { readonly deposits: DepositPort; readonly depositCalls: DepositCall[]; readonly wallets: OwnerWallets; readonly approvals: OwnerApprovals; readonly notify: (text: string) => Promise<void>; readonly notices: string[]; readonly schedules: Schedules; readonly shared: SharedAttackList; readonly quota: QuotaMeter; readonly isAdmin: boolean; readonly read: (text: string) => Promise<Reading>; readonly telegram: { readonly link: () => Promise<{ readonly url: string; readonly expires: string } | null>; readonly linked: () => Promise<boolean> } };

export async function ownerExtras(rows: SqlRows, deps: { readonly memory: MemoryPort; readonly signer: RecordSigner; readonly signatures: SignatureVerifier; readonly shared: SharedAttackList }, now: () => number = Date.now): Promise<Extras> {
  const notices: string[] = [];
  const depositCalls: DepositCall[] = [];
  return {
    depositCalls,
    deposits: {
      prepare: async (sender, amounts) => {
        depositCalls.push({ sender, ...amounts });
        return amounts.usdcBaseUnits > 100_000_000n ? { ok: false, kind: "NOT_ENOUGH", coin: "USDC", heldBaseUnits: 1_000_000n, neededBaseUnits: amounts.usdcBaseUnits } : { ok: true, transaction: JSON.stringify({ version: 2, sender }) };
      },
      sight: async (digest) => (digest === "1".repeat(44) ? { kind: "NOT_FOUND" } : { kind: "CONFIRMED", usdcBaseUnits: 5_000_000n, suiBaseUnits: 0n }),
    },
    wallets: await OwnerWallets.open({ rows, memory: deps.memory, signer: deps.signer, ownerId: "owner1", now }),
    approvals: await OwnerApprovals.open(rows, "owner1", (m, s, a) => deps.signatures.verifyPersonalMessage(m, s, a), now),
    notify: async (text) => void notices.push(text),
    notices,
    shared: deps.shared,
    quota: new QuotaMeter(null),
    isAdmin: true,
    read: async () => ({ provider: "groq", status: "UNKNOWN", problem: "UNAVAILABLE", httpStatus: null, attempts: 1 }),
    telegram: { link: async () => ({ url: "https://t.me/countersign_test_bot?start=0123456789abcdef0123456789abcdef", expires: new Date(Date.now() + 600_000).toISOString() }), linked: async () => false },
    schedules: await Schedules.open({ rows, memory: deps.memory, signer: deps.signer, ownerId: "owner1", now }),
  };
}
