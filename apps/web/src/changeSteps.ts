import { DatabaseSync } from "node:sqlite";

const BUSY_TIMEOUT_MS = 5_000;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS change_steps (
  nonce TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('current','new')), signature TEXT NOT NULL, signed_at TEXT NOT NULL,
  PRIMARY KEY (nonce, role));
CREATE TABLE IF NOT EXISTS owner_confirmations (nonce TEXT PRIMARY KEY, confirmation_id TEXT NOT NULL, confirmed_at TEXT NOT NULL);
`;

export type StepRole = "current" | "new";
export type ChangeProgress = {
  readonly current: { readonly signature: string; readonly signedAt: string } | null;
  readonly next: { readonly signature: string; readonly signedAt: string } | null;
  readonly owner: { readonly confirmationId: string; readonly confirmedAt: string } | null;
};

export class ChangeSteps {
  readonly #db: DatabaseSync;

  constructor(databasePath: string) {
    this.#db = new DatabaseSync(databasePath);
    this.#db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
    this.#db.exec(SCHEMA);
  }

  record(nonce: string, role: StepRole, signature: string, at: string): void {
    this.#db.prepare("INSERT INTO change_steps (nonce, role, signature, signed_at) VALUES (?,?,?,?) ON CONFLICT(nonce, role) DO UPDATE SET signature = excluded.signature, signed_at = excluded.signed_at").run(nonce, role, signature, at);
  }

  confirmByOwner(nonce: string, confirmationId: string, at: string): boolean {
    return Number(this.#db.prepare("INSERT OR IGNORE INTO owner_confirmations (nonce, confirmation_id, confirmed_at) VALUES (?,?,?)").run(nonce, confirmationId, at).changes) === 1;
  }

  progress(nonce: string): ChangeProgress {
    const step = (role: StepRole) => {
      const row = this.#db.prepare("SELECT signature, signed_at FROM change_steps WHERE nonce = ? AND role = ?").get(nonce, role);
      return row ? { signature: String(row["signature"]), signedAt: String(row["signed_at"]) } : null;
    };
    const owner = this.#db.prepare("SELECT confirmation_id, confirmed_at FROM owner_confirmations WHERE nonce = ?").get(nonce);
    return { current: step("current"), next: step("new"), owner: owner ? { confirmationId: String(owner["confirmation_id"]), confirmedAt: String(owner["confirmed_at"]) } : null };
  }

  ownerConfirmedNonces(): readonly string[] {
    return this.#db.prepare("SELECT nonce FROM owner_confirmations").all().map((row) => String(row["nonce"]));
  }
}
