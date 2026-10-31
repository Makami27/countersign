import type { Countersign, IndexStore, PaymentIntent, PaymentLedger, SignatureCheck, SuiAddress } from "@countersign/core";
import type { ChangeSteps } from "./changeSteps.ts";
import type { OwnerAuth } from "./ownerAuth.ts";
import type { OwnerSettings } from "./ownerSettings.ts";

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

export type MemoryCounts = { readonly realUseMemories: number; readonly namespaces: number } | null;

export type OwnerContext = {
  readonly ownerId: string;
  readonly network: "mainnet" | "testnet";
  readonly agentAddress: SuiAddress;
  readonly publicUrl: string | null;
  readonly engine: Countersign;
  readonly index: IndexStore;
  readonly ledger: PaymentLedger & { reservedFor(period: string): bigint };
  readonly auth: OwnerAuth;
  readonly settings: OwnerSettings;
  readonly balances: () => Promise<BalancesView>;
  readonly memory: () => MemoryView;
  readonly memoryCounts: () => Promise<MemoryCounts>;
  readonly sendPayment: (paymentId: string) => Promise<PaymentIntent>;
  readonly steps: ChangeSteps;
  readonly cooldownMs: () => number;
  readonly verifySignature: (message: string, signature: string, address: SuiAddress) => Promise<SignatureCheck>;
};
