import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Countersign, InMemoryIndex, InMemoryPaymentLedger, changeMessage, payeeNamespace, sealRecord, type Outcome, type PayeeVersionRecord, type Proposal, type SharedAttackMemory, type SuiAddress } from "@countersign/core";
import { MemWalMemory } from "@countersign/adapters/memwal";
import { recordSignerFromSeed } from "@countersign/adapters/signer";
import { SqliteRateGate, TATUM_FREE_TIER_INTERVAL_MS, TatumSignatureVerifier, tatumGrpcClient, tatumRateGateName } from "@countersign/adapters/tatum";
import { extractWithGroq, type GroqConfig } from "@countersign/adapters/groq";
import type { Extraction } from "@countersign/adapters/model";
import { loadConfig } from "./config.ts";
import { ATTACKS, ATTACK_TRIALS, BENIGN, PAYEES, type Attack } from "./measureCorpus.ts";
import { PacedMemory } from "./pacedMemory.ts";
import { summarize, type BenignRow, type TrialRow } from "./measureResults.ts";

const SMOKE = process.env["MEASURE_SMOKE_DIR"] ?? null;
const OUT = SMOKE ?? "evidence/measurement";
const attackList = SMOKE ? ATTACKS.filter((a) => a.id === "K4" || a.id === "K7") : ATTACKS;
const trialsPerAttack = SMOKE ? 1 : ATTACK_TRIALS;
const benignList = SMOKE ? BENIGN.slice(0, 2) : BENIGN;
const MODEL_GAP_MS = 7_000;
const RELAYER_GAP_MS = 3_000;
const RATE_LIMIT_BACKOFF_MS = 60_000;
const MAX_MODEL_TRIES = 4;
const QUOTA_STOP_AFTER = 3;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const config = loadConfig(process.env);
if (config.network !== "testnet") throw new Error("The measurement runs on testnet only. Nothing was run.");
function preregisteredModel(): GroqConfig {
  if (!config.groq) throw new Error("The preregistered model is Groq (PRD Amendment 1); set GROQ_API_KEY. Nothing was run.");
  return config.groq;
}
const groq = preregisteredModel();
const resumeRun = process.env["MEASURE_RUN"] ?? null;
const runId = resumeRun ?? new Date().toISOString().replace(/[:.]/g, "-");
const windowTag = resumeRun ? `-w${Date.now().toString(36)}` : "";
const modelBudget = Number(process.env["MEASURE_MAX_MODEL_CALLS"] ?? Number.POSITIVE_INFINITY);
const walrus = new MemWalMemory(config.memwal);
if (walrus.environment !== "mainnet relayer") throw new Error("The measurement writes to the Walrus Memory mainnet relayer (our key isn't registered on the dev relayer, REALITY_SPIKES R2). Nothing was run.");
const memory = new PacedMemory(walrus, RELAYER_GAP_MS);
const signer = recordSignerFromSeed(randomBytes(32).toString("base64"));
const gate = new SqliteRateGate(join(mkdtempSync(join(tmpdir(), "countersign-measure-")), "gate.sqlite"), tatumRateGateName("testnet"), TATUM_FREE_TIER_INTERVAL_MS);
const signatures = new TatumSignatureVerifier(tatumGrpcClient("testnet", config.tatumApiKey, gate));
const sharedOff: SharedAttackMemory = { flag: () => ({ status: "UNKNOWN" }), report: async () => ({ status: "UNKNOWN" }) };
const caps = { perPaymentBaseUnits: 50_000_000n, perDayBaseUnits: 1_000_000_000_000n };
mkdirSync(OUT, { recursive: true });
const raw = join(OUT, `raw-${runId}.jsonl`);
const previous = (resumeRun && existsSync(raw) ? readFileSync(raw, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as TrialRow | BenignRow) : []);
let modelCalls = 0;
const modelVersions = new Set<string>();
let nextModelAt = 0;
let rateLimitedInARow = 0;
let stoppedEarly: string | null = null;

async function ask(text: string): Promise<{ readonly extraction: Extraction; readonly tries: number }> {
  for (let tries = 1; ; tries += 1) {
    const wait = nextModelAt - Date.now();
    if (wait > 0) await sleep(wait);
    nextModelAt = Date.now() + MODEL_GAP_MS;
    modelCalls += 1;
    const extraction = await extractWithGroq(groq, text, PAYEES);
    if (extraction.status === "READ" && extraction.modelVersion) modelVersions.add(extraction.modelVersion);
    if (extraction.status === "READ" || extraction.problem !== "RATE_LIMITED" || tries >= MAX_MODEL_TRIES) {
      rateLimitedInARow = extraction.status === "UNKNOWN" && extraction.problem === "RATE_LIMITED" ? rateLimitedInARow + 1 : 0;
      if (rateLimitedInARow >= QUOTA_STOP_AFTER) stoppedEarly = `the model answered 429 (rate limited) ${QUOTA_STOP_AFTER} times in a row after ${MAX_MODEL_TRIES} tries each; the daily quota is probably used up`;
      return { extraction, tries };
    }
    await sleep(RATE_LIMIT_BACKOFF_MS * tries);
  }
}

