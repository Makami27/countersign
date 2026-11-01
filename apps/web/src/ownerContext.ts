import type { SharedAttackList } from "@countersign/core/shared";
import type { Countersign, IndexStore, PaymentIntent, PaymentLedger, SignatureCheck, SuiAddress } from "@countersign/core";
import type { ChangeSteps } from "./changeSteps.ts";
import type { OwnerSettings } from "./ownerSettings.ts";
import type { OwnerApprovals } from "./ownerApprovals.ts";
import type { OwnerWallets } from "./ownerWallet.ts";
import type { Schedules } from "./schedules.ts";
import type { QuotaMeter } from "./quota.ts";
import type { Reading } from "./screen.ts";

export type BalancesView =
  | { readonly status: "KNOWN"; readonly suiBaseUnits: bigint; readonly usdcBaseUnits: bigint }
  | { readonly status: "UNKNOWN"; readonly detail: string };

export type MemoryView = {
  readonly relayer: string;
  readonly restored: boolean;
  readonly restoredAt: string | null;
  readonly legacyRecords: number;
  readonly ignoredRecords: number;
};

export type MemoryCounts = { readonly realUseMemories: number; readonly namespaces: number; readonly byNamespace: readonly { readonly suffix: string; readonly count: number }[] } | null;

export type OwnerContext = {
  readonly ownerId: string;
  readonly network: "mainnet" | "testnet";
  readonly agentAddress: SuiAddress;
  readonly publicUrl: string | null;
  readonly engine: Countersign;
  readonly index: IndexStore;
  readonly ledger: PaymentLedger & { reservedFor(period: string): Promise<bigint> };
  readonly settings: OwnerSettings;
  readonly balances: () => Promise<BalancesView>;
  readonly memory: () => MemoryView;
  readonly memoryCounts: () => Promise<MemoryCounts>;
  readonly sendPayment: (paymentId: string) => Promise<PaymentIntent>;
  readonly steps: ChangeSteps;
  readonly cooldownMs: () => number;
  readonly verifySignature: (message: string, signature: string, address: SuiAddress) => Promise<SignatureCheck>;
  readonly wallets: OwnerWallets;
  readonly approvals: OwnerApprovals;
  readonly notify: (text: string) => Promise<void>;
  readonly schedules: Schedules;
  readonly shared: SharedAttackList;
  readonly quota: QuotaMeter;
  readonly isAdmin: boolean;
  readonly read: (text: string) => Promise<Reading>;
  readonly telegram: { readonly link: () => Promise<{ readonly url: string; readonly expires: string } | null>; readonly linked: () => Promise<boolean> };
};
