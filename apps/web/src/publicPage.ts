const WORDMARK = `<svg viewBox="0 0 40 24" aria-hidden="true"><path d="M2 17c5-1 7-13 11-12s-4 14 1 13 5-9 8-9-1 8 2 8 6-6 9-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M2 21h36" stroke="currentColor" stroke-width="1"/></svg>`;

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function publicPage(title: string, body: string, network: "mainnet" | "testnet" | null, mainClass = "detail receipt"): string {
  const label = network === null ? "" : `<span class="netlabel">${network === "mainnet" ? "Sui mainnet" : "Sui testnet · test USDC"}</span>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · Countersign</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/familjen-grotesk-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/styles.css">
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div class="app">
<header class="bar"><a class="wordmark" href="/" aria-label="Countersign home">${WORDMARK}<span>Countersign</span></a>${label}</header>
<main class="${mainClass}">${body}</main>
</div>
</body>
</html>`;
}
