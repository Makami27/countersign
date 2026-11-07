import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { SuiAddress } from "@countersign/core";
import { COMMANDS, balanceHtml, cancelText, helpText, payeesHtml, schedulesText } from "../src/commands.ts";
import { GOOGLE_WORDS } from "@countersign/web/walletFacts";
import { changeStartedHtml, questionHtml, signInLinkText } from "../src/telegramText.ts";

const URL = "https://countersign.example";
const ADDRESS = `0x${"ab".repeat(32)}`;

test("X10 /help lists every command in plain words, explains paying, forwarding and pasting, links the app and names the network", () => {
  const help = helpText(URL, "testnet");
  for (const c of COMMANDS) assert.ok(help.includes(`/${c.command}: `), c.command);
  for (const words of ["pay rent 0.10", "forward an email or chat", "paste its text", `${URL}/app`, "Sui testnet: test USDC, no real money", "Agent wallet: pays your bills (fund this one)", "Your wallet: signs approvals (never pays)", "continue with Google", "Slush makes a free one from your Google account the first time"]) assert.ok(help.includes(words), words);
  assert.ok(helpText(URL, "mainnet").includes("Sui mainnet"));
});

test("U04 Telegram asks how much with the verified address, and names the payee problem otherwise", () => {
  const payee = { id: "rent", name: "Rent", verified: ADDRESS as SuiAddress };
  const asked = questionHtml({ kind: "ask_amount", payee, verified: ADDRESS as SuiAddress }, [], URL);
  assert.ok(asked.startsWith("<b>How much should I pay Rent?</b>"));
  assert.ok(asked.includes("Nothing was sent") && asked.includes("0x abab"));
  assert.ok(questionHtml({ kind: "no_payee", address: null }, ["Rent"], URL).includes("Your payees: Rent."));
  assert.ok(questionHtml({ kind: "not_payable", payee: { ...payee, verified: null } }, [], URL).includes(`the owner app (${URL}/app)`));
});

test("U04 a new address over Telegram is reported as saved as said, not proven", () => {
  const html = changeStartedHtml({ verdict: "CHANGE_STARTED", nonce: "n", expires: "2026-11-06T00:00:00Z", fromAddress: ADDRESS as SuiAddress, toAddress: `0x${"cd".repeat(32)}` as SuiAddress }, `${URL}/sign/n`);
  assert.ok(html.includes("Saved as said, not proven") && html.includes("Nothing was sent") && html.includes(`${URL}/sign/n`));
});

test("G02 the bot's /login reply carries the same words as the sign-in screen", () => {
  const reply = signInLinkText(URL);
  assert.ok(reply.includes(`${URL}/app/login`));
  assert.ok(reply.includes(GOOGLE_WORDS));
  assert.ok(reply.includes("Continue with Google."));
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
  assert.ok(cancelText(0, URL).includes("your wallet's signature"));
});

test("X10 the landing names only Telegram commands the bot really has", async () => {
  const page = await readFile("apps/web/public/index.html", "utf8");
  const features = page.slice(page.indexOf(`id="features"`), page.indexOf(`id="built"`));
  const named = [...features.matchAll(/(?:^|[\s>(])\/([a-z]+)/g)].map((m) => m[1] ?? "");
  const real = new Set<string>(["start", ...COMMANDS.map((c) => c.command)]);
  assert.ok(named.length > 0);
  for (const command of named) assert.ok(real.has(command), `/${command} is named on the landing but the bot has no such command`);
});
