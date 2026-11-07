import { api } from "./api.ts";
import { h, networkWords } from "./dom.ts";
import type { ActivityItem, Overview, PayeeDetail, PayeeSummary, ScheduleItem } from "./types.ts";
import { payeeList } from "./views/payees.ts";
import { payeeDetailView } from "./views/payeeDetail.ts";
import { schedulesPanel } from "./views/schedules.ts";
import { checklistCard, checklistDone, pasteCard } from "./views/dashboard.ts";
import { adminPage } from "./views/admin.ts";
import { addPayeeSheet } from "./views/sheets.ts";
import { paySheet } from "./views/paySheet.ts";
import { cancelChange, confirmChangeSheet, requestChangeSheet } from "./views/changeSheets.ts";
import { activityPage, settingsPage } from "./views/pages.ts";
import { signInPage } from "./views/signIn.ts";
import { agentWalletPanel } from "./views/walletPanel.ts";
import { depositSheet } from "./views/depositSheet.ts";
import { showMoment, startMoments } from "./moment.ts";
import { notePayees } from "./momentFacts.ts";
import { installPlainCopy } from "./copyHandler.ts";

const root = document.querySelector<HTMLElement>("#app");
const nav = document.querySelector<HTMLElement>("#nav");
const banner = document.querySelector<HTMLElement>("#banner");
const netlabel = document.querySelector<HTMLElement>("#netlabel");

const PAYABLE: ReadonlySet<PayeeSummary["status"]> = new Set(["verified", "attempt_refused", "change_pending"]);

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function payeeMoments(payees: readonly PayeeSummary[]): void {
  for (const event of notePayees(storage(), payees.map((p) => ({ id: p.id, name: p.name, payable: PAYABLE.has(p.status), address: p.address })))) {
    showMoment(event.kind === "verified"
      ? { title: `${event.name} is verified`, detail: "Their wallet signed. They can be paid now.", address: event.address }
      : { title: `${event.name}'s address changed`, detail: "Both proofs checked out. Payments now go to the new address.", address: event.address });
  }
}

function go(path: string): void {
  history.pushState(null, "", path);
  void render();
}

