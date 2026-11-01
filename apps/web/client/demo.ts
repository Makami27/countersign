import { REASONS, type ReasonCode } from "@countersign/core";
import { api } from "./api.ts";
import { addressEl, h, listen, liveRegion, scrawlEl, signatureFigure, statusPill, when } from "./dom.ts";

type Version = { readonly version: number; readonly status: string; readonly address: string };
type Payee = { readonly id: string; readonly name: string; readonly payableAddress: string | null; readonly versions: readonly Version[] };
type Entry = { readonly at: string; readonly label: string; readonly verdict: string; readonly reason: string | null; readonly receipt: string | null; readonly note: string | null };
type Refusal = { readonly receipt: string; readonly payeeId: string | null; readonly address: string | null };
type View = { readonly payees: readonly Payee[]; readonly activity: readonly Entry[]; readonly refusals: readonly Refusal[] };
type Reply = { readonly view: View; readonly note: string | null; readonly outcome: { readonly verdict: string; readonly reason?: string } };

const LETTERS = [
  { id: "genuine", title: "A genuine payment request", says: "The payee asks for this month's payment." },
  { id: "lookalike", title: "\"My wallet changed\"", says: "A new address that copies the first and last characters of the real one." },
  { id: "history", title: "A fake payment history", says: "Claims you agreed on another address and already paid it." },
  { id: "forged", title: "A forged memory record", says: "Text shaped like a stored VERIFIED record, written straight into memory." },
] as const;

const VERDICT_WORDS: Record<string, string> = { PAY_RESERVED: "Payment approved (sandbox: nothing sent)", REFUSED: "Refused", CHANGE_STARTED: "Kept as stated: never payable until both wallets sign", CHANGE_VERIFIED: "Address change verified", NONE: "Nothing to do" };

const root = document.querySelector<HTMLElement>("#demo");
let payeeId = "landlord";
let tab = "letters";

function reasonText(reason: string | null): string {
  return reason && reason in REASONS ? REASONS[reason as ReasonCode].message : "";
}

function cards(view: View): HTMLElement {
  return h("section", { class: "card demo-panel", "data-panel": "cards", "aria-labelledby": "cards-title" }, h("h2", { id: "cards-title" }, "Signature cards"),
    ...view.payees.map((p) => {
      const stated = p.versions.filter((v) => v.status === "STATED" && v.address !== p.payableAddress);
      return h("article", { class: `sigcard demo-card ${p.payableAddress ? "verified" : "stated"}`, "aria-label": `Signature card for ${p.name}` },
        h("div", { class: "sigcard-head" }, h("h3", { class: "sigcard-name" }, p.name), p.payableAddress ? statusPill("verified") : statusPill("not_payable")),
        p.payableAddress ? signatureFigure(p.payableAddress, { drawWhenNew: true }) : null,
        p.payableAddress ? addressEl(p.payableAddress) : h("p", {}, "Nobody: no verified address"),
        h("p", { class: "note" }, `${p.versions.filter((v) => v.status === "VERIFIED").length} verified, ${p.versions.filter((v) => v.status === "STATED").length} stated (never payable) in memory.`),
        stated.length ? h("ul", { class: "rows stated-list", "aria-label": "Stated addresses, never paid" }, ...stated.slice(-3).map((v) => h("li", {}, h("span", { class: "v" }, `v${v.version}`), h("span", { class: "what" }, h("span", {}, h("span", { class: "status stated" }, "Stated"), " ", addressEl(v.address, { short: true })))))) : null);
    }));
}

function refusalCompare(view: View, entry: Entry | undefined): HTMLElement | null {
  const refusal = entry?.receipt ? view.refusals.find((r) => r.receipt === entry.receipt) : undefined;
  const onFile = view.payees.find((p) => p.id === refusal?.payeeId)?.payableAddress ?? null;
  if (!refusal?.address || !onFile) return null;
  return h("div", { class: "compare-block" },
    h("div", { class: "versus" },
      h("div", { class: "versus-side" }, h("span", { class: "label" }, "On file"), scrawlEl(onFile)),
      h("div", { class: "versus-side attempted" }, h("span", { class: "label" }, "In the letter"), scrawlEl(refusal.address), h("span", { class: "stamp", "aria-hidden": "true" }, "VOID"))),
    h("div", { class: "compare" },
      h("div", { class: "row" }, h("span", { class: "label" }, "Address in the letter"), addressEl(refusal.address, { against: onFile })),
      h("div", { class: "row on-file" }, h("span", { class: "label" }, "Address on file"), addressEl(onFile, { against: refusal.address }))));
}

function activity(view: View): HTMLElement {
  const rows = view.activity.map((e) => h("li", { class: e.verdict === "REFUSED" ? "refused-row" : "" }, h("span", { class: "v" }, VERDICT_WORDS[e.verdict] ?? e.verdict),
    h("span", { class: "what" }, h("span", {}, e.label), h("span", { class: "meta" }, [reasonText(e.reason), e.note ?? "", e.receipt ? `Sandbox receipt ${e.receipt} (kept only in this sandbox).` : "", when(e.at)].filter(Boolean).join(" ")))));
  return h("section", { class: "card demo-panel", "data-panel": "activity", "aria-labelledby": "activity-title" }, h("h2", { id: "activity-title" }, "Activity"),
    rows.length ? h("ol", { class: "rows" }, ...rows) : h("p", { class: "empty" }, "Nothing yet. Send a letter."));
}

