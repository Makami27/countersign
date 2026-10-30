import { readFileSync } from "node:fs";

const ledger = readFileSync("CLAIMS.md", "utf8");
const status = new Map();
for (const row of ledger.split("\n")) {
  const cells = row.split("|").map((c) => c.trim());
  if (cells.length > 3 && /^CL\d+$/.test(cells[1] ?? "")) status.set(cells[1], cells[3]);
}

const copy = ["README.md"].map((file) => [file, readFileSync(file, "utf8")]);
const problems = [];
for (const [file, text] of copy) {
  for (const match of text.matchAll(/\[claim:(CL\d+)\]/g)) {
    const id = match[1];
    if (!status.has(id)) problems.push(`${file}: ${id} is not in CLAIMS.md`);
    else if (status.get(id) !== "PROVEN") problems.push(`${file}: ${id} is ${status.get(id)}, only PROVEN claims may appear in copy`);
  }
}
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`claims: ${status.size} in ledger, copy only cites PROVEN`);
