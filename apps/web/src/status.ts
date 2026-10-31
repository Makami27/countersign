export type StatusCheck = { readonly name: string; readonly ok: boolean; readonly ms: number; readonly detail: string | null };

export type StatusView = {
  readonly checkedAt: string;
  readonly network: "mainnet" | "testnet";
  readonly version: string | null;
  readonly restore: { readonly relayer: string; readonly complete: boolean; readonly at: string | null };
  readonly checks: readonly StatusCheck[];
};
