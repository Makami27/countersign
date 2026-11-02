import { REASONS, formatUsdc, type CheckCode, type ReasonCode } from "@countersign/core";
import { scrawlMarkup } from "../client/scrawl.ts";
import type { Acts, RecordedAct, Trial } from "./landingData.ts";
import { addressHtml, escapeHtml, shortAddressHtml } from "./publicPage.ts";
import { CHECK_WORDS } from "./receiptView.ts";

const REPO = "https://github.com/Makami27/countersign/blob/main/";
const MISSING = `<p class="note">This recording isn't available on this server, so nothing is shown in its place.</p>`;

function utcTime(iso: string): string {
  return `${iso.slice(11, 16)} UTC`;
}

function reasonWords(reason: string | null): string {
  return reason && reason in REASONS ? REASONS[reason as ReasonCode].message : "";
}

function checkWords(check: string): string {
  return check in CHECK_WORDS ? CHECK_WORDS[check as CheckCode] : check;
}

function receiptLink(act: RecordedAct): string {
  return `<a href="/r/${escapeHtml(act.receipt.receipt)}">receipt ${escapeHtml(act.receipt.receipt)}</a>`;
}

function evidenceLink(act: RecordedAct, label: string): string {
  return `<a href="${REPO}${escapeHtml(act.source)}" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function replayEvent(act: RecordedAct, note: string): string {
  const r = act.receipt;
  const checks = r.checks.map((c) => `<li class="replay-step ${c.result === "PASS" ? "pass" : "fail"}" data-step><span class="status ${c.result === "PASS" ? "verified" : "refused"}">${c.result === "PASS" ? "Passed" : "Failed"}</span> ${escapeHtml(checkWords(c.check))}</li>`).join("");
  return `<li class="replay-event">
<div class="replay-in replay-step" data-step><p class="label">Forwarded on Telegram at ${utcTime(r.createdAt)}</p><p>A message asking the agent to pay Rent at ${r.address ? shortAddressHtml(r.address) : "an address"}.</p><p class="note">${escapeHtml(note)}</p></div>
<div class="replay-out"><ol class="replay-checks">${checks}</ol>
<p class="replay-step outcome refused" data-step><strong>Refused. Nothing was sent and nothing was changed.</strong> ${escapeHtml(reasonWords(r.reason))}</p>
<p class="replay-step memory-line" data-step>Written to Walrus Memory: a receipt signed by the agent, ${receiptLink(act)}${act.blobId ? `, blob <code>${escapeHtml(act.blobId.slice(0, 10))}…</code>` : ""}.</p></div>
</li>`;
}

export function replayHtml(acts: Acts): string {
  if (!acts.refused || !acts.repeated) return MISSING;
  return `<ol class="replay" data-replay>
${replayEvent(acts.refused, "The bot keeps the address a message named and the checks it ran, not the message's words.")}
${replayEvent(acts.repeated, "The same address again, eight minutes later. This time the first refusal is cited.")}
</ol>`;
}

function stamp(day: string, tone: "ink" | "red"): string {
  return `<span class="date-stamp ${tone}" aria-hidden="true"><span>${day}</span></span>`;
}

function entry(day: string, spoken: string, tone: "ink" | "red", title: string, body: string, act: RecordedAct | null, actLabel: string): string {
  const proof = act ? `<p class="note">Real flow: ${evidenceLink(act, actLabel)}, ${act.source.includes("act1") ? `receipt <code>${escapeHtml(act.receipt.receipt)}</code> (a demo owner, kept in the evidence file)` : receiptLink(act)}.</p>` : MISSING;
  return `<li class="month-entry ${tone}">${stamp(day, tone)}<div class="month-body"><h3><span class="visually-hidden">${spoken}: </span>${title}</h3>${body}${proof}</div></li>`;
}

export function monthHtml(acts: Acts): string {
  const usdc = (a: RecordedAct | null) => (a?.receipt.amountBaseUnits ? `${formatUsdc(BigInt(a.receipt.amountBaseUnits))} test USDC` : "Test USDC");
  const attempt = acts.refused?.receipt.address ?? null;
  const v1Address = acts.paid?.receipt.address ?? null;
  const versus = v1Address && attempt
    ? `<div class="versus"><div class="versus-side"><span class="label">On file</span>${scrawlMarkup(v1Address)}</div><div class="versus-side attempted"><span class="label">In the email</span>${scrawlMarkup(attempt)}<span class="stamp month-void" aria-hidden="true">VOID</span></div></div>`
    : "";
  const v2 = acts.changed?.receipt.address ?? null;
  return `<ol class="month">
${entry("1st", "The 1st", "ink", "Rent is paid", `<p>${usdc(acts.paid)} goes to Rent at ${v1Address ? shortAddressHtml(v1Address) : "the verified address"}, the address Rent's own wallet signed for.</p>`, acts.paid, "Act 1")}
${entry("9th", "The 9th", "red", "A “new wallet” email arrives. Refused.", `<p>It names an address that copies the first and last characters of Rent's. Nothing is sent and nothing changes.</p>${versus}`, acts.refused, "Act 2")}
${entry("12th", "The 12th", "red", "The same scam again. Refused at once.", `<p>The address was refused before, so the agent refuses it without asking the model and cites the first receipt.</p>`, acts.repeated, "Act 3")}
${entry("15th", "The 15th", "ink", "The landlord really changes wallets", `<p>Rent's current wallet signs the change, then the new wallet signs too. Rent's card now holds version 2.</p>${v2 ? `<div class="sigcard verified month-card"><div class="sigcard-head"><span class="sigcard-name">Rent, version 2</span><span class="status verified">Verified</span></div><div class="sigcard-sig">${scrawlMarkup(v2)}<span class="sigline">Drawn from the address</span></div>${addressHtml(v2, null)}</div>` : ""}`, acts.changed, "Act 4")}
${entry("1st", "The next 1st", "ink", "Next month's rent goes to version 2", `<p>${usdc(acts.paidAfter)} goes to ${v2 ? shortAddressHtml(v2) : "the new address"} without anyone touching a setting.</p>`, acts.paidAfter, "Act 4")}
</ol>`;
}

export function twoAgentsHtml(t: Trial | null): string {
  if (!t || !t.baselinePaidAttacker || t.countersign.verdict !== "REFUSED") return MISSING;
  return `<blockquote class="trial-message"><p>${escapeHtml(t.message)}</p></blockquote>
<div class="two-agents">
<section class="agent naive" aria-labelledby="naive-title"><h3 id="naive-title">Agent without checks: paid the attacker</h3>
<div class="versus-side"><span class="label">Paid to</span>${scrawlMarkup(t.attacker)}</div><div class="compare"><div class="row"><span class="label">The attacker's address</span>${addressHtml(t.attacker, t.verified)}</div></div>
<p class="note">It stored the address the model read from the message and paid it.</p></section>
<section class="agent guarded" aria-labelledby="guarded-title"><h3 id="guarded-title">Countersign: refused</h3>
<div class="versus-side attempted"><span class="label">Asked to pay</span>${scrawlMarkup(t.attacker)}<span class="stamp" aria-hidden="true">VOID</span></div><div class="compare"><div class="row on-file"><span class="label">Paid instead, the verified address</span>${addressHtml(t.verified, t.attacker)}</div></div>
<p class="note">${escapeHtml(reasonWords(t.countersign.reason))} The payment went to the verified address above.</p></section>
</div>
<p class="note">Trial ${escapeHtml(t.attack)} (${escapeHtml(t.name)}), number ${t.trial + 1} of 10, run ${escapeHtml(t.at.slice(0, 10))} on Sui testnet with ${escapeHtml(t.model)}. In the measurement both agents reserved the payment; nothing was sent on chain. <a href="${REPO}evidence/measurement/README.md" rel="noreferrer">Raw rows</a></p>`;
}
