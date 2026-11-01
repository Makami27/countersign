import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { CLAIMS_PATH } from "../src/claims.ts";
import { startWebServer } from "../src/server.ts";

function ledgerRows(): { id: string; status: string; paths: string[] }[] {
  return readFileSync(CLAIMS_PATH, "utf8").split(/\r?\n/).filter((line) => line.startsWith("| CL")).map((line) => {
    const [id = "", , status = "", evidence = ""] = line.split("|").slice(1, -1).map((cell) => cell.trim());
    const paths = [...evidence.matchAll(/`([^`\s]+\/[^`\s]+)`/g)].map((m) => m[1] ?? "").filter((p) => !p.includes("*") && !p.includes("{"));
    return { id, status, paths };
  });
}

test("V15 the landing's proof table is generated from CLAIMS.md: same claims, same statuses, same evidence links", async (t) => {
  const server = startWebServer({ port: 0, network: "testnet", proof: undefined, version: null, owners: null });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const html = await (await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`)).text();
  const rows = [...html.matchAll(/<tr data-claim="([^"]+)" data-status="([^"]+)">(.*?)<\/tr>/g)].map((m) => ({ id: m[1] ?? "", status: (m[2] ?? "").replace(/&#40;/g, "(").replace(/&#41;/g, ")"), html: m[3] ?? "" }));
  const ledger = ledgerRows();
  assert.ok(ledger.length >= 13);
  assert.deepEqual(rows.map((r) => r.id), ledger.map((l) => l.id));
  for (const [i, claim] of ledger.entries()) {
    const row = rows[i];
    assert.ok(row);
    assert.equal(decode(row.status), claim.status, `${claim.id} status`);
    for (const path of claim.paths) assert.ok(row.html.includes(`href="https://github.com/Makami27/countersign/blob/main/${path}"`), `${claim.id} missing link to ${path}`);
  }
});

function decode(text: string): string {
  return text.replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(Number(code)));
}
