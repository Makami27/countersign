import type { IncomingMessage, ServerResponse } from "node:http";
import { REASONS, onboardingMessage } from "@countersign/core";
import { WindowLimiter, clientAddress, problem, readJson, send } from "./http.ts";
import type { OwnerContext } from "./ownerContext.ts";

const NONCE = /^[0-9a-f]{32}$/;
const MAX_SIGNATURE_CHARS = 4_096;
const signLimiter = new WindowLimiter(20, 10 * 60 * 1000);

export async function signRoute(ctx: OwnerContext, req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const nonce = path.slice("/api/sign/".length);
  if (!NONCE.test(nonce)) return problem(res, 404, "This signing link isn't valid. Ask the person who sent it for a new one.");
  const onboarding = ctx.index.pendingOnboarding(nonce);
  if (req.method === "GET") {
    if (!onboarding) return problem(res, 404, "This signing link was already used, has expired, or never existed. Nothing was changed.");
    return send(res, 200, { kind: "onboarding", payeeName: onboarding.name, address: onboarding.address, expires: onboarding.expires, expired: Date.parse(onboarding.expires) <= Date.now(), message: onboardingMessage(onboarding), network: ctx.network });
  }
  if (req.method !== "POST") return problem(res, 405, "Not allowed.");
  if (req.headers["x-countersign"] !== "1") return problem(res, 403, "Missing request header. Nothing was changed.");
  if (!signLimiter.allow(clientAddress(req))) return problem(res, 429, "Too many attempts. Nothing was changed. Wait ten minutes.");
  const input = await readJson(req);
  const signature = input?.["signature"];
  if (typeof signature !== "string" || signature.length === 0 || signature.length > MAX_SIGNATURE_CHARS) return problem(res, 400, "Send the signature your wallet produced. Nothing was changed.");
  const outcome = await ctx.engine.completeOnboarding(nonce, { kind: "signature", signature });
  if (outcome.verdict === "REFUSED") return send(res, 422, { outcome, refusal: { ...REASONS[outcome.reason], reason: outcome.reason } });
  return send(res, 200, { outcome });
}
