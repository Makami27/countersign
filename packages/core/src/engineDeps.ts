import type { RoundTripChecker } from "./changeProofs.ts";
import type { Clock, IndexStore, MemoryPort, NonceSource, PaymentLedger, RecordSigner, SignatureVerifier } from "./ports.ts";

export type Caps = { readonly perPaymentBaseUnits: bigint; readonly perDayBaseUnits: bigint };

export type EngineDeps = {
  readonly ownerId: string;
  readonly network: "mainnet" | "testnet";
  readonly memory: MemoryPort & { listNamespaces(prefix: string): Promise<readonly string[] | null> };
  readonly index: IndexStore;
  readonly payments: PaymentLedger;
  readonly signer: RecordSigner;
  readonly signatures: SignatureVerifier;
  readonly roundTrips: RoundTripChecker;
  readonly clock: Clock;
  readonly nonces: NonceSource;
  readonly caps: Caps;
  readonly cooldownMs: number;
};
