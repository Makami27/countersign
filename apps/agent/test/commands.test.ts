import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { COMMANDS, balanceHtml, cancelText, helpText, payeesHtml, schedulesText } from "../src/commands.ts";

const URL = "https://countersign.example";
const ADDRESS = `0x${"ab".repeat(32)}`;

test("X10 /help lists every command in plain words, explains paying, forwarding and pasting, links the app and names the network", () => {
  const help = helpText(URL, "testnet");
  for (const c of COMMANDS) assert.ok(help.includes(`/${c.command}: `), c.command);
  for (const words of ["pay rent 0.10", "forward an email or chat", "paste its text", `${URL}/app`, "Sui testnet: test USDC, no real money"]) assert.ok(help.includes(words), words);
  assert.ok(helpText(URL, "mainnet").includes("Sui mainnet"));
});

test("X10 /payees says which payees can be paid and shows the grouped address only where it will pay", () => {
  const text = payeesHtml([{ name: "Rent", status: "verified", address: ADDRESS }, { name: "Studio", status: "waiting_wallet", address: ADDRESS }], URL);
  assert.ok(text.includes("<b>Rent</b>: verified, payable"));
  assert.ok(text.includes("<b>Studio</b>: not payable yet"));
  assert.equal(text.split("0x abab").length - 1, 1);
  assert.ok(payeesHtml([], URL).startsWith("No payees yet."));
});

test("X10 /balance shows test USDC and SUI, and says plainly when the chain didn't answer", () => {
  const known = balanceHtml(ADDRESS, { status: "KNOWN", usdcBaseUnits: 1_250_000n, suiBaseUnits: 500_000_000n }, "testnet");
  assert.ok(known.includes("1.25 test USDC") && known.includes("0.5 test SUI"));
  assert.ok(balanceHtml(ADDRESS, { status: "UNKNOWN", detail: "Tatum timed out" }, "testnet").includes("Balance not known right now: Tatum timed out"));
});

test("X10 /schedules and /cancel say what happened, including when there was nothing to do", () => {
  assert.ok(schedulesText([], URL).startsWith("No scheduled payments."));
  assert.ok(schedulesText([{ says: "0.10 USDC to Rent every month on day 1", nextDue: "2026-12-01T09:00:00.000Z" }], URL).includes("next run 2026-12-01 09:00 UTC"));
  assert.ok(cancelText(0, URL).startsWith("There's no payment waiting for your confirmation. Nothing was changed."));
  assert.ok(cancelText(1, URL).startsWith("Cancelled the payment waiting for your confirmation. Nothing was sent."));
  assert.ok(cancelText(0, URL).includes("owner wallet's signature"));
});

test("X10 the landing names only Telegram commands the bot really has", async () => {
  const page = await readFile("apps/web/public/index.html", "utf8");
  const features = page.slice(page.indexOf(`id="features"`), page.indexOf(`id="built"`));
  const named = [...features.matchAll(/(?:^|[\s>(])\/([a-z]+)/g)].map((m) => m[1] ?? "");
  const real = new Set<string>(["start", ...COMMANDS.map((c) => c.command)]);
  assert.ok(named.length > 0);
  for (const command of named) assert.ok(real.has(command), `/${command} is named on the landing but the bot has no such command`);
});
