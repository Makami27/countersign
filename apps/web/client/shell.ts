import { h, networkWords } from "./dom.ts";

export type Route = "loading" | "bare" | "home" | "home-empty" | "payee" | "activity" | "settings" | "admin";
export type Section = "payees" | "activity" | "settings" | "admin" | null;

const shell = document.querySelector<HTMLElement>(".shell");
const side = document.querySelector<HTMLElement>("#side");
const sidebar = document.querySelector<HTMLElement>(".side");
const wallet = document.querySelector<HTMLElement>("#wallet-slot");
const nav = document.querySelector<HTMLElement>("#nav");
const mainCol = document.querySelector<HTMLElement>("#main-col");
const menu = document.querySelector<HTMLButtonElement>("#menu-button");

export function setRoute(route: Route, section: Section): void {
  if (shell) shell.dataset["route"] = route;
  nav?.querySelectorAll("a").forEach((a) => (a.dataset["section"] === section ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
}

export function setNetwork(network: "mainnet" | "testnet"): void {
  document.querySelectorAll<HTMLElement>("[data-netlabel]").forEach((el) => (el.textContent = networkWords(network)));
}

export function setSide(parts: readonly HTMLElement[], quiet: boolean): void {
  if (!side || (quiet && side.contains(document.activeElement))) return;
  side.replaceChildren(...parts);
  markMoreBelow();
}

export function setWallet(band: HTMLElement | null, quiet: boolean): void {
  if (!wallet || (quiet && wallet.contains(document.activeElement))) return;
  wallet.replaceChildren(...(band ? [band] : []));
}

function markMoreBelow(): void {
  if (!sidebar) return;
  sidebar.classList.toggle("more-below", sidebar.scrollTop + sidebar.clientHeight < sidebar.scrollHeight - 2);
}

sidebar?.addEventListener("scroll", markMoreBelow, { passive: true });
window.addEventListener("resize", markMoreBelow);
if (side && "ResizeObserver" in window) new ResizeObserver(markMoreBelow).observe(side);

export function showAdminLink(): void {
  if (nav && !nav.querySelector("[data-section=admin]")) nav.append(h("a", { href: "/app/admin", "data-link": true, "data-section": "admin" }, "Admin"));
}

export function scrollToTop(): void {
  mainCol?.scrollTo({ top: 0 });
  window.scrollTo({ top: 0 });
}

let openMenu: (() => void) | null = null;
menu?.addEventListener("click", () => openMenu?.());

export function setMenu(open: () => void): void {
  openMenu = open;
  if (menu) menu.hidden = false;
}
