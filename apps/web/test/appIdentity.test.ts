import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { startWebServer, PUBLIC_DIR } from "../src/server.ts";
import type { AddressInfo } from "node:net";

const PAGES = ["index.html", "app.html", "demo.html", "sign.html"];

test("I01 every page names the app and links the favicon, apple-touch-icon and manifest", async () => {
  for (const page of PAGES) {
    const html = await readFile(`${PUBLIC_DIR}${page}`, "utf8");
    for (const tag of ['<meta name="application-name" content="Countersign">', 'href="/favicon.ico"', 'href="/icons/icon-192.png"', 'rel="apple-touch-icon"', 'rel="manifest" href="/site.webmanifest"']) assert.ok(html.includes(tag), `${page}: ${tag}`);
  }
});

test("I01 the icons are real square PNGs at the sizes they claim, served with the right types", async (t) => {
  const server = startWebServer({ port: 0, network: "testnet", proof: undefined, version: null, owners: null });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const [path, size] of [["/icons/icon-192.png", 192], ["/icons/icon-512.png", 512], ["/icons/apple-touch-icon.png", 180]] as const) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("content-type"), "image/png");
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [size, size], path);
  }
  const ico = await fetch(`${base}/favicon.ico`);
  assert.equal(ico.headers.get("content-type"), "image/x-icon");
  const manifestResponse = await fetch(`${base}/site.webmanifest`);
  assert.equal(manifestResponse.headers.get("content-type"), "application/manifest+json");
  const manifest = (await manifestResponse.json()) as { name: string; icons: { sizes: string }[] };
  assert.equal(manifest.name, "Countersign");
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ["192x192", "512x512"]);
});

test("I01 Slush is registered with the app's name, the one thing its SDK sends besides the page URL", async () => {
  const source = await readFile(new URL("../client/signFlow.ts", import.meta.url), "utf8");
  assert.match(source, /APP_NAME = "Countersign"/);
  assert.match(source, /registerSlushWallet\(APP_NAME\)/);
  assert.match(source, /new SlushWallet\(\{ name: APP_NAME/);
});
