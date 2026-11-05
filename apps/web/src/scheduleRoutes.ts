import { randomBytes } from "node:crypto";
import type { ServerResponse } from "node:http";
import { z } from "zod";
import { LAST_SCHEDULE_DAY, REASONS, WEEKDAYS, duePeriods, formatUsdc, headOf, usdcToBaseUnits, type ScheduleRecord, type ScheduleTerms } from "@countersign/core";
import { problem, send } from "./http.ts";
import { ownerSigned, proofsOf, verificationsOf, type Granted } from "./ownerGate.ts";
import type { OwnerContext } from "./ownerContext.ts";
import type { ApprovalKind } from "./ownerApprovals.ts";

const TermsInput = z.object({
  payeeId: z.string().min(1).max(80),
  amount: z.string().min(1).max(24),
  every: z.enum(["week", "two_weeks", "month", "year"]),
  day: z.number().int().min(1).max(LAST_SCHEDULE_DAY),
  month: z.number().int().min(1).max(12).nullable().optional(),
  approvals: z.unknown().optional(),
}).strict();
const DeleteInput = z.object({ approvals: z.unknown().optional() }).strict();

type Checked = { readonly ok: true; readonly terms: ScheduleTerms } | { readonly ok: false; readonly status: number; readonly message: string };

async function checkTerms(ctx: OwnerContext, input: Record<string, unknown>): Promise<Checked> {
  const parsed = TermsInput.safeParse(input);
  if (!parsed.success) return { ok: false, status: 400, message: "Give a payee, an amount in USDC, a period (week, two weeks, month or year) and a day (weekday 1 to 7, or day of the month 1 to 28; plus a month for yearly). Nothing was changed." };
  const { payeeId, amount, every, day } = parsed.data;
  const month = parsed.data.month ?? null;
  if ((every === "year") !== (month !== null)) return { ok: false, status: 400, message: "A yearly payment needs a month; other periods don't. Nothing was changed." };
  if ((every === "week" || every === "two_weeks") && day > WEEKDAYS.length) return { ok: false, status: 400, message: "A weekly payment needs a day of the week (1 Monday to 7 Sunday). Nothing was changed." };
  const amountBaseUnits = usdcToBaseUnits(amount.trim());
  if (!amountBaseUnits) return { ok: false, status: 400, message: "Give the amount in USDC, for example 0.10. Nothing was changed." };
  if (headOf(await ctx.index.payeeVersions(payeeId)).kind !== "verified") return { ok: false, status: 409, message: "Only a payee with a verified address can have a scheduled payment. Nothing was changed." };
  if (BigInt(amountBaseUnits) > ctx.settings.values().perPaymentBaseUnits) return { ok: false, status: 422, message: `${REASONS.CAP_EXCEEDED.message} Nothing was changed.` };
  return { ok: true, terms: { payeeId, amountBaseUnits, every, day, month } };
}

function payloadOf(terms: ScheduleTerms, scheduleId: string | null): Record<string, string> {
  const fields = { payee: terms.payeeId, amount: terms.amountBaseUnits, every: terms.every, day: String(terms.day), month: terms.month === null ? "" : String(terms.month) };
  return scheduleId === null ? fields : { ...fields, schedule: scheduleId };
}

export function describeSchedule(terms: ScheduleTerms): string {
  const weekday = WEEKDAYS[terms.day - 1] ?? "";
  const month = new Date(Date.UTC(2000, (terms.month ?? 1) - 1, 1)).toLocaleString("en", { month: "long", timeZone: "UTC" });
  const when = { week: `every ${weekday}`, two_weeks: `every other ${weekday}`, month: `day ${terms.day} of every month`, year: `${terms.day} ${month} every year` }[terms.every];
  return `${formatUsdc(BigInt(terms.amountBaseUnits))} USDC to ${terms.payeeId} on ${when} (UTC)`;
}

function nextDue(schedule: ScheduleRecord, now: number): string | null {
  const ahead = duePeriods(schedule, new Date(Math.max(now, Date.parse(schedule.createdAt))), new Date(now + 400 * 24 * 3600 * 1000));
  return ahead[0]?.dueAt.toISOString() ?? null;
}

async function save(ctx: OwnerContext, res: ServerResponse, draft: Omit<ScheduleRecord, "type" | "ownerId" | "version" | "createdAt" | "approval" | "verifications">, granted: readonly Granted[], notice: string): Promise<void> {
  const [approval] = proofsOf(granted);
  if (!approval) return problem(res, 403, "This needs a signature from your wallet. Nothing was changed.");
  const written = await ctx.schedules.write({ ...draft, approval, verifications: verificationsOf(granted) });
  if (written.status !== "WRITTEN") return problem(res, 503, REASONS.MEMORY_WRITE_UNCONFIRMED.message);
  await ctx.notify(notice);
  return send(res, 200, { schedule: written.record, nextDue: nextDue(written.record, Date.now()) });
}

export async function scheduleRoute(ctx: OwnerContext, res: ServerResponse, method: string, parts: readonly string[], input: Record<string, unknown>): Promise<void> {
  const scheduleId = parts[1] ? decodeURIComponent(parts[1]) : null;
  const existing = scheduleId === null ? null : ctx.schedules.get(scheduleId);
  if (scheduleId !== null && existing?.status !== "ACTIVE") return problem(res, 404, "No scheduled payment with that id.");
  if (method === "DELETE" && existing) {
    if (!DeleteInput.safeParse(input).success) return problem(res, 400, "Nothing was changed.");
    const granted = await ownerSigned(ctx, res, input, "delete_schedule", { schedule: existing.scheduleId });
    if (!granted) return;
    return save(ctx, res, { ...existing, status: "DELETED" }, granted, `Scheduled payment deleted with your wallet's signature: ${describeSchedule(existing)}.`);
  }
  if (method !== (existing ? "PUT" : "POST")) return problem(res, 404, "Not found.");
  const checked = await checkTerms(ctx, input);
  if (!checked.ok) return problem(res, checked.status, checked.message);
  const kind: ApprovalKind = existing ? "change_schedule" : "create_schedule";
  const granted = await ownerSigned(ctx, res, input, kind, payloadOf(checked.terms, existing?.scheduleId ?? null));
  if (!granted) return;
  const id = existing?.scheduleId ?? randomBytes(6).toString("hex");
  return save(ctx, res, { ...checked.terms, scheduleId: id, status: "ACTIVE" }, granted, `Scheduled payment ${existing ? "changed" : "created"} with your wallet's signature: ${describeSchedule(checked.terms)}. Each run re-checks the verified address, your caps and Walrus Memory.`);
}

export function scheduleList(ctx: OwnerContext, now: number) {
  return { schedules: ctx.schedules.active().map((schedule) => ({ schedule, nextDue: nextDue(schedule, now), says: describeSchedule(schedule) })) };
}
