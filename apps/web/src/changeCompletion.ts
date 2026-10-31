import type { Outcome } from "@countersign/core";
import type { OwnerContext } from "./ownerContext.ts";

export type Completion = { readonly state: "COMPLETED"; readonly outcome: Outcome } | { readonly state: "WAITING"; readonly waitingFor: "current_wallet" | "new_wallet" | "cooldown"; readonly readyAt: string | null } | { readonly state: "GONE" };

export async function tryCompleteChange(ctx: OwnerContext, nonce: string, now: number): Promise<Completion> {
  const change = ctx.index.pendingChange(nonce);
  if (!change || Date.parse(change.expires) <= now) return { state: "GONE" };
  const progress = ctx.steps.progress(nonce);
  if (!progress.next) return { state: "WAITING", waitingFor: progress.owner || progress.current ? "new_wallet" : "current_wallet", readyAt: null };
  if (progress.current) {
    const outcome = await ctx.engine.completeChange(nonce, { kind: "signature", signature: progress.current.signature }, { kind: "signature", signature: progress.next.signature });
    return { state: "COMPLETED", outcome };
  }
  if (!progress.owner) return { state: "WAITING", waitingFor: "current_wallet", readyAt: null };
  const readyAt = Date.parse(progress.owner.confirmedAt) + ctx.cooldownMs();
  if (readyAt > now) return { state: "WAITING", waitingFor: "cooldown", readyAt: new Date(readyAt).toISOString() };
  const outcome = await ctx.engine.completeChange(nonce, { kind: "owner_confirmed", ownerConfirmationId: progress.owner.confirmationId, confirmedAt: progress.owner.confirmedAt }, { kind: "signature", signature: progress.next.signature });
  return { state: "COMPLETED", outcome };
}

export async function completeReadyChanges(ctx: OwnerContext, now: number): Promise<number> {
  let completed = 0;
  for (const nonce of ctx.steps.ownerConfirmedNonces()) {
    const result = await tryCompleteChange(ctx, nonce, now);
    if (result.state === "COMPLETED") completed += 1;
  }
  return completed;
}
