import { REASONS, headOf, isRefusal, remembersAttack, type PayeeVersionRecord, type ReceiptRecord, type SignatureVerification, type SuiAddress } from "@countersign/core";
import type { OwnerContext } from "./ownerContext.ts";

const DAY_MS = 24 * 3600 * 1000;

export type PayeeStatus = "verified" | "change_pending" | "attempt_refused" | "waiting_wallet" | "conflict" | "not_payable";

export type PayeeSummary = {
  readonly id: string;
  readonly name: string;
  readonly status: PayeeStatus;
  readonly address: SuiAddress | null;
  readonly lastPaid: { readonly amountBaseUnits: bigint; readonly at: string } | null;
  readonly refusalsLastDay: number;
  readonly since: string;
};

function signUrl(ctx: OwnerContext, nonce: string): string {
  return `${ctx.publicUrl ?? ""}/sign/${nonce}`;
}

function nameOf(versions: readonly PayeeVersionRecord[], id: string): string {
  return [...versions].sort((a, b) => b.version - a.version)[0]?.name ?? id;
}

function liveRefusals(ctx: OwnerContext, payeeId: string): readonly ReceiptRecord[] {
  return ctx.index.receiptsFor(payeeId, 50).filter(isRefusal);
}

export function payeeSummary(ctx: OwnerContext, id: string, now: number): PayeeSummary {
  const versions = ctx.index.payeeVersions(id);
  const head = headOf(versions);
  const refusalsLastDay = liveRefusals(ctx, id).filter((r) => Date.parse(r.createdAt) > now - DAY_MS).length;
  const pendingChange = ctx.index.pendingChangesFor(id).some((c) => Date.parse(c.expires) > now);
  const waiting = ctx.index.pendingOnboardingFor(id);
  const paid = ctx.ledger.recentPayments(20, id).find((p) => p.state === "SETTLED");
  const status: PayeeStatus = head.kind === "conflict" ? "conflict"
    : head.kind === "none" ? (waiting && Date.parse(waiting.expires) > now ? "waiting_wallet" : "not_payable")
    : pendingChange ? "change_pending" : refusalsLastDay > 0 ? "attempt_refused" : "verified";
  const address = head.kind === "verified" ? head.version.address : (waiting?.address ?? versions[0]?.address ?? null);
  return { id, name: nameOf(versions, id), status, address, lastPaid: paid ? { amountBaseUnits: paid.amountBaseUnits, at: paid.updatedAt } : null, refusalsLastDay, since: versions[0]?.createdAt ?? "" };
}

function whyVersion(version: PayeeVersionRecord): string {
  switch (version.evidence.kind) {
    case "payee_onboarding": return "Added by you. The payee's wallet proved control by signing.";
    case "continuity_signature": return "Changed after the previous wallet signed the change and the new wallet proved control.";
    case "owner_confirmed_change": return "Changed by you after the waiting period. The new wallet proved control.";
    case "onboarding_requested": return "Added by you. Waiting for the payee's wallet; never payable on its own.";
    case "stated": return "Stated in a message. Kept as stated; it can never be paid.";
  }
}

function verificationsOf(version: PayeeVersionRecord): readonly SignatureVerification[] {
  const evidence = version.evidence;
  return evidence.kind === "payee_onboarding" || evidence.kind === "continuity_signature" || evidence.kind === "owner_confirmed_change" ? evidence.verifications : [];
}

export function payeeDetail(ctx: OwnerContext, id: string, now: number) {
  const versions = ctx.index.payeeVersions(id);
  if (versions.length === 0) return null;
  const head = headOf(versions);
  const refusals = liveRefusals(ctx, id);
  const waiting = ctx.index.pendingOnboardingFor(id);
  const latest = refusals[0];
  return {
    summary: payeeSummary(ctx, id, now),
    payTo: head.kind === "verified" ? { address: head.version.address, version: head.version.version, since: head.version.createdAt, why: whyVersion(head.version), verifications: verificationsOf(head.version) } : null,
    waiting: waiting && head.kind === "none" ? { address: waiting.address, expires: waiting.expires, signUrl: signUrl(ctx, waiting.nonce), expired: Date.parse(waiting.expires) <= now } : null,
    pendingChanges: ctx.index.pendingChangesFor(id).filter((c) => Date.parse(c.expires) > now).map((c) => ({ toAddress: c.toAddress, expires: c.expires, signUrl: signUrl(ctx, c.nonce) })),
    latestRefusal: latest ? { receipt: latest.receipt, at: latest.createdAt, reason: latest.reason, message: latest.reason ? REASONS[latest.reason].message : "", address: latest.address, against: head.kind === "verified" ? head.version.address : null } : null,
    history: [
      ...[...versions].sort((a, b) => a.version - b.version).map((v) => ({ kind: "version" as const, label: `v${v.version}`, status: v.status, address: v.address, at: v.createdAt, why: whyVersion(v) })),
      ...refusals.filter((r) => r.address !== null).map((r) => ({ kind: "refusal" as const, label: "Refused", status: "REFUSED", address: r.address, at: r.createdAt, why: `${r.reason ? REASONS[r.reason].message : "Refused."}${remembersAttack(r) ? " Kept on record so a repeat is refused instantly." : ""}`, receipt: r.receipt })),
    ],
    payments: ctx.ledger.recentPayments(20, id).map((p) => ({ id: p.id, state: p.state, amountBaseUnits: p.amountBaseUnits, address: p.address, at: p.updatedAt, digest: p.digest, reason: p.reason })),
  };
}

export async function overview(ctx: OwnerContext, now: number) {
  const settings = ctx.settings.values();
  const today = new Date(now).toISOString().slice(0, 10);
  return {
    network: ctx.network, agentAddress: ctx.agentAddress, balances: await ctx.balances(), memory: ctx.memory(), memoryCounts: await ctx.memoryCounts(),
    caps: { perPaymentBaseUnits: settings.perPaymentBaseUnits, perDayBaseUnits: settings.perDayBaseUnits, usedTodayBaseUnits: ctx.ledger.reservedFor(today) },
    cooldownSeconds: settings.cooldownSeconds, payeeCount: ctx.index.payeeIds().length,
  };
}

export function activity(ctx: OwnerContext) {
  const receipts = ctx.index.receiptsFor(null, 60).map((r) => ({ kind: "receipt" as const, at: r.createdAt, receipt: r.receipt, verdict: r.verdict, reason: r.reason, payeeId: r.payeeId, address: r.address, amountBaseUnits: r.amountBaseUnits, suiDigest: r.suiDigest, network: r.network }));
  const open = ctx.ledger.recentPayments(60, null).filter((p) => p.state !== "SETTLED" && p.state !== "FAILED").map((p) => ({ kind: "payment" as const, at: p.updatedAt, paymentId: p.id, state: p.state, payeeId: p.payeeId, address: p.address, amountBaseUnits: p.amountBaseUnits, digest: p.digest }));
  return [...receipts, ...open].sort((a, b) => b.at.localeCompare(a.at));
}
