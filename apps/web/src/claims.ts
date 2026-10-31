import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { escapeHtml } from "./receiptPage.ts";

export const CLAIMS_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "CLAIMS.md");
const REPO_BLOB = "https://github.com/Makami27/countersign/blob/main/";
const CLAIM_ROW = /^\|\s*(CL\d{2})\s*\|/;
const CODE_SPAN = /`([^`]+)`/g;
const REPO_PATH = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.*-]+)+$/;

export type Claim = { readonly id: string; readonly claim: string; readonly status: string; readonly evidence: string };

export function parseClaims(markdown: string): readonly Claim[] {
  return markdown.split(/\r?\n/).filter((line) => CLAIM_ROW.test(line)).map((line) => {
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    return { id: cells[0] ?? "", claim: cells[1] ?? "", status: cells[2] ?? "", evidence: cells[3] ?? "" };
  });
}

export function evidenceHtml(evidence: string): string {
  let html = "";
  let last = 0;
  for (const match of evidence.matchAll(CODE_SPAN)) {
    const code = match[1] ?? "";
    html += escapeHtml(evidence.slice(last, match.index));
    const path = code.split(" ")[0] ?? "";
    html += REPO_PATH.test(path) && !path.includes("*")
      ? `<a href="${escapeHtml(`${REPO_BLOB}${path}`)}" rel="noreferrer"><code>${escapeHtml(code)}</code></a>`
      : `<code>${escapeHtml(code)}</code>`;
    last = (match.index ?? 0) + match[0].length;
  }
  return html + escapeHtml(evidence.slice(last));
}

export function claimRowsHtml(claims: readonly Claim[] | null): string {
  if (!claims) return `<tr><td colspan="3">The claims ledger isn't available on this server.</td></tr>`;
  return claims.map((c) => {
    const tone = c.status.startsWith("PROVEN") ? "proven" : "open";
    return `<tr data-claim="${escapeHtml(c.id)}" data-status="${escapeHtml(c.status)}"><td><span class="claim-id">${escapeHtml(c.id)}</span> ${escapeHtml(c.claim)}</td><td><span class="badge ${tone}">${escapeHtml(c.status)}</span></td><td>${evidenceHtml(c.evidence)}</td></tr>`;
  }).join("");
}

export async function readClaims(path: string = CLAIMS_PATH): Promise<readonly Claim[] | null> {
  try {
    return parseClaims(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}
