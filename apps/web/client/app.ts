import { api } from "./api.ts";
import { h } from "./dom.ts";
import type { ActivityItem, Overview, PayeeDetail, PayeeSummary, ScheduleItem } from "./types.ts";
import { payeeDetailView } from "./views/payeeDetail.ts";
import { schedulesPanel } from "./views/schedules.ts";
import { checkMessageSheet } from "./views/dashboard.ts";
import { adminPage } from "./views/admin.ts";
import { addPayeeSheet } from "./views/sheets.ts";
import { paySheet } from "./views/paySheet.ts";
import { cancelChange, confirmChangeSheet, requestChangeSheet } from "./views/changeSheets.ts";
import { activityPage } from "./views/pages.ts";
import { settingsPage } from "./views/settings.ts";
import { signInPage } from "./views/signIn.ts";
import { firstRun } from "./views/firstRun.ts";
import { menuSheet, sidebarParts } from "./views/sidebar.ts";
import { depositSheet } from "./views/depositSheet.ts";
import { showMoment, startMoments } from "./moment.ts";
import { payeeMoments } from "./payeeMoments.ts";
import { installPlainCopy } from "./copyHandler.ts";
import { scrollToTop, setMenu, setNetwork, setRoute, setSide, showAdminLink } from "./shell.ts";

const root = document.querySelector<HTMLElement>("#app");
const banner = document.querySelector<HTMLElement>("#banner");

function go(path: string): void {
  history.pushState(null, "", path);
  scrollToTop();
  void render();
}

let quietRender = false;
let edited = false;
root?.addEventListener("input", () => {
  edited = true;
});

let drawn = false;

function show(...children: HTMLElement[]): void {
  root?.replaceChildren(...children);
  drawn = !children.some((child) => child.dataset["loading"] === "true");
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
  return h("p", { class: "narrow", role: "status", "data-loading": "true" }, "Loading your agent…");
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
    setRoute("bare", null);
    setSide([], false);
    return show(signInPage((address) => {
      signInWhy = null;
      go("/app");
      showMoment({ title: "Signed in", detail: "This wallet opens your agent. It approves changes and sends deposits. It never pays bills.", address });
    }, signInWhy, new URLSearchParams(location.search).has("other")));
  }
  if (!drawn) {
    setRoute("loading", null);
    show(loading());
  }
  const [overview, payees] = await Promise.all([api<Overview>("GET", "/api/app/overview"), api<{ payees: PayeeSummary[] }>("GET", "/api/app/payees")]);
  if (!overview.ok && overview.error.status === 401) {
    const notice = overview.error.body?.["notice"];
    signInWhy = typeof notice === "string" ? notice : null;
    return go("/app/login");
  }
  if (!overview.ok) return show(failure(overview.error.message));
  const o = overview.data;
  setNetwork(o.network);
  if (banner) {
    const sandbox = o.memory.relayer.startsWith("sandbox");
    banner.hidden = o.memory.restored && !sandbox;
    banner.textContent = sandbox ? "Sandbox memory: nothing on this screen is stored on Walrus Memory. For local screen checks only." : o.memory.restored ? "" : "Walrus Memory couldn't be read completely. Nothing will be paid until it can.";
  }
  if (o.isAdmin) showAdminLink();
  setMenu(() => menuSheet(o));
  const list = payees.ok ? payees.data.payees : [];
  if (payees.ok) payeeMoments(list);
  const match = /^\/app\/payees\/([^/]+)$/.exec(path);
  const home = path === "/app" || path === "/app/";
  const selected = match?.[1] ? decodeURIComponent(match[1]) : home ? (list[0]?.id ?? null) : null;
  const openDeposit = () => depositSheet(o, () => void render());
  const openPay = (id: string, name: string, address: string, amount: string | null = null) => paySheet({ id, name, address }, o, () => void render(), openDeposit, amount);
  const payFromMessage = (payeeId: string, amount: string | null) => void api<PayeeDetail>("GET", `/api/app/payees/${encodeURIComponent(payeeId)}`).then((found) => {
    if (found.ok && found.data.payTo) openPay(found.data.summary.id, found.data.summary.name, found.data.payTo.address, amount);
  });
  const openAdd = () => addPayeeSheet(o.network, () => void render());
  setSide(sidebarParts(o, payees.ok ? { ok: true, payees: list } : { ok: false, problem: payees.error.message }, selected, {
    onDeposit: openDeposit, onAdd: openAdd, onCheck: () => checkMessageSheet(() => void render(), payFromMessage),
    onPay: (payee) => {
      if (payee.address) openPay(payee.id, payee.name, payee.address);
    },
  }), quietRender);
  if (path === "/app/activity") {
    setRoute("activity", "activity");
    const items = await api<{ items: ActivityItem[] }>("GET", "/api/app/activity");
    const names = new Map(list.map((p) => [p.id, p.name] as const));
    return show(items.ok ? activityPage(items.data.items, names, o.network) : failure(items.error.message));
  }
  if (path === "/app/admin") {
    setRoute("admin", "admin");
    return show(await adminPage(o.network));
  }
  if (path === "/app/settings") {
    setRoute("settings", "settings");
    return show(settingsPage(o, () => void render()));
  }
  if (!payees.ok) return show(failure(payees.error.message));
  if (!selected) {
    setRoute("home-empty", "payees");
    return show(firstRun(o, () => void render(), openAdd));
  }
  setRoute(match ? "payee" : "home", "payees");
  const rerender = () => void render();
  const [detail, schedules] = await Promise.all([api<PayeeDetail>("GET", `/api/app/payees/${encodeURIComponent(selected)}`), api<{ schedules: ScheduleItem[] }>("GET", "/api/app/schedules")]);
  if (!detail.ok) return show(failure(detail.error.message));
  const d = detail.data;
  const panel = d.payTo && schedules.ok ? schedulesPanel(selected, schedules.data.schedules, o.network, rerender) : null;
  const view = payeeDetailView(d, {
    onPay: () => {
      if (d.payTo) openPay(d.summary.id, d.summary.name, d.payTo.address);
    },
    onRequestChange: () => requestChangeSheet(d, rerender), onConfirm: (nonce) => confirmChangeSheet(nonce, o.cooldownSeconds, o.network, rerender), onCancel: (nonce, status) => cancelChange(nonce, o.network, status, rerender),
  }, panel);
  if (d.pendingChanges.length > 0 || d.waiting) schedulePoll(path);
  show(view);
}

document.addEventListener("click", (event) => {
  const link = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[data-link]");
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
  event.preventDefault();
  go(link.getAttribute("href") ?? "/app");
});
window.addEventListener("popstate", () => void render());
startMoments();
installPlainCopy();
void render();
