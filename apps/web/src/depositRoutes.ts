import type { ServerResponse } from "node:http";
import { z } from "zod";
import { formatUsdc, parseSuiAddress, usdcToBaseUnits } from "@countersign/core";
import { problem, send } from "./http.ts";
import type { OwnerContext } from "./ownerContext.ts";
import { formatSui, suiToBaseUnits } from "../client/walletFacts.ts";

const PrepareInput = z.object({ sender: z.string().max(80), usdc: z.string().max(24).optional(), sui: z.string().max(24).optional() }).strict();
const ConfirmInput = z.object({ digest: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,64}$/) }).strict();

function amountOf(text: string | undefined, parse: (value: string) => string | null): bigint | null {
  const trimmed = text?.trim() ?? "";
  if (trimmed === "") return 0n;
  const base = parse(trimmed);
  return base === null ? null : BigInt(base);
}

async function prepare(ctx: OwnerContext, res: ServerResponse, input: Record<string, unknown>): Promise<void> {
  const parsed = PrepareInput.safeParse(input);
  const sender = parsed.success ? parseSuiAddress(parsed.data.sender) : null;
  if (!parsed.success || !sender) return problem(res, 400, "Connect your wallet and give an amount. Nothing was signed.");
  if (sender === ctx.agentAddress) return problem(res, 400, "That is the agent wallet itself. Connect your own wallet to deposit. Nothing was signed.");
  const usdcBaseUnits = amountOf(parsed.data.usdc, usdcToBaseUnits);
  const suiBaseUnits = amountOf(parsed.data.sui, suiToBaseUnits);
  if (usdcBaseUnits === null || suiBaseUnits === null) return problem(res, 400, "Give amounts as plain numbers, for example 5 or 0.25. Nothing was signed.");
  if (usdcBaseUnits === 0n && suiBaseUnits === 0n) return problem(res, 400, "Give an amount of USDC, SUI or both. Nothing was signed.");
  const prepared = await ctx.deposits.prepare(sender, { usdcBaseUnits, suiBaseUnits });
  if (prepared.ok) return send(res, 200, { transaction: prepared.transaction, to: ctx.agentAddress, sender, usdcBaseUnits, suiBaseUnits, network: ctx.network });
  if (prepared.kind === "UNKNOWN") return problem(res, 503, "Your wallet's balance couldn't be read through Tatum, so the transfer wasn't prepared. Nothing was signed. Try again in a moment.");
  const words = prepared.coin === "USDC"
    ? `Your wallet holds ${formatUsdc(prepared.heldBaseUnits)} USDC and this deposit needs ${formatUsdc(prepared.neededBaseUnits)} USDC.`
    : `Your wallet holds ${formatSui(prepared.heldBaseUnits)} SUI and this deposit needs about ${formatSui(prepared.neededBaseUnits)} SUI, including the network fee.`;
  return problem(res, 422, `${words} Nothing was signed.`);
}

async function confirm(ctx: OwnerContext, res: ServerResponse, input: Record<string, unknown>): Promise<void> {
  const parsed = ConfirmInput.safeParse(input);
  if (!parsed.success) return problem(res, 400, "That isn't a transaction digest. Nothing was changed.");
  const sighting = await ctx.deposits.sight(parsed.data.digest);
  if (sighting.kind !== "CONFIRMED") return send(res, 200, { state: sighting.kind });
  return send(res, 200, { state: "CONFIRMED", usdcBaseUnits: sighting.usdcBaseUnits, suiBaseUnits: sighting.suiBaseUnits, balances: await ctx.balances(true) });
}

export async function depositRoute(ctx: OwnerContext, res: ServerResponse, step: string | undefined, input: Record<string, unknown>): Promise<void> {
  if (step === "prepare") return prepare(ctx, res, input);
  if (step === "confirm") return confirm(ctx, res, input);
  return problem(res, 404, "Not found.");
}
