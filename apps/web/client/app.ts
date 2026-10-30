import { api } from "./api.ts";
import { h, networkWords } from "./dom.ts";
import type { ActivityItem, Overview, PayeeDetail, PayeeSummary } from "./types.ts";
import { payeeList } from "./views/payees.ts";
import { payeeDetailView } from "./views/payeeDetail.ts";
import { addPayeeSheet, paySheet } from "./views/sheets.ts";
import { activityPage, loginPage, settingsPage } from "./views/pages.ts";

const root = document.querySelector<HTMLElement>("#app");
const nav = document.querySelector<HTMLElement>("#nav");
const banner = document.querySelector<HTMLElement>("#banner");
const netlabel = document.querySelector<HTMLElement>("#netlabel");

function go(path: string): void {
  history.pushState(null, "", path);
  void render();
}

function setCurrent(section: "payees" | "activity" | "settings" | null): void {
  nav?.querySelectorAll("a").forEach((a) => (a.dataset["section"] === section ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
}

function show(...children: HTMLElement[]): void {
  root?.replaceChildren(...children);
  root?.querySelector<HTMLElement>("h1, h2")?.focus({ preventScroll: true });
}

function failure(message: string): HTMLElement {
  return h("section", { class: "narrow" }, h("h1", { tabindex: "-1" }, "Couldn't load this"), h("p", {}, message), h("div", { class: "actions" }, h("button", { class: "btn", type: "button", onclick: () => void render() }, "Try again")));
}

async function render(): Promise<void> {
  const path = location.pathname;
  if (path === "/app/login") {
    setCurrent(null);
    return show(loginPage(() => go("/app")));
  }
  const overview = await api<Overview>("GET", "/api/app/overview");
  if (!overview.ok && overview.error.status === 401) return go("/app/login");
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
  if (path === "/app/settings") {
    setCurrent("settings");
    return show(settingsPage(overview.data, () => void render()));
  }
  setCurrent("payees");
  const payees = await api<{ payees: PayeeSummary[] }>("GET", "/api/app/payees");
  if (!payees.ok) return show(failure(payees.error.message));
  const match = /^\/app\/payees\/([^/]+)$/.exec(path);
  const selected = match?.[1] ? decodeURIComponent(match[1]) : (payees.data.payees[0]?.id ?? null);
  const list = payeeList(payees.data.payees, overview.data, selected, () => addPayeeSheet(() => void render()));
  if (!selected) return show(h("div", { class: "owner single at-list" }, list));
  const detail = await api<PayeeDetail>("GET", `/api/app/payees/${encodeURIComponent(selected)}`);
  const detailView = detail.ok ? payeeDetailView(detail.data, () => paySheet(detail.data, overview.data, () => void render())) : failure(detail.error.message);
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
