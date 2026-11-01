import { api } from "./api.ts";
import { h, networkWords } from "./dom.ts";
import type { ActivityItem, Overview, PayeeDetail, PayeeSummary, ScheduleItem } from "./types.ts";
import { payeeList } from "./views/payees.ts";
import { payeeDetailView } from "./views/payeeDetail.ts";
import { schedulesPanel } from "./views/schedules.ts";
import { checklistCard, pasteCard } from "./views/dashboard.ts";
import { adminPage } from "./views/admin.ts";
import { addPayeeSheet, paySheet } from "./views/sheets.ts";
import { confirmChangeSheet, requestChangeSheet } from "./views/changeSheets.ts";
import { activityPage, settingsPage } from "./views/pages.ts";
import { signInPage } from "./views/signIn.ts";

const root = document.querySelector<HTMLElement>("#app");
const nav = document.querySelector<HTMLElement>("#nav");
const banner = document.querySelector<HTMLElement>("#banner");
const netlabel = document.querySelector<HTMLElement>("#netlabel");

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
    return show(signInPage(() => {
      signInWhy = null;
      go("/app");
    }, signInWhy));
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
  const match = /^\/app\/payees\/([^/]+)$/.exec(path);
  const selected = match?.[1] ? decodeURIComponent(match[1]) : (payees.data.payees[0]?.id ?? null);
  const list = payeeList(payees.data.payees, overview.data, selected, () => addPayeeSheet(overview.data.network, () => void render()), () => void render());
  list.append(checklistCard(overview.data), pasteCard(() => void render()));
  if (!selected) return show(h("div", { class: "owner single at-list" }, list));
  const detail = await api<PayeeDetail>("GET", `/api/app/payees/${encodeURIComponent(selected)}`);
  const rerender = () => void render();
  const detailView = detail.ok ? payeeDetailView(detail.data, { onPay: () => paySheet(detail.data, overview.data, rerender), onRequestChange: () => requestChangeSheet(detail.data, rerender), onConfirm: (nonce) => confirmChangeSheet(nonce, overview.data.cooldownSeconds, overview.data.network, rerender) }) : failure(detail.error.message);
  const schedules = detail.ok && detail.data.payTo ? await api<{ schedules: ScheduleItem[] }>("GET", "/api/app/schedules") : null;
  if (detail.ok && schedules?.ok) detailView.insertBefore(schedulesPanel(selected, schedules.data.schedules, overview.data.network, rerender), detailView.querySelector(".actions.sticky"));
  if (detail.ok && (detail.data.pendingChanges.length > 0 || detail.data.waiting)) schedulePoll(path);
  show(h("div", { class: `owner ${match ? "at-detail" : "at-list"}` }, list, detailView));
}

document.addEventListener("click", (event) => {
  const link = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[data-link]");
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
  event.preventDefault();
  go(link.getAttribute("href") ?? "/app");
});
window.addEventListener("popstate", () => void render());
void render();
