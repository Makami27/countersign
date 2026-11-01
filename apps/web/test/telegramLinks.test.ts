import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteRows } from "@countersign/adapters/sqlite";
import { LINK_LIFETIME_MS, TelegramLinks } from "../src/telegramLinks.ts";
import { wallet } from "../../../packages/core/test/fixtures.ts";
import { multiOwnerServer } from "./support/multiOwner.ts";

test("V24 a Telegram link works once, for ten minutes, is stored only hashed, gives one chat per owner, and can't take over the admin's chat", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "countersign-tg-")), "links.sqlite");
  let now = 1_000_000;
  const links = await TelegramLinks.open(new SqliteRows(path), { telegramUserId: 1001, ownerId: "admin1" }, () => now);
  const first = await links.issue("o0123456789");
  assert.equal(readFileSync(path).includes(Buffer.from(first.token)), false);
  assert.deepEqual(await links.redeem(first.token, 1001), { ok: false, why: "ADMIN_CHAT" });
  assert.deepEqual(await links.redeem(first.token, 2002), { ok: true, ownerId: "o0123456789" });
  assert.deepEqual(await links.redeem(first.token, 3003), { ok: false, why: "UNKNOWN" });
  assert.equal(await links.ownerOf(2002), "o0123456789");
  assert.equal(await links.ownerOf(1001), "admin1");
  assert.equal(await links.ownerOf(4004), null);
  const second = await links.issue("o0123456789");
  await links.redeem(second.token, 3003);
  assert.equal(await links.ownerOf(2002), null);
  assert.equal(await links.chatOf("o0123456789"), 3003);
  const late = await links.issue("o0123456789");
  now += LINK_LIFETIME_MS + 1;
  assert.deepEqual(await links.redeem(late.token, 5005), { ok: false, why: "UNKNOWN" });
});

test("V24 a Telegram link made in B's session binds the chat to B only; A's agent never answers B's chat", async (t) => {
  const s = await multiOwnerServer(t);
  await s.as(s.admin);
  const bWallet = wallet();
  const b = await s.as(bWallet);
  const made = await b.call("POST", "/api/app/telegram", {});
  const token = new URL(String(made.body["url"])).searchParams.get("start") ?? "";
  assert.match(token, /^[0-9a-f]{32}$/);
  assert.equal((await s.links.redeem(token, 777)).ok, true);
  assert.equal(await s.links.ownerOf(777), s.ownerOf(bWallet)?.ownerId);
  assert.equal((await b.call("GET", "/api/app/telegram")).body["linked"], true);
  assert.equal(await s.links.chatOf("admin1"), 1001);
});
