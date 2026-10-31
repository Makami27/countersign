import { test } from "node:test";
import assert from "node:assert/strict";
import type { Extraction } from "@countersign/adapters/gemini";
import { lookalikeOf, message, wallet, world } from "../../../packages/core/test/fixtures.ts";
import { readMessage } from "../src/screen.ts";
import { REFUSED_HEADLINE, refusalHtml } from "../src/telegramText.ts";

const PUBLIC_URL = "https://countersign-agent-7u1c.onrender.com";

function unavailableModel() {
  const calls: string[] = [];
  const extract = async (text: string): Promise<Extraction> => {
    calls.push(text);
    return { status: "UNKNOWN", problem: "UNAVAILABLE", httpStatus: 503, attempts: 2 };
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
    assert.deepEqual(reading, { status: "UNKNOWN", problem: "UNAVAILABLE", httpStatus: 503, attempts: 2 });
  }
  assert.equal(model.calls.length, 2);
});
