import { createHash, randomBytes } from "node:crypto";
import type { SqlRows } from "@countersign/adapters/sql";

export const LINK_LIFETIME_MS = 10 * 60 * 1000;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS telegram_links (telegram_user_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL UNIQUE, linked_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS telegram_link_tokens (hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL, expires_at BIGINT NOT NULL, used INTEGER NOT NULL DEFAULT 0 CHECK (used IN (0,1)));
`;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export type Redeemed = { readonly ok: true; readonly ownerId: string } | { readonly ok: false; readonly why: "UNKNOWN" | "ADMIN_CHAT" };

export class TelegramLinks {
  readonly #rows: SqlRows;
  readonly #admin: { readonly telegramUserId: number; readonly ownerId: string };
  readonly #now: () => number;

  private constructor(rows: SqlRows, admin: { readonly telegramUserId: number; readonly ownerId: string }, now: () => number) {
    this.#rows = rows;
    this.#admin = admin;
    this.#now = now;
  }

  static async open(rows: SqlRows, admin: { readonly telegramUserId: number; readonly ownerId: string }, now: () => number = Date.now): Promise<TelegramLinks> {
    await rows.exec(SCHEMA);
    return new TelegramLinks(rows, admin, now);
  }

  async issue(ownerId: string): Promise<{ readonly token: string; readonly expires: string }> {
    const token = randomBytes(16).toString("hex");
    const expiresAt = this.#now() + LINK_LIFETIME_MS;
    await this.#rows.run("INSERT INTO telegram_link_tokens (hash, owner_id, expires_at) VALUES (?,?,?)", [hash(token), ownerId, expiresAt]);
    return { token, expires: new Date(expiresAt).toISOString() };
  }

  async redeem(token: string, telegramUserId: number): Promise<Redeemed> {
    if (!/^[0-9a-f]{32}$/.test(token)) return { ok: false, why: "UNKNOWN" };
    if (telegramUserId === this.#admin.telegramUserId) return { ok: false, why: "ADMIN_CHAT" };
    const row = await this.#rows.get("SELECT owner_id FROM telegram_link_tokens WHERE hash = ? AND used = 0 AND expires_at > ?", [hash(token), this.#now()]);
    if (!row) return { ok: false, why: "UNKNOWN" };
    if ((await this.#rows.run("UPDATE telegram_link_tokens SET used = 1 WHERE hash = ? AND used = 0", [hash(token)])) !== 1) return { ok: false, why: "UNKNOWN" };
    const ownerId = String(row["owner_id"]);
    await this.#rows.run("DELETE FROM telegram_links WHERE owner_id = ? OR telegram_user_id = ?", [ownerId, String(telegramUserId)]);
    await this.#rows.run("INSERT INTO telegram_links (telegram_user_id, owner_id, linked_at) VALUES (?,?,?)", [String(telegramUserId), ownerId, this.#now()]);
    return { ok: true, ownerId };
  }

  async ownerOf(telegramUserId: number): Promise<string | null> {
    if (telegramUserId === this.#admin.telegramUserId) return this.#admin.ownerId;
    const row = await this.#rows.get("SELECT owner_id FROM telegram_links WHERE telegram_user_id = ?", [String(telegramUserId)]);
    return row ? String(row["owner_id"]) : null;
  }

  async chatOf(ownerId: string): Promise<number | null> {
    if (ownerId === this.#admin.ownerId) return this.#admin.telegramUserId;
    const row = await this.#rows.get("SELECT telegram_user_id FROM telegram_links WHERE owner_id = ?", [ownerId]);
    return row ? Number(row["telegram_user_id"]) : null;
  }

  async forget(ownerId: string): Promise<void> {
    await this.#rows.run("DELETE FROM telegram_links WHERE owner_id = ?", [ownerId]);
    await this.#rows.run("DELETE FROM telegram_link_tokens WHERE owner_id = ?", [ownerId]);
  }
}
