import { REASONS, duePeriods, formatUsdc, scheduleRunKey, type Countersign, type DuePeriod, type PaymentIntent, type PaymentLedger, type ScheduleRecord } from "@countersign/core";
import type { SqlRows } from "@countersign/adapters/sql";
import type { Schedules } from "./schedules.ts";

export const LATE_AFTER_MS = 10 * 60 * 1000;
export const RETRY_AFTER_MS = 60 * 60 * 1000;
export const RECHECK_RESERVED_MS = 5 * 60 * 1000;
const SCHEMA = "CREATE TABLE IF NOT EXISTS schedule_runs (schedule_id TEXT NOT NULL, period TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('RETRYING','REFUSED','DONE','MISSED')), reason TEXT, attempted_at BIGINT NOT NULL, PRIMARY KEY (schedule_id, period))";

type RunState = "RETRYING" | "REFUSED" | "DONE" | "MISSED";
type Run = { readonly state: RunState; readonly attemptedAt: number };
type Timing = { readonly due: DuePeriod; readonly late: boolean; readonly missed: readonly string[] };

export type ScheduleRunDeps = {
  readonly rows: SqlRows;
  readonly engine: Countersign;
  readonly ledger: PaymentLedger;
  readonly schedules: Schedules;
  readonly sendPayment: (paymentId: string) => Promise<PaymentIntent>;
  readonly notify: (text: string) => Promise<void>;
  readonly publicUrl: string | null;
  readonly now: () => number;
};

export class ScheduleRunner {
  readonly #d: ScheduleRunDeps;
  readonly #closed = new Set<string>();
  readonly #notBefore = new Map<string, number>();
  #running: Promise<void> | null = null;

  private constructor(deps: ScheduleRunDeps) {
    this.#d = deps;
  }

  static async open(deps: ScheduleRunDeps): Promise<ScheduleRunner> {
    await deps.rows.exec(SCHEMA);
    return new ScheduleRunner(deps);
  }

