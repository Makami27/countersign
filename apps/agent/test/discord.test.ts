import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { Extraction } from "@countersign/adapters/model";
import { groupAddress } from "@countersign/web/addressGroups";
import { lookalikeOf, onboard, wallet } from "../../../packages/core/test/fixtures.ts";
import { multiOwnerServer } from "../../web/test/support/multiOwner.ts";
import { chatOwnerOf } from "../src/chat/ownerPort.ts";
import type { Reply } from "../src/chat/conversation.ts";
import { discordHandler, type DiscordCommand } from "../src/discord/handler.ts";
import { DISCORD_COMMANDS } from "../src/discord/words.ts";
import { COMMAND_DEFINITIONS } from "../src/discord/definitions.ts";

const PUBLIC_URL = "https://example.test";
const USER_A = "200000000000000001";
const USER_B = "200000000000000002";
const STRANGER = "200000000000000009";
let interactionCounter = 0;

async function discordWorld(t: TestContext) {
  const s = await multiOwnerServer(t);
  await s.as(s.admin);
  const bWallet = wallet();
  await s.as(bWallet);
  const aCtx = s.ownerOf(s.admin);
  const bCtx = s.ownerOf(bWallet);
  if (!aCtx || !bCtx) throw new Error("owners missing");
  const landlord = wallet();
  await onboard(aCtx.engine, "Landlord", landlord);
  const modelCalls: string[] = [];
  const handler = discordHandler({
    network: "testnet", publicUrl: PUBLIC_URL, answeredByCode: () => undefined,
    extract: async (text): Promise<Extraction> => {
      modelCalls.push(text);
      return { provider: "groq", status: "UNKNOWN", problem: "UNAVAILABLE", httpStatus: null, attempts: 1 };
    },
    ownerFor: async (userId) => {
      const ownerId = await s.discordLinks.ownerOf(userId);
      const ctx = ownerId ? s.owners.get(ownerId) : null;
      return ctx ? chatOwnerOf(ctx) : null;
    },
    redeem: (code, userId) => s.discordLinks.redeem(code, userId),
    takeDmWarning: (ownerId) => s.discordLinks.takeDmWarning(ownerId),
  });
  const run = async (userId: string, name: string, options: Record<string, string> = {}) => {
    const said: Reply[] = [];
    interactionCounter += 1;
    const command: DiscordCommand = { id: `i${interactionCounter}`, userId, name, options, at: new Date().toISOString() };
    await handler.command(command, async (reply) => void said.push(reply));
    return said;
  };
  const press = async (userId: string, data: string) => {
    const said: Reply[] = [];
    await handler.button({ userId, data }, async (reply) => void said.push(reply));
    return said;
  };
  const link = async (userId: string, ownerId: string) => run(userId, "link", { code: (await s.discordLinks.issue(ownerId)).code });
  return { s, aCtx, bCtx, landlord, handler, run, press, link, modelCalls };
}

const texts = (said: readonly Reply[]) => said.map((r) => r.text).join("\n---\n");

test("V28 an unlinked Discord user is told to sign in and connect Discord, and nothing is stored; a bad code changes nothing", async (t) => {
  const w = await discordWorld(t);
  for (const name of ["payees", "balance", "schedules", "cancel", "pay", "check"]) {
    assert.equal(texts(await w.run(STRANGER, name, { payee: "Landlord", amount: "1", message: "pay landlord 1" })), `Sign in at ${PUBLIC_URL}/app, then Connect Discord in Settings.`, name);
  }
  assert.ok(texts(await w.run(STRANGER, "help")).endsWith(`Sign in at ${PUBLIC_URL}/app, then Connect Discord in Settings.`));
  assert.match(texts(await w.run(STRANGER, "link", { code: "ABCDE-FGHJK" })), /^That code expired or was already used\. Nothing was changed\./);
  assert.equal(await w.s.discordLinks.ownerOf(STRANGER), null);
  assert.deepEqual(w.modelCalls, []);
});