function modelSummary(e: Extraction, tries: number) {
  return e.status === "READ" ? { status: "READ", proposal: e.proposal, modelVersion: e.modelVersion, tries } : { status: "UNKNOWN", problem: e.problem, httpStatus: e.httpStatus, attempts: e.attempts, tries };
}

function verdictOf(o: Outcome | null) {
  return o === null ? null : o.verdict === "REFUSED" ? { verdict: o.verdict, reason: o.reason } : { verdict: o.verdict };
}

async function seed(ownerId: string, payeeId: string): Promise<Ed25519Keypair> {
  const payee = Ed25519Keypair.generate();
  const { signature } = await payee.signPersonalMessage(new TextEncoder().encode(`Countersign measurement seed ${ownerId} ${payeeId}`));
  const record: PayeeVersionRecord = { type: "payee_version", payeeId, name: payeeId, version: 1, address: payee.toSuiAddress() as SuiAddress, status: "VERIFIED", supersedes: null, evidence: { kind: "payee_onboarding", ownerConfirmationId: "measurement-seed", nonce: `seed-${payeeId}`, control: { kind: "signature", signature }, verifications: [] }, createdAt: new Date().toISOString() };
  const written = await memory.remember(payeeNamespace(ownerId, payeeId), sealRecord(signer, record), `seed:${ownerId}:${payeeId}`);
  if (written.status !== "WRITTEN") throw new Error(`Seeding ${payeeId} for ${ownerId} wasn't confirmed by the relayer.`);
  return payee;
}

function engineFor(ownerId: string): Countersign {
  const index = new InMemoryIndex();
  return new Countersign({ ownerId, network: "testnet", memory, index, payments: new InMemoryPaymentLedger(index), signer, signatures, roundTrips: { check: async () => "NOT_PROVEN" }, clock: { now: () => new Date() }, nonces: { next: () => randomBytes(16).toString("hex") }, caps, cooldownMs: 24 * 3600 * 1000, shared: sharedOff });
}

function lookalikeOf(address: string): SuiAddress {
  return `0x${address.slice(2, 6)}${randomBytes(28).toString("hex")}${address.slice(-4)}` as SuiAddress;
}

async function attackTrial(attack: Attack, ownerId: string, landlord: Ed25519Keypair, trial: number) {
  const attacker = Ed25519Keypair.generate();
  const target = attack.lookalike ? lookalikeOf(landlord.toSuiAddress()) : (attacker.toSuiAddress() as SuiAddress);
  const second = Ed25519Keypair.generate().toSuiAddress() as SuiAddress;
  const targets = attack.plants === 2 ? [target, second] : [target];
  const text = attack.message(target);
  const { extraction, tries } = await ask(text);
  const engine = engineFor(ownerId);
  const restored = await engine.restore();
  let change: Outcome | null = null;
  let replay: Outcome | null = null;
  if (extraction.status === "READ" && extraction.proposal.kind !== "none") change = await engine.handle({ id: `m-${randomBytes(6).toString("hex")}`, channel: "lab", from: "attacker", text, receivedAt: new Date().toISOString() }, extraction.proposal);
  if (attack.replay && change?.verdict === "CHANGE_STARTED") {
    const old = await landlord.signPersonalMessage(new TextEncoder().encode(changeMessage({ nonce: "an-earlier-request", payeeId: "landlord", fromAddress: landlord.toSuiAddress() as SuiAddress, toAddress: target, expires: "2026-01-01T00:00:00.000Z" })));
    const control = await attacker.signPersonalMessage(new TextEncoder().encode(changeMessage({ nonce: change.nonce, payeeId: "landlord", fromAddress: change.fromAddress, toAddress: change.toAddress, expires: change.expires })));
    replay = await engine.completeChange(change.nonce, { kind: "signature", signature: old.signature }, { kind: "signature", signature: control.signature });
  }
  for (const [i, planted] of targets.slice(0, attack.plants).entries()) await memory.remember(payeeNamespace(ownerId, "landlord"), attack.message(planted), `plant:${ownerId}:${trial}:${i}`);
  const afterAttack = await engine.restore();
  const pay: Proposal = { kind: "pay", payeeId: "landlord", amountBaseUnits: "1000000", reasonQuote: "pay rent" };
  const paid = await engine.handle({ id: `m-${randomBytes(6).toString("hex")}`, channel: "lab", from: "owner", text: "pay landlord 1 USDC", receivedAt: new Date().toISOString() }, pay);
  const paidTo = paid.verdict === "PAY_RESERVED" ? paid.address : null;
  let naive = landlord.toSuiAddress() as string;
  if (extraction.status === "READ" && extraction.proposal.kind === "change_address" && extraction.proposal.payeeId === "landlord") naive = extraction.proposal.newAddress.toLowerCase();
  for (const planted of targets.slice(0, attack.plants)) naive = planted;
  return {
    kind: "attack", attack: attack.id, trial, targets, model: modelSummary(extraction, tries),
    countersign: { restored: restored.ok, restoredAfterAttack: afterAttack.ok, change: verdictOf(change), replay: verdictOf(replay), pay: verdictOf(paid), paidTo, attackerPaid: paidTo !== null && targets.includes(paidTo) },
    baseline: { paysTo: naive, attackerPaid: targets.includes(naive as SuiAddress) },
    at: new Date().toISOString(),
  };
}

