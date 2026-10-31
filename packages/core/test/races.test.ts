import { test } from "node:test";
import assert from "node:assert/strict";
import { changeMessage } from "../src/changeMessage.ts";
import type { MemoryRead, MemoryWrite } from "../src/ports.ts";
import type { NewPaymentIntent } from "../src/payments.ts";
import type { PayeeVersionRecord } from "../src/types.ts";
import { DEFAULT_CAPS, ONE_USDC, message, wallet, world } from "./fixtures.ts";

const pay = { kind: "pay", payeeId: "landlord", amountBaseUnits: ONE_USDC, reasonQuote: "pay rent" } as const;
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 2));

test("V07 C01 a payment racing a verified address change pays the head verified when it was reserved, never the old address after the change", async () => {
  const w = await world({ ...DEFAULT_CAPS, perDayBaseUnits: 1_000_000_000n });
  const { agent, index, payments, memory, landlord } = w;
  const next = wallet();
  const started = await agent.handle(message(`my new wallet is ${next.address}`), { kind: "change_address", payeeId: "landlord", newAddress: next.address, reasonQuote: "x" });
  assert.equal(started.verdict, "CHANGE_STARTED");
  if (started.verdict !== "CHANGE_STARTED") return;

  const events: string[] = [];
  const remember = memory.remember.bind(memory);
  const readAll = memory.readAll.bind(memory);
  memory.remember = async (namespace: string, text: string, key: string): Promise<MemoryWrite> => {
    await tick();
    return remember(namespace, text, key);
  };
  memory.readAll = async (namespace: string): Promise<MemoryRead> => {
    await tick();
    return readAll(namespace);
  };
  const put = index.putPayeeVersion.bind(index);
  index.putPayeeVersion = async (record: PayeeVersionRecord) => {
    if (record.status === "VERIFIED") events.push(`head:${record.address}`);
    return put(record);
  };
  const reserve = payments.reservePayment.bind(payments);
  payments.reservePayment = async (intent: NewPaymentIntent, cap: bigint) => {
    const result = await reserve(intent, cap);
    if (result === "RESERVED") events.push(`paid:${intent.address}`);
    return result;
  };

  const text = changeMessage({ nonce: started.nonce, payeeId: "landlord", fromAddress: started.fromAddress, toAddress: started.toAddress, expires: started.expires });
  const outcomes = await Promise.all([
    agent.handle(message("pay rent"), pay),
    agent.completeChange(started.nonce, { kind: "signature", signature: landlord.sign(text) }, { kind: "signature", signature: next.sign(text) }),
    ...Array.from({ length: 6 }, () => agent.handle(message("pay rent"), pay)),
  ]);
  assert.equal(outcomes[1]?.verdict, "CHANGE_VERIFIED");
  const changedAt = events.indexOf(`head:${next.address}`);
  assert.ok(changedAt >= 0);
  events.forEach((event, i) => {
    if (event.startsWith("paid:")) assert.equal(event, `paid:${i < changedAt ? landlord.address : next.address}`);
  });
  const refused = outcomes.filter((o) => o.verdict === "REFUSED");
  assert.ok(refused.every((o) => o.verdict === "REFUSED" && o.reason === "PAYEE_CHANGED"));
});

test("V07 C09 parallel payments through the engine never reserve past the daily cap", async () => {
  const { agent, payments } = await world({ perPaymentBaseUnits: 30_000_000n, perDayBaseUnits: 100_000_000n });
  const outcomes = await Promise.all(Array.from({ length: 12 }, () => agent.handle(message("pay rent"), { ...pay, amountBaseUnits: "30000000" })));
  assert.equal(outcomes.filter((o) => o.verdict === "PAY_RESERVED").length, 3);
  assert.ok((await payments.reservedFor(new Date("2026-10-30T10:00:00Z").toISOString().slice(0, 10))) <= 100_000_000n);
});