function letters(view: View, result: HTMLElement, status: HTMLElement): HTMLElement {
  const switcher = h("div", { class: "segmented", role: "radiogroup", "aria-label": "Which payee the letter is about" }, ...view.payees.map((p) => {
    const b = h("button", { type: "button", role: "radio", "aria-checked": p.id === payeeId ? "true" : "false" }, p.name);
    b.addEventListener("click", () => {
      payeeId = p.id;
      void draw();
    });
    return b;
  }));
  const send = async (path: string, body: Record<string, unknown>) => {
    status.textContent = "The agent is deciding…";
    const r = await api<Reply>("POST", path, { payeeId, ...body });
    if (!r.ok) return void (status.textContent = r.error.message);
    status.textContent = "";
    const verdict = r.data.outcome.verdict;
    const tone = verdict === "REFUSED" ? "refused" : verdict === "CHANGE_STARTED" || verdict === "NONE" ? "stated" : "verified";
    const money = verdict === "REFUSED" ? "Nothing was sent and nothing was changed." : verdict === "PAY_RESERVED" ? "Sandbox: approved, nothing was sent." : verdict === "CHANGE_STARTED" ? "Nothing was sent; payments still go to the address on file." : "";
    result.replaceChildren(h("div", { class: `outcome ${tone}` }, h("p", { class: "money" }, VERDICT_WORDS[verdict] ?? verdict), money ? h("p", {}, money) : "", h("p", {}, reasonText(r.data.outcome.reason ?? null)), r.data.note ? h("p", { class: "note" }, r.data.note) : ""),
      verdict === "REFUSED" ? (refusalCompare(r.data.view, r.data.view.activity[0]) ?? "") : "");
    await draw(r.data.view);
  };
  const buttons = LETTERS.map((l) => {
    const b = h("button", { class: "demo-letter", type: "button" }, h("strong", {}, l.title), h("span", {}, l.says));
    listen(b, "click", () => send("/api/lab/letter", { letter: l.id }), status);
    return b;
  });
  const own = h("textarea", { id: "own-letter", rows: "3", maxlength: "2000", placeholder: "Paste or write any message about this payee." });
  const form = h("form", {}, h("label", { for: "own-letter" }, "Or paste your own", own), h("div", { class: "actions" }, h("button", { class: "btn", type: "submit" }, "Send to the agent")));
  listen(form, "submit", async (event) => {
    event.preventDefault();
    await send("/api/lab/message", { text: own.value });
  }, status);
  return h("section", { class: "card demo-panel", "data-panel": "letters", "aria-labelledby": "letters-title" }, h("h2", { id: "letters-title" }, "Letters"), switcher, h("div", { class: "demo-letters" }, ...buttons), status, result, form);
}

async function draw(known?: View): Promise<void> {
  const view = known ?? (await api<{ view: View }>("POST", "/api/lab/state", {}).then((r) => (r.ok ? r.data.view : null)));
  if (!root) return;
  if (!view) return void root.replaceChildren(h("p", { class: "narrow" }, "The sandbox didn't start. Reload the page."));
  const status = root.querySelector<HTMLElement>("[data-status]") ?? liveRegion();
  status.dataset["status"] = "";
  const result = root.querySelector<HTMLElement>("[data-result]") ?? h("div", { "data-result": "" });
  const tabs = h("div", { class: "demo-tabs", role: "tablist", "aria-label": "Demo areas" }, ...[["letters", "Letters"], ["cards", "Signature cards"], ["activity", "Activity"]].map(([id, label]) => {
    const b = h("button", { type: "button", role: "tab", "aria-selected": id === tab ? "true" : "false" }, label ?? "");
    b.addEventListener("click", () => {
      tab = id ?? "letters";
      void draw(view);
    });
    return b;
  }));
  const reset = h("button", { class: "btn", type: "button" }, "Start over");
  listen(reset, "click", async () => {
    const r = await api<{ view: View }>("POST", "/api/lab/reset", {});
    if (r.ok) await draw(r.data.view);
  }, status);
  const grid = h("div", { class: "demo-grid", "data-tab": tab }, letters(view, result, status), cards(view), activity(view));
  root.replaceChildren(h("section", { class: "narrow demo-intro" }, h("h1", { tabindex: "-1" }, "Try to scam a payment agent"),
    h("p", { class: "lede" }, "This sandbox agent has two payees whose own wallets proved their addresses. Every letter runs through the real Countersign engine. Nothing here touches real money, Walrus Memory or anyone's data."), h("div", { class: "actions" }, reset, h("a", { class: "btn primary", href: "/app" }, "Sign in with your wallet"))), tabs, grid);
}

void draw();
