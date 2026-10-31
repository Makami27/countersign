export type Config = {
  readonly network: "mainnet" | "testnet";
  readonly tatumApiKey: string;
  readonly memwal: { readonly key: string; readonly accountId: string; readonly serverUrl: string };
  readonly recordSigningKey: string;
  readonly agentWalletKey: string;
  readonly ownerId: string;
  readonly telegram: { readonly token: string; readonly ownerUserId: number };
  readonly gemini: { readonly apiKey: string; readonly model: string };
  readonly caps: { readonly perPaymentBaseUnits: bigint; readonly perDayBaseUnits: bigint };
  readonly cooldownMs: number;
  readonly databasePath: string;
  readonly memoryBackend: "walrus" | "sandbox";
  readonly port: number;
  readonly publicUrl: string | null;
};

export class ConfigError extends Error {
  readonly missing: readonly string[];
  constructor(missing: readonly string[]) {
    super(`Invalid or missing configuration: ${missing.join(", ")}. Nothing was started.`);
    this.missing = missing;
  }
}

const BASE_UNITS = /^(0|[1-9]\d*)$/;

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const problems: string[] = [];
  const need = (name: string): string => {
    const value = env[name];
    if (value === undefined || value.trim() === "") problems.push(name);
    return value?.trim() ?? "";
  };
  const network = need("NETWORK");
  if (network !== "" && network !== "mainnet" && network !== "testnet") problems.push("NETWORK (mainnet|testnet)");
  const baseUnits = (name: string): bigint => {
    const value = need(name);
    if (value !== "" && !BASE_UNITS.test(value)) problems.push(`${name} (integer base units)`);
    return BASE_UNITS.test(value) ? BigInt(value) : 0n;
  };
  const ownerUserId = Number(need("TELEGRAM_OWNER_USER_ID"));
  const cooldownSeconds = Number(need("CHANGE_COOLDOWN_SECONDS"));
  if (!Number.isInteger(ownerUserId)) problems.push("TELEGRAM_OWNER_USER_ID (integer)");
  if (!Number.isInteger(cooldownSeconds) || cooldownSeconds < 0) problems.push("CHANGE_COOLDOWN_SECONDS (integer ≥ 0)");
  const config: Config = {
    network: network === "mainnet" ? "mainnet" : "testnet",
    tatumApiKey: need("TATUM_API_KEY"),
    memwal: { key: need("MEMWAL_PRIVATE_KEY"), accountId: need("MEMWAL_ACCOUNT_ID"), serverUrl: need("MEMWAL_RELAYER_URL") },
    recordSigningKey: need("AGENT_RECORD_SIGNING_KEY"),
    agentWalletKey: need("AGENT_WALLET_PRIVATE_KEY"),
    ownerId: need("OWNER_ID"),
    telegram: { token: need("TELEGRAM_BOT_TOKEN"), ownerUserId },
    gemini: { apiKey: need("GEMINI_API_KEY"), model: need("GEMINI_MODEL") },
    caps: { perPaymentBaseUnits: baseUnits("CAP_PER_PAYMENT_USDC_BASE_UNITS"), perDayBaseUnits: baseUnits("CAP_PER_DAY_USDC_BASE_UNITS") },
    cooldownMs: cooldownSeconds * 1000,
    databasePath: need("DATABASE_PATH"),
    memoryBackend: env["MEMORY_BACKEND"] === "sandbox" ? "sandbox" : "walrus",
    port: Number(env["WEB_PORT"] ?? env["PORT"]),
    publicUrl: env["PUBLIC_BASE_URL"]?.trim().replace(/\/+$/, "") || null,
  };
  const backend = need("MEMORY_BACKEND");
  if (backend !== "" && backend !== "walrus" && backend !== "sandbox") problems.push("MEMORY_BACKEND (walrus|sandbox)");
  if (backend === "sandbox" && network === "mainnet") problems.push("MEMORY_BACKEND=sandbox is not allowed with NETWORK=mainnet");
  if (!Number.isInteger(config.port) || config.port <= 0) problems.push("WEB_PORT or PORT (positive integer)");
  if (config.publicUrl !== null && !/^https?:\/\/[^\s/]+$/.test(config.publicUrl)) problems.push("PUBLIC_BASE_URL (origin like https://example.com)");
  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}
