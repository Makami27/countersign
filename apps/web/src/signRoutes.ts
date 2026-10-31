import type { IncomingMessage, ServerResponse } from "node:http";
import { REASONS, changeMessage, headOf, onboardingMessage, type ReasonCode, type SignatureCheck } from "@countersign/core";
import { WindowLimiter, clientAddress, problem, readJson, send } from "./http.ts";
import { tryCompleteChange } from "./changeCompletion.ts";
import type { OwnerContext } from "./ownerContext.ts";

const NONCE = /^[0-9A-Za-z_-]{6,64}$/;
const MAX_SIGNATURE_CHARS = 4_096;
const signLimiter = new WindowLimiter(20, 10 * 60 * 1000);

function named(res: ServerResponse, status: number, reason: ReasonCode): void {
  send(res, status, { refusal: { reason, ...REASONS[reason] } });
}

function stepRefusal(check: SignatureCheck): ReasonCode | null {
  switch (check.result) {
    case "VALID": return null;
    case "WRONG_SIGNER": return "WRONG_WALLET";
    case "INVALID": return "SIGNATURE_INVALID";
    case "UNKNOWN": return "CHAIN_UNKNOWN";
    case "UNSUPPORTED": return "NO_CONTINUITY";
  }
}

async function changeView(ctx: OwnerContext, nonce: string, now: number) {
  const change = await ctx.index.pendingChange(nonce);
  if (!change) return null;
  const head = headOf(await ctx.index.payeeVersions(change.payeeId));
  const progress = await ctx.steps.progress(nonce);
  return {
    kind: "change" as const, network: ctx.network, memory: ctx.memory().relayer, payeeName: head.kind === "verified" ? head.version.name : change.payeeId, fromAddress: change.fromAddress, toAddress: change.toAddress,
    message: changeMessage(change), expires: change.expires, expired: Date.parse(change.expires) <= now,
    steps: { current: progress.current ? { signedAt: progress.current.signedAt } : null, next: progress.next ? { signedAt: progress.next.signedAt } : null },
    owner: progress.owner ? { confirmedAt: progress.owner.confirmedAt, readyAt: new Date(Date.parse(progress.owner.confirmedAt) + ctx.cooldownMs()).toISOString() } : null,
  };
}

export async function signRoute(ctx: OwnerContext, req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const nonce = path.slice("/api/sign/".length);
  const now = Date.now();
  if (!NONCE.test(nonce)) return named(res, 404, "NONCE_REUSED");
  const onboarding = await ctx.index.pendingOnboarding(nonce);
  const change = onboarding ? null : await changeView(ctx, nonce, now);
  if (req.method === "GET") {
    if (onboarding) return send(res, 200, { kind: "onboarding", network: ctx.network, memory: ctx.memory().relayer, payeeName: onboarding.name, address: onboarding.address, expires: onboarding.expires, expired: Date.parse(onboarding.expires) <= now, message: onboardingMessage(onboarding) });
    return change ? send(res, 200, change) : named(res, 404, "NONCE_REUSED");
  }
  if (req.method !== "POST") return problem(res, 405, "Not allowed.");
  if (req.headers["x-countersign"] !== "1") return problem(res, 403, "Missing request header. Nothing was changed.");
  if (!signLimiter.allow(clientAddress(req))) return problem(res, 429, "Too many attempts. Nothing was changed. Wait ten minutes.");
  const input = await readJson(req);
  const signature = input?.["signature"];
  const role = input?.["role"];
  if (typeof signature !== "string" || signature.length === 0 || signature.length > MAX_SIGNATURE_CHARS) return problem(res, 400, "Send the signature your wallet produced. Nothing was changed.");

  if (onboarding) {
    if (Date.parse(onboarding.expires) <= now) return named(res, 410, "EXPIRED");
    const outcome = await ctx.engine.completeOnboarding(nonce, { kind: "signature", signature });
    return outcome.verdict === "REFUSED" ? named(res, 422, outcome.reason) : send(res, 200, { outcome });
  }
  if (!change) return named(res, 404, "NONCE_REUSED");
  if (change.expired) return named(res, 410, "EXPIRED");
  if (role !== "current" && role !== "new") return problem(res, 400, "Say which wallet signed: current or new. Nothing was changed.");
  if (role === "current" && change.owner) return problem(res, 409, "The owner already confirmed this change; only the new wallet needs to sign. Nothing was changed.");
  const expected = role === "current" ? change.fromAddress : change.toAddress;
  const refusal = stepRefusal(await ctx.verifySignature(change.message, signature, expected));
  if (refusal) return named(res, 422, refusal);
  await ctx.steps.record(nonce, role, signature, new Date(now).toISOString());
  const completion = await tryCompleteChange(ctx, nonce, now);
  if (completion.state === "COMPLETED" && completion.outcome.verdict === "REFUSED") return named(res, 422, completion.outcome.reason);
  return send(res, 200, { completion, view: await changeView(ctx, nonce, now) });
}
