import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const steps = [
  ["typecheck", existsSync("node_modules/typescript") ? ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"] : null],
  ["no comments", ["scripts/check-no-comments.mjs"]],
  ["secrets", ["scripts/check-secrets.mjs"]],
  ["tests", ["--test", "--test-reporter=spec", "packages/*/test/*.test.ts", "apps/*/test/*.test.ts"]],
  ["claims", ["scripts/check-claims.mjs"]],
];

let failed = 0;
for (const [name, args] of steps) {
  if (args === null) {
    console.error(`✖ ${name}: typescript is not installed (run pnpm install). Gate fails rather than skipping.`);
    failed++;
    continue;
  }
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.status === 0) console.log(`✔ ${name}`);
  else {
    console.error(`✖ ${name}`);
    failed++;
  }
}
console.log(failed === 0 ? "\nGATE PASSED" : `\nGATE FAILED (${failed} step${failed === 1 ? "" : "s"})`);
process.exit(failed === 0 ? 0 : 1);
