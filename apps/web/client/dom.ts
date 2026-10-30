import { formatUsdc } from "@countersign/core";
import { groupAddress } from "./addressGroups.ts";
import type { PayeeStatus } from "./types.ts";

type Child = Node | string | null | false | undefined;
type Attrs = Record<string, string | boolean | ((event: Event) => void) | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (typeof value === "function") el.addEventListener(key.replace(/^on/, ""), value);
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, value);
  }
  for (const child of children) if (child !== null && child !== false && child !== undefined) el.append(child);
  return el;
}

export function addressEl(address: string, options: { readonly against?: string | null; readonly short?: boolean } = {}): HTMLElement {
  const grouped = groupAddress(address, { ...(options.against ? { against: options.against } : {}), ...(options.short ? { short: true } : {}) });
  const el = h("span", { class: grouped.short ? "addr short" : "addr", title: grouped.full, "aria-label": grouped.label, role: "text" });
  for (const group of grouped.groups) el.append(h("span", { class: group.mark ? `g ${group.mark}` : "g", "aria-hidden": "true" }, group.text));
  return el;
}

const STATUS_WORDS: Record<PayeeStatus, [string, string]> = {
  verified: ["verified", "Verified"],
  change_pending: ["stated", "Change waiting for proof"],
  attempt_refused: ["refused", "Attempt refused"],
  waiting_wallet: ["stated", "Waiting for the payee's wallet"],
  conflict: ["refused", "Frozen: conflicting records"],
  not_payable: ["stated", "Not payable"],
};

export function statusPill(status: PayeeStatus): HTMLElement {
  const [tone, words] = STATUS_WORDS[status];
  return h("span", { class: `status ${tone}` }, words);
}

export function usdc(baseUnits: string): string {
  return `${formatUsdc(BigInt(baseUnits))} USDC`;
}

export function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function networkWords(network: "mainnet" | "testnet"): string {
  return network === "mainnet" ? "Sui mainnet" : "Sui testnet (test USDC, no real money)";
}

export function countersignMark(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 60 20");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", "M2 14c6-1 8-11 13-10s-5 12 1 11 6-8 9-8-1 7 3 7 7-5 11-5 5 4 9 3");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.6");
  path.setAttribute("stroke-linecap", "round");
  svg.append(path);
  return svg;
}

export function liveRegion(): HTMLElement {
  return h("p", { role: "status", "aria-live": "polite", class: "note" });
}
