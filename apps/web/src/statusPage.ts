import { escapeHtml, publicPage } from "./publicPage.ts";
import type { StatusView } from "./status.ts";

const REPO_COMMIT = "https://github.com/Makami27/countersign/commit/";

function at(iso: string | null): string {
  return iso ? `${escapeHtml(iso.slice(0, 19).replace("T", " "))} UTC` : "—";
}

export function statusPageHtml(view: StatusView | null): string {
  if (!view) return publicPage("Status", "<h1>Status</h1><p>This server isn't connected to the live agent, so it has nothing to check.</p>", null, "detail receipt status-page");
  const allOk = view.checks.every((c) => c.ok) && view.restore.complete;
  const rows = view.checks.map((c) => `<tr><td>${escapeHtml(c.name)}</td><td><span class="badge ${c.ok ? "proven" : "open"}">${c.ok ? "OK" : "Problem"}</span></td><td>${c.ms} ms</td><td>${c.detail ? escapeHtml(c.detail) : ""}</td></tr>`).join("");
  const version = view.version ? `<a href="${REPO_COMMIT}${escapeHtml(view.version)}" rel="noreferrer"><code>${escapeHtml(view.version.slice(0, 7))}</code></a>` : "unknown";
  const model = view.model
    ? `<section class="card"><h2>Model (since the last restart)</h2><dl class="facts"><div><dt>Calls</dt><dd>${view.model.calls}</dd></div><div><dt>Failed</dt><dd>${view.model.failures}</dd></div><div><dt>Answered by code before the model</dt><dd>${view.model.answeredByCode}</dd></div><div><dt>Last answer</dt><dd>${view.model.lastLatencyMs === null ? "—" : `${view.model.lastLatencyMs} ms`}, ${at(view.model.lastOkAt)}</dd></div></dl>${view.model.lastError ? `<p class="note">Last error: ${escapeHtml(view.model.lastError.problem)}${view.model.lastError.httpStatus ? ` (HTTP ${view.model.lastError.httpStatus})` : ""} after ${view.model.lastError.attempts} attempts, ${at(view.model.lastError.at)}.</p>` : ""}</section>`
    : "";
  return publicPage("Status", `<h1>Status</h1>
<p class="lede">${allOk ? "Everything the agent depends on answered." : "Something the agent depends on isn't answering. When it can't get a definite answer it pays nothing."}</p>
<section class="card"><dl class="facts">
<div><dt>Network</dt><dd>Sui ${escapeHtml(view.network)}${view.network === "testnet" ? " (test USDC, no real money)" : ""}</dd></div>
<div><dt>Version</dt><dd>${version}</dd></div>
<div><dt>Last restore from Walrus Memory</dt><dd>${view.restore.complete ? "complete" : "<strong>incomplete: payments are blocked</strong>"}, ${escapeHtml(view.restore.relayer)}, ${at(view.restore.at)}</dd></div>
<div><dt>Checked</dt><dd>${at(view.checkedAt)} (refreshed at most every 5 minutes; the database check at most every 15, so visits don't keep the database awake)</dd></div>
</dl></section>
<section class="card"><h2>Dependencies</h2><table class="claims"><thead><tr><th scope="col">Check</th><th scope="col">Result</th><th scope="col">Time</th><th scope="col">Detail</th></tr></thead><tbody>${rows}</tbody></table></section>
${model}
<p class="note">The same data as JSON: <a href="/api/status">/api/status</a>. Proof and claims: <a href="/proof">/proof</a>.</p>`, view.network, "detail receipt status-page");
}
