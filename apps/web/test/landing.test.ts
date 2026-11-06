import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { startWebServer } from "../src/server.ts";
import { readActs, readTrial, type RecordedAct } from "../src/landingData.ts";
import { monthHtml } from "../src/landingSections.ts";
import { COMPARED_TRIAL, landingHtml } from "../src/landingPage.ts";
import { readMeasurement } from "../src/proofPage.ts";
import { START_STEPS } from "../client/startSteps.ts";
import { countText, sharedSentence } from "../client/liveCounts.ts";

const LINKS = ["https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf", "https://cointelegraph.com/news/address-poisoning-copy-paste-mistake-50m-usdt-loss", "/proof", "/status", "/demo"];

async function landing(t: { after: (fn: () => void) => void }) {
  const server = startWebServer({ port: 0, network: "testnet", proof: undefined, version: null, owners: null });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, page: await (await fetch(`${base}/`)).text() };
}

test("V27 the landing replays Acts 2 and 3 from their evidence files: every check in order, the refusal and the receipt linked to its page", async (t) => {
  const { page } = await landing(t);
  const acts = await readActs();
  for (const act of [acts.refused, acts.repeated]) {
    assert.ok(act);
    assert.ok(page.includes(`href="/r/${act.receipt.receipt}"`), act.receipt.receipt);
    assert.equal(act.receipt.verdict, "REFUSED");
  }
  assert.equal(acts.refused?.receipt.reason, "LOOKALIKE_ADDRESS");
  assert.equal(acts.repeated?.receipt.reason, "KNOWN_ATTACK_PATTERN");
  const replay = page.slice(page.indexOf("data-replay"), page.indexOf("Try it yourself"));
  assert.equal((replay.match(/>Failed</g) ?? []).length, 2);
  assert.equal((replay.match(/>Passed</g) ?? []).length, 5);
  assert.ok(page.includes("Recorded on 31 Oct 2026 on the live agent"));
});

test("V27 the month timeline says its dates are illustrative and links a real receipt for every step", async (t) => {
  const { page } = await landing(t);
  const acts = await readActs();
  assert.ok(page.includes("The dates are illustrative."));
  const month = page.slice(page.indexOf(`<ol class="month">`), page.indexOf(`id="memory"`));
  assert.equal((month.match(/class="month-entry/g) ?? []).length, acts.sharedSecond ? 6 : 5);
  for (const act of [acts.paid, acts.refused, acts.repeated, acts.changed, acts.paidAfter]) assert.ok(act && month.includes(act.receipt.receipt), act?.source ?? "missing act");
  assert.equal(acts.changed?.receipt.address, acts.paidAfter?.receipt.address);
});

test("V27 the two-agent comparison is a real measurement row: the same message, the baseline paid the attacker, Countersign refused it", async (t) => {
  const { page } = await landing(t);
  const trial = await readTrial(COMPARED_TRIAL.attack, COMPARED_TRIAL.trial);
  assert.ok(trial);
  assert.equal(trial.baselinePaidAttacker, true);
  assert.deepEqual(trial.countersign, { verdict: "REFUSED", reason: "LOOKALIKE_ADDRESS" });
  const raw = await readFile("evidence/measurement/raw-2026-11-01T15-11-00-564Z.jsonl", "utf8");
  assert.ok(raw.includes(trial.attacker) && raw.includes(trial.verified));
  assert.ok(page.includes(trial.message));
  assert.ok(page.includes("Trial K4 (look-alike), number 1 of 10"));
  assert.ok(page.includes("nothing was sent on chain"));
});

test("V27 the landing cites its sources, keeps live counters honest and leaves the claims ledger to /proof", async (t) => {
  const { base, page } = await landing(t);
  for (const href of LINKS) assert.ok(page.includes(`href="${href}"`), href);
  for (const live of ["memories", "sharedReports", "sharedAgents"]) assert.match(page, new RegExp(`data-live="${live}">—<`));
  assert.equal((page.match(/<details>/g) ?? []).length, 9);
  assert.doesNotMatch(page, /data-claim=|Every claim with its evidence|Status of everything the agent depends on/);
  const proof = (await (await fetch(`${base}/api/proof`)).json()) as { live: Record<string, unknown> };
  assert.deepEqual(proof.live, { memories: null, sharedAgents: null, sharedReports: null });
});

test("V27 the shared counter says \"No shared reports yet\" at zero, counts agents in plain words, and stays \"—\" when unknown", () => {
  assert.equal(sharedSentence({ memories: 12, sharedAgents: 0, sharedReports: 0 }), "No shared reports yet.");
  assert.equal(sharedSentence({ memories: 12, sharedAgents: 1, sharedReports: 2 }), "Shared scam reports right now: 2, from 1 agent.");
  assert.equal(sharedSentence({ memories: 12, sharedAgents: 3, sharedReports: 4 }), "Shared scam reports right now: 4, from 3 agents.");
  assert.equal(sharedSentence({ memories: null, sharedAgents: null, sharedReports: null }), null);
  assert.equal(countText(null), "—");
});

test("V27 the month shows the two-owner step only when Act 5 holds a real SEEN_BY_OTHER_AGENT refusal", async () => {
  const acts = await readActs();
  const recorded = (reason: string, receipt: string): RecordedAct => ({ source: "evidence/acts/act5/records.json", blobId: null, receipt: { receipt, verdict: "REFUSED", reason, ref: "x", address: null, amountBaseUnits: null, checks: [], createdAt: "2026-11-05T10:00:00.000Z", suiDigest: null } });
  const without = monthHtml({ ...acts, sharedFirst: null, sharedSecond: null });
  assert.doesNotMatch(without, /Another owner gets the same scam/);
  assert.doesNotMatch(monthHtml({ ...acts, sharedFirst: recorded("LOOKALIKE_ADDRESS", "rcpt_a"), sharedSecond: recorded("LOOKALIKE_ADDRESS", "rcpt_b") }), /Another owner gets the same scam/);
  const shown = monthHtml({ ...acts, sharedFirst: recorded("LOOKALIKE_ADDRESS", "rcpt_a"), sharedSecond: recorded("SEEN_BY_OTHER_AGENT", "rcpt_b") });
  assert.ok(shown.includes("Another owner gets the same scam") && shown.includes(`href="/r/rcpt_a"`) && shown.includes(`href="/r/rcpt_b"`));
});

test("U05 the landing FAQ names the two wallets the same way as the app, and no copy says owner wallet", () => {
  const page = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  for (const name of ["Agent wallet: pays your bills (fund this one)", "Your wallet: signs approvals (never pays)"]) assert.ok(page.includes(name), name);
  assert.equal(/owner wallet/i.test(page), false);
});

test("U06 How to start reads the same on the landing and in the checklist, in order", async () => {
  const page = landingHtml(readFileSync(new URL("../public/index.html", import.meta.url), "utf8"), await readMeasurement(), await readActs(), await readTrial(COMPARED_TRIAL.attack, COMPARED_TRIAL.trial));
  const section = page.slice(page.indexOf('id="how-to-start"'));
  const steps = [...section.slice(0, section.indexOf("</ol>")).matchAll(/<li>([^<]+)<\/li>/g)].map((m) => m[1]);
  assert.deepEqual(steps, ["Sign in with your wallet", "Fund your agent wallet (it pays your bills)", "Add a payee and send them the signing link", "They sign once", "Pay or schedule", "Try pasting a scam"]);
  assert.deepEqual(steps, START_STEPS.map((step) => step.label));
  assert.match(readFileSync(new URL("../client/views/dashboard.ts", import.meta.url), "utf8"), /START_STEPS\.map/);
});
