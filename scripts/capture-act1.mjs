import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const RUN = process.argv[2] ?? "2026-10-30T21-53-37-449Z";
const OUT = "evidence/acts/act1";
const evidence = JSON.parse(readFileSync(`evidence/acts/act1-${RUN}.json`, "utf8"));
const transcript = readFileSync(`evidence/acts/act1-${RUN}.txt`, "utf8").trim().split("\n");
const receipt = evidence.receiptRecord;
const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;background:#E9F0EA;color:#18233D;font:15px/1.5 system-ui,sans-serif;padding:20px}
h1{font-size:20px;margin:0 0 4px}.note{color:#4A5670;font-size:13px;margin:0 0 16px}
pre{white-space:pre-wrap;word-break:break-all;background:#0E1626;color:#E4ECE6;padding:14px;border-radius:6px;font:12px/1.55 ui-monospace,Menlo,monospace}
dl{display:grid;grid-template-columns:10rem 1fr;gap:6px 12px;background:#F4F8F4;border:1px solid #B9C8BD;border-radius:6px;padding:14px}
dt{color:#4A5670}dd{margin:0;word-break:break-all;font-family:ui-monospace,Menlo,monospace;font-size:13px}
ol{margin:0;padding-left:20px}.pass{color:#0F6B5C;font-weight:600}
</style></head><body>
<h1>Act 1: pay rent (testnet demo)</h1>
<p class="note">Rendered unedited from evidence/acts/act1-${RUN}.txt and .json. Money: Sui testnet, test USDC. Memory: Walrus Memory mainnet relayer, demo owner excluded from real-use counts.</p>
<pre>${transcript.map(escape).join("\n")}</pre>
<h1>Receipt ${escape(receipt.receipt)}</h1>
<dl>
<dt>Verdict</dt><dd>${escape(receipt.verdict)}</dd>
<dt>Amount</dt><dd>${escape(receipt.amountBaseUnits)} base units (${Number(receipt.amountBaseUnits) / 1e6} USDC)</dd>
<dt>Paid to</dt><dd>${escape(receipt.address)}</dd>
<dt>Checks, in order</dt><dd><ol>${receipt.checks.map((c) => `<li><span class="pass">${escape(c.result)}</span> ${escape(c.check)}</li>`).join("")}</ol></dd>
<dt>Payee record blob</dt><dd>${escape(receipt.memoryBlobIds.join(", "))}</dd>
<dt>Receipt blob</dt><dd>${escape(evidence.receipt.blobId)}</dd>
<dt>Sui transaction</dt><dd>${escape(receipt.suiDigest)} (${escape(receipt.network)})</dd>
<dt>Written</dt><dd>${escape(receipt.createdAt)}</dd>
</dl></body></html>`;

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/act1-rendered.html`, page);
const browser = await chromium.launch();
const shots = [];
for (const [name, width] of [["phone", 390], ["desktop", 1280]]) {
  const tab = await browser.newPage({ viewport: { width, height: 900 } });
  await tab.setContent(page);
  await tab.screenshot({ path: `${OUT}/act1-flow-${name}.png`, fullPage: true });
  shots.push(`${OUT}/act1-flow-${name}.png`);
  await tab.close();
}
for (const [name, url] of [["suiscan-transaction", `https://suiscan.xyz/testnet/tx/${receipt.suiDigest}`], ["walruscan-receipt-blob", `https://walruscan.com/mainnet/blob/${evidence.receipt.blobId}`]]) {
  const tab = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await tab.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
    await tab.waitForTimeout(3_000);
    await tab.screenshot({ path: `${OUT}/act1-${name}.png` });
    shots.push(`${OUT}/act1-${name}.png ${url}`);
  } catch (error) {
    shots.push(`FAILED ${name} ${url}: ${String(error).slice(0, 160)}`);
  }
  await tab.close();
}
await browser.close();
writeFileSync(`${OUT}/README.txt`, `Act 1 capture, run ${RUN}\n${shots.join("\n")}\n`);
console.log(shots.join("\n"));
