import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Transaction } from "@mysten/sui/transactions";
import type { SuiAddress } from "@countersign/core";
import { SqliteRateGate, TATUM_FREE_TIER_INTERVAL_MS, prepareDeposit, readAgentBalances, sightDeposit, tatumGrpcClient, tatumRateGateName } from "../../src/tatum/index.ts";

const apiKey = process.env["TATUM_API_KEY"] ?? "";
const agentKey = process.env["AGENT_WALLET_PRIVATE_KEY"] ?? "";
const skip = process.env["NETWORK"] === "testnet" && apiKey !== "" && agentKey !== "" ? false : "needs NETWORK=testnet, TATUM_API_KEY and AGENT_WALLET_PRIVATE_KEY in .env";
const gate = new SqliteRateGate(join(mkdtempSync(join(tmpdir(), "countersign-live-")), "gate.sqlite"), tatumRateGateName("testnet"), TATUM_FREE_TIER_INTERVAL_MS);
const grpc = tatumGrpcClient("testnet", apiKey, gate);
const elsewhere = `0x${"e7".repeat(32)}` as SuiAddress;

function sender(): SuiAddress {
  return Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(agentKey).secretKey).toSuiAddress() as SuiAddress;
}

test("D06 live: Tatum prepares a transfer of real coins to the destination, with only coin and transfer commands, and signs nothing", { skip }, async () => {
  const from = sender();
  const held = await readAgentBalances(grpc, "testnet", from);
  assert.equal(held.status, "KNOWN");
  const prepared = await prepareDeposit(grpc, "testnet", from, elsewhere, { usdcBaseUnits: 1n, suiBaseUnits: 1n });
  assert.ok(prepared.ok, JSON.stringify(prepared, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)));
  const data = Transaction.from(prepared.transaction).getData();
  assert.equal(data.sender, from);
  assert.deepEqual([...new Set(data.commands.map((c) => c.$kind))].filter((kind) => !["SplitCoins", "MergeCoins", "TransferObjects", "MoveCall"].includes(kind)), []);
  for (const call of data.commands.flatMap((c) => (c.$kind === "MoveCall" ? [c.MoveCall] : []))) {
    assert.ok(/^0x0+2$/.test(call.package) && call.module === "coin" && ["redeem_funds", "send_funds"].includes(call.function), `${call.module}::${call.function}`);
  }
  const transfers = data.commands.filter((c) => c.$kind === "TransferObjects");
  assert.equal(transfers.length, 1);
  const address = transfers[0]?.TransferObjects?.address;
  const input = address?.$kind === "Input" ? data.inputs[address.Input] : null;
  const bytes = input?.$kind === "Pure" ? input.Pure.bytes : "";
  assert.equal(`0x${Buffer.from(bytes, "base64").toString("hex")}`, elsewhere);
});

test("D06 live: a digest that doesn't exist reads as not found, never as confirmed", { skip }, async () => {
  const sighting = await sightDeposit(grpc, "testnet", "1".repeat(44), elsewhere);
  assert.ok(sighting.kind === "NOT_FOUND" || sighting.kind === "UNKNOWN", sighting.kind);
});