  tick(): Promise<void> {
    this.#running ??= this.#tick().finally(() => {
      this.#running = null;
    });
    return this.#running;
  }

  async #tick(): Promise<void> {
    const now = this.#d.now();
    for (const schedule of this.#d.schedules.active()) {
      const due = duePeriods(schedule, new Date(schedule.createdAt), new Date(now));
      const latest = due.at(-1);
      const key = latest ? scheduleRunKey(schedule.scheduleId, latest.period) : null;
      if (!latest || !key || this.#closed.has(key) || (this.#notBefore.get(key) ?? 0) > now) continue;
      await this.#runPeriod(schedule, latest, due.slice(0, -1), now);
    }
  }

  async #runPeriod(schedule: ScheduleRecord, due: DuePeriod, earlier: readonly DuePeriod[], now: number): Promise<void> {
    const runs = await this.#runs(schedule.scheduleId);
    const run = runs.get(due.period);
    if (run && run.state !== "RETRYING") return void this.#closed.add(scheduleRunKey(schedule.scheduleId, due.period));
    if (run && now - run.attemptedAt < RETRY_AFTER_MS) return void this.#notBefore.set(scheduleRunKey(schedule.scheduleId, due.period), run.attemptedAt + RETRY_AFTER_MS);
    const missed = earlier.filter((p) => !runs.has(p.period)).map((p) => p.period);
    for (const period of missed) await this.#d.rows.run("INSERT INTO schedule_runs (schedule_id, period, state, reason, attempted_at) VALUES (?,?,'MISSED',NULL,?) ON CONFLICT (schedule_id, period) DO NOTHING", [schedule.scheduleId, period, now]);
    const timing = { due, late: now - due.dueAt.getTime() > LATE_AFTER_MS, missed };
    const outcome = await this.#d.engine.reserveScheduled(schedule.scheduleId, due.period, schedule.payeeId);
    if (outcome.verdict === "NOT_ACTIVE") return void this.#closed.add(scheduleRunKey(schedule.scheduleId, due.period));
    if (outcome.verdict === "REFUSED") {
      const retryable = REASONS[outcome.reason].retryable;
      await this.#mark(schedule, due.period, retryable ? "RETRYING" : "REFUSED", outcome.reason, now);
      if (!run) await this.#d.notify(`${await this.#title(schedule, due.period)} was not paid: ${REASONS[outcome.reason].message} ${retryable ? "It will be tried again every hour this period." : "It won't be tried again this period."}${this.#lateNote(timing)} Receipt: ${this.#link(outcome.receipt)}`);
      return;
    }
    if (outcome.verdict === "PAY_RESERVED") return this.#finish(schedule, timing, await this.#d.sendPayment(outcome.paymentId));
    if (outcome.payment.state !== "RESERVED") return this.#finish(schedule, timing, outcome.payment);
    const recheck = await this.#d.engine.recheckReserved(outcome.payment);
    if (recheck === "WAIT") return void this.#notBefore.set(scheduleRunKey(schedule.scheduleId, due.period), now + RECHECK_RESERVED_MS);
    if (recheck === "SEND") return this.#finish(schedule, timing, await this.#d.sendPayment(outcome.payment.id));
    const failed = await this.#d.ledger.payment(outcome.payment.id);
    if (failed) await this.#d.engine.recordPaymentOutcome(failed);
    return this.#finish(schedule, timing, failed ?? outcome.payment);
  }

  async #finish(schedule: ScheduleRecord, timing: Timing, payment: PaymentIntent): Promise<void> {
    if (payment.state === "RESERVED" || payment.state === "SENDING") return;
    if (!(await this.#mark(schedule, timing.due.period, "DONE", payment.reason, this.#d.now()))) return;
    const title = await this.#title(schedule, timing.due.period);
    const receipt = this.#link(`rcpt_${payment.id.replace(/^pay_/, "")}`);
    const said = payment.state === "SETTLED"
      ? `${title}: ${formatUsdc(payment.amountBaseUnits)} USDC sent to ${payment.address}.${this.#lateNote(timing)} Receipt: ${receipt}`
      : payment.state === "FAILED"
        ? `${title} failed: ${payment.detail ?? REASONS[payment.reason ?? "PAYMENT_FAILED_ON_CHAIN"].message} It won't run again this period.${this.#lateNote(timing)} Receipt: ${receipt}`
        : `${title}: sent, but the chain hasn't confirmed it yet. It will never be resent; it's checked by digest every minute.${this.#lateNote(timing)} The receipt will be at ${receipt}`;
    await this.#d.notify(said);
  }

  async #title(schedule: ScheduleRecord, period: string): Promise<string> {
    const head = await this.#d.engine.payeeHead(schedule.payeeId);
    return `Scheduled payment to ${head.kind === "verified" ? head.version.name : schedule.payeeId} for ${period}`;
  }

  #lateNote(timing: Timing): string {
    const late = timing.late ? ` It ran late: it was due ${timing.due.dueAt.toISOString().slice(0, 16).replace("T", " ")} UTC and the agent wasn't running then.` : "";
    const missed = timing.missed.length > 0 ? ` Missed while the agent was down and not paid: ${timing.missed.join(", ")}.` : "";
    return late + missed;
  }

  #link(receipt: string): string {
    return `${this.#d.publicUrl ?? ""}/r/${receipt}`;
  }

  async #runs(scheduleId: string): Promise<Map<string, Run>> {
    const rows = await this.#d.rows.all("SELECT period, state, attempted_at FROM schedule_runs WHERE schedule_id = ?", [scheduleId]);
    return new Map(rows.map((row) => [String(row["period"]), { state: String(row["state"]) as RunState, attemptedAt: Number(row["attempted_at"]) }]));
  }

  async #mark(schedule: ScheduleRecord, period: string, state: RunState, reason: string | null, at: number): Promise<boolean> {
    const changed = await this.#d.rows.run("INSERT INTO schedule_runs (schedule_id, period, state, reason, attempted_at) VALUES (?,?,?,?,?) ON CONFLICT (schedule_id, period) DO UPDATE SET state = excluded.state, reason = excluded.reason, attempted_at = excluded.attempted_at WHERE schedule_runs.state = 'RETRYING'", [schedule.scheduleId, period, state, reason, at]);
    if (state !== "RETRYING") this.#closed.add(scheduleRunKey(schedule.scheduleId, period));
    else this.#notBefore.set(scheduleRunKey(schedule.scheduleId, period), at + RETRY_AFTER_MS);
    return changed === 1;
  }
}
