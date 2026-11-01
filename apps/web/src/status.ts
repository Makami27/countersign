export type StatusCheck = { readonly name: string; readonly ok: boolean; readonly ms: number; readonly detail: string | null };

export type ModelStatus = {
  readonly calls: number;
  readonly failures: number;
  readonly answeredByCode: number;
  readonly lastLatencyMs: number | null;
  readonly lastOkAt: string | null;
  readonly lastError: { readonly problem: string; readonly httpStatus: number | null; readonly attempts: number; readonly at: string } | null;
  readonly primary: string;
  readonly fallback: string | null;
  readonly lastProvider: string | null;
  readonly fallbacksUsed: number;
  readonly quota: { readonly provider: string; readonly remainingRequests: number | null; readonly limitRequests: number | null; readonly resetRequests: string | null; readonly at: string } | null;
};

export type StatusView = {
  readonly checkedAt: string;
  readonly network: "mainnet" | "testnet";
  readonly version: string | null;
  readonly restore: { readonly relayer: string; readonly complete: boolean; readonly at: string | null };
  readonly checks: readonly StatusCheck[];
  readonly model: ModelStatus | null;
};
