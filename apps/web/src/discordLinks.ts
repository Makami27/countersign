import { createHash, randomInt } from "node:crypto";
import type { SqlRows } from "@countersign/adapters/sql";

export const DISCORD_CODE_LIFETIME_MS = 10 * 60 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
const CODE_LENGTH = 10;
const KEPT_NOTICES = 50;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS discord_links (discord_user_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL UNIQUE, linked_at BIGINT NOT NULL, dm_state TEXT NOT NULL DEFAULT 'ok' CHECK (dm_state IN ('ok','refused','told')));
CREATE TABLE IF NOT EXISTS discord_link_codes (hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL, expires_at BIGINT NOT NULL, used INTEGER NOT NULL DEFAULT 0 CHECK (used IN (0,1)));
CREATE TABLE IF NOT EXISTS discord_undelivered (owner_id TEXT NOT NULL, at BIGINT NOT NULL, text TEXT NOT NULL);
`;

export type UndeliveredNotice = { readonly at: string; readonly text: string };
export type DiscordInstalls = { readonly account: string; readonly server: string };
export type DiscordPort = {
  readonly enabled: boolean;
  readonly installs: DiscordInstalls | null;
  readonly code: () => Promise<{ readonly code: string; readonly expires: string } | null>;
  readonly linked: () => Promise<boolean>;
  readonly undelivered: () => Promise<readonly UndeliveredNotice[]>;
};

export const DISCORD_OFF: DiscordPort = { enabled: false, installs: null, code: async () => null, linked: async () => false, undelivered: async () => [] };

export function discordInstalls(applicationId: string): DiscordInstalls {
  const base = `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(applicationId)}`;
  return { account: `${base}&integration_type=1&scope=applications.commands`, server: `${base}&integration_type=0&scope=bot+applications.commands&permissions=0` };
}

export function normaliseCode(typed: string): string {
  return typed.toUpperCase().replace(/[\s-]/g, "");
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export type DiscordRedeemed = { readonly ok: true; readonly ownerId: string } | { readonly ok: false };

export class DiscordLinks {
  readonly #rows: SqlRows;
  readonly #now: () => number;

  private constructor(rows: SqlRows, now: () => number) {
    this.#rows = rows;
    this.#now = now;
  }

  static async open(rows: SqlRows, now: () => number = Date.now): Promise<DiscordLinks> {
    await rows.exec(SCHEMA);
    return new DiscordLinks(rows, now);
  }

  async issue(ownerId: string): Promise<{ readonly code: string; readonly expires: string }> {
    const raw = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
    const expiresAt = this.#now() + DISCORD_CODE_LIFETIME_MS;
    await this.#rows.run("INSERT INTO discord_link_codes (hash, owner_id, expires_at) VALUES (?,?,?)", [hash(raw), ownerId, expiresAt]);
    return { code: `${raw.slice(0, 5)}-${raw.slice(5)}`, expires: new Date(expiresAt).toISOString() };
  }

  async redeem(typed: string, discordUserId: string): Promise<DiscordRedeemed> {
    const code = normaliseCode(typed);
    if (code.length !== CODE_LENGTH || ![...code].every((c) => CODE_ALPHABET.includes(c)) || !/^\d{5,25}$/.test(discordUserId)) return { ok: false };
    const row = await this.#rows.get("SELECT owner_id FROM discord_link_codes WHERE hash = ? AND used = 0 AND expires_at > ?", [hash(code), this.#now()]);
    if (!row) return { ok: false };
    if ((await this.#rows.run("UPDATE discord_link_codes SET used = 1 WHERE hash = ? AND used = 0", [hash(code)])) !== 1) return { ok: false };
    const ownerId = String(row["owner_id"]);
    await this.#rows.run("DELETE FROM discord_links WHERE owner_id = ? OR discord_user_id = ?", [ownerId, discordUserId]);
    await this.#rows.run("INSERT INTO discord_links (discord_user_id, owner_id, linked_at) VALUES (?,?,?)", [discordUserId, ownerId, this.#now()]);
    return { ok: true, ownerId };
  }

  async ownerOf(discordUserId: string): Promise<string | null> {
    const row = await this.#rows.get("SELECT owner_id FROM discord_links WHERE discord_user_id = ?", [discordUserId]);
    return row ? String(row["owner_id"]) : null;
  }

  async userOf(ownerId: string): Promise<string | null> {
    const row = await this.#rows.get("SELECT discord_user_id FROM discord_links WHERE owner_id = ?", [ownerId]);
    return row ? String(row["discord_user_id"]) : null;
  }

  async dmDelivered(ownerId: string): Promise<void> {
    await this.#rows.run("UPDATE discord_links SET dm_state = 'ok' WHERE owner_id = ?", [ownerId]);
  }

  async keepUndelivered(ownerId: string, text: string): Promise<void> {
    await this.#rows.run("INSERT INTO discord_undelivered (owner_id, at, text) VALUES (?,?,?)", [ownerId, this.#now(), text]);
  }

  async dmRefused(ownerId: string, text: string): Promise<void> {
    await this.keepUndelivered(ownerId, text);
    await this.#rows.run("UPDATE discord_links SET dm_state = 'refused' WHERE owner_id = ? AND dm_state = 'ok'", [ownerId]);
  }

  async takeDmWarning(ownerId: string): Promise<boolean> {
    return (await this.#rows.run("UPDATE discord_links SET dm_state = 'told' WHERE owner_id = ? AND dm_state = 'refused'", [ownerId])) === 1;
  }

  async undelivered(ownerId: string): Promise<readonly UndeliveredNotice[]> {
    const rows = await this.#rows.all("SELECT at, text FROM discord_undelivered WHERE owner_id = ? ORDER BY at DESC LIMIT ?", [ownerId, KEPT_NOTICES]);
    return rows.map((r) => ({ at: new Date(Number(r["at"])).toISOString(), text: String(r["text"]) }));
  }

  async forget(ownerId: string): Promise<void> {
    await this.#rows.run("DELETE FROM discord_links WHERE owner_id = ?", [ownerId]);
    await this.#rows.run("DELETE FROM discord_link_codes WHERE owner_id = ?", [ownerId]);
    await this.#rows.run("DELETE FROM discord_undelivered WHERE owner_id = ?", [ownerId]);
  }

  portFor(ownerId: string, applicationId: string, ready: () => boolean): DiscordPort {
    return {
      enabled: true,
      installs: discordInstalls(applicationId),
      code: async () => (ready() ? this.issue(ownerId) : null),
      linked: async () => (await this.userOf(ownerId)) !== null,
      undelivered: () => this.undelivered(ownerId),
    };
  }
}
