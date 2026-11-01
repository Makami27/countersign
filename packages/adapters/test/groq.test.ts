import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { extractWithGroq, type GroqConfig, type GroqQuota } from "../src/groq/extract.ts";
import { withFallback, type Extraction } from "../src/model/extraction.ts";

async function fakeGroq(status: number, content: unknown) {
  const server = createServer((_req, res) => {
    res.writeHead(status, { "content-type": "application/json", "x-ratelimit-remaining-requests": "998", "x-ratelimit-limit-requests": "1000", "x-ratelimit-reset-requests": "1m26s" }).end(JSON.stringify(status === 200 ? { model: "openai/gpt-oss-120b", choices: [{ message: { content: JSON.stringify(content) } }] } : { error: { message: "rate limited" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("no port");
  const config: GroqConfig = { apiKey: "k", model: "openai/gpt-oss-120b", baseUrl: `http://127.0.0.1:${address.port}` };
  return { server, config };
}

test("X09 Groq answers go through the same strict check: nulls and a trailing USDC are tolerated, the amount must still stand in the message, and the quota headers are kept", async (t) => {
  const { server, config } = await fakeGroq(200, { kind: "pay", payeeId: "designer", amountText: "2.50 USDC", newAddress: null, reasonQuote: "Please send 2.50 USDC to designer" });
  t.after(() => server.close());
  let quota: GroqQuota | null = null;
  const read = await extractWithGroq(config, "Please send 2.50 USDC to designer", ["landlord", "designer"], (q) => void (quota = q));
  assert.deepEqual(read.status === "READ" ? read.proposal : null, { kind: "pay", payeeId: "designer", amountBaseUnits: "2500000", reasonQuote: "Please send 2.50 USDC to designer" });
  assert.equal(read.provider, "groq");
  assert.deepEqual(quota && { remaining: (quota as GroqQuota).remainingRequests, limit: (quota as GroqQuota).limitRequests }, { remaining: 998, limit: 1000 });
  const invented = await extractWithGroq(config, "Please send rent to designer", ["landlord", "designer"]);
  assert.deepEqual(invented.status === "READ" ? invented.proposal : null, { kind: "none" });
});

test("X09 a Groq 429 falls back to Gemini, and only when both fail is the reading UNKNOWN", async (t) => {
  const { server, config } = await fakeGroq(429, null);
  t.after(() => server.close());
  const groq = (text: string, ids: readonly string[]) => extractWithGroq(config, text, ids);
  const geminiOk = async (): Promise<Extraction> => ({ provider: "gemini", status: "READ", proposal: { kind: "none" }, modelVersion: "g", modelText: "{}" });
  const geminiDown = async (): Promise<Extraction> => ({ provider: "gemini", status: "UNKNOWN", problem: "UNAVAILABLE", httpStatus: 503, attempts: 2 });
  assert.equal((await withFallback(groq, geminiOk)("hello", ["landlord"])).provider, "gemini");
  const both = await withFallback(groq, geminiDown)("hello", ["landlord"]);
  assert.equal(both.status, "UNKNOWN");
  const alone = await groq("hello", ["landlord"]);
  assert.deepEqual(alone.status === "UNKNOWN" ? [alone.provider, alone.problem, alone.httpStatus] : null, ["groq", "RATE_LIMITED", 429]);
});
