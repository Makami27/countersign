import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { proofPageHtml } from "../src/proofPage.ts";
import { statusPageHtml } from "../src/statusPage.ts";
import { startWebServer } from "../src/server.ts";
import type { ProofView } from "../src/proof.ts";
import type { StatusView } from "../src/status.ts";

const proof: ProofView = { connected: true, network: "testnet", verifiedPayees: 1, addressChangesVerified: 1, paid: 2, paymentsFailed: 0, refusals: 2, refusalsByReason: [{ reason: "LOOKALIKE_ADDRESS", count: 1 }, { reason: "KNOWN_ATTACK_PATTERN", count: 1 }], recent: [{ receipt: "rcpt_abcd1234", reason: "LOOKALIKE_ADDRESS", at: "2026-10-31T17:05:48.402Z" }] };
const memory = { counts: { realUseMemories: 12, namespaces: 3, byNamespace: [{ suffix: "owner", count: 1 }, { suffix: "payee:rent", count: 5 }, { suffix: "receipts", count: 6 }] }, why: null };
const claims = [{ id: "CL07", claim: "≥10 memories on mainnet from real use", status: "PROVEN", evidence: "`evidence/a02-memory-count.json`" }];

test("V15 /proof shows live counts with their network, refusals by reason linked to receipts, memories per namespace, and the claims ledger", () => {
  const page = proofPageHtml({ proof, memory, claims, measurement: null });
  for (const text of ["Payments paid", "<strong>2</strong>", "Sui testnet with test USDC", "Walrus Memory mainnet relayer", "The new address imitates a known address.", "href=\"/r/rcpt_abcd1234\"", "<code>payee:rent</code></td><td>5", "<strong>12</strong>", "CL07"]) assert.ok(page.includes(text), text);
});

test("V15 the preregistered measurement says it hasn't run and shows no numbers until results exist, then shows them with their denominators", () => {
  const before = proofPageHtml({ proof, memory, claims, measurement: null });
  assert.ok(before.includes("Not run yet."));
  assert.doesNotMatch(before, /per 100<\/td>/);
  const after = proofPageHtml({ proof, memory, claims, measurement: { runAt: "2026-11-07T12:00:00Z", network: "testnet", corpus: "K1–K9", countersign: { attempts: 90, attackerPayments: 0 }, baseline: { attempts: 90, attackerPayments: 31 }, benign: { messages: 50, falseRefusals: 1 } } });
  for (const text of ["<td>90</td><td>0</td><td>0.0 per 100</td>", "<td>90</td><td>31</td><td>34.4 per 100</td>", "1 false refusals out of 50"]) assert.ok(after.includes(text), text);
});

test("V15 a disconnected agent or unreadable memory is said plainly, never shown as zero", () => {
  const page = proofPageHtml({ proof: { connected: false, why: "The live agent's records couldn't be read just now." }, memory: { counts: null, why: "x" }, claims: null, measurement: null });
  assert.ok(page.includes("be read just now"));
  assert.doesNotMatch(page, /Payments paid/);
  const noMemory = proofPageHtml({ proof, memory: { counts: null, why: "Walrus Memory (memory count) took longer than 8 s." }, claims, measurement: null });
  assert.ok(noMemory.includes("Memory counts unavailable: Walrus Memory (memory count) took longer than 8 s."));
});

test("V16 /status names the network, links the deployed commit, says when restore was incomplete, and lists every dependency with its time", () => {
  const view: StatusView = { checkedAt: "2026-11-01T01:00:00.000Z", network: "testnet", version: "753d501d481ec72f78d0caaf0870de1004d66674", restore: { relayer: "mainnet relayer", complete: false, at: null }, checks: [{ name: "Tatum gRPC", ok: true, ms: 120, detail: null }, { name: "Walrus Memory relayer", ok: false, ms: 8000, detail: "no answer within 8 s" }], model: null };
  const page = statusPageHtml(view);
  for (const text of ["Sui testnet (test USDC, no real money)", "/commit/753d501d481ec72f78d0caaf0870de1004d66674", "<code>753d501</code>", "incomplete: payments are blocked", "Tatum gRPC", "120 ms", "no answer within 8 s", "isn't answering"]) assert.ok(page.includes(text), text);
});

test("V15 V16 the pages are served at /proof and /status, and say so when the server isn't connected to the agent", async (t) => {
  const server = startWebServer({ port: 0, network: "testnet", proof: undefined, version: null, owner: null });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const proofPage = await fetch(`${base}/proof`);
  assert.equal(proofPage.status, 200);
  const proofText = await proofPage.text();
  assert.ok(proofText.includes("connected to this page yet") && proofText.includes("Claims ledger"));
  assert.ok((await (await fetch(`${base}/status`)).text()).includes("isn't connected to the live agent"));
});

test("V15 an unfinished measurement is labelled partial with how far it got and why it stopped, never shown as the result", () => {
  const page = proofPageHtml({ proof, memory, claims, measurement: { complete: false, stoppedEarly: "the free-tier daily quota (20 requests) was used", runAt: "2026-11-01T01:49:59Z", network: "testnet", corpus: "K1–K9", countersign: { attempts: 12, attackerPayments: 0 }, baseline: { attempts: 12, attackerPayments: 9 }, benign: { messages: 0, falseRefusals: 0 } } });
  for (const text of ["Partial run.", "12 of 90 attack attempts and 0 of 50 benign messages so far", "free-tier daily quota", "these numbers are not final"]) assert.ok(page.includes(text), text);
});
