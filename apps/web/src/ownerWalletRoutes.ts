import type { ServerResponse } from "node:http";
import { parseSuiAddress } from "@countersign/core";
import { problem, send } from "./http.ts";
import type { OwnerContext } from "./ownerContext.ts";
import { proofsOf, requireApprovals, verificationsOf } from "./ownerGate.ts";

const WRITE_FAILED = "Walrus Memory didn't confirm your wallet's record. Nothing was changed. Try again in a few minutes.";

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export async function ownerWalletRoute(ctx: OwnerContext, res: ServerResponse, parts: readonly string[], input: Record<string, unknown>): Promise<void> {
  const state = ctx.wallets.state();
  if (!state.known) return problem(res, 503, `${state.why} Nothing was changed. Try again shortly.`);
  if (parts[2] === "cancel") {
    if (!state.current || !state.waiting) return problem(res, 409, "There is no waiting change of wallet. Nothing was changed.");
    const granted = await requireApprovals(ctx, res, input, [{ field: "owner", kind: "cancel_owner_wallet_change", payload: { to: state.waiting.address }, signer: state.current.address, role: "continuity" }]);
    if (!granted) return;
    await ctx.wallets.cancelWaiting();
    await ctx.notify(`Owner wallet change to ${short(state.waiting.address)} cancelled with your wallet's signature. Your wallet is still ${short(state.current.address)}.`);
    return send(res, 200, { ownerWallet: ctx.wallets.state() });
  }
  const address = parseSuiAddress(String(input["address"] ?? ""));
  if (!address) return problem(res, 400, "Give a full Sui address (0x and 64 hex characters). Nothing was changed.");
  if (state.current?.address === address) return problem(res, 409, "That is already your wallet. Nothing was changed.");
  const proof = { field: "proof", kind: "register_owner_wallet" as const, payload: { wallet: address }, signer: address, role: "control" as const };
  if (!state.current) {
    const granted = await requireApprovals(ctx, res, input, [proof]);
    if (!granted) return;
    if ((await ctx.wallets.record(address, "first_registration", proofsOf(granted), verificationsOf(granted))) !== "WRITTEN") return problem(res, 503, WRITE_FAILED);
    await ctx.notify(`Owner wallet registered: ${short(address)}. From now on, adding payees, confirming address changes yourself and raising limits need this wallet's signature.`);
    return send(res, 200, { ownerWallet: ctx.wallets.state() });
  }
  if (input["waitInstead"] === true) {
    const granted = await requireApprovals(ctx, res, input, [proof]);
    if (!granted) return;
    const readyAt = await ctx.wallets.wait(address, proofsOf(granted), verificationsOf(granted));
    await ctx.notify(`Warning: someone signed in to your owner app asked to replace your wallet ${short(state.current.address)} with ${short(address)} without the current wallet's signature. It takes effect at ${readyAt} unless you cancel it in Settings with your current wallet.`);
    return send(res, 202, { ownerWallet: ctx.wallets.state() });
  }
  const granted = await requireApprovals(ctx, res, input, [proof, { field: "owner", kind: "change_owner_wallet", payload: { from: state.current.address, to: address }, signer: state.current.address, role: "continuity" }]);
  if (!granted) return;
  if ((await ctx.wallets.record(address, "old_wallet_signed", proofsOf(granted), verificationsOf(granted))) !== "WRITTEN") return problem(res, 503, WRITE_FAILED);
  await ctx.wallets.cancelWaiting();
  await ctx.notify(`Owner wallet replaced: ${short(state.current.address)} signed the change to ${short(address)}.`);
  return send(res, 200, { ownerWallet: ctx.wallets.state() });
}
