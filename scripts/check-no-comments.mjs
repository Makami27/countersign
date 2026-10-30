import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["packages", "apps", "scripts"];
const EXTENSIONS = [".ts", ".mjs", ".js"];

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return EXTENSIONS.some((ext) => path.endsWith(ext)) ? [path] : [];
  });
}

function commentLines(source) {
  const hits = [];
  let quote = null;
  let line = 1;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === "\n") line++;
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "/" && (source[i + 1] === "/" || source[i + 1] === "*")) {
      const before = source.slice(Math.max(0, i - 1), i);
      if (before !== "\\") hits.push(line);
      const end = source[i + 1] === "/" ? source.indexOf("\n", i) : source.indexOf("*/", i + 2) + 1;
      if (end <= 0) break;
      line += source.slice(i, end).split("\n").length - 1;
      i = end;
    }
  }
  return hits;
}

const violations = ROOTS.flatMap((root) => files(root)).flatMap((file) => commentLines(readFileSync(file, "utf8")).map((line) => `${file}:${line}`));
if (violations.length > 0) {
  console.error(`Comments are not allowed; rename or split the code so it explains itself.\n${violations.join("\n")}`);
  process.exit(1);
}
console.log("no-comments: clean");
