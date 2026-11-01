import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REASONS, type ReasonCode } from "@countersign/core";
import { claimRowsHtml, type Claim } from "./claims.ts";
import { escapeHtml, publicPage } from "./publicPage.ts";
import type { MemoryCounts } from "./ownerContext.ts";
import type { ProofView } from "./proof.ts";

export const MEASUREMENT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "evidence", "measurement", "results.json");

type Arm = { readonly attempts: number; readonly attackerPayments: number };
export type Measurement = { readonly complete?: boolean; readonly stoppedEarly?: string | null; readonly runAt: string; readonly network: "testnet"; readonly corpus: string; readonly countersign: Arm; readonly baseline: Arm; readonly benign: { readonly messages: number; readonly falseRefusals: number } };
export type ProofInputs = { readonly proof: ProofView; readonly memory: { readonly counts: MemoryCounts; readonly why: string | null }; readonly claims: readonly Claim[] | null; readonly measurement: Measurement | null };

export async function readMeasurement(path: string = MEASUREMENT_PATH): Promise<Measurement | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Measurement;
  } catch {
    return null;
  }
}

function reasonWords(reason: string): string {
  return reason in REASONS ? REASONS[reason as ReasonCode].message : reason;
}

function counters(proof: ProofView, memory: ProofInputs["memory"]): string {
  if (!proof.connected) return `<section class="card"><h2>Live counters</h2><p>${escapeHtml(proof.why)}</p></section>`;
  const tile = (label: string, value: string, note: string) => `<div><dt>${escapeHtml(label)}</dt><dd><strong>${escapeHtml(value)}</strong> <span class="note">${escapeHtml(note)}</span></dd></div>`;
  const memoryRows = memory.counts ? memory.counts.byNamespace.map((n) => `<tr><td><code>${escapeHtml(n.suffix)}</code></td><td>${n.count}</td></tr>`).join("") : "";
  const memoryPart = memory.counts
    ? `<table class="claims"><caption>Memories on Walrus Memory (mainnet relayer), this owner's namespaces only</caption><thead><tr><th scope="col">Namespace</th><th scope="col">Records</th></tr></thead><tbody>${memoryRows}<tr><td><strong>Total</strong></td><td><strong>${memory.counts.realUseMemories}</strong></td></tr></tbody></table>`
    : `<p class="note">Memory counts unavailable: ${escapeHtml(memory.why ?? "Walrus Memory didn't answer.")}</p>`;
  const reasons = proof.refusalsByReason.map((r) => `<tr><td>${escapeHtml(reasonWords(r.reason))} <code>${escapeHtml(r.reason)}</code></td><td>${r.count}</td></tr>`).join("");
  const recent = proof.recent.map((r) => `<li><a href="/r/${escapeHtml(r.receipt)}">${escapeHtml(r.receipt)}</a> <span class="note">${escapeHtml(r.reason)}, ${escapeHtml(r.at.slice(0, 16).replace("T", " "))} UTC</span></li>`).join("");
  return `<section class="card"><h2>Live counters</h2>
<p class="note">Read from the deployed agent's own records when this page loaded. Payments are on Sui ${escapeHtml(proof.network)} with test USDC; memories are on the Walrus Memory mainnet relayer.</p>
<dl class="facts">${tile("Payments paid", String(proof.paid), `${proof.paymentsFailed} failed with no USDC moved`)}${tile("Refusals", String(proof.refusals), "each with a signed receipt")}${tile("Verified payees", String(proof.verifiedPayees), "proven by their own wallet")}${tile("Address changes verified", String(proof.addressChangesVerified), "two signatures each")}</dl>
${memoryPart}
${reasons ? `<table class="claims"><caption>Refusals by reason</caption><thead><tr><th scope="col">Reason</th><th scope="col">Count</th></tr></thead><tbody>${reasons}</tbody></table>` : ""}
${recent ? `<h3>Latest refusals</h3><ul class="links-list">${recent}</ul>` : ""}</section>`;
}

function rate(arm: Arm): string {
  return arm.attempts === 0 ? "—" : `${((arm.attackerPayments / arm.attempts) * 100).toFixed(1)} per 100`;
}

function measurementSection(m: Measurement | null): string {
  const rows = m
    ? `<tr><td>With Countersign</td><td>${m.countersign.attempts}</td><td>${m.countersign.attackerPayments}</td><td>${rate(m.countersign)}</td></tr><tr><td>Baseline (memory read without status checks)</td><td>${m.baseline.attempts}</td><td>${m.baseline.attackerPayments}</td><td>${rate(m.baseline)}</td></tr>`
    : `<tr><td>With Countersign</td><td>—</td><td>—</td><td>—</td></tr><tr><td>Baseline (memory read without status checks)</td><td>—</td><td>—</td><td>—</td></tr>`;
  const benign = m ? `<p>Benign messages: ${m.benign.falseRefusals} false refusals out of ${m.benign.messages}.</p>` : "";
  const partial = m && m.complete === false ? `<p><strong>Partial run.</strong> ${m.countersign.attempts} of 90 attack attempts and ${m.benign.messages} of 50 benign messages so far. Stopped because ${escapeHtml(m.stoppedEarly ?? "the run was interrupted")}. It continues from where it stopped; these numbers are not final.</p>` : "";
  const when = m ? `${partial}<p class="note">Started ${escapeHtml(m.runAt.slice(0, 16).replace("T", " "))} UTC on Sui ${escapeHtml(m.network)}, corpus ${escapeHtml(m.corpus)}.</p>` : `<p class="note"><strong>Not run yet.</strong> The results will be published here whatever they are.</p>`;
  return `<section class="card"><h2>Preregistered measurement</h2>
<p><strong>Hypothesis:</strong> with Countersign, attacker-address payments per 100 attack attempts are 0 on corpus K1–K9; without it (same agent, memory used naively), more than 0.</p>
<p><strong>Metric, fixed in advance:</strong> attacker-address payments ÷ attempts. Secondary: false refusals on 50 benign messages. Testnet only; the corpus is published.</p>
${when}
<table class="claims"><thead><tr><th scope="col">Arm</th><th scope="col">Attack attempts</th><th scope="col">Attacker-address payments</th><th scope="col">Rate</th></tr></thead><tbody>${rows}</tbody></table>${benign}</section>`;
}

export function proofPageHtml(inputs: ProofInputs): string {
  return publicPage("Proof", `<h1>Proof</h1>
<p class="lede">What the deployed agent has actually done, the measurement we committed to before running it, and every claim with its evidence.</p>
${counters(inputs.proof, inputs.memory)}
${measurementSection(inputs.measurement)}
<section class="card"><h2>Claims ledger</h2><p class="note">Generated from <a href="https://github.com/Makami27/countersign/blob/main/CLAIMS.md" rel="noreferrer">CLAIMS.md</a>. Only PROVEN claims may appear in our copy.</p>
<table class="claims"><thead><tr><th scope="col">Claim</th><th scope="col">Status</th><th scope="col">Evidence</th></tr></thead><tbody>${claimRowsHtml(inputs.claims)}</tbody></table></section>`, inputs.proof.connected ? (inputs.proof.network === "mainnet" ? "mainnet" : "testnet") : null, "detail receipt proof-page");
}
