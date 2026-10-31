import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { REASONS, formatUsdc, headOf, type Outcome } from "@countersign/core";
import { usdcToBaseUnits } from "@countersign/core";
import { WindowLimiter, clientAddress, cookie, problem, readJson, send } from "./http.ts";
import { SESSION_LIFETIME_MS } from "./ownerAuth.ts";
import type { OwnerContext } from "./ownerContext.ts";
import { activity, overview, payeeDetail, payeeSummary } from "./ownerViews.ts";
import { tryCompleteChange } from "./changeCompletion.ts";
import { TookTooLong, within } from "./deadline.ts";
import { ownerSigned } from "./ownerGate.ts";
import { ownerWalletRoute } from "./ownerWalletRoutes.ts";

export const SESSION_COOKIE = "cs_owner";
export const CSRF_HEADER = "x-countersign";
const loginLimiter = new WindowLimiter(5, 10 * 60 * 1000);
const writeLimiter = new WindowLimiter(60, 60 * 1000);
const READ_DEADLINE_MS = 20_000;
export const SIGNED_OUT = "You're signed out: your session ended or this browser has none. Send /login to the bot for a new code.";

function sessionCookie(token: string, maxAgeSeconds: number): Record<string, string> {
  return { "set-cookie": `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}` };
}

function refusalBody(outcome: Outcome) {
  if (outcome.verdict !== "REFUSED") return { outcome };
  return { outcome, refusal: { ...REASONS[outcome.reason], reason: outcome.reason, receipt: outcome.receipt, cites: outcome.cites } };
}

export async function sessionRoute(ctx: OwnerContext, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.headers[CSRF_HEADER] !== "1") return problem(res, 403, "Missing request header. Nothing was changed.");
  if (req.method === "DELETE") {
    await ctx.auth.endSession(cookie(req, SESSION_COOKIE));
    return send(res, 200, { signedOut: true }, sessionCookie("", 0));
  }
  if (!loginLimiter.allow(clientAddress(req))) return problem(res, 429, "Too many attempts. Wait ten minutes, then ask the bot for a new code.");
  const input = await readJson(req);
  const code = input?.["code"];
  if (typeof code !== "string") return problem(res, 400, "Enter the code the bot sent you.");
  const redeemed = await ctx.auth.redeemCode(code);
  if (!redeemed.ok) return problem(res, 401, "That code is wrong, used or expired. Send /login to the bot for a new one.");
  return send(res, 200, { signedIn: true }, sessionCookie(redeemed.token, Math.floor(SESSION_LIFETIME_MS / 1000)));
}

export async function ownerRoute(ctx: OwnerContext, req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  if (req.method !== "GET") return ownerRequest(ctx, req, res, path);
  try {
    await within(READ_DEADLINE_MS, `GET ${path}`, ownerRequest(ctx, req, res, path));
  } catch (error) {
    if (!(error instanceof TookTooLong) || res.headersSent) throw error;
    problem(res, 503, `The agent didn't answer within ${READ_DEADLINE_MS / 1000} s. Nothing was changed. Try again in a moment.`);
  }
}

