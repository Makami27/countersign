import { createHash, randomBytes } from "node:crypto";
import type { SqlRows } from "@countersign/adapters/sql";

export const SIGN_IN_LIFETIME_MS = 10 * 60 * 1000;
export const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE_LIFETIME_MS = SESSION_LIFETIME_MS;
const SESSION_RENEW_AFTER_MS = 60_000;
export const SIGN_IN_VERSION = "Countersign sign-in v1";

const SCHEMA = `
DROP TABLE IF EXISTS login_codes;
DROP TABLE IF EXISTS owner_sessions;
CREATE TABLE IF NOT EXISTS sign_in_nonces (hash TEXT PRIMARY KEY, address TEXT NOT NULL, expires_at BIGINT NOT NULL, used INTEGER NOT NULL DEFAULT 0 CHECK (used IN (0,1)));
CREATE TABLE IF NOT EXISTS wallet_sessions (hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL, address TEXT NOT NULL, expires_at BIGINT NOT NULL);
`;

export type SignInChallenge = { readonly nonce: string; readonly message: string; readonly expires: string };
export type PendingSignIn = { readonly ok: true; readonly message: string } | { readonly ok: false; readonly problem: "UNKNOWN_NONCE" | "USED" | "EXPIRED" | "WRONG_ADDRESS" };
export type Session = { readonly ownerId: string; readonly address: string };

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function signInMessage(domain: string, address: string, nonce: string, expires: string): string {
  return [SIGN_IN_VERSION, `domain:${domain}`, "purpose:sign in to your Countersign agent", `address:${address}`, `nonce:${nonce}`, `expires:${expires}`].join("\n");
}

export class OwnerAuth {
  readonly #rows: SqlRows;
  readonly #domain: string;
  readonly #now: () => number;

  private constructor(rows: SqlRows, domain: string, now: () => number) {
    this.#rows = rows;
    this.#domain = domain;
    this.#now = now;
  }

  static async open(rows: SqlRows, domain: string, now: () => number = Date.now): Promise<OwnerAuth> {
    await rows.exec(SCHEMA);
    return new OwnerAuth(rows, domain, now);
  }

  async challenge(address: string): Promise<SignInChallenge> {
    const nonce = randomBytes(16).toString("hex");
    const expiresAt = this.#now() + SIGN_IN_LIFETIME_MS;
    await this.#rows.run("INSERT INTO sign_in_nonces (hash, address, expires_at) VALUES (?,?,?)", [hash(nonce), address, expiresAt]);
    const expires = new Date(expiresAt).toISOString();
    return { nonce, expires, message: signInMessage(this.#domain, address, nonce, expires) };
  }

  async pending(address: string, nonce: string): Promise<PendingSignIn> {
    const row = await this.#rows.get("SELECT address, expires_at, used FROM sign_in_nonces WHERE hash = ?", [hash(nonce)]);
    if (!row) return { ok: false, problem: "UNKNOWN_NONCE" };
    if (Number(row["used"]) === 1) return { ok: false, problem: "USED" };
    if (Number(row["expires_at"]) <= this.#now()) return { ok: false, problem: "EXPIRED" };
    if (row["address"] !== address) return { ok: false, problem: "WRONG_ADDRESS" };
    return { ok: true, message: signInMessage(this.#domain, address, nonce, new Date(Number(row["expires_at"])).toISOString()) };
  }

  async consume(nonce: string): Promise<boolean> {
    return (await this.#rows.run("UPDATE sign_in_nonces SET used = 1 WHERE hash = ? AND used = 0 AND expires_at > ?", [hash(nonce), this.#now()])) === 1;
  }

  async startSession(ownerId: string, address: string): Promise<{ readonly token: string; readonly expiresAt: number }> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = this.#now() + SESSION_LIFETIME_MS;
    await this.#rows.run("INSERT INTO wallet_sessions (hash, owner_id, address, expires_at) VALUES (?,?,?,?)", [hash(token), ownerId, address, expiresAt]);
    return { token, expiresAt };
  }

  async session(token: string | null): Promise<Session | null> {
    if (!token) return null;
    const now = this.#now();
    const row = await this.#rows.get("SELECT owner_id, address, expires_at FROM wallet_sessions WHERE hash = ? AND expires_at > ?", [hash(token), now]);
    if (!row) return null;
    if (Number(row["expires_at"]) < now + SESSION_LIFETIME_MS - SESSION_RENEW_AFTER_MS) await this.#rows.run("UPDATE wallet_sessions SET expires_at = ? WHERE hash = ? AND expires_at > ?", [now + SESSION_LIFETIME_MS, hash(token), now]);
    return { ownerId: String(row["owner_id"]), address: String(row["address"]) };
  }

  async sessionValid(token: string | null): Promise<boolean> {
    return (await this.session(token)) !== null;
  }

  async endSession(token: string | null): Promise<void> {
    if (token) await this.#rows.run("DELETE FROM wallet_sessions WHERE hash = ?", [hash(token)]);
  }
}
