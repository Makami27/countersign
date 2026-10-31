import type { SqlRows } from "@countersign/adapters/sql";
import type { Caps } from "@countersign/core";

const BASE_UNITS = /^(0|[1-9]\d*)$/;
export const MAX_CAP_BASE_UNITS = 1_000_000_000n;
export const MAX_COOLDOWN_SECONDS = 7 * 24 * 3600;

export type OwnerSettingsValues = { readonly perPaymentBaseUnits: bigint; readonly perDayBaseUnits: bigint; readonly cooldownSeconds: number };
export type SettingsUpdate = { readonly ok: true; readonly values: OwnerSettingsValues } | { readonly ok: false; readonly problem: string };

export class OwnerSettings {
  readonly #rows: SqlRows;
  #values: OwnerSettingsValues;

  private constructor(rows: SqlRows, values: OwnerSettingsValues) {
    this.#rows = rows;
    this.#values = values;
  }

  static async open(rows: SqlRows, defaults: OwnerSettingsValues): Promise<OwnerSettings> {
    await rows.exec("CREATE TABLE IF NOT EXISTS owner_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const stored = new Map((await rows.all("SELECT key, value FROM owner_settings")).map((row) => [String(row["key"]), String(row["value"])]));
    const read = (key: string): string | null => {
      const value = stored.get(key);
      return value !== undefined && BASE_UNITS.test(value) ? value : null;
    };
    const perPayment = read("perPaymentBaseUnits");
    const perDay = read("perDayBaseUnits");
    const cooldown = read("cooldownSeconds");
    return new OwnerSettings(rows, {
      perPaymentBaseUnits: perPayment ? BigInt(perPayment) : defaults.perPaymentBaseUnits,
      perDayBaseUnits: perDay ? BigInt(perDay) : defaults.perDayBaseUnits,
      cooldownSeconds: cooldown ? Number(cooldown) : defaults.cooldownSeconds,
    });
  }

  values(): OwnerSettingsValues {
    return this.#values;
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

  validate(input: { readonly perPaymentBaseUnits: string; readonly perDayBaseUnits: string; readonly cooldownSeconds: string }): SettingsUpdate {
    if (![input.perPaymentBaseUnits, input.perDayBaseUnits, input.cooldownSeconds].every((v) => BASE_UNITS.test(v))) return { ok: false, problem: "Use whole numbers only." };
    const values = { perPaymentBaseUnits: BigInt(input.perPaymentBaseUnits), perDayBaseUnits: BigInt(input.perDayBaseUnits), cooldownSeconds: Number(input.cooldownSeconds) };
    if (values.perPaymentBaseUnits === 0n || values.perDayBaseUnits === 0n) return { ok: false, problem: "Caps must be above zero." };
    if (values.perPaymentBaseUnits > values.perDayBaseUnits) return { ok: false, problem: "The per-payment cap can't be above the daily cap." };
    if (values.perDayBaseUnits > MAX_CAP_BASE_UNITS) return { ok: false, problem: "The daily cap can't be above 1,000 USDC in this build." };
    if (values.cooldownSeconds > MAX_COOLDOWN_SECONDS) return { ok: false, problem: "The cooldown can't be longer than 7 days." };
    return { ok: true, values };
  }

  async update(input: { readonly perPaymentBaseUnits: string; readonly perDayBaseUnits: string; readonly cooldownSeconds: string }): Promise<SettingsUpdate> {
    if (![input.perPaymentBaseUnits, input.perDayBaseUnits, input.cooldownSeconds].every((v) => BASE_UNITS.test(v))) return { ok: false, problem: "Use whole numbers only." };
    const perPayment = BigInt(input.perPaymentBaseUnits);
    const perDay = BigInt(input.perDayBaseUnits);
    const cooldown = Number(input.cooldownSeconds);
    if (perPayment === 0n || perDay === 0n) return { ok: false, problem: "Caps must be above zero." };
    if (perPayment > perDay) return { ok: false, problem: "The per-payment cap can't be above the daily cap." };
    if (perDay > MAX_CAP_BASE_UNITS) return { ok: false, problem: "The daily cap can't be above 1,000 USDC in this build." };
    if (cooldown > MAX_COOLDOWN_SECONDS) return { ok: false, problem: "The cooldown can't be longer than 7 days." };
    const write = (key: string, value: string) => this.#rows.run("INSERT INTO owner_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [key, value]);
    await write("perPaymentBaseUnits", perPayment.toString());
    await write("perDayBaseUnits", perDay.toString());
    await write("cooldownSeconds", String(cooldown));
    this.#values = { perPaymentBaseUnits: perPayment, perDayBaseUnits: perDay, cooldownSeconds: cooldown };
    return { ok: true, values: this.#values };
  }
}
