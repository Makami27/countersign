import type { SqlRows } from "@countersign/adapters/sql";

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
  readonly #rows: SqlRows;
  #open: Set<string> | null = null;
  readonly #notBefore = new Map<string, number>();

  private constructor(rows: SqlRows) {
    this.#rows = rows;
  }

  static async open(rows: SqlRows): Promise<ChangeSteps> {
    await rows.exec(SCHEMA);
    return new ChangeSteps(rows);
  }

  async record(nonce: string, role: StepRole, signature: string, at: string): Promise<void> {
    await this.#rows.run("INSERT INTO change_steps (nonce, role, signature, signed_at) VALUES (?,?,?,?) ON CONFLICT (nonce, role) DO UPDATE SET signature = excluded.signature, signed_at = excluded.signed_at", [nonce, role, signature, at]);
    this.#notBefore.delete(nonce);
  }

  async confirmByOwner(nonce: string, confirmationId: string, at: string): Promise<boolean> {
    const added = (await this.#rows.run("INSERT INTO owner_confirmations (nonce, confirmation_id, confirmed_at) VALUES (?,?,?) ON CONFLICT (nonce) DO NOTHING", [nonce, confirmationId, at])) === 1;
    if (added) this.#open?.add(nonce);
    return added;
  }

  async progress(nonce: string): Promise<ChangeProgress> {
    const step = async (role: StepRole) => {
      const row = await this.#rows.get("SELECT signature, signed_at FROM change_steps WHERE nonce = ? AND role = ?", [nonce, role]);
      return row ? { signature: String(row["signature"]), signedAt: String(row["signed_at"]) } : null;
    };
    const owner = await this.#rows.get("SELECT confirmation_id, confirmed_at FROM owner_confirmations WHERE nonce = ?", [nonce]);
    return { current: await step("current"), next: await step("new"), owner: owner ? { confirmationId: String(owner["confirmation_id"]), confirmedAt: String(owner["confirmed_at"]) } : null };
  }

  async ownerConfirmedNonces(now: number): Promise<readonly string[]> {
    this.#open ??= new Set((await this.#rows.all("SELECT nonce FROM owner_confirmations")).map((row) => String(row["nonce"])));
    return [...this.#open].filter((nonce) => (this.#notBefore.get(nonce) ?? 0) <= now);
  }

  waitUntil(nonce: string, at: number): void {
    this.#notBefore.set(nonce, at);
  }

  settle(nonce: string): void {
    this.#open?.delete(nonce);
    this.#notBefore.delete(nonce);
  }
}
