import { randomBytes } from "node:crypto";
import { Countersign, type IndexStore, type MemoryPort, type PaymentIntent, type PaymentLedger, type RecordSigner, type RestoreResult, type RoundTripChecker, type SignatureVerifier, type SuiAddress } from "@countersign/core";
import { SharedAttackList } from "@countersign/core/shared";
import type { PaymentRunner } from "@countersign/adapters/payments";
import type { SqlRows } from "@countersign/adapters/sql";
import { ChangeSteps } from "./changeSteps.ts";
import { completeReadyChanges } from "./changeCompletion.ts";
import { OwnerApprovals } from "./ownerApprovals.ts";
import { OwnerSettings } from "./ownerSettings.ts";
import { OwnerWallets } from "./ownerWallet.ts";
import { ScheduleRunner } from "./scheduleRuns.ts";
import { Schedules } from "./schedules.ts";
import type { BalancesView, DepositPort, MemoryCounts, OwnerContext } from "./ownerContext.ts";
import type { OwnerRuntime } from "./ownerDirectory.ts";
import type { ModelReader } from "@countersign/adapters/model";
import type { QuotaMeter } from "./quota.ts";
import { readMessage } from "./screen.ts";

const SHARED_REFRESH_EVERY_MS = 10 * 60_000;

export type RuntimeInput = {
  readonly ownerId: string;
  readonly network: "mainnet" | "testnet";
  readonly publicUrl: string | null;
  readonly agentAddress: SuiAddress;
  readonly memory: MemoryPort & { listNamespaces(prefix: string): Promise<readonly string[] | null> };
  readonly relayerLabel: string;
  readonly storage: { readonly index: IndexStore; readonly ledger: PaymentLedger & { reservedFor(period: string): Promise<bigint> }; readonly rows: SqlRows };
  readonly signer: RecordSigner;
  readonly verifier: SignatureVerifier;
  readonly roundTrips: RoundTripChecker;
  readonly runner: PaymentRunner;
  readonly balances: (fresh?: boolean) => Promise<BalancesView>;
  readonly deposits: DepositPort;
  readonly memoryCounts: () => Promise<MemoryCounts>;
  readonly notify: (text: string) => Promise<void>;
  readonly telegram: OwnerContext["telegram"];
  readonly reader: ModelReader;
  readonly quota: QuotaMeter;
  readonly isAdmin: boolean;
  readonly defaults: { readonly perPaymentBaseUnits: bigint; readonly perDayBaseUnits: bigint; readonly cooldownSeconds: number };
  readonly now: () => number;
};

export type BuiltRuntime = OwnerRuntime & { readonly restored: RestoreResult; readonly engine: Countersign; readonly sendRaw: (paymentId: string) => Promise<PaymentIntent> };

export async function buildOwnerRuntime(i: RuntimeInput): Promise<BuiltRuntime> {
  const { rows, index, ledger } = i.storage;
  const memory = {
    remember: (namespace: string, text: string, key: string) => {
      i.quota.record("walrus");
      return i.memory.remember(namespace, text, key);
    },
    readAll: (namespace: string) => i.memory.readAll(namespace),
    listNamespaces: (prefix: string) => i.memory.listNamespaces(prefix),
  };
  const verifier: SignatureVerifier = {
    verifyPersonalMessage: (message, signature, address) => {
      i.quota.record("tatum");
      return i.verifier.verifyPersonalMessage(message, signature, address);
    },
  };
  const settings = await OwnerSettings.open(rows, i.defaults);
  const steps = await ChangeSteps.open(rows);
  const wallets = await OwnerWallets.open({ rows, memory, signer: i.signer, ownerId: i.ownerId, now: i.now });
  const approvals = await OwnerApprovals.open(rows, i.ownerId, (message, signature, address) => verifier.verifyPersonalMessage(message, signature, address), i.now);
  const schedules = await Schedules.open({ rows, memory, signer: i.signer, ownerId: i.ownerId, now: i.now });
  const shared = new SharedAttackList({ memory, signer: i.signer, now: () => new Date(i.now()) });
  await shared.refresh();
  let sharedReadAt = i.now();
  const engine = new Countersign({
    ownerId: i.ownerId, network: i.network, memory, index, payments: ledger, clock: { now: () => new Date(i.now()) },
    signer: i.signer, signatures: verifier, shared, roundTrips: i.roundTrips,
    nonces: { next: () => randomBytes(16).toString("hex") },
    caps: settings.caps(),
    get cooldownMs() {
      return settings.values().cooldownSeconds * 1000;
    },
  });
  const restored = await engine.restore();
  const memoryView = { relayer: i.relayerLabel, restored: restored.ok, restoredAt: restored.ok ? new Date(i.now()).toISOString() : null, legacyRecords: restored.ok ? restored.legacy : 0, ignoredRecords: restored.ok ? restored.ignored : 0 };
  const recordFinished = async (payments: readonly PaymentIntent[]) => {
    for (const payment of payments) await engine.recordPaymentOutcome(payment);
  };
  await recordFinished(await i.runner.recoverInterrupted());
  let paymentsOpen = true;
  const sendRaw = (paymentId: string) => {
    paymentsOpen = true;
    i.quota.record("tatum");
    return i.runner.send(paymentId);
  };
  const ctx: OwnerContext = {
    ownerId: i.ownerId, network: i.network, agentAddress: i.agentAddress, publicUrl: i.publicUrl, engine, index, ledger, settings, balances: i.balances, deposits: {
      prepare: (sender, amounts) => {
        i.quota.record("tatum");
        return i.deposits.prepare(sender, amounts);
      },
      sight: (digest) => {
        i.quota.record("tatum");
        return i.deposits.sight(digest);
      },
    },
    memory: () => memoryView, memoryCounts: i.memoryCounts, steps, cooldownMs: () => settings.values().cooldownSeconds * 1000,
    verifySignature: (message, signature, address) => verifier.verifyPersonalMessage(message, signature, address),
    wallets, approvals, notify: i.notify, schedules, shared, telegram: i.telegram, quota: i.quota, isAdmin: i.isAdmin,
    read: (text) => readMessage(index, (t, payeeIds) => {
      i.quota.record("model");
      return i.reader(t, payeeIds);
    }, text),
    sendPayment: async (paymentId) => {
      const payment = await sendRaw(paymentId);
      await recordFinished([payment].filter((p) => p.state === "SETTLED" || p.state === "FAILED"));
      return payment;
    },
  };
  const scheduleRunner = await ScheduleRunner.open({ rows, engine, ledger, schedules, sendPayment: ctx.sendPayment, notify: i.notify, publicUrl: i.publicUrl, now: i.now });
  const tick = async () => {
    if (paymentsOpen) {
      await recordFinished(await i.runner.reconcileOpen());
      paymentsOpen = (await ledger.unresolvedPayments()).length > 0;
    }
    const applied = await wallets.applyDue();
    if (applied) await i.notify(`Owner wallet replaced after the 72-hour wait: it is now ${applied.address}. The previous wallet didn't cancel it.`);
    await scheduleRunner.tick();
    await completeReadyChanges(ctx, i.now());
    if (i.now() - sharedReadAt >= SHARED_REFRESH_EVERY_MS) {
      sharedReadAt = i.now();
      await shared.refresh();
    }
  };
  return { ctx, tick, restored, engine, sendRaw };
}