function setCurrent(section: "payees" | "activity" | "settings" | "admin" | null): void {
  nav?.querySelectorAll("a").forEach((a) => (a.dataset["section"] === section ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
}

let quietRender = false;
let edited = false;
root?.addEventListener("input", () => {
  edited = true;
});

function show(...children: HTMLElement[]): void {
  root?.replaceChildren(...children);
  edited = false;
  if (!quietRender) root?.querySelector<HTMLElement>("h1, h2")?.focus({ preventScroll: true });
}

function typingHere(): boolean {
  const active = document.activeElement;
  const field = active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active instanceof HTMLTextAreaElement;
  return edited || (field && root?.contains(active) === true);
}

function failure(message: string): HTMLElement {
  return h("section", { class: "narrow" }, h("h1", { tabindex: "-1" }, "Couldn't load this"), h("p", {}, message), h("div", { class: "actions" }, h("button", { class: "btn", type: "button", onclick: () => void render() }, "Try again")));
}

let poll: number | undefined;
function schedulePoll(path: string): void {
  window.clearTimeout(poll);
  poll = window.setTimeout(() => {
    if (location.pathname !== path) return;
    if (document.querySelector("dialog[open]") || typingHere()) return schedulePoll(path);
    quietRender = true;
    void render().finally(() => {
      quietRender = false;
    });
  }, 5_000);
}

let signInWhy: string | null = null;

function loading(): HTMLElement {
  return h("p", { class: "narrow", role: "status" }, "Loading your agent…");
}

async function render(): Promise<void> {
  try {
    await renderPage();
  } catch {
    show(failure("This screen couldn't be drawn from the agent's answer. Nothing was changed."));
  }
}

async function renderPage(): Promise<void> {
  window.clearTimeout(poll);
  const path = location.pathname;
  if (path === "/app/login") {
    setCurrent(null);
    return show(signInPage((address) => {
      signInWhy = null;
      go("/app");
      showMoment({ title: "Signed in", detail: "This wallet opens your agent. It signs approvals and never pays your bills.", address });
    }, signInWhy, new URLSearchParams(location.search).has("other")));
  }
  if (!root?.querySelector(".owner")) show(loading());
  const overview = await api<Overview>("GET", "/api/app/overview");
  if (!overview.ok && overview.error.status === 401) {
    signInWhy = overview.error.message;
    return go("/app/login");
  }
  if (!overview.ok) return show(failure(overview.error.message));
  if (netlabel) netlabel.textContent = networkWords(overview.data.network);
  if (banner) {
    const sandbox = overview.data.memory.relayer.startsWith("sandbox");
    banner.hidden = overview.data.memory.restored && !sandbox;
    banner.textContent = sandbox ? "Sandbox memory: nothing on this screen is stored on Walrus Memory. For local screen checks only." : overview.data.memory.restored ? "" : "Walrus Memory couldn't be read completely. Nothing will be paid until it can.";
  }
  if (path === "/app/activity") {
    setCurrent("activity");
    const items = await api<{ items: ActivityItem[] }>("GET", "/api/app/activity");
    return show(items.ok ? activityPage(items.data.items) : failure(items.error.message));
  }
  if (nav && overview.data.isAdmin && !nav.querySelector("[data-section=admin]")) nav.append(h("a", { href: "/app/admin", "data-link": true, "data-section": "admin" }, "Admin"));
  if (path === "/app/admin") {
    setCurrent("admin");
    return show(await adminPage(overview.data.network));
  }
  if (path === "/app/settings") {
    setCurrent("settings");
    return show(settingsPage(overview.data, () => void render()));
  }
  setCurrent("payees");
  const payees = await api<{ payees: PayeeSummary[] }>("GET", "/api/app/payees");
  if (!payees.ok) return show(failure(payees.error.message));
  payeeMoments(payees.data.payees);
  const match = /^\/app\/payees\/([^/]+)$/.exec(path);
  const selected = match?.[1] ? decodeURIComponent(match[1]) : (payees.data.payees[0]?.id ?? null);
  const openDeposit = () => depositSheet(overview.data, () => void render());
  const openPay = (id: string, name: string, address: string, amount: string | null = null) => paySheet({ id, name, address }, overview.data, () => void render(), openDeposit, amount);
  const payFromMessage = (payeeId: string, amount: string | null) => void api<PayeeDetail>("GET", `/api/app/payees/${encodeURIComponent(payeeId)}`).then((found) => {
    if (found.ok && found.data.payTo) openPay(found.data.summary.id, found.data.summary.name, found.data.payTo.address, amount);
  });
  const list = payeeList(payees.data.payees, overview.data, selected, () => addPayeeSheet(overview.data.network, () => void render()), () => void render(), (payee) => {
    if (payee.address) openPay(payee.id, payee.name, payee.address);
  });
  if (checklistDone(overview.data)) list.append(pasteCard(() => void render(), payFromMessage), checklistCard(overview.data, openDeposit));
  else {
    list.prepend(checklistCard(overview.data, openDeposit));
    list.append(pasteCard(() => void render(), payFromMessage));
  }
  const wallet = agentWalletPanel(overview.data, openDeposit);
  if (!selected) return show(h("div", { class: "owner single at-list" }, wallet, list));
  const detail = await api<PayeeDetail>("GET", `/api/app/payees/${encodeURIComponent(selected)}`);
  const rerender = () => void render();
  const detailView = detail.ok ? payeeDetailView(detail.data, { onPay: () => {
    if (detail.data.payTo) openPay(detail.data.summary.id, detail.data.summary.name, detail.data.payTo.address);
  }, onRequestChange: () => requestChangeSheet(detail.data, rerender), onConfirm: (nonce) => confirmChangeSheet(nonce, overview.data.cooldownSeconds, overview.data.network, rerender), onCancel: (nonce, status) => cancelChange(nonce, overview.data.network, status, rerender) }) : failure(detail.error.message);
  const schedules = detail.ok && detail.data.payTo ? await api<{ schedules: ScheduleItem[] }>("GET", "/api/app/schedules") : null;
  if (detail.ok && schedules?.ok) detailView.querySelector(".pay-actions")?.after(schedulesPanel(selected, schedules.data.schedules, overview.data.network, rerender));
  if (detail.ok && (detail.data.pendingChanges.length > 0 || detail.data.waiting)) schedulePoll(path);
  show(h("div", { class: `owner ${match ? "at-detail" : "at-list"}` }, wallet, list, detailView));
}

document.addEventListener("click", (event) => {
  const link = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[data-link]");
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
  event.preventDefault();
  go(link.getAttribute("href") ?? "/app");
});
window.addEventListener("popstate", () => void render());
startMoments(document.querySelector(".bar"));
installPlainCopy();
void render();