test("V28 /link binds the Discord account to the owner who made the code; /payees, /balance, /schedules, /cancel and /help answer for that owner only", async (t) => {
  const w = await discordWorld(t);
  assert.match(texts(await w.link(USER_A, w.aCtx.ownerId)), /^Connected: this Discord account now runs your Countersign agent/);
  await w.link(USER_B, w.bCtx.ownerId);
  const payees = texts(await w.run(USER_A, "payees"));
  assert.ok(payees.includes("**Landlord**: verified, payable"));
  assert.ok(payees.includes(groupAddress(w.landlord.address).groups.map((g) => g.text).join(" ")));
  assert.ok(payees.includes("Pay with /pay <name> <amount>."));
  assert.match(texts(await w.run(USER_B, "payees")), /^No payees yet\./);
  assert.ok(texts(await w.run(USER_A, "balance")).includes("Balance not known right now"));
  assert.match(texts(await w.run(USER_A, "schedules")), /^No scheduled payments\./);
  assert.match(texts(await w.run(USER_A, "cancel")), /^There's no payment waiting for your confirmation\./);
  const help = texts(await w.run(USER_A, "help"));
  for (const c of DISCORD_COMMANDS) assert.ok(help.includes(`/${c.command}: `), c.command);
  for (const words of ["/pay rent 0.10", "/check", "visible only to you", "Telegram and from Discord", "Your wallet: signs approvals and deposits. It never pays bills."]) assert.ok(help.includes(words), words);
});

test("V28 /pay previews the full grouped verified address with Pay and Cancel; Pay sends once and reports the receipt; B's button can never confirm A's payment", async (t) => {
  const w = await discordWorld(t);
  await w.link(USER_A, w.aCtx.ownerId);
  await w.link(USER_B, w.bCtx.ownerId);
  const [preview] = await w.run(USER_A, "pay", { payee: "Landlord", amount: "1" });
  assert.ok(preview?.rich && preview.text.startsWith("Pay **1.00 USDC** to **Landlord** on Sui testnet"));
  assert.ok(preview.text.includes(groupAddress(w.landlord.address).groups.map((g) => g.text).join(" ")));
  const [row] = preview.buttons ?? [];
  assert.deepEqual(row?.map((b) => b.label), ["Pay", "Cancel"]);
  const payData = row?.[0]?.data ?? "";
  assert.match(texts(await w.press(USER_B, payData)), /^This confirmation expired\. Nothing was sent\./);
  assert.match(texts(await w.press(STRANGER, payData)), /^Sign in at /);
  assert.equal((await w.aCtx.ledger.recentPayments(10, null)).length, 0);
  const paid = texts(await w.press(USER_A, payData));
  assert.ok(paid.includes("Nothing has been sent yet. Sending 1.00 USDC"));
  assert.ok(paid.includes("Sent 1.00 USDC to"));
  assert.ok(paid.includes(`Receipt: ${PUBLIC_URL}/r/rcpt_`));
  assert.match(texts(await w.press(USER_A, payData)), /^This confirmation expired\./);
  assert.equal((await w.aCtx.ledger.recentPayments(10, null)).length, 1);
});

test("V28 /cancel and the Cancel button drop a waiting payment; B can't pay A's payee by name", async (t) => {
  const w = await discordWorld(t);
  await w.link(USER_A, w.aCtx.ownerId);
  await w.link(USER_B, w.bCtx.ownerId);
  await w.run(USER_A, "pay", { payee: "Landlord", amount: "1" });
  assert.match(texts(await w.run(USER_A, "cancel")), /^Cancelled the payment waiting for your confirmation\. Nothing was sent\./);
  const [preview] = await w.run(USER_A, "pay", { payee: "Landlord", amount: "2" });
  const cancel = preview?.buttons?.[0]?.[1]?.data ?? "";
  assert.equal(texts(await w.press(USER_A, cancel)), "Cancelled. Nothing was sent.");
  const fromB = await w.run(USER_B, "pay", { payee: "Landlord", amount: "1" });
  assert.ok(fromB.every((r) => !r.buttons));
  assert.equal((await w.aCtx.ledger.recentPayments(10, null)).length, 0);
  assert.deepEqual(await w.handler.payeeChoices(USER_B, "land"), []);
  assert.deepEqual(await w.handler.payeeChoices(USER_A, "land"), [{ name: "Landlord", value: "Landlord" }]);
  assert.deepEqual(await w.handler.payeeChoices(STRANGER, ""), []);
});

test("V28 /check runs the same checks as pasting a message: a look-alike is refused by code, with the receipt, and the model is never asked", async (t) => {
  const w = await discordWorld(t);
  await w.link(USER_A, w.aCtx.ownerId);
  const fake = lookalikeOf(w.landlord.address);
  const [refusal] = await w.run(USER_A, "check", { message: `Hi, it's your landlord. New wallet from today: ${fake}` });
  assert.ok(refusal?.rich && refusal.text.startsWith("**Refused. Nothing was sent and nothing was changed.**"));
  assert.ok(refusal.text.includes("__") && refusal.text.includes(`Receipt: ${PUBLIC_URL}/r/rcpt_`));
  assert.deepEqual(w.modelCalls, []);
});

test("V28 after Discord refused a DM, the next command reply says so once and points to Activity", async (t) => {
  const w = await discordWorld(t);
  await w.link(USER_A, w.aCtx.ownerId);
  await w.s.discordLinks.dmRefused(w.aCtx.ownerId, "Payment sent.");
  const first = texts(await w.run(USER_A, "schedules"));
  assert.ok(first.includes("I couldn't send you a notice by DM: Discord refused it."));
  assert.ok(first.includes(`${PUBLIC_URL}/app/activity`));
  assert.ok(!texts(await w.run(USER_A, "schedules")).includes("couldn't send you a notice"));
});

test("V28 every slash command installs to servers and to user accounts, works in servers, DMs and group DMs, and needs only the options it uses", () => {
  assert.deepEqual(COMMAND_DEFINITIONS.map((c) => c.name).sort(), DISCORD_COMMANDS.map((c) => c.command).sort());
  for (const c of COMMAND_DEFINITIONS) {
    assert.deepEqual(c.integration_types, [0, 1]);
    assert.deepEqual(c.contexts, [0, 1, 2]);
    assert.ok(c.description.length <= 100, c.name);
  }
  assert.deepEqual(COMMAND_DEFINITIONS.find((c) => c.name === "pay")?.options.map((o) => o.name), ["payee", "amount"]);
  assert.deepEqual(COMMAND_DEFINITIONS.find((c) => c.name === "help")?.options, []);
});
