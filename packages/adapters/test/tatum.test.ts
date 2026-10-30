import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { UnaryCall, type MethodInfo, type RpcOptions } from "@protobuf-ts/runtime-rpc";
import type { SuiAddress } from "@countersign/core";
import { SqliteRateGate, rateGateInterceptor, type RateGate } from "../src/tatum/rateGate.ts";
import { TatumGraphql } from "../src/tatum/graphql.ts";
import { TatumSignatureVerifier } from "../src/tatum/signatures.ts";
import { tatumGrpcClient } from "../src/tatum/client.ts";

const OPEN_GATE: RateGate = { acquire: async () => undefined };

function tempDatabase(): string {
  return join(mkdtempSync(join(tmpdir(), "countersign-gate-")), "gate.sqlite");
}

test("V19 the Tatum rate gate spaces calls across two gates sharing one database, as two processes or a restart would", async () => {
  const path = tempDatabase();
  const intervalMs = 40;
  const first = new SqliteRateGate(path, "tatum:testnet", intervalMs);
  const second = new SqliteRateGate(path, "tatum:testnet", intervalMs);
  const started = Date.now();
  for (let i = 0; i < 6; i++) await (i % 2 === 0 ? first : second).acquire();
  const elapsed = Date.now() - started;
  first.close();
  second.close();
  assert.ok(elapsed >= 5 * intervalMs - 5, `six calls took ${elapsed} ms, expected at least ${5 * intervalMs}`);
});

test("V19 every gRPC call made through the Tatum transport waits for the rate gate first", async () => {
  let acquired = 0;
  const counting: RateGate = { acquire: async () => void (acquired += 1) };
  const method = { name: "VerifySignature" } as MethodInfo;
  const next = (m: MethodInfo, input: object, options: RpcOptions) =>
    new UnaryCall(m, options.meta ?? {}, input, Promise.resolve({}), Promise.resolve({ isValid: true }), Promise.resolve({ code: "OK", detail: "" }), Promise.resolve({}));
  const interceptor = rateGateInterceptor(counting);
  assert.ok(interceptor.interceptUnary);
  const call = interceptor.interceptUnary(next, method, {}, {});
  const finished = await call;
  assert.equal(acquired, 1);
  assert.deepEqual(finished.response, { isValid: true });
});

test("V19 the GraphQL adapter reports RATE_LIMITED after three 429 answers and never returns data", async () => {
  let requests = 0;
  const server = createServer((_req, res) => {
    requests += 1;
    res.writeHead(429, { "content-type": "application/json" }).end(JSON.stringify({ statusCode: 429, message: "You have exceeded your limit of 3 requests per second." }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const result = await new TatumGraphql(`http://127.0.0.1:${address.port}/graphql`, "test-key", OPEN_GATE).query("{ chainIdentifier }");
  server.close();
  assert.equal(requests, 3);
  assert.deepEqual(result, { ok: false, kind: "RATE_LIMITED", detail: "429" });
});

test("C08 the Tatum signature verifier reports UNKNOWN, never INVALID, when the gateway cannot be reached", async () => {
  const keypair = new Ed25519Keypair();
  const message = "Countersign payee change v1\npayee:test";
  const { signature } = await keypair.signPersonalMessage(new TextEncoder().encode(message));
  const unreachable = tatumGrpcClient("testnet", "test-key", OPEN_GATE, "127.0.0.1:1");
  const verifier = new TatumSignatureVerifier(unreachable);
  assert.deepEqual(await verifier.verifyPersonalMessage(message, signature, keypair.toSuiAddress() as SuiAddress), { result: "UNKNOWN" });
});
