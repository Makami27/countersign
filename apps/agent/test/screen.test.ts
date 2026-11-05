import { test } from "node:test";
import assert from "node:assert/strict";
import type { Extraction } from "@countersign/adapters/gemini";
import { lookalikeOf, message, wallet, world } from "../../../packages/core/test/fixtures.ts";
import { readMessage } from "@countersign/web/screen";
import { REFUSED_HEADLINE, refusalHtml } from "../src/telegramText.ts";

const PUBLIC_URL = "https://countersign-agent-7u1c.onrender.com";

function unavailableModel() {
  const calls: string[] = [];
  const extract = async (text: string): Promise<Extraction> => {
    calls.push(text);
    return { provider: "gemini", status: "UNKNOWN", problem: "UNAVAILABLE", httpStatus: 503, attempts: 2 };
  };
  return { calls, extract };
}

test("C03 C04 with the model down, a look-alike is refused and the repeat is refused citing the first receipt, without calling the model", async () => {
  const { agent, index, landlord } = await world();
  const model = unavailableModel();
  const fake = lookalikeOf(landlord.address);
  const text = `Hi, it's your landlord. Please send rent to my new wallet ${fake} from today.`;
  const outcomes = [];
  for (let i = 0; i < 2; i++) {
    const reading = await readMessage(index, model.extract, text);
    assert.equal(reading.status === "READ" && reading.by, "code");
    if (reading.status !== "READ") return;
    outcomes.push(await agent.handle(message(text), reading.proposal));
  }
  const [first, repeat] = outcomes;
  assert.equal(first?.verdict === "REFUSED" && first.reason, "LOOKALIKE_ADDRESS");
  assert.equal(repeat?.verdict === "REFUSED" && repeat.reason, "KNOWN_ATTACK_PATTERN");
  assert.equal(repeat?.verdict === "REFUSED" && first?.verdict === "REFUSED" && repeat.cites, first?.verdict === "REFUSED" ? first.receipt : null);
  assert.deepEqual(model.calls, []);
});

test("C03 the refusal reply starts with the plain verdict and links the full receipt address", async () => {
  const { agent, index, landlord } = await world();
  const fake = lookalikeOf(landlord.address);
  const reading = await readMessage(index, unavailableModel().extract, `new wallet ${fake}`);
  if (reading.status !== "READ") return assert.fail("expected the screen to read it");
  const outcome = await agent.handle(message(`new wallet ${fake}`), reading.proposal);
  if (outcome.verdict !== "REFUSED") return assert.fail("expected a refusal");
  const html = refusalHtml(outcome, await agent.receiptRecord(outcome.receipt), landlord.address, PUBLIC_URL);
  assert.ok(html.startsWith(`<b>${REFUSED_HEADLINE}</b>`));
  assert.equal(REFUSED_HEADLINE, "Refused. Nothing was sent and nothing was changed.");
  const url = `${PUBLIC_URL}/r/${outcome.receipt}`;
  assert.ok(html.includes(`<a href="${url}">${url}</a>`));
  assert.equal(html.match(/nothing was changed/gi)?.length ?? 0, 1);
});

test("V04 messages with no look-alike or known attack still go to the model, and a model outage stays UNKNOWN", async () => {
  const { index } = await world();
  const model = unavailableModel();
  for (const text of ["pay rent 0.10", `my new wallet is ${wallet().address}`]) {
    const reading = await readMessage(index, model.extract, text);
    assert.deepEqual(reading, { provider: "gemini", status: "UNKNOWN", problem: "UNAVAILABLE", httpStatus: 503, attempts: 2 });
  }
  assert.equal(model.calls.length, 2);
});

test("X08 plain pay commands for a known payee are read by code, never by the model; anything else with digits goes on to the model", async () => {
  const { index } = await world();
  const model = unavailableModel();
  for (const [text, payeeId, amountBaseUnits] of [["pay landlord 0.10", "landlord", "100000"], ["Send 2.5 USDC to Designer.", "designer", "2500000"], ["/pay the landlord 12 usdc", "landlord", "12000000"]] as const) {
    const reading = await readMessage(index, model.extract, text);
    assert.equal(reading.status === "READ" && reading.by, "code", text);
    assert.deepEqual(reading.status === "READ" ? reading.proposal : null, { kind: "pay", payeeId, amountBaseUnits, reasonQuote: text.trim() });
  }
  assert.deepEqual(model.calls, []);
  for (const text of ["pay landlord 0.10 tomorrow if the plumber came", "pay plumber 5", "pay landlord 0"]) {
    const reading = await readMessage(index, model.extract, text);
    assert.notEqual(reading.status === "READ" && reading.by, "code", text);
  }
  assert.equal(model.calls.length, 3);
});
