import { DatabaseSync } from "node:sqlite";
import type { Caps } from "@countersign/core";

const BASE_UNITS = /^(0|[1-9]\d*)$/;
const BUSY_TIMEOUT_MS = 5_000;
export const MAX_CAP_BASE_UNITS = 1_000_000_000n;
export const MAX_COOLDOWN_SECONDS = 7 * 24 * 3600;

export type OwnerSettingsValues = { readonly perPaymentBaseUnits: bigint; readonly perDayBaseUnits: bigint; readonly cooldownSeconds: number };
export type SettingsUpdate = { readonly ok: true; readonly values: OwnerSettingsValues } | { readonly ok: false; readonly problem: string };

export class OwnerSettings {
  readonly #db: DatabaseSync;
  readonly #defaults: OwnerSettingsValues;

  constructor(databasePath: string, defaults: OwnerSettingsValues) {
    this.#db = new DatabaseSync(databasePath);
    this.#db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
    this.#db.exec("CREATE TABLE IF NOT EXISTS owner_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    this.#defaults = defaults;
  }

  values(): OwnerSettingsValues {
    const read = (key: string): string | null => {
      const row = this.#db.prepare("SELECT value FROM owner_settings WHERE key = ?").get(key);
      return row ? String(row["value"]) : null;
    };
    const perPayment = read("perPaymentBaseUnits");
    const perDay = read("perDayBaseUnits");
    const cooldown = read("cooldownSeconds");
    return {
      perPaymentBaseUnits: perPayment && BASE_UNITS.test(perPayment) ? BigInt(perPayment) : this.#defaults.perPaymentBaseUnits,
      perDayBaseUnits: perDay && BASE_UNITS.test(perDay) ? BigInt(perDay) : this.#defaults.perDayBaseUnits,
      cooldownSeconds: cooldown && BASE_UNITS.test(cooldown) ? Number(cooldown) : this.#defaults.cooldownSeconds,
    };
  }

  caps(): Caps {
    const settings = this;
    return {
      get perPaymentBaseUnits() {
        return settings.values().perPaymentBaseUnits;
      },
      get perDayBaseUnits() {
        return settings.values().perDayBaseUnits;
      },
    };
  }

  update(input: { readonly perPaymentBaseUnits: string; readonly perDayBaseUnits: string; readonly cooldownSeconds: string }): SettingsUpdate {
    if (![input.perPaymentBaseUnits, input.perDayBaseUnits, input.cooldownSeconds].every((v) => BASE_UNITS.test(v))) return { ok: false, problem: "Use whole numbers only." };
    const perPayment = BigInt(input.perPaymentBaseUnits);
    const perDay = BigInt(input.perDayBaseUnits);
    const cooldown = Number(input.cooldownSeconds);
    if (perPayment === 0n || perDay === 0n) return { ok: false, problem: "Caps must be above zero." };
    if (perPayment > perDay) return { ok: false, problem: "The per-payment cap can't be above the daily cap." };
    if (perDay > MAX_CAP_BASE_UNITS) return { ok: false, problem: "The daily cap can't be above 1,000 USDC in this build." };
    if (cooldown > MAX_COOLDOWN_SECONDS) return { ok: false, problem: "The cooldown can't be longer than 7 days." };
    const write = this.#db.prepare("INSERT INTO owner_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    write.run("perPaymentBaseUnits", perPayment.toString());
    write.run("perDayBaseUnits", perDay.toString());
    write.run("cooldownSeconds", String(cooldown));
    return { ok: true, values: this.values() };
  }
}
