import type { IncomingMessage, ServerResponse } from "node:http";
import { REASONS, parseSuiAddress, type SignatureCheck, type SuiAddress } from "@countersign/core";
import { WindowLimiter, clientAddress, cookie, problem, readJson, send } from "./http.ts";
import { SESSION_LIFETIME_MS } from "./ownerAuth.ts";
import { CSRF_HEADER, SESSION_COOKIE, sessionCookie } from "./ownerRoutes.ts";
import type { OwnerContext } from "./ownerContext.ts";

const signInLimiter = new WindowLimiter(30, 10 * 60 * 1000);
const NONCE = /^[0-9a-f]{32}$/;
const PENDING_PROBLEMS = {
  UNKNOWN_NONCE: "That sign-in request doesn't exist. Start again.",
  USED: "That sign-in request was already used. Start again.",
  EXPIRED: "That sign-in request expired after 10 minutes. Start again.",
  WRONG_ADDRESS: "That sign-in request was made for a different wallet. Start again.",
} as const;

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

type Owner = { readonly ok: true; readonly ownerId: string } | { readonly ok: false; readonly status: number; readonly message: string };

async function ownerFor(ctx: OwnerContext, address: SuiAddress, message: string, signature: string, check: Extract<SignatureCheck, { result: "VALID" }>): Promise<Owner> {
  const state = ctx.wallets.state();
  if (!state.known) return { ok: false, status: 503, message: `${state.why} You can't sign in until it can be read. Try again shortly.` };
  if (state.current?.address === address) return { ok: true, ownerId: ctx.ownerId };
  if (state.current) return { ok: false, status: 403, message: "This wallet isn't the owner wallet registered with this agent. Sign in with that wallet." };
  const verification = { role: "control" as const, signer: address, scheme: check.scheme, maxEpoch: check.maxEpoch, checkedAtEpoch: check.checkedAtEpoch };
  if ((await ctx.wallets.record(address, "first_registration", [{ signer: address, message, signature }], [verification])) !== "WRITTEN") return { ok: false, status: 503, message: REASONS.MEMORY_WRITE_UNCONFIRMED.message };
  await ctx.notify(`Owner wallet registered by signing in: ${short(address)}. From now on, signing in, adding payees, confirming address changes yourself and loosening limits need this wallet. If this wasn't you, act now.`);
  return { ok: true, ownerId: ctx.ownerId };
}

export async function sessionRoute(ctx: OwnerContext, req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  if (req.headers[CSRF_HEADER] !== "1") return problem(res, 403, "Missing request header. Nothing was changed.");
  if (req.method === "DELETE") {
    await ctx.auth.endSession(cookie(req, SESSION_COOKIE));
    return send(res, 200, { signedOut: true }, sessionCookie("", 0));
  }
  if (req.method !== "POST") return problem(res, 405, "Not allowed.");
  if (!signInLimiter.allow(clientAddress(req))) return problem(res, 429, "Too many sign-in attempts. Wait ten minutes, then try again.");
  const input = await readJson(req);
  const address = parseSuiAddress(String(input?.["address"] ?? ""));
  if (!address) return problem(res, 400, "Connect a Sui wallet first.");
  if (path === "/api/session/challenge") return send(res, 200, { ...(await ctx.auth.challenge(address)), network: ctx.network });
  const nonce = String(input?.["nonce"] ?? "");
  const signature = input?.["signature"];
  if (!NONCE.test(nonce) || typeof signature !== "string" || signature.length === 0 || signature.length > 4096) return problem(res, 400, "Sign the sign-in message with your wallet.");
  const pending = await ctx.auth.pending(address, nonce);
  if (!pending.ok) return problem(res, 401, PENDING_PROBLEMS[pending.problem]);
  const check = await ctx.verifySignature(pending.message, signature, address);
  if (check.result === "UNKNOWN") return problem(res, 503, "Your signature couldn't be checked through Tatum just now. You're not signed in. Try again shortly.");
  if (check.result !== "VALID") return problem(res, 401, check.result === "WRONG_SIGNER" ? "That signature came from a different wallet than the one you connected." : "That signature doesn't verify for the sign-in message.");
  if (!(await ctx.auth.consume(nonce))) return problem(res, 401, PENDING_PROBLEMS.USED);
  const owner = await ownerFor(ctx, address, pending.message, signature, check);
  if (!owner.ok) return problem(res, owner.status, owner.message);
  const session = await ctx.auth.startSession(owner.ownerId, address);
  return send(res, 200, { signedIn: true }, sessionCookie(session.token, Math.floor(SESSION_LIFETIME_MS / 1000)));
}
