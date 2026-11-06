import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const PUBLIC = "apps/web/public";
const ICON_SIZES: readonly (readonly [string, number])[] = [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]];
const ICO_SIZE = 48;

function icoFrom(png: Buffer, size: number): Buffer {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(size, 6);
  header.writeUInt8(size, 7);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}

const square = readFileSync(`${PUBLIC}/favicon.svg`, "utf8").replace(/ rx="\d+"/, "");
const browser = await chromium.launch();
async function render(size: number): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<!doctype html><style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${square}`);
  const png = await page.screenshot({ type: "png" });
  await page.close();
  return png;
}
mkdirSync(`${PUBLIC}/icons`, { recursive: true });
for (const [name, size] of ICON_SIZES) writeFileSync(`${PUBLIC}/icons/${name}`, await render(size));
writeFileSync(`${PUBLIC}/favicon.ico`, icoFrom(await render(ICO_SIZE), ICO_SIZE));
await browser.close();
