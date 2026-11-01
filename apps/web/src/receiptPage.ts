import { scrawlMarkup } from "../client/scrawl.ts";
import type { BlobLink, ReceiptView } from "./receiptView.ts";
import { addressHtml, escapeHtml, publicPage } from "./publicPage.ts";

export { escapeHtml } from "./publicPage.ts";

function utc(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const day = date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${day}, ${date.toISOString().slice(11, 16)} UTC`;
}

function blobHtml(blob: BlobLink, label: string): string {
  const links = blob.raw && blob.explorer ? ` <a href="${escapeHtml(blob.raw)}" rel="noreferrer">raw bytes (encrypted)</a> · <a href="${escapeHtml(blob.explorer)}" rel="noreferrer">Walruscan</a>` : "";
  return `<li><span class="label">${escapeHtml(label)}</span> <code>${escapeHtml(blob.id)}</code>${links}</li>`;
}

function attemptHtml(view: ReceiptView): string {
  if (!view.attempt) return "";
  const verified = view.attempt.verified;
  const rows = [`<div class="row"><span class="label">Address in the attempt</span>${addressHtml(view.attempt.address, verified)}</div>`];
  if (verified) rows.push(`<div class="row on-file"><span class="label">${escapeHtml(view.payeeName ?? "Payee")}'s verified address today</span>${addressHtml(verified, view.attempt.address)}</div>`);
  const onFile = verified ? `<div class="versus-side"><span class="label">On file</span>${scrawlMarkup(verified)}</div>` : `<div class="versus-side"><span class="label">On file</span><p class="note">No verified address</p></div>`;
  const versus = `<div class="versus" aria-hidden="true">${onFile}<div class="versus-side attempted"><span class="label">In the attempt</span>${scrawlMarkup(view.attempt.address)}<span class="stamp">VOID</span></div></div><p class="note">Signatures drawn from the addresses. The check is the address itself, below.</p>`;
  return `<section class="attempt" aria-label="Address comparison">${versus}<p class="money">${verified ? "Underlined groups differ from the verified address." : "This address was never verified."}</p><div class="compare">${rows.join("")}</div></section>`;
}

export function receiptHtml(view: ReceiptView): string {
  const checks = view.checks.length === 0
    ? `<p class="note">No checks ran before this outcome.</p>`
    : `<ol class="checks">${view.checks.map((c) => `<li><span class="status ${c.passed ? "verified" : "refused"}">${c.passed ? "Passed" : "Failed"}</span> ${escapeHtml(c.words)}</li>`).join("")}</ol>`;
  const reason = view.reason ? `<section class="card"><h2>Why</h2><p>${escapeHtml(view.reason.message)}</p>${view.reason.nextAction ? `<p class="note">${escapeHtml(view.reason.nextAction)}</p>` : ""}${view.cites ? `<p class="note">The first time this address was refused: <a href="/r/${escapeHtml(view.cites)}">receipt ${escapeHtml(view.cites)}</a>.</p>` : ""}${view.seenElsewhere ? `<p class="note">Refused by ${view.seenElsewhere.agents} other Countersign agent${view.seenElsewhere.agents === 1 ? "" : "s"} in the last 90 days; the first was their receipt ${escapeHtml(view.seenElsewhere.firstReceipt)}.</p>` : ""}</section>` : "";
  const memory = [view.receiptBlob ? blobHtml(view.receiptBlob, "This receipt") : `<li><span class="label">This receipt</span> its blob id isn't known yet; the agent writes it to ${escapeHtml(view.memoryLabel)} and lists it here once confirmed.</li>`, ...view.evidenceBlobs.map((b) => blobHtml(b, "Payee record it relied on"))].join("");
  const chain = view.transaction
    ? `<p><a href="${escapeHtml(view.transaction.url)}" rel="noreferrer">Sui ${view.network} transaction ${escapeHtml(view.transaction.digest)}</a></p>`
    : `<p>No transaction: nothing was sent.</p>`;
  return publicPage(`Receipt ${view.id}`, `
    <p class="label">Receipt <code>${escapeHtml(view.id)}</code> · ${escapeHtml(utc(view.at))}</p>
    <h1><span class="status ${view.verdict.tone}">${escapeHtml(view.verdict.words)}</span>${view.payeeName ? ` <span class="sub">${escapeHtml(view.payeeName)}</span>` : ""}</h1>
    <p class="money">${escapeHtml(view.money)}</p>
    ${attemptHtml(view)}
    ${reason}
    <section class="card"><h2>Checks, in the order they ran</h2>${checks}</section>
    <section class="card"><h2>Memory</h2><p class="note">Stored in ${escapeHtml(view.memoryLabel)}, signed by the agent.</p><ul class="blobs">${memory}</ul></section>
    <section class="card"><h2>Chain</h2>${chain}<p class="note">${view.network === "mainnet" ? "Sui mainnet." : "Sui testnet: test USDC, no real money."}</p></section>`, view.network);
}

export function missingReceiptHtml(connected: boolean): string {
  return publicPage("Receipt not found", `<h1>No receipt with that id</h1><p>${connected ? "The live agent has no receipt with this id. Check the link you were given." : "This server isn't connected to the live agent, so it can't show receipts."}</p><p><a href="/">Back to Countersign</a></p>`, null);
}
