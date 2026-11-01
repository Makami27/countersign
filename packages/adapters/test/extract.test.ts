import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { extractProposal, type GeminiConfig } from "../src/gemini/extract.ts";

async function fakeModel(status: number | readonly number[], body: unknown, ok: unknown = body): Promise<{ server: Server; config: GeminiConfig; hits: () => number }> {
  let hits = 0;
  const statuses = typeof status === "number" ? [status] : status;
  const server = createServer((_req, res) => {
    const answer = statuses[Math.min(hits, statuses.length - 1)] ?? 200;
    hits += 1;
    res.writeHead(answer, { "content-type": "application/json" }).end(JSON.stringify(answer === 200 ? ok : body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("test server has no port");
  return { server, config: { apiKey: "test-key", model: "test-model", baseUrl: `http://127.0.0.1:${address.port}` }, hits: () => hits };
}

function answer(json: unknown) {
  return { candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }], modelVersion: "test-model-001" };
}

test("X04 a model outage, rate limit or empty answer is UNKNOWN with its HTTP code after one retry at most, never read as 'no proposal'", async () => {
  for (const [status, body, problem, attempts] of [[503, { error: "high demand" }, "UNAVAILABLE", 2], [429, { error: "quota" }, "RATE_LIMITED", 2], [200, { candidates: [] }, "NO_ANSWER", 1]] as const) {
    const { server, config, hits } = await fakeModel(status, body);
    const result = await extractProposal(config, "pay rent 0.10", ["rent"], async () => undefined);
    server.close();
    assert.deepEqual(result, { provider: "gemini", status: "UNKNOWN", problem, httpStatus: status, attempts });
    assert.equal(hits(), attempts);
  }
  const unreachable = await extractProposal({ apiKey: "k", model: "m", baseUrl: "http://127.0.0.1:1" }, "pay rent 0.10", ["rent"]);
  assert.deepEqual(unreachable, { provider: "gemini", status: "UNKNOWN", problem: "NETWORK", httpStatus: null, attempts: 1 });
});

test("X07 a 503 followed by an answer is read on the one retry, after a backoff", async () => {
  const waits: number[] = [];
  const { server, config, hits } = await fakeModel([503, 200], { error: "high demand" }, answer({ kind: "pay", payeeId: "rent", amountText: "0.10", reasonQuote: "pay rent 0.10" }));
  const result = await extractProposal(config, "pay rent 0.10", ["rent"], async (ms) => void waits.push(ms));
  server.close();
  assert.equal(result.status, "READ");
  assert.equal(hits(), 2);
  assert.deepEqual(waits, [2_000]);
});

test("X05 a readable answer is checked by code and reports the model version that actually answered", async () => {
  const { server, config } = await fakeModel(200, answer({ kind: "pay", payeeId: "rent", amountText: "0.10", reasonQuote: "pay rent 0.10" }));
  const result = await extractProposal(config, "pay rent 0.10", ["rent"]);
  server.close();
  assert.deepEqual(result, { provider: "gemini", status: "READ", proposal: { kind: "pay", payeeId: "rent", amountBaseUnits: "100000", reasonQuote: "pay rent 0.10" }, modelVersion: "test-model-001", modelText: JSON.stringify({ kind: "pay", payeeId: "rent", amountText: "0.10", reasonQuote: "pay rent 0.10" }) });
});

test("X06 malformed model text is refused as no proposal, not repaired", async () => {
  const { server, config } = await fakeModel(200, { candidates: [{ content: { parts: [{ text: "{kind: pay, amount: 0.10" }] } }] });
  const result = await extractProposal(config, "pay rent 0.10", ["rent"]);
  server.close();
  assert.deepEqual(result, { provider: "gemini", status: "READ", proposal: { kind: "none" }, modelVersion: null, modelText: "{kind: pay, amount: 0.10" });
});