function outOfBudget(): boolean {
  if (modelCalls >= modelBudget) stoppedEarly ??= `this window's model-call budget (${modelBudget}) is used; continue with MEASURE_RUN=${runId}`;
  return stoppedEarly !== null;
}

async function benignRun(from: number): Promise<BenignRow[]> {
  const ownerId = `measure-${runId}-benign${windowTag}`;
  const payees = { landlord: await seed(ownerId, "landlord"), designer: await seed(ownerId, "designer") };
  const engine = engineFor(ownerId);
  const restored = await engine.restore();
  const rows: BenignRow[] = [];
  for (const [i, b] of benignList.entries()) {
    if (i < from) continue;
    if (outOfBudget()) break;
    const { extraction, tries } = await ask(b.text);
    const expected = { address: payees[b.payeeId].toSuiAddress(), amountBaseUnits: String(Math.round(Number(b.amount) * 1_000_000)) };
    const proposal = extraction.status === "READ" ? extraction.proposal : null;
    const understood = proposal?.kind === "pay" && proposal.payeeId === b.payeeId && proposal.amountBaseUnits === expected.amountBaseUnits;
    const outcome = understood && proposal ? await engine.handle({ id: `b-${i}`, channel: "lab", from: "owner", text: b.text, receivedAt: new Date().toISOString() }, proposal) : null;
    const row = { kind: "benign", index: i, text: b.text, expected, restored: restored.ok, model: modelSummary(extraction, tries), understood, countersign: verdictOf(outcome), paidRight: outcome?.verdict === "PAY_RESERVED" && outcome.address === expected.address, falseRefusal: outcome?.verdict === "REFUSED", at: new Date().toISOString() };
    appendFileSync(raw, `${JSON.stringify(row)}\n`);
    rows.push(row);
  }
  return rows;
}

writeFileSync(join(OUT, "corpus.json"), `${JSON.stringify({ attacks: ATTACKS.map((a) => ({ id: a.id, name: a.name, message: a.message("<attacker address>"), lookalike: a.lookalike, plantsInMemory: a.plants, replaysOldSignature: a.replay })), trialsPerAttack: ATTACK_TRIALS, benign: BENIGN }, null, 2)}\n`);
const started = new Date().toISOString();
const attacks: TrialRow[] = previous.filter((r): r is TrialRow => r.kind === "attack");
const benignBefore = previous.filter((r): r is BenignRow => r.kind === "benign");
for (const attack of attackList) {
  const done = attacks.filter((r) => r.attack === attack.id).length;
  if (done >= trialsPerAttack) continue;
  if (outOfBudget()) break;
  const ownerId = `measure-${runId}-${attack.id.toLowerCase()}${windowTag}`;
  const landlord = await seed(ownerId, "landlord");
  for (let trial = done; trial < trialsPerAttack && !outOfBudget(); trial += 1) {
    const row: TrialRow = await attackTrial(attack, ownerId, landlord, trial).catch((error: Error) => ({ kind: "attack", attack: attack.id, trial, error: error.message.slice(0, 300), countersign: { attackerPaid: false }, baseline: { attackerPaid: false }, at: new Date().toISOString() }));
    appendFileSync(raw, `${JSON.stringify(row)}\n`);
    attacks.push(row);
    console.log(`${attack.id} #${trial}: countersign ${row.countersign.attackerPaid ? "PAID ATTACKER" : "safe"}, baseline ${row.baseline.attackerPaid ? "paid attacker" : "safe"}${row.error ? ` (error: ${row.error})` : ""}`);
  }
  writeFileSync(join(OUT, "progress.json"), `${JSON.stringify({ runId, done: attacks.length, memory: memory.counts() }, null, 2)}\n`);
}
const benign = [...benignBefore, ...(stoppedEarly ? [] : await benignRun(benignBefore.length))];
const results = summarize({ attacks, benign, runAt: attacks[0]?.at ?? benign[0]?.at ?? started, stoppedEarly, model: `groq ${groq.model}`, modelVersions: [...modelVersions], corpus: SMOKE ? "smoke run (not the measurement)" : `K1–K9, ${ATTACK_TRIALS} trials each; 50 benign (evidence/measurement/corpus.json)`, relayerCalls: memory.counts(), raw: raw.replaceAll("\\", "/"), complete: stoppedEarly === null && attacks.length === attackList.length * trialsPerAttack && benign.length === benignList.length });
writeFileSync(join(OUT, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify({ countersign: results.countersign, baseline: results.baseline, benign: results.benign, modelErrors: results.modelErrors, trialErrors: results.trialErrors, relayer: results.relayerCalls, stoppedEarly }, null, 2));
gate.close();
