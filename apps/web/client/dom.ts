import { formatUsdc } from "@countersign/core";
import { groupAddress } from "./addressGroups.ts";
import { scrawlFor } from "./scrawl.ts";
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
  grouped.groups.forEach((group, i) => {
    if (i > 0) el.append(document.createElement("wbr"));
    el.append(h("span", { class: group.mark ? `g ${group.mark}` : "g", "aria-hidden": "true" }, group.text));
  });
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

const SVG_NS = "http://www.w3.org/2000/svg";
const SEEN_KEY = "countersign:drawn";

function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

function firstSighting(address: string): boolean {
  try {
    const seen = new Set<string>(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as string[]);
    if (seen.has(address)) return false;
    seen.add(address);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-200)));
    return true;
  } catch {
    return false;
  }
}

export function scrawlEl(address: string, options: { readonly drawWhenNew?: boolean; readonly draw?: boolean } = {}): SVGElement {
  const s = scrawlFor(address);
  const draw = options.draw === true || (options.drawWhenNew === true && firstSighting(address.toLowerCase()));
  const svg = svgEl("svg", { class: draw ? "scrawl draw" : "scrawl", viewBox: s.viewBox, preserveAspectRatio: "xMinYMid meet", "aria-hidden": "true", focusable: "false" });
  svg.append(svgEl("path", { class: "scrawl-stroke", d: s.stroke, pathLength: "1" }));
  if (s.underline) svg.append(svgEl("path", { class: "scrawl-under", d: s.underline, pathLength: "1" }));
  for (const dot of s.dots) svg.append(svgEl("circle", { cx: String(dot.x), cy: String(dot.y), r: String(dot.r) }));
  return svg;
}

export function signatureFigure(address: string, options: { readonly drawWhenNew?: boolean } = {}): HTMLElement {
  return h("div", { class: "sigcard-sig" }, scrawlEl(address, options), h("span", { class: "sigline" }, "Drawn from the address"));
}

export function copyButton(text: string, label: string): HTMLButtonElement {
  const button = h("button", { class: "btn", type: "button" }, label);
  button.addEventListener("click", () => {
    void navigator.clipboard.writeText(text).then(() => {
      button.textContent = "Copied";
      window.setTimeout(() => {
        button.textContent = label;
      }, 2_000);
    }, () => {
      button.textContent = "Couldn't copy: select it above";
    });
  });
  return button;
}

export function liveRegion(): HTMLElement {
  return h("p", { role: "status", "aria-live": "polite", class: "note" });
}

export const PAGE_FAILED = "This page hit an error before it could show the result. Reload the page to see where things stand.";

export function listen<K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, handler: (event: HTMLElementEventMap[K]) => Promise<void>, status: HTMLElement): void {
  target.addEventListener(type, (event) => {
    handler(event).catch(() => {
      status.textContent = PAGE_FAILED;
    });
  });
}
