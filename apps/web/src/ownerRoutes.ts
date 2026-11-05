import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { REASONS, formatUsdc, headOf, parseSuiAddress, payeeIdFor, type Outcome } from "@countersign/core";
import { usdcToBaseUnits } from "@countersign/core";
import { WindowLimiter, clientAddress, cookie, problem, readJson, send } from "./http.ts";
import { SESSION_LIFETIME_MS } from "./ownerAuth.ts";
import type { OwnerContext } from "./ownerContext.ts";
import type { OwnerDirectory } from "./ownerDirectory.ts";
import { activity, overview, payeeDetail, payeeSummary } from "./ownerViews.ts";
import { tryCompleteChange } from "./changeCompletion.ts";
import { TookTooLong, within } from "./deadline.ts";
import { ownerSigned } from "./ownerGate.ts";
import { ownerWalletRoute } from "./ownerWalletRoutes.ts";
import { scheduleList, scheduleRoute } from "./scheduleRoutes.ts";
import { adminRoute } from "./adminRoutes.ts";
import { pasteRoute } from "./pasteRoute.ts";
import { depositRoute } from "./depositRoutes.ts";
import { BUSY } from "./quota.ts";
import { retractSharedReport } from "./sharedReportRoutes.ts";

export const SESSION_COOKIE = "cs_owner";
export const CSRF_HEADER = "x-countersign";
const writeLimiter = new WindowLimiter(60, 60 * 1000);
const READ_DEADLINE_MS = 20_000;
export const SIGNED_OUT = "You're signed out: your session ended or this browser has none. Sign in with your wallet.";

export function sessionCookie(token: string, maxAgeSeconds: number): Record<string, string> {
  return { "set-cookie": `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}` };
}

function refusalBody(outcome: Outcome) {
  if (outcome.verdict !== "REFUSED") return { outcome };
  return { outcome, refusal: { ...REASONS[outcome.reason], reason: outcome.reason, receipt: outcome.receipt, cites: outcome.cites } };
}

export async function ownerRoute(owners: OwnerDirectory, req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const ctx = await owners.forSession(cookie(req, SESSION_COOKIE));
  if (!ctx) return problem(res, 401, SIGNED_OUT);
  if (req.method !== "GET" && ctx.quota.busy()) return problem(res, 429, BUSY);
  const parts = path.split("/").slice(3);
  if (parts[0] === "admin") return adminRoute(owners, ctx, res, req.method ?? "", parts, req.method === "GET" ? null : await readJson(req));
  if (req.method !== "GET") return ownerRequest(ctx, req, res, path);
  try {
    await within(READ_DEADLINE_MS, `GET ${path}`, ownerRequest(ctx, req, res, path));
  } catch (error) {
    if (!(error instanceof TookTooLong) || res.headersSent) throw error;
    problem(res, 503, `The agent didn't answer within ${READ_DEADLINE_MS / 1000} s. Nothing was changed. Try again in a moment.`);
  }
}

