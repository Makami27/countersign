import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const PATTERNS = [
  [/suiprivkey1[0-9a-z]{50,}/, "Sui private key"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "PEM private key"],
  [/\b\d{8,10}:[A-Za-z0-9_-]{35}\b/, "Telegram bot token"],
  [/AIza[0-9A-Za-z_-]{35}/, "Google API key"],
];

const MIN_SECRET_LENGTH = 12;
const ENV_FILES = [".env", "spikes/.env"];
const PUBLIC_CONFIG_KEYS = new Set([
  "NETWORK",
  "MEMWAL_RELAYER_URL",
  "GEMINI_MODEL",
  "CAP_PER_PAYMENT_USDC_BASE_UNITS",
  "CAP_PER_DAY_USDC_BASE_UNITS",
  "CHANGE_COOLDOWN_SECONDS",
  "DATABASE_PATH",
  "PROOF_DATABASE_PATH",
  "WEB_PORT",
  "WALLET_B_ADDRESS",
]);

const envSecrets = ENV_FILES.filter((file) => existsSync(file)).flatMap((file) =>
  readFileSync(file, "utf8")
    .split("\n")
    .map((line) => ({ file, key: line.split("=")[0].trim(), value: line.split("=").slice(1).join("=").trim() }))
    .filter(({ key, value }) => !key.startsWith("#") && !PUBLIC_CONFIG_KEYS.has(key) && value.length >= MIN_SECRET_LENGTH),
);

let tracked;
try {
  tracked = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\n").filter(Boolean);
} catch {
  console.error("check-secrets needs a git repository. Nothing was scanned.");
  process.exit(1);
}

const allowed = JSON.parse(readFileSync("scripts/secret-allowlist.json", "utf8")).map((entry) => entry.value);

const findings = [];
for (const file of tracked) {
  if (ENV_FILES.includes(file) || !existsSync(file)) continue;
  const text = allowed.reduce((t, value) => t.split(value).join(""), readFileSync(file, "utf8"));
  for (const [pattern, label] of PATTERNS) if (pattern.test(text)) findings.push(`${file}: ${label}`);
  for (const secret of envSecrets) if (text.includes(secret.value)) findings.push(`${file}: the value of ${secret.key} from ${secret.file}`);
}
if (findings.length > 0) {
  console.error(`Secrets found:\n${findings.join("\n")}`);
  process.exit(1);
}
console.log(`secrets: clean (${tracked.length} files)`);
