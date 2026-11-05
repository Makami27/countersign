import { test } from "node:test";
import assert from "node:assert/strict";
import { TransactionError } from "@mysten/sui/client";
import type { SuiAddress } from "@countersign/core";
import { USDC_COIN_TYPE, depositTransaction, sightDeposit } from "@countersign/adapters/tatum";
import { wallet } from "../../../packages/core/test/fixtures.ts";
import { formatSui, lowBalances, suiToBaseUnits } from "../client/walletFacts.ts";
import { ownerServer } from "./support/ownerServer.ts";

const SENDER = wallet().address;
const AGENT = wallet().address;
const DIGEST = "5Wg1fYqJ8sV4nK2mR7tP9xB3cD6eH1jL4oQ8uZ2aN5rT";

test("D01 a deposit transaction holds one transfer to the agent wallet and nothing else", () => {
  const data = depositTransaction("testnet", SENDER, AGENT, { usdcBaseUnits: 5_000_000n, suiBaseUnits: 250_000_000n }).getData();
  assert.equal(data.sender, SENDER);
  const kinds = data.commands.map((c) => c.$kind);
  assert.deepEqual(kinds, ["$Intent", "$Intent", "TransferObjects"]);
  const transfer = data.commands[2];
  const address = transfer?.$kind === "TransferObjects" ? transfer.TransferObjects.address : null;
  const input = address?.$kind === "Input" ? data.inputs[address.Input] : null;
  assert.equal(`0x${Buffer.from(input?.$kind === "Pure" ? input.Pure.bytes : "", "base64").toString("hex")}`, AGENT);
  const coins = data.commands.flatMap((c) => (c.$kind === "$Intent" ? [String((c.$Intent.data as { type: string }).type)] : []));
  assert.ok(coins[0]?.endsWith("::usdc::USDC"));
  assert.ok(coins[0]?.startsWith(USDC_COIN_TYPE.testnet.slice(0, 10)));
  assert.equal(coins[1], "gas");
});

test("D01 a deposit of one coin transfers only that coin", () => {
  const data = depositTransaction("testnet", SENDER, AGENT, { usdcBaseUnits: 0n, suiBaseUnits: 1n }).getData();
  assert.deepEqual(data.commands.map((c) => c.$kind), ["$Intent", "TransferObjects"]);
});

function client(changes: readonly { address: string; coinType: string; amount: string }[], kind: "Transaction" | "FailedTransaction" = "Transaction") {
  const body = { balanceChanges: changes };
  return { getTransaction: async () => (kind === "Transaction" ? { $kind: "Transaction", Transaction: body } : { $kind: "FailedTransaction", FailedTransaction: body }) } as unknown as Parameters<typeof sightDeposit>[0];
}

test("D02 confirming a digest reports only what the agent wallet was credited, for the full coin types", async () => {
  const sighting = await sightDeposit(client([
    { address: AGENT, coinType: USDC_COIN_TYPE.testnet, amount: "5000000" },
    { address: AGENT, coinType: "0x2::sui::SUI", amount: "250000000" },
    { address: SENDER, coinType: USDC_COIN_TYPE.testnet, amount: "-5000000" },
    { address: AGENT, coinType: "0xbad::usdc::USDC", amount: "99" },
  ]), "testnet", DIGEST, AGENT as SuiAddress);
  assert.deepEqual(sighting, { kind: "CONFIRMED", usdcBaseUnits: 5_000_000n, suiBaseUnits: 250_000_000n });
});

test("D02 a failed transfer, a digest not found and a gateway error stay distinct", async () => {
  assert.equal((await sightDeposit(client([], "FailedTransaction"), "testnet", DIGEST, AGENT)).kind, "FAILED");
  const notFound = { getTransaction: async () => { throw new TransactionError("notFound", "no such transaction"); } } as unknown as Parameters<typeof sightDeposit>[0];
  assert.equal((await sightDeposit(notFound, "testnet", DIGEST, AGENT)).kind, "NOT_FOUND");
  const down = { getTransaction: async () => { throw new Error("gateway down"); } } as unknown as Parameters<typeof sightDeposit>[0];
  assert.deepEqual(await sightDeposit(down, "testnet", DIGEST, AGENT), { kind: "UNKNOWN", detail: "gateway down" });
});

test("D03 the low-balance warning fires below the next scheduled payment and below about 0.05 SUI", () => {
  const next = { amountBaseUnits: "5000000", nextDue: "2026-12-01T00:00:00Z", payeeId: "rent" };
  assert.deepEqual(lowBalances("5000000", "50000000", next), []);
  assert.deepEqual(lowBalances("4999999", "50000000", next).map((l) => l.coin), ["USDC"]);
  assert.deepEqual(lowBalances("0", "49999999", null).map((l) => l.coin), ["SUI"]);
});

test("D03 SUI amounts parse and show as exact decimals", () => {
  assert.equal(suiToBaseUnits("0.25"), "250000000");
  assert.equal(suiToBaseUnits("0"), null);
  assert.equal(suiToBaseUnits("1.2.3"), null);
  assert.equal(formatSui("1250000000"), "1.25");
  assert.equal(formatSui("50000000"), "0.05");
  assert.equal(formatSui("0"), "0");
});

test("D04 preparing a deposit checks the amounts, passes them on as base units and names the shortfall", async (t) => {
  const s = await ownerServer(t);
  const sender = wallet().address;
  assert.equal((await s.call("POST", "/api/app/deposits/prepare", { sender, usdc: "", sui: "" })).status, 400);
  assert.equal((await s.call("POST", "/api/app/deposits/prepare", { sender, usdc: "lots" })).status, 400);
  assert.equal((await s.call("POST", "/api/app/deposits/prepare", { sender: s.owner.agentAddress, usdc: "1" })).status, 400);
  const ok = await s.call("POST", "/api/app/deposits/prepare", { sender, usdc: "5", sui: "0.25" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body["to"], s.owner.agentAddress);
  assert.deepEqual([ok.body["usdcBaseUnits"], ok.body["suiBaseUnits"]], ["5000000", "250000000"]);
  assert.deepEqual(s.extras.depositCalls.at(-1), { sender, usdcBaseUnits: 5_000_000n, suiBaseUnits: 250_000_000n });
  const short = await s.call("POST", "/api/app/deposits/prepare", { sender, usdc: "999" });
  assert.equal(short.status, 422);
  assert.match(String(short.body["error"]), /holds 1 USDC|holds 1\.00 USDC/);
  assert.match(String(short.body["error"]), /Nothing was signed/);
});

test("D04 confirming a deposit refreshes the balance and answers what the chain says", async (t) => {
  const s = await ownerServer(t);
  assert.equal((await s.call("POST", "/api/app/deposits/confirm", { digest: "not a digest" })).status, 400);
  const confirmed = await s.call("POST", "/api/app/deposits/confirm", { digest: DIGEST });
  assert.deepEqual([confirmed.body["state"], confirmed.body["usdcBaseUnits"]], ["CONFIRMED", "5000000"]);
  const waiting = await s.call("POST", "/api/app/deposits/confirm", { digest: "1".repeat(44) });
  assert.equal(waiting.body["state"], "NOT_FOUND");
});
