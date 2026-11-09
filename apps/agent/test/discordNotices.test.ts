import { test } from "node:test";
import assert from "node:assert/strict";
import { discordNotifier, type DmResult, type NoticeLinks } from "../src/discord/notices.ts";
import { DISCORD_MESSAGE_LIMIT, chunks, contentOf } from "../src/discord/messages.ts";
import { ConfigError, loadConfig } from "../src/config.ts";
import { helpLines } from "../src/chat/commands.ts";
import { DISCORD_WORDS } from "../src/discord/words.ts";

function recordingLinks(linked: Record<string, string>) {
  const calls: string[] = [];
  const links: NoticeLinks = {
    userOf: async (ownerId) => linked[ownerId] ?? null,
    dmDelivered: async (ownerId) => void calls.push(`delivered ${ownerId}`),
    dmRefused: async (ownerId, text) => void calls.push(`refused ${ownerId}: ${text}`),
    keepUndelivered: async (ownerId, text) => void calls.push(`kept ${ownerId}: ${text}`),
  };
  return { calls, links };
}

test("V28 a notice goes by DM to the linked Discord account; refused is kept and flagged, a failed send is kept, an unlinked owner gets nothing", async () => {
  const { calls, links } = recordingLinks({ o1: "300000000000000001" });
  const sent: string[] = [];
  let result: DmResult = "SENT";
  const notify = discordNotifier(links, async (userId, content) => {
    sent.push(`${userId} ${content}`);
    return result;
  });
  await notify("o1", "Refused rcpt_a_b *now*.");
  assert.deepEqual(sent, ["300000000000000001 Refused rcpt\\_a\\_b \\*now\\*."]);
  result = "REFUSED";
  await notify("o1", "Second.");
  result = "FAILED";
  await notify("o1", "Third.");
  await notify("o2", "Nobody.");
  assert.deepEqual(calls, ["delivered o1", "refused o1: Second.", "kept o1: Third."]);
  assert.equal(sent.length, 3);
});

test("V28 Discord replies stay under 2000 characters per message, split at paragraphs, and plain replies are escaped while rich ones keep their marks", () => {
  const help = helpLines(DISCORD_WORDS, "https://example.test", "testnet");
  assert.ok(chunks(help).every((part) => part.length <= DISCORD_MESSAGE_LIMIT));
  const long = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ${"x".repeat(150)}`).join("\n\n");
  const parts = chunks(long);
  assert.ok(parts.length > 1 && parts.every((part) => part.length <= DISCORD_MESSAGE_LIMIT));
  assert.equal(parts.join("\n\n"), long);
  assert.ok(chunks("y".repeat(4500)).every((part) => part.length <= DISCORD_MESSAGE_LIMIT));
  assert.equal(contentOf({ text: "rcpt_a_b", rich: false }), "rcpt\\_a\\_b");
  assert.equal(contentOf({ text: "**Paid**", rich: true }), "**Paid**");
});

const BASE_ENV = {
  NETWORK: "testnet", TATUM_API_KEY: "k", MEMWAL_PRIVATE_KEY: "k", MEMWAL_ACCOUNT_ID: "a", MEMWAL_RELAYER_URL: "https://relayer.example",
  AGENT_RECORD_SIGNING_KEY: "k", AGENT_WALLET_PRIVATE_KEY: "k", OWNER_ID: "admin1", TELEGRAM_BOT_TOKEN: "t", TELEGRAM_OWNER_USER_ID: "1001",
  GEMINI_API_KEY: "g", GEMINI_MODEL: "m", CAP_PER_PAYMENT_USDC_BASE_UNITS: "1000000", CAP_PER_DAY_USDC_BASE_UNITS: "5000000",
  CHANGE_COOLDOWN_SECONDS: "60", DATABASE_PATH: "x.sqlite", MEMORY_BACKEND: "sandbox", WEB_PORT: "8080",
};

test("V28 with no DISCORD_BOT_TOKEN, Discord is off and the rest of the configuration still loads; a token needs its application id", () => {
  assert.equal(loadConfig(BASE_ENV).discord, null);
  assert.deepEqual(loadConfig({ ...BASE_ENV, DISCORD_BOT_TOKEN: "token", DISCORD_APPLICATION_ID: "123456789012345678" }).discord, { token: "token", applicationId: "123456789012345678" });
  assert.throws(() => loadConfig({ ...BASE_ENV, DISCORD_BOT_TOKEN: "token" }), (error: unknown) => error instanceof ConfigError && error.missing.some((m) => m.startsWith("DISCORD_APPLICATION_ID")));
});
