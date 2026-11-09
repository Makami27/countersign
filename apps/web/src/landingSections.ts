import { REASONS, formatUsdc, type CheckCode, type ReasonCode } from "@countersign/core";
import { scrawlMarkup } from "../client/scrawl.ts";
import type { Acts, RecordedAct, Trial } from "./landingData.ts";
import { addressHtml, escapeHtml, shortAddressHtml } from "./publicPage.ts";
import { CHECK_WORDS } from "./receiptView.ts";

const REPO = "https://github.com/Makami27/countersign/blob/main/";
const MISSING = `<p class="note">This recording isn't available on this server, so nothing is shown in its place.</p>`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dayMonthYear(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function utcTime(iso: string): string {
  return `${iso.slice(11, 16)} UTC`;
}

function reasonWords(reason: string | null): string {
  return reason && reason in REASONS ? REASONS[reason as ReasonCode].message : "";
}

function checkWords(check: string): string {
  return check in CHECK_WORDS ? CHECK_WORDS[check as CheckCode] : check;
}

function receiptLink(act: RecordedAct, label = "Receipt"): string {
  return `<a href="/r/${escapeHtml(act.receipt.receipt)}">${escapeHtml(label)}</a>`;
}

function evidenceLink(act: RecordedAct, label: string): string {
  return `<a href="${REPO}${escapeHtml(act.source)}" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function replayEvent(act: RecordedAct, first: RecordedAct, note: string): string {
  const r = act.receipt;
  const checks = r.checks.map((c) => `<li class="replay-step ${c.result === "PASS" ? "pass" : "fail"}" data-step><span class="status ${c.result === "PASS" ? "verified" : "refused"}">${c.result === "PASS" ? "Passed" : "Failed"}</span> ${escapeHtml(checkWords(c.check))}</li>`).join("");
  return `<li class="replay-event">
<div class="replay-in replay-step" data-step><p class="label">Forwarded on Telegram at ${utcTime(r.createdAt)}</p><p>The same message again, asking the agent to pay Rent at ${r.address ? shortAddressHtml(r.address) : "an address"}.</p><p class="note">${escapeHtml(note)}</p></div>
<div class="replay-out"><ol class="replay-checks">${checks}</ol>
<p class="replay-step outcome refused" data-step><strong>Refused. Nothing was sent and nothing was changed.</strong> ${escapeHtml(reasonWords(r.reason))}</p>
<p class="replay-step memory-line" data-step>It found the first refusal on Walrus Memory and cited it (${receiptLink(first, "first receipt")}), then wrote its own: ${receiptLink(act)}.</p></div>
</li>`;
}

export function replayHtml(acts: Acts): string {
  if (!acts.refused || !acts.repeated) return MISSING;
  const first = acts.refused.receipt;
  return `<ol class="replay" data-replay>
<li class="replay-first replay-step" data-step><span class="status refused">Refused</span> <span>At ${utcTime(first.createdAt)} a message asked it to pay Rent at ${first.address ? shortAddressHtml(first.address) : "a new address"}, a look-alike of the address on file. ${receiptLink(acts.refused)}</span></li>
${replayEvent(acts.repeated, acts.refused, "The second time, it remembered: refused citing the first receipt.")}
</ol>`;
}

function stamp(day: string, tone: "ink" | "red"): string {
  return `<span class="date-stamp ${tone}" aria-hidden="true"><span>${day}</span></span>`;
}

function entry(day: string, spoken: string, tone: "ink" | "red", title: string, body: string, act: RecordedAct | null, actLabel: string): string {
  const proof = act ? `<p class="note">${act.source.includes("act1") ? `Recorded on the live agent for a demo owner: ${evidenceLink(act, "Receipt")}` : `Recorded on the live agent: ${receiptLink(act)}, ${evidenceLink(act, "Evidence")}`}.</p>` : MISSING;
  return `<li class="month-entry ${tone}">${stamp(day, tone)}<div class="month-body"><h3><span class="visually-hidden">${spoken}: </span>${title}</h3>${body}${proof}</div></li>`;
}

function lineEntry(day: string, spoken: string, title: string, act: RecordedAct | null): string {
  const link = act ? ` <span class="month-link">${receiptLink(act)}</span>` : "";
  return `<li class="month-entry red line">${stamp(day, "red")}<div class="month-body"><h3><span class="visually-hidden">${spoken}: </span>${title}${link}</h3></div></li>`;
}

function sharedEntry(acts: Acts): string {
  if (!acts.sharedFirst || !acts.sharedSecond || acts.sharedSecond.receipt.reason !== "SEEN_BY_OTHER_AGENT") return "";
  return `${entry("13th", "The 13th", "red", "Another owner gets the same scam. Refused.", `<p>Their agent has never seen this address, and it imitates nothing in their account. Another agent's signed report is enough (${receiptLink(acts.sharedFirst, "the first refusal")}). Nothing is sent and nothing changes.</p>`, acts.sharedSecond, "Act 5")}\n`;
}

export function monthHtml(acts: Acts): string {
  const usdc = (a: RecordedAct | null) => (a?.receipt.amountBaseUnits ? `${formatUsdc(BigInt(a.receipt.amountBaseUnits))} test USDC` : "Test USDC");
  const v1Address = acts.paid?.receipt.address ?? null;
  const v2 = acts.changed?.receipt.address ?? null;
  return `<ol class="month">
${entry("1st", "The 1st", "ink", "Rent is paid", `<p>${usdc(acts.paid)} goes to Rent at ${v1Address ? shortAddressHtml(v1Address) : "the verified address"}, the address Rent's own wallet signed for.</p>`, acts.paid, "Act 1")}
${lineEntry("9th", "The 9th", "A “new wallet” message with a look-alike address arrives. Refused.", acts.refused)}
${entry("12th", "The 12th", "red", "The same scam again. Refused at once.", `<p>The address was refused before, so the agent refuses it without asking the model and cites the first receipt.</p>`, acts.repeated, "Act 3")}
${sharedEntry(acts)}${entry("15th", "The 15th", "ink", "The landlord really changes wallets", `<p>Rent's current wallet signs the change, then the new wallet signs too. Rent's card now holds version 2.</p>${v2 ? `<div class="sigcard verified month-card"><div class="sigcard-head"><span class="sigcard-name">Rent, version 2</span><span class="status verified">Verified</span></div><div class="sigcard-sig">${scrawlMarkup(v2)}<span class="sigline">Drawn from the address</span></div>${addressHtml(v2, null)}</div>` : ""}`, acts.changed, "Act 4")}
${entry("1st", "The next 1st", "ink", "Next month's rent goes to version 2", `<p>${usdc(acts.paidAfter)} goes to ${v2 ? shortAddressHtml(v2) : "the new address"} without anyone touching a setting.</p>`, acts.paidAfter, "Act 4")}
</ol>`;
}

export function twoAgentsHtml(t: Trial | null): string {
  if (!t || !t.baselinePaidAttacker || t.countersign.verdict !== "REFUSED") return MISSING;
  return `<blockquote class="trial-message"><p>${escapeHtml(t.message)}</p></blockquote>
<div class="two-agents">
<section class="agent naive" aria-labelledby="naive-title"><h3 id="naive-title">Agent without checks: paid the attacker</h3>
<div class="versus-side"><span class="label">Would have paid</span>${scrawlMarkup(t.attacker)}</div><div class="compare"><div class="row"><span class="label">The attacker's address</span>${addressHtml(t.attacker, t.verified)}</div></div>
<p class="note">It stored the address the model read from the message and paid it.</p></section>
<section class="agent guarded" aria-labelledby="guarded-title"><h3 id="guarded-title">Countersign: refused</h3>
<div class="versus-side attempted"><span class="label">Asked to pay</span>${scrawlMarkup(t.attacker)}<span class="stamp" aria-hidden="true">VOID</span></div><div class="compare"><div class="row on-file"><span class="label">Would pay instead: the verified address</span>${addressHtml(t.verified, t.attacker)}</div></div>
<p class="note">Refused the new address. Rent still goes to the one on file.</p></section>
</div>
<p class="note">Trial ${escapeHtml(t.attack)} (${escapeHtml(t.name)}), number ${t.trial + 1} of 10, run ${escapeHtml(dayMonthYear(t.at))} on Sui testnet with ${escapeHtml(t.model)}. In the measurement both agents reserved the payment; nothing was sent on chain. <a href="${REPO}evidence/measurement/README.md" rel="noreferrer">Raw rows</a></p>`;
}
