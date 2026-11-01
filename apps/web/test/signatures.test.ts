import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { scrawlFor, scrawlMarkup } from "../client/scrawl.ts";
import { COUNTER_STROKE } from "../client/wordmark.ts";
import { HERO_ATTEMPT, HERO_ON_FILE } from "../src/landingPage.ts";
import { PUBLIC_DIR, startWebServer } from "../src/server.ts";

const RENT = "0x68f21c9f3d876c7115d8bea271a6fdb53a139f97cae8bfc5bca45b88262b023b";
const RENT_LOOKALIKE = "0x68f215db195f32d32792fc33dad646a3394ad1affe6f243757f4f98d663b023b";

function addressFrom(n: number): string {
  let hex = "";
  let x = n * 2654435761;
  while (hex.length < 64) {
    x = (Math.imul(x ^ (x >>> 15), 2246822507) + n) >>> 0;
    hex += x.toString(16).padStart(8, "0");
  }
  return `0x${hex.slice(0, 64)}`;
}

test("V26 the same address always draws the same signature, whatever its letter case", () => {
  assert.deepEqual(scrawlFor(RENT), scrawlFor(RENT));
  assert.deepEqual(scrawlFor(RENT.toUpperCase().replace("0X", "0x")), scrawlFor(RENT));
  assert.equal(scrawlMarkup(RENT), scrawlMarkup(RENT));
});

test("V26 the look-alike sent for Rent draws a visibly different signature from the one on file", () => {
  const onFile = scrawlFor(RENT);
  const lookalike = scrawlFor(RENT_LOOKALIKE);
  assert.equal(RENT.slice(0, 6), RENT_LOOKALIKE.slice(0, 6));
  assert.equal(RENT.slice(-5), RENT_LOOKALIKE.slice(-5));
  assert.notEqual(onFile.stroke, lookalike.stroke);
  assert.ok(onFile.loops !== lookalike.loops || onFile.tailAngle !== lookalike.tailAngle, "loop count or tail angle must differ");
});

test("V26 every signature is one flowing stroke with 1 to 3 loops, a tail and 1 or 2 dots, drawn from the full address", () => {
  const strokes = new Set<string>();
  for (let n = 1; n <= 300; n++) {
    const s = scrawlFor(addressFrom(n));
    assert.equal(s.stroke.match(/M/g)?.length, 1);
    assert.ok(s.loops >= 1 && s.loops <= 3, `loops ${s.loops}`);
    assert.ok(s.dots.length >= 1 && s.dots.length <= 2, `dots ${s.dots.length}`);
    assert.ok(s.tailAngle >= -26 && s.tailAngle <= 20);
    strokes.add(s.stroke);
  }
  assert.equal(strokes.size, 300);
  const a = addressFrom(7);
  const lastCharChanged = `${a.slice(0, -1)}${a.endsWith("0") ? "1" : "0"}`;
  assert.notEqual(scrawlFor(a).stroke, scrawlFor(lastCharChanged).stroke);
});

test("V26 every page carries the same hand-drawn \"counter\" in its wordmark", async () => {
  for (const page of ["index.html", "app.html", "demo.html", "sign.html"]) {
    const html = await readFile(`${PUBLIC_DIR}${page}`, "utf8");
    assert.ok(html.includes(COUNTER_STROKE) || html.includes("<!--wordmark-->"), page);
  }
});

test("V26 the landing shows Rent's card and the look-alike's signature beside it, drawn on the server with no script, and the measured figures", async (t) => {
  const server = startWebServer({ port: 0, network: "testnet", proof: undefined, version: null, owners: null });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  t.after(() => server.close());
  const page = await (await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`)).text();
  assert.equal(HERO_ON_FILE, RENT);
  assert.equal(HERO_ATTEMPT, RENT_LOOKALIKE);
  assert.ok(page.includes(scrawlFor(RENT).stroke) && page.includes(scrawlFor(RENT_LOOKALIKE).stroke));
  assert.ok(page.includes(COUNTER_STROKE));
  assert.ok(page.includes("Drawn from the address") && page.includes("Nothing was sent and nothing was changed."));
  assert.match(page, /class="g diff"/);
  assert.ok(page.includes("Sandbox, no money moves") && page.includes("Sui testnet"));
  assert.doesNotMatch(page, /<script/);
  assert.doesNotMatch(page, /<!--/);
});
