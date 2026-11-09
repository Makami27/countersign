import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteRows } from "@countersign/adapters/sqlite";
import { DISCORD_CODE_LIFETIME_MS, DiscordLinks, discordInstalls } from "../src/discordLinks.ts";
import { wallet } from "../../../packages/core/test/fixtures.ts";
import { DISCORD_TEST_APPLICATION_ID, multiOwnerServer } from "./support/multiOwner.ts";
import { ownerServer } from "./support/ownerServer.ts";

const USER_A = "100000000000000001";
const USER_B = "100000000000000002";

async function freshLinks(now: () => number) {
  const path = join(mkdtempSync(join(tmpdir(), "countersign-dc-")), "links.sqlite");
  return { path, links: await DiscordLinks.open(new SqliteRows(path), now) };
}

test("V28 a Discord code works once, for ten minutes, is stored only hashed, accepts dashes and lower case, and gives one Discord account per owner", async () => {
  let now = 1_000_000;
  const { path, links } = await freshLinks(() => now);
  const first = await links.issue("o0123456789");
  assert.match(first.code, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  assert.equal(readFileSync(path).includes(Buffer.from(first.code.replace("-", ""))), false);
  assert.deepEqual(await links.redeem(first.code.toLowerCase(), USER_A), { ok: true, ownerId: "o0123456789" });
  assert.deepEqual(await links.redeem(first.code, USER_B), { ok: false });
  assert.equal(await links.ownerOf(USER_A), "o0123456789");
  assert.equal(await links.ownerOf(USER_B), null);
  const second = await links.issue("o0123456789");
  assert.equal((await links.redeem(second.code.replace("-", " "), USER_B)).ok, true);
  assert.equal(await links.ownerOf(USER_A), null);
  assert.equal(await links.userOf("o0123456789"), USER_B);
  const late = await links.issue("o0123456789");
  now += DISCORD_CODE_LIFETIME_MS + 1;
  assert.deepEqual(await links.redeem(late.code, USER_A), { ok: false });
  assert.deepEqual(await links.redeem("not a code", USER_A), { ok: false });
  assert.deepEqual(await links.redeem((await links.issue("o0123456789")).code, "not-a-user-id"), { ok: false });
});

test("V28 a refused DM keeps the notice for Activity and warns once; a delivered DM clears the warning so the next refusal warns again", async () => {
  const { links } = await freshLinks(() => 2_000_000);
  await links.redeem((await links.issue("o0123456789")).code, USER_A);
  assert.equal(await links.takeDmWarning("o0123456789"), false);
  await links.dmRefused("o0123456789", "Payment sent: 1.00 USDC to Landlord.");
  await links.dmRefused("o0123456789", "Refused a look-alike address.");
  assert.equal(await links.takeDmWarning("o0123456789"), true);
  assert.equal(await links.takeDmWarning("o0123456789"), false);
  assert.deepEqual((await links.undelivered("o0123456789")).map((n) => n.text).sort(), ["Payment sent: 1.00 USDC to Landlord.", "Refused a look-alike address."]);
  await links.dmDelivered("o0123456789");
  await links.dmRefused("o0123456789", "Another notice.");
  assert.equal(await links.takeDmWarning("o0123456789"), true);
  await links.keepUndelivered("o0123456789", "Gateway down.");
  assert.equal(await links.takeDmWarning("o0123456789"), false);
  assert.equal((await links.undelivered("o0999999999")).length, 0);
});

test("V28 the install links ask for no permissions: one adds the app to your account, one to a server", () => {
  const installs = discordInstalls(DISCORD_TEST_APPLICATION_ID);
  assert.equal(installs.account, `https://discord.com/oauth2/authorize?client_id=${DISCORD_TEST_APPLICATION_ID}&integration_type=1&scope=applications.commands`);
  assert.equal(installs.server, `https://discord.com/oauth2/authorize?client_id=${DISCORD_TEST_APPLICATION_ID}&integration_type=0&scope=bot+applications.commands&permissions=0`);
});

test("V28 a Discord code made in B's session binds that Discord account to B only; A's Activity never shows B's missed notices", async (t) => {
  const s = await multiOwnerServer(t);
  const a = await s.as(s.admin);
  const bWallet = wallet();
  const b = await s.as(bWallet);
  const state = await b.call("GET", "/api/app/discord");
  assert.deepEqual(state.body, { enabled: true, linked: false, installs: discordInstalls(DISCORD_TEST_APPLICATION_ID) });
  const made = await b.call("POST", "/api/app/discord", {});
  assert.equal(made.status, 200);
  assert.equal((await s.discordLinks.redeem(String(made.body["code"]), USER_B)).ok, true);
  const bOwner = s.ownerOf(bWallet)?.ownerId ?? "";
  assert.equal(await s.discordLinks.ownerOf(USER_B), bOwner);
  assert.equal((await b.call("GET", "/api/app/discord")).body["linked"], true);
  assert.equal((await a.call("GET", "/api/app/discord")).body["linked"], false);
  assert.equal(await s.discordLinks.userOf("admin1"), null);
  await s.discordLinks.dmRefused(bOwner, "B's private notice");
  assert.ok(JSON.stringify((await b.call("GET", "/api/app/activity")).body).includes("B's private notice"));
  assert.ok(!JSON.stringify((await a.call("GET", "/api/app/activity")).body).includes("B's private notice"));
  assert.equal(((await b.call("GET", "/api/app/overview")).body["checklist"] as { telegram: boolean }).telegram, true);
});

test("V28 with Discord off, Settings says nothing about it and no code can be made; everything else answers", async (t) => {
  const s = await ownerServer(t);
  const get = async (path: string) => fetch(`${s.base}${path}`, { headers: { "x-countersign": "1", cookie: s.cookie } });
  assert.deepEqual(await (await get("/api/app/discord")).json(), { enabled: false, linked: false, installs: null });
  const made = await s.call("POST", "/api/app/discord", {});
  assert.equal(made.status, 503);
  assert.match(String(made.body["error"]), /Discord isn't set up on this agent\. Nothing was changed\./);
  assert.equal((await get("/api/app/overview")).status, 200);
});
