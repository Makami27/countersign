import type { IncomingMessage, ServerResponse } from "node:http";
import { parseSuiAddress } from "@countersign/core";
import { WindowLimiter, clientAddress, cookie, problem, readJson, send } from "./http.ts";
import { SESSION_LIFETIME_MS } from "./ownerAuth.ts";
import { CSRF_HEADER, SESSION_COOKIE, sessionCookie } from "./ownerRoutes.ts";
import type { OwnerDirectory } from "./ownerDirectory.ts";

const signInLimiter = new WindowLimiter(30, 10 * 60 * 1000);
const NONCE = /^[0-9a-f]{32}$/;
const PENDING_PROBLEMS = {
  UNKNOWN_NONCE: "That sign-in request doesn't exist. Start again.",
  USED: "That sign-in request was already used. Start again.",
  EXPIRED: "That sign-in request expired after 10 minutes. Start again.",
  WRONG_ADDRESS: "That sign-in request was made for a different wallet. Start again.",
} as const;

export async function sessionRoute(owners: OwnerDirectory, network: "mainnet" | "testnet", req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const auth = owners.auth;
  const admin = owners.get(owners.adminOwnerId);
  if (!admin) return problem(res, 503, "The agent isn't ready yet. Try again shortly.");
  if (req.headers[CSRF_HEADER] !== "1") return problem(res, 403, "Missing request header. Nothing was changed.");
  if (req.method === "DELETE") {
    await auth.endSession(cookie(req, SESSION_COOKIE));
    return send(res, 200, { signedOut: true }, sessionCookie("", 0));
  }
  if (req.method !== "POST") return problem(res, 405, "Not allowed.");
  if (!signInLimiter.allow(clientAddress(req))) return problem(res, 429, "Too many sign-in attempts. Wait ten minutes, then try again.");
  const input = await readJson(req);
  const address = parseSuiAddress(String(input?.["address"] ?? ""));
  if (!address) return problem(res, 400, "Connect a Sui wallet first.");
  if (path === "/api/session/challenge") return send(res, 200, { ...(await auth.challenge(address)), network });
  const nonce = String(input?.["nonce"] ?? "");
  const signature = input?.["signature"];
  if (!NONCE.test(nonce) || typeof signature !== "string" || signature.length === 0 || signature.length > 4096) return problem(res, 400, "Sign the sign-in message with your wallet.");
  const pending = await auth.pending(address, nonce);
  if (!pending.ok) return problem(res, 401, PENDING_PROBLEMS[pending.problem]);
  const check = await admin.verifySignature(pending.message, signature, address);
  if (check.result === "UNKNOWN") return problem(res, 503, "Your signature couldn't be checked through Tatum just now. You're not signed in. Try again shortly.");
  if (check.result !== "VALID") return problem(res, 401, check.result === "WRONG_SIGNER" ? "That signature came from a different wallet than the one you connected." : "That signature doesn't verify for the sign-in message.");
  if (!(await auth.consume(nonce))) return problem(res, 401, PENDING_PROBLEMS.USED);
  const owner = await owners.signIn(address, pending.message, signature, check);
  if (!owner.ok) return problem(res, owner.status, owner.message);
  const session = await auth.startSession(owner.ownerId, address);
  return send(res, 200, { signedIn: true }, sessionCookie(session.token, Math.floor(SESSION_LIFETIME_MS / 1000)));
}