async function ownerRequest(ctx: OwnerContext, req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  if (!(await ctx.auth.sessionValid(cookie(req, SESSION_COOKIE)))) return problem(res, 401, SIGNED_OUT);
  const writes = req.method !== "GET";
  if (writes && req.headers[CSRF_HEADER] !== "1") return problem(res, 403, "Missing request header. Nothing was changed.");
  if (writes && !writeLimiter.allow(clientAddress(req))) return problem(res, 429, "Too many requests. Nothing was changed. Wait a minute.");
  const now = Date.now();
  const parts = path.split("/").slice(3);

  if (req.method === "GET" && parts[0] === "overview") return send(res, 200, await overview(ctx, now));
  if (req.method === "GET" && parts[0] === "payees" && parts.length === 1) return send(res, 200, { payees: await Promise.all((await ctx.index.payeeIds()).map((id) => payeeSummary(ctx, id, now))) });
  if (req.method === "GET" && parts[0] === "payees" && parts[1]) {
    const detail = await payeeDetail(ctx, decodeURIComponent(parts[1]), now);
    return detail ? send(res, 200, detail) : problem(res, 404, "No payee with that name.");
  }
  if (req.method === "GET" && parts[0] === "activity") return send(res, 200, { items: await activity(ctx) });
  if (req.method === "GET" && parts[0] === "settings") return send(res, 200, ctx.settings.values());
  if (req.method === "GET" && parts[0] === "payments" && parts[1]) {
    const payment = await ctx.ledger.payment(parts[1]);
    if (!payment) return problem(res, 404, "No payment with that id.");
    return send(res, 200, { payment, receipt: (await ctx.engine.receiptRecord(`rcpt_${payment.id.replace(/^pay_/, "")}`)) });
  }

  const input = await readJson(req);
  if (!input) return problem(res, 400, "Send a JSON object under 8 KB. Nothing was changed.");
  if (req.method === "POST" && parts[0] === "owner" && parts[1] === "wallet") return ownerWalletRoute(ctx, res, parts, input);
  if (req.method === "PUT" && parts[0] === "settings") {
    const wanted = { perPaymentBaseUnits: String(input["perPaymentBaseUnits"] ?? ""), perDayBaseUnits: String(input["perDayBaseUnits"] ?? ""), cooldownSeconds: String(input["cooldownSeconds"] ?? "") };
    const checked = ctx.settings.validate(wanted);
    if (!checked.ok) return problem(res, 400, `${checked.problem} Nothing was changed.`);
    const before = ctx.settings.values();
    const looser = checked.values.perPaymentBaseUnits > before.perPaymentBaseUnits || checked.values.perDayBaseUnits > before.perDayBaseUnits || checked.values.cooldownSeconds < before.cooldownSeconds;
    if (looser && !(await ownerSigned(ctx, res, input, "raise_limits", wanted))) return;
    const updated = await ctx.settings.update(wanted);
    if (!updated.ok) return problem(res, 400, `${updated.problem} Nothing was changed.`);
    await ctx.notify(`Limits changed${looser ? " with your owner wallet's signature" : ""}: ${formatUsdc(updated.values.perPaymentBaseUnits)} USDC per payment, ${formatUsdc(updated.values.perDayBaseUnits)} USDC per day, ${Math.round(updated.values.cooldownSeconds / 3600)} h waiting period.`);
    return send(res, 200, updated.values);
  }
  if (req.method === "POST" && parts[0] === "payees" && parts.length === 1) {
    const name = input["name"];
    const address = input["address"];
    if (typeof name !== "string" || typeof address !== "string") return problem(res, 400, "Give a name and an address. Nothing was added.");
    if (!(await ownerSigned(ctx, res, input, "add_payee", { name: name.trim(), address: address.trim().toLowerCase() }))) return;
    const outcome = await ctx.engine.requestOnboarding(name, address, `web:${randomBytes(6).toString("hex")}`);
    if (outcome.verdict === "ONBOARDING_STARTED") await ctx.notify(`Payee "${name.trim()}" was added with your owner wallet's signature. Nothing can be paid to them until their own wallet signs.`);
    const signUrl = outcome.verdict === "ONBOARDING_STARTED" ? `${ctx.publicUrl ?? ""}/sign/${outcome.nonce}` : null;
    return send(res, outcome.verdict === "REFUSED" ? 422 : 200, { ...refusalBody(outcome), signUrl });
  }
  if (req.method === "POST" && parts[0] === "payments") {
    const payeeId = String(input["payeeId"] ?? "");
    const amountText = String(input["amount"] ?? "").trim();
    const amountBaseUnits = usdcToBaseUnits(amountText);
    if (!amountBaseUnits) return problem(res, 400, "Give the amount in USDC, for example 0.10. Nothing was sent.");
    const head = headOf(await ctx.index.payeeVersions(payeeId));
    if (head.kind !== "verified") return problem(res, 409, "This payee has no verified address. Nothing was sent.");
    if (head.version.address !== input["expectedAddress"]) return problem(res, 409, "The payee's address changed since you opened this screen. Nothing was sent. Reload and check the address again.");
    const text = `Pay ${head.version.name} ${amountText} USDC (owner app)`;
    const outcome = await ctx.engine.handle({ id: `web:${randomBytes(8).toString("hex")}`, channel: "web", from: "owner", text, receivedAt: new Date(now).toISOString() }, { kind: "pay", payeeId, amountBaseUnits, reasonQuote: text });
    if (outcome.verdict !== "PAY_RESERVED") return send(res, 422, refusalBody(outcome));
    void ctx.sendPayment(outcome.paymentId);
    return send(res, 202, { paymentId: outcome.paymentId, message: `Nothing has been sent yet. Sending ${formatUsdc(outcome.amountBaseUnits)} USDC now.` });
  }
  if (req.method === "POST" && parts[0] === "payees" && parts[1] && parts[2] === "changes") {
    const payeeId = decodeURIComponent(parts[1]);
    const address = String(input["address"] ?? "").trim().toLowerCase();
    const text = `Owner requested a new address for ${payeeId}: ${address}`;
    const outcome = await ctx.engine.handle({ id: `web:${randomBytes(8).toString("hex")}`, channel: "web", from: "owner", text, receivedAt: new Date(now).toISOString() }, { kind: "change_address", payeeId, newAddress: address, reasonQuote: text });
    const signUrl = outcome.verdict === "CHANGE_STARTED" ? `${ctx.publicUrl ?? ""}/sign/${outcome.nonce}` : null;
    return send(res, outcome.verdict === "CHANGE_STARTED" ? 200 : 422, { ...refusalBody(outcome), signUrl });
  }
  if (req.method === "POST" && parts[0] === "changes" && parts[1] && parts[2] === "confirm") {
    const nonce = parts[1];
    const change = await ctx.index.pendingChange(nonce);
    if (!change || Date.parse(change.expires) <= now) return send(res, 410, { refusal: { reason: "EXPIRED", ...REASONS.EXPIRED } });
    if (!(await ownerSigned(ctx, res, input, "confirm_owner_change", { nonce, payee: change.payeeId, to: change.toAddress }))) return;
    await ctx.steps.confirmByOwner(nonce, `owner:${randomBytes(6).toString("hex")}`, new Date(now).toISOString());
    await ctx.notify(`You confirmed the address change for ${change.payeeId} with your owner wallet. It can take effect after the waiting period, once the new wallet signs.`);
    return send(res, 200, { completion: await tryCompleteChange(ctx, nonce, now) });
  }
  return problem(res, 404, "Not found.");
}
