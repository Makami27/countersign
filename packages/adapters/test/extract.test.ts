import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { extractProposal, type GeminiConfig } from "../src/gemini/extract.ts";

async function fakeModel(status: number, body: unknown): Promise<{ server: Server; config: GeminiConfig }> {
  const server = createServer((_req, res) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body)));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("test server has no port");
  return { server, config: { apiKey: "test-key", model: "test-model", baseUrl: `http://127.0.0.1:${address.port}` } };
}

function answer(json: unknown) {
  return { candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }], modelVersion: "test-model-001" };
}

test("X04 a model outage, rate limit or empty answer is UNKNOWN, never read as 'no proposal'", async () => {
  for (const [status, body, problem] of [[503, { error: "high demand" }, "UNAVAILABLE"], [429, { error: "quota" }, "RATE_LIMITED"], [200, { candidates: [] }, "NO_ANSWER"]] as const) {
    const { server, config } = await fakeModel(status, body);
    const result = await extractProposal(config, "pay rent 0.10", ["rent"]);
    server.close();
    assert.deepEqual(result, { status: "UNKNOWN", problem });
  }
  const unreachable = await extractProposal({ apiKey: "k", model: "m", baseUrl: "http://127.0.0.1:1" }, "pay rent 0.10", ["rent"]);
  assert.deepEqual(unreachable, { status: "UNKNOWN", problem: "NETWORK" });
});

test("X05 a readable answer is checked by code and reports the model version that actually answered", async () => {
  const { server, config } = await fakeModel(200, answer({ kind: "pay", payeeId: "rent", amountText: "0.10", reasonQuote: "pay rent 0.10" }));
  const result = await extractProposal(config, "pay rent 0.10", ["rent"]);
  server.close();
  assert.deepEqual(result, { status: "READ", proposal: { kind: "pay", payeeId: "rent", amountBaseUnits: "100000", reasonQuote: "pay rent 0.10" }, modelVersion: "test-model-001" });
});

test("X06 malformed model text is refused as no proposal, not repaired", async () => {
  const { server, config } = await fakeModel(200, { candidates: [{ content: { parts: [{ text: "{kind: pay, amount: 0.10" }] } }] });
  const result = await extractProposal(config, "pay rent 0.10", ["rent"]);
  server.close();
  assert.deepEqual(result, { status: "READ", proposal: { kind: "none" }, modelVersion: null });
});
