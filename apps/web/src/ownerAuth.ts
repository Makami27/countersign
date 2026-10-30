import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 10;
export const CODE_LIFETIME_MS = 10 * 60 * 1000;
export const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;
const BUSY_TIMEOUT_MS = 5_000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS login_codes (hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0 CHECK (used IN (0,1)));
CREATE TABLE IF NOT EXISTS owner_sessions (hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
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
  readonly #db: DatabaseSync;
  readonly #now: () => number;

  constructor(databasePath: string, now: () => number = Date.now) {
    this.#db = new DatabaseSync(databasePath);
    this.#db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
    this.#db.exec(SCHEMA);
    this.#now = now;
  }

  issueCode(): string {
    const bytes = randomBytes(CODE_LENGTH);
    const code = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
    this.#db.prepare("INSERT INTO login_codes (hash, expires_at) VALUES (?, ?)").run(hash(code), this.#now() + CODE_LIFETIME_MS);
    return formatCode(code);
  }

  redeemCode(input: string): Redeemed {
    const code = normalizeCode(input);
    if (code.length !== CODE_LENGTH) return { ok: false };
    const changed = this.#db.prepare("UPDATE login_codes SET used = 1 WHERE hash = ? AND used = 0 AND expires_at > ?").run(hash(code), this.#now()).changes;
    if (Number(changed) !== 1) return { ok: false };
    const token = randomBytes(32).toString("base64url");
    const expiresAt = this.#now() + SESSION_LIFETIME_MS;
    this.#db.prepare("INSERT INTO owner_sessions (hash, expires_at) VALUES (?, ?)").run(hash(token), expiresAt);
    return { ok: true, token, expiresAt };
  }

  sessionValid(token: string | null): boolean {
    if (!token) return false;
    return this.#db.prepare("SELECT 1 FROM owner_sessions WHERE hash = ? AND expires_at > ?").get(hash(token), this.#now()) !== undefined;
  }

  endSession(token: string | null): void {
    if (token) this.#db.prepare("DELETE FROM owner_sessions WHERE hash = ?").run(hash(token));
  }
}
