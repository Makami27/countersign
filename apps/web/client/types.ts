export type PayeeStatus = "verified" | "change_pending" | "attempt_refused" | "waiting_wallet" | "conflict" | "not_payable";

export type PayeeSummary = {
  readonly id: string;
  readonly name: string;
  readonly status: PayeeStatus;
  readonly address: string | null;
  readonly lastPaid: { readonly amountBaseUnits: string; readonly at: string } | null;
  readonly refusalsLastDay: number;
  readonly since: string;
};

export type Verification = { readonly role: string; readonly scheme: string; readonly maxEpoch: string | null; readonly checkedAtEpoch: string };

export type PayeeDetail = {
  readonly summary: PayeeSummary;
  readonly payTo: { readonly address: string; readonly version: number; readonly since: string; readonly why: string; readonly verifications: readonly Verification[] } | null;
  readonly waiting: { readonly address: string; readonly expires: string; readonly signUrl: string; readonly expired: boolean } | null;
  readonly pendingChanges: readonly { readonly nonce: string; readonly toAddress: string; readonly expires: string; readonly signUrl: string; readonly currentSignedAt: string | null; readonly newSignedAt: string | null; readonly ownerConfirmedAt: string | null; readonly readyAt: string | null }[];
  readonly latestRefusal: { readonly receipt: string; readonly at: string; readonly reason: string | null; readonly message: string; readonly address: string | null; readonly against: string | null } | null;
  readonly history: readonly { readonly kind: "version" | "refusal"; readonly label: string; readonly status: string; readonly address: string | null; readonly at: string; readonly why: string }[];
  readonly payments: readonly { readonly id: string; readonly state: string; readonly amountBaseUnits: string; readonly at: string; readonly digest: string | null; readonly reason: string | null }[];
};

export type Overview = {
  readonly network: "mainnet" | "testnet";
  readonly agentAddress: string;
  readonly balances: { readonly status: "KNOWN"; readonly suiBaseUnits: string; readonly usdcBaseUnits: string } | { readonly status: "UNKNOWN"; readonly detail: string };
  readonly memory: { readonly relayer: string; readonly restored: boolean; readonly restoredAt: string | null; readonly legacyRecords: number; readonly ignoredRecords: number };
  readonly memoryCounts: { readonly realUseMemories: number; readonly namespaces: number } | null;
  readonly memoryCountsWhy: string | null;
  readonly caps: { readonly perPaymentBaseUnits: string; readonly perDayBaseUnits: string; readonly usedTodayBaseUnits: string };
  readonly cooldownSeconds: number;
  readonly payeeCount: number;
  readonly ownerWallet:
    | { readonly known: true; readonly current: { readonly address: string; readonly version: number; readonly since: string } | null; readonly waiting: { readonly address: string; readonly readyAt: string } | null }
    | { readonly known: false; readonly why: string };
};

export type Refusal = { readonly reason: string; readonly message: string; readonly nextAction: string; readonly receipt: string; readonly cites: string | null };

export type PaymentStatus = {
  readonly payment: { readonly id: string; readonly state: string; readonly amountBaseUnits: string; readonly address: string; readonly digest: string | null; readonly detail: string | null; readonly reason: string | null };
  readonly receipt: { readonly receipt: string } | null;
};

export type ActivityItem =
  | { readonly kind: "receipt"; readonly at: string; readonly receipt: string; readonly verdict: string; readonly reason: string | null; readonly payeeId: string | null; readonly address: string | null; readonly amountBaseUnits: string | null; readonly suiDigest: string | null; readonly network: string }
  | { readonly kind: "payment"; readonly at: string; readonly paymentId: string; readonly state: string; readonly payeeId: string; readonly address: string; readonly amountBaseUnits: string; readonly digest: string | null };

export type ScheduleItem = { readonly schedule: { readonly scheduleId: string; readonly payeeId: string }; readonly nextDue: string | null; readonly says: string };
