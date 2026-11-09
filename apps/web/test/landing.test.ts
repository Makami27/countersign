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
import { GOOGLE_WORDS } from "../client/walletFacts.ts";
import { countText, sharedLine } from "../client/liveCounts.ts";

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

test("V27 V29 the landing replays Act 3 from its evidence file, every check in order, after a one-line Act 2, and links both receipts to their pages", async (t) => {
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
  assert.equal((replay.match(/>Failed</g) ?? []).length, 1);
  assert.equal((replay.match(/>Passed</g) ?? []).length, 2);
  assert.ok(replay.indexOf(`/r/${acts.refused?.receipt.receipt}`) < replay.indexOf("replay-event"), "the first refusal is one line before the main beat");
  assert.ok(replay.includes(`<a href="/r/${acts.refused?.receipt.receipt}">first receipt</a>`));
  assert.ok(page.includes("Recorded on 31 Oct 2026 on the live agent"));
});

test("V27 the month timeline says its dates are illustrative and links a real receipt for every step", async (t) => {
  const { page } = await landing(t);
  const acts = await readActs();
  assert.ok(page.includes("The dates are illustrative."));
  const month = page.slice(page.indexOf(`<ol class="month">`), page.indexOf(`id="memory"`));
  assert.equal((month.match(/class="month-entry/g) ?? []).length, acts.sharedSecond ? 6 : 5);
  for (const act of [acts.refused, acts.repeated, acts.changed, acts.paidAfter]) assert.ok(act && month.includes(`href="/r/${act.receipt.receipt}">Receipt</a>`), act?.source ?? "missing act");
  assert.ok(acts.paid && month.includes(`${acts.paid.source}" rel="noreferrer">Receipt</a>`), "Act 1 links the evidence file that holds its receipt");
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
  assert.equal((page.match(/<details>/g) ?? []).length, 11);
  assert.doesNotMatch(page, /data-claim=|Every claim with its evidence|Status of everything the agent depends on/);
  const proof = (await (await fetch(`${base}/api/proof`)).json()) as { live: Record<string, unknown> };
  assert.deepEqual(proof.live, { memories: null, sharedAgents: null, sharedReports: null });
  assert.deepEqual(((await (await fetch(`${base}/api/live`)).json()) as { live: unknown }).live, proof.live);
});

test("V27 V29 the shared counter is hidden at zero, counts agents in plain words, and stays \"—\" when unknown", async () => {
  assert.deepEqual(sharedLine({ memories: 12, sharedAgents: 0, sharedReports: 0 }), { show: false });
  assert.deepEqual(sharedLine({ memories: 12, sharedAgents: 1, sharedReports: 2 }), { show: true, text: "Shared scam reports right now: 2, from 1 agent." });
  assert.deepEqual(sharedLine({ memories: 12, sharedAgents: 3, sharedReports: 4 }), { show: true, text: "Shared scam reports right now: 4, from 3 agents." });
  assert.equal(sharedLine({ memories: null, sharedAgents: null, sharedReports: null }), null);
  const template = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const zero = landingHtml(template, null, await readActs(), null, { memories: 12, sharedAgents: 0, sharedReports: 0 });
  assert.ok(zero.includes(`<p class="live-line" data-shared-line hidden></p>`));
  assert.ok(zero.includes("A shared report can only stop an address nobody has proven."));
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
  for (const name of ["Agent wallet: pays your bills (fund this one)", "Your wallet: signs approvals and deposits. It never pays bills."]) assert.ok(page.includes(name), name);
  assert.equal(/owner wallet/i.test(page), false);
});

test("U06 How to start reads the same on the landing and in the checklist, in order", async () => {
  const page = landingHtml(readFileSync(new URL("../public/index.html", import.meta.url), "utf8"), await readMeasurement(), await readActs(), await readTrial(COMPARED_TRIAL.attack, COMPARED_TRIAL.trial));
  const section = page.slice(page.indexOf('id="how-to-start"'));
  const steps = [...section.slice(0, section.indexOf("</ol>")).matchAll(/<li>([^<]+)<\/li>/g)].map((m) => m[1]);
  assert.deepEqual(steps, ["Continue with Google", "Fund your agent wallet (it pays your bills)", "Add a payee and send them the signing link", "They sign once", "Pay or schedule", "Try pasting a scam"]);
  assert.deepEqual(steps, START_STEPS.map((step) => step.label));
  assert.match(readFileSync(new URL("../client/views/dashboard.ts", import.meta.url), "utf8"), /START_STEPS\.map/);
});

test("G01 the landing's main button is Continue with Google with another wallet under it, and the FAQ says no crypto wallet is needed", () => {
  const page = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.equal(/Sign in with your wallet/.test(page), false);
  const hero = page.slice(page.indexOf('class="hero-cta"'));
  assert.match(hero, /^class="hero-cta"><a class="btn primary" href="\/app\/login">Continue with Google<\/a>/);
  assert.ok(hero.includes('<a class="cta-other" href="/app/login?other">Use another Sui wallet</a>'));
  assert.ok(page.includes("<summary>Do I need a crypto wallet?</summary><p>No, continue with Google."));
  assert.ok(page.includes(GOOGLE_WORDS));
});

test("G01 the plain words say what signing in does and that the wallet never pays", () => {
  assert.equal(GOOGLE_WORDS, "No crypto wallet needed. Slush makes a free one from your Google account the first time. It signs your approvals. Your agent's own wallet pays the bills.");
});

test("U07 the demo has one name, and the closing section leads with it", async (t) => {
  const { page } = await landing(t);
  assert.equal(/Try to scam it/.test(page), false);
  const closing = page.slice(page.indexOf('id="start"'));
  assert.match(closing, /class="hero-cta"><a class="btn primary" href="\/demo">Try the demo<\/a><a class="btn" href="\/app\/login">Continue with Google<\/a><a class="cta-other" href="\/app\/login\?other">Use another Sui wallet<\/a><\/p>/);
});

test("U07 the comparison, the second case and the source answer use the agreed words", async (t) => {
  const { page } = await landing(t);
  assert.ok(page.includes("Refused the new address. Rent still goes to the one on file."));
  assert.ok(page.includes("The second time, it remembered: refused citing the first receipt."));
  const plain = page.replace(/<[^>]+>/g, "");
  assert.ok(plain.includes("The code is public on GitHub, so you can read and check every rule. It isn't licensed for reuse."));
  assert.doesNotMatch(plain, /open-source licence/);
});

test("V29 under the hero buttons one quiet line states the preregistered result and links to /proof; with no finished run it says nothing", async () => {
  const template = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const measurement = await readMeasurement();
  assert.ok(measurement);
  const page = landingHtml(template, measurement, await readActs(), null);
  const hero = page.slice(page.indexOf(`class="hero-actions"`), page.indexOf("</section>"));
  assert.ok(hero.includes(`<p class="hero-proof"><a href="/proof">${measurement.countersign.attackerPayments} of ${measurement.countersign.attempts} scam attempts paid in our preregistered test.</a></p>`));
  assert.doesNotMatch(landingHtml(template, null, await readActs(), null), /class="hero-proof"/);
});

test("V29 story text shows no raw receipt or blob ids: they are Receipt links", async (t) => {
  const { page } = await landing(t);
  const story = page.slice(page.indexOf(`id="demo"`), page.indexOf(`id="memory"`)).replace(/<[^>]+>/g, "");
  assert.doesNotMatch(story, /rcpt_|blob [A-Za-z0-9]/);
  const month = page.slice(page.indexOf(`<ol class="month">`), page.indexOf(`id="memory"`));
  assert.match(month, /<h3><span class="visually-hidden">The 9th: <\/span>A “new wallet” email with a look-alike address arrives\. Refused\. <span class="month-link"><a href="\/r\/rcpt_[0-9a-f]+">Receipt<\/a><\/span><\/h3>/);
});

test("V29 the hero keeps one button order at every width and the phone header leaves Try the demo to the menu", () => {
  const css = readFileSync(new URL("../public/landing.css", import.meta.url), "utf8");
  assert.ok(!css.includes(".hero-cta .btn:not(.primary) { order"));
  assert.ok(css.includes(".site-actions .signin, .site-actions .demo { display: none; }"));
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.ok(html.includes(`<a class="menu-demo" href="/demo">Try the demo</a>`));
});