async function ownerRequest(ctx: OwnerContext, req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
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
  if (req.method === "GET" && parts[0] === "schedules") return send(res, 200, scheduleList(ctx, now));
  if (req.method === "GET" && parts[0] === "telegram") return send(res, 200, { linked: await ctx.telegram.linked() });
  if (req.method === "GET" && parts[0] === "settings") return send(res, 200, ctx.settings.values());
  if (req.method === "GET" && parts[0] === "payments" && parts[1]) {
    const payment = await ctx.ledger.payment(parts[1]);
    if (!payment) return problem(res, 404, "No payment with that id.");
    return send(res, 200, { payment, receipt: (await ctx.engine.receiptRecord(`rcpt_${payment.id.replace(/^pay_/, "")}`)) });
  }

  const input = await readJson(req);
  if (!input) return problem(res, 400, "Send a JSON object under 8 KB. Nothing was changed.");
  if (req.method === "POST" && parts[0] === "telegram") {
    const link = await ctx.telegram.link();
    return link ? send(res, 200, link) : problem(res, 503, "The Telegram bot isn't running right now. Nothing was changed. Try again shortly.");
  }
  if (req.method === "POST" && parts[0] === "paste") return pasteRoute(ctx, res, input);
  if (req.method === "POST" && parts[0] === "deposits") return depositRoute(ctx, res, parts[1], input);
  if (parts[0] === "schedules") return scheduleRoute(ctx, res, req.method ?? "", parts, input);
  if (req.method === "POST" && parts[0] === "receipts" && parts[1] && parts[2] === "retract") return retractSharedReport(ctx, res, decodeURIComponent(parts[1]), input);
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
    await ctx.notify(`Limits changed${looser ? " with your wallet's signature" : ""}: ${formatUsdc(updated.values.perPaymentBaseUnits)} USDC per payment, ${formatUsdc(updated.values.perDayBaseUnits)} USDC per day, ${Math.round(updated.values.cooldownSeconds / 3600)} h waiting period.`);
    return send(res, 200, updated.values);
  }
  if (req.method === "POST" && parts[0] === "payees" && parts.length === 1) {
    const name = input["name"];
    const address = input["address"];
    if (typeof name !== "string" || typeof address !== "string") return problem(res, 400, "Give a name and an address. Nothing was added.");
    if (!payeeIdFor(name) || !parseSuiAddress(address)) return problem(res, 400, "Give a short name with letters or digits and a full Sui address (0x and 64 hex characters). Nothing was added, and nothing needs signing.");
    if (!(await ownerSigned(ctx, res, input, "add_payee", { name: name.trim(), address: address.trim().toLowerCase() }))) return;
    const outcome = await ctx.engine.requestOnboarding(name, address, `web:${randomBytes(6).toString("hex")}`);
    if (outcome.verdict === "ONBOARDING_STARTED") await ctx.notify(`Payee "${name.trim()}" was added with your wallet's signature. Nothing can be paid to them until their own wallet signs.`);
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
    const screened = await ctx.engine.screenOwnerConfirmation(nonce);
    if (screened) {
      await ctx.notify(`Refused your confirmation of the address change for ${change.payeeId}: ${REASONS[screened.reason].message} Nothing was changed. Receipt ${screened.receipt}.`);
      return send(res, 422, refusalBody(screened));
    }
    if (!(await ownerSigned(ctx, res, input, "confirm_owner_change", { nonce, payee: change.payeeId, to: change.toAddress }))) return;
    await ctx.steps.confirmByOwner(nonce, `owner:${randomBytes(6).toString("hex")}`, new Date(now).toISOString());
    const readyAt = new Date(now + ctx.cooldownMs()).toISOString();
    await ctx.notify(`You confirmed the address change for ${change.payeeId} to ${change.toAddress} with your wallet. Nothing has changed yet: it can take effect after ${readyAt.slice(0, 16).replace("T", " ")} UTC, once the new wallet signs. If this wasn't you, or the request didn't come from the payee, cancel it now: ${ctx.publicUrl ?? ""}/app/payees/${encodeURIComponent(change.payeeId)}`);
    return send(res, 200, { completion: await tryCompleteChange(ctx, nonce, now) });
  }
  if (req.method === "POST" && parts[0] === "changes" && parts[1] && parts[2] === "cancel") {
    const nonce = parts[1];
    const change = await ctx.index.pendingChange(nonce);
    if (!change) return problem(res, 409, "There is no waiting address change with this link. Nothing was changed.");
    if (!(await ownerSigned(ctx, res, input, "cancel_owner_change", { nonce, payee: change.payeeId, to: change.toAddress }))) return;
    const cancelled = await ctx.engine.cancelChange(nonce);
    if (!cancelled) return problem(res, 409, "This change already finished or expired. Nothing was changed.");
    await ctx.notify(`Address change for ${change.payeeId} to ${change.toAddress} cancelled with your wallet's signature. Payments keep going to ${change.fromAddress}. Receipt ${cancelled.receipt}.`);
    return send(res, 200, refusalBody(cancelled));
  }
  return problem(res, 404, "Not found.");
}
