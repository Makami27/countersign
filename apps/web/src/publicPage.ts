import { groupAddress } from "../client/addressGroups.ts";
import { COUNTER_CROSS, COUNTER_STROKE, COUNTER_VIEWBOX } from "../client/wordmark.ts";

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function wordmarkSvg(): string {
  return `<svg class="counter" viewBox="${COUNTER_VIEWBOX}" aria-hidden="true" focusable="false"><path d="${COUNTER_STROKE}" pathLength="1"/><path class="cross" d="${COUNTER_CROSS}" pathLength="1"/></svg>`;
}

export function addressHtml(address: string, against: string | null): string {
  const grouped = groupAddress(address, against ? { against } : {});
  const groups = grouped.groups.map((g) => `<span class="g${g.mark ? ` ${g.mark}` : ""}" aria-hidden="true">${escapeHtml(g.text)}</span>`).join("<wbr>");
  return `<span class="addr" role="text" title="${escapeHtml(grouped.full)}" aria-label="${escapeHtml(grouped.label)}">${groups}</span>`;
}

export function shortAddressHtml(address: string): string {
  const grouped = groupAddress(address, { short: true });
  return `<span class="addr short" role="text" title="${escapeHtml(grouped.full)}" aria-label="${escapeHtml(grouped.label)}">${grouped.groups.map((g) => `<span class="g" aria-hidden="true">${escapeHtml(g.text)}</span>`).join("")}</span>`;
}

export function networkLabel(network: "mainnet" | "testnet"): string {
  return `<span class="netlabel">${network === "mainnet" ? "Sui mainnet" : "Sui testnet · test USDC"}</span>`;
}

export function publicPage(title: string, body: string, network: "mainnet" | "testnet" | null, mainClass = "detail receipt"): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · Countersign</title>
<meta name="theme-color" content="#F6F8FD" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0F1A3A" media="(prefers-color-scheme: dark)">
<meta name="application-name" content="Countersign">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/icons/icon-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="preload" href="/fonts/familjen-grotesk-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/tokens.css">
<link rel="stylesheet" href="/styles.css">
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div class="app">
<header class="bar"><a class="wordmark" href="/" aria-label="Countersign home">${wordmarkSvg()}<span>sign</span></a>${network === null ? "" : networkLabel(network)}<nav aria-label="Site"><a href="/demo">Demo</a><a href="/proof">Proof</a><a href="/status">Status</a></nav></header>
<main class="${mainClass} prose-links">${body}</main>
</div>
</body>
</html>`;
}
