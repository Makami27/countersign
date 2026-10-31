import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changeMessage, payeeNamespace, type Caps, type ChainSighting, type ScheduleTerms } from "@countersign/core";
import { SqliteRows } from "@countersign/adapters/sqlite";
import { PaymentRunner } from "@countersign/adapters/payments";
import type { PaymentChain, Prepared, Submitted } from "../../../../packages/adapters/src/tatum/payments.ts";
import { DEFAULT_CAPS, message, wallet, world } from "../../../../packages/core/test/fixtures.ts";
import { Schedules } from "../../src/schedules.ts";
import { ScheduleRunner } from "../../src/scheduleRuns.ts";

export const DAY_MS = 24 * 3600 * 1000;

export class ScriptedChain implements PaymentChain {
  submits = 0;
  submitted: Submitted = { state: "SENT" };
  async prepare(): Promise<Prepared> {
    return { ok: true, payment: { bytes: new Uint8Array([1]), signature: "sig", digest: `DIGEST${this.submits + 1}`, validUntilEpoch: "100" } };
  }
  async submit(): Promise<Submitted> {
    this.submits += 1;
    return this.submitted;
  }
  async sight(): Promise<ChainSighting> {
    return this.submitted.state === "SENT" ? { kind: "FOUND", success: true, creditedPayee: true } : { kind: "NOT_FOUND", currentEpoch: 90n };
  }
}

export async function scheduleWorld(caps: Caps = DEFAULT_CAPS) {
  const w = await world(caps, "2026-10-30T10:00:00Z", 0);
  const rows = new SqliteRows(join(mkdtempSync(join(tmpdir(), "countersign-schedules-")), "web.sqlite"));
  const now = () => w.clock.now().getTime();
  const schedules = await Schedules.open({ rows, memory: w.memory, signer: w.signer, ownerId: "owner1", now });
  const chain = new ScriptedChain();
  const payments = new PaymentRunner({ ledger: w.payments, chain, clock: w.clock, sleep: async () => undefined });
  const notices: string[] = [];
  const sendPayment = async (id: string) => {
    const paid = await payments.send(id);
    await w.agent.recordPaymentOutcome(paid);
    return paid;
  };
  const runner = () => ScheduleRunner.open({ rows, engine: w.agent, ledger: w.payments, schedules, sendPayment, notify: async (text) => void notices.push(text), publicUrl: "https://example.test", now });
  const schedule = async (terms: Partial<ScheduleTerms> = {}) => {
    const written = await schedules.write({
      scheduleId: `s${Math.random().toString(16).slice(2, 10)}`, payeeId: "landlord", amountBaseUnits: "2000000", every: "month", day: 5, month: null, ...terms,
      status: "ACTIVE", approval: { signer: wallet().address, message: "test approval", signature: "test" }, verifications: [],
    });
    if (written.status !== "WRITTEN") throw new Error("schedule not written");
    return written.record;
  };
  const moveLandlord = async () => {
    const next = wallet();
    const started = await w.agent.handle(message(`new wallet ${next.address}`), { kind: "change_address", payeeId: "landlord", newAddress: next.address, reasonQuote: "x" });
    if (started.verdict !== "CHANGE_STARTED") throw new Error("change did not start");
    const text = changeMessage({ nonce: started.nonce, payeeId: "landlord", fromAddress: started.fromAddress, toAddress: started.toAddress, expires: started.expires });
    const done = await w.agent.completeChange(started.nonce, { kind: "signature", signature: w.landlord.sign(text) }, { kind: "signature", signature: next.sign(text) });
    if (done.verdict !== "CHANGE_VERIFIED") throw new Error("change not verified");
    return next.address;
  };
  const at = (iso: string) => void (w.clock.current = new Date(iso));
  return { ...w, rows, schedules, chain, notices, runner, schedule, moveLandlord, at, landlordSpace: payeeNamespace("owner1", "landlord") };
}
