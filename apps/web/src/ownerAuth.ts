import { createHash, randomBytes } from "node:crypto";
import type { SqlRows } from "@countersign/adapters/sql";

export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 10;
export const CODE_LIFETIME_MS = 10 * 60 * 1000;
export const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS login_codes (hash TEXT PRIMARY KEY, expires_at BIGINT NOT NULL, used INTEGER NOT NULL DEFAULT 0 CHECK (used IN (0,1)));
CREATE TABLE IF NOT EXISTS owner_sessions (hash TEXT PRIMARY KEY, expires_at BIGINT NOT NULL);
`;

export type Redeemed = { readonly ok: true; readonly token: string; readonly expiresAt: number } | { readonly ok: false };

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function formatCode(code: string): string {
  return `${code.slice(0, CODE_LENGTH / 2)}-${code.slice(CODE_LENGTH / 2)}`;
}

export class OwnerAuth {
  readonly #rows: SqlRows;
  readonly #now: () => number;

  private constructor(rows: SqlRows, now: () => number) {
    this.#rows = rows;
    this.#now = now;
  }

  static async open(rows: SqlRows, now: () => number = Date.now): Promise<OwnerAuth> {
    await rows.exec(SCHEMA);
    return new OwnerAuth(rows, now);
  }

  async issueCode(): Promise<string> {
    const bytes = randomBytes(CODE_LENGTH);
    const code = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
    await this.#rows.run("INSERT INTO login_codes (hash, expires_at) VALUES (?, ?)", [hash(code), this.#now() + CODE_LIFETIME_MS]);
    return formatCode(code);
  }

  async redeemCode(input: string): Promise<Redeemed> {
    const code = normalizeCode(input);
    if (code.length !== CODE_LENGTH) return { ok: false };
    if (!(await this.#claim(code))) return { ok: false };
    const token = randomBytes(32).toString("base64url");
    const expiresAt = this.#now() + SESSION_LIFETIME_MS;
    await this.#rows.run("INSERT INTO owner_sessions (hash, expires_at) VALUES (?, ?)", [hash(token), expiresAt]);
    return { ok: true, token, expiresAt };
  }

  async consumeCode(input: string): Promise<boolean> {
    const code = normalizeCode(input);
    if (code.length !== CODE_LENGTH) return false;
    return this.#claim(code);
  }

  async sessionValid(token: string | null): Promise<boolean> {
    if (!token) return false;
    return (await this.#rows.get("SELECT 1 AS ok FROM owner_sessions WHERE hash = ? AND expires_at > ?", [hash(token), this.#now()])) !== undefined;
  }

  async endSession(token: string | null): Promise<void> {
    if (token) await this.#rows.run("DELETE FROM owner_sessions WHERE hash = ?", [hash(token)]);
  }

  async #claim(code: string): Promise<boolean> {
    return (await this.#rows.run("UPDATE login_codes SET used = 1 WHERE hash = ? AND used = 0 AND expires_at > ?", [hash(code), this.#now()])) === 1;
  }
}
