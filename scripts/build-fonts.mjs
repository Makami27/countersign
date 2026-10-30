import { mkdirSync, readFileSync, writeFileSync, copyFileSync, statSync } from "node:fs";
import subsetFont from "subset-font";

const LATIN = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCodePoint(0x20 + i)).join("");
const LATIN_1 = Array.from({ length: 0xff - 0xa0 + 1 }, (_, i) => String.fromCodePoint(0xa0 + i)).join("");
const PUNCTUATION = "‘’“”–—…•→×≥≤€£";
const FONTS = [
  ["apps/web/design/fonts/FamiljenGrotesk.ttf", "familjen-grotesk-latin.woff2", LATIN + LATIN_1 + PUNCTUATION],
  ["apps/web/design/fonts/MartianMono.ttf", "martian-mono-latin.woff2", LATIN + "…–—"],
];
const OUT = "apps/web/public/fonts";

mkdirSync(OUT, { recursive: true });
for (const [source, target, text] of FONTS) {
  const subset = await subsetFont(readFileSync(source), text, { targetFormat: "woff2" });
  writeFileSync(`${OUT}/${target}`, subset);
  console.log(`${target}: ${(statSync(source).size / 1024).toFixed(0)} KB TTF -> ${(subset.length / 1024).toFixed(1)} KB WOFF2`);
}
copyFileSync("apps/web/design/fonts/OFL-FamiljenGrotesk.txt", `${OUT}/OFL-FamiljenGrotesk.txt`);
copyFileSync("apps/web/design/fonts/OFL-MartianMono.txt", `${OUT}/OFL-MartianMono.txt`);
