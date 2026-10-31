import { randomBytes } from "node:crypto";
import { canonicalJson, type SignatureCheck, type SuiAddress } from "@countersign/core";
import type { SqlRows } from "@countersign/adapters/sql";

export const APPROVAL_LIFETIME_MS = 10 * 60 * 1000;
const SCHEMA = "CREATE TABLE IF NOT EXISTS owner_approvals (nonce TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, signer TEXT NOT NULL, expires_at BIGINT NOT NULL, used INTEGER NOT NULL DEFAULT 0 CHECK (used IN (0,1)))";

export type ApprovalKind = "register_owner_wallet" | "change_owner_wallet" | "cancel_owner_wallet_change" | "add_payee" | "confirm_owner_change" | "raise_limits" | "create_schedule" | "change_schedule" | "delete_schedule" | "retract_shared_report";
export type Payload = Readonly<Record<string, string>>;
export type Challenge = { readonly nonce: string; readonly message: string; readonly signer: SuiAddress };
export type ApprovalProblem = "APPROVAL_EXPIRED" | "APPROVAL_USED" | "APPROVAL_MISMATCH" | "WRONG_WALLET" | "SIGNATURE_INVALID" | "CHAIN_UNKNOWN";
export type Approved = { readonly ok: true; readonly signer: SuiAddress; readonly message: string; readonly signature: string; readonly check: Extract<SignatureCheck, { result: "VALID" }> } | { readonly ok: false; readonly problem: ApprovalProblem };

export const APPROVAL_PROBLEMS: Record<ApprovalProblem, string> = {
  APPROVAL_EXPIRED: "This approval expired. Nothing was changed. Try again and sign within ten minutes.",
  APPROVAL_USED: "This approval was already used. Nothing was changed. Try again.",
  APPROVAL_MISMATCH: "The signed approval doesn't match this request. Nothing was changed.",
  WRONG_WALLET: "That signature came from a different wallet than this step needs. Nothing was changed.",
  SIGNATURE_INVALID: "The signature doesn't verify for this approval. Nothing was changed.",
  CHAIN_UNKNOWN: "The signature couldn't be checked through Tatum just now. Nothing was changed. Try again shortly.",
};

const KIND_WORDS: Record<ApprovalKind, string> = {
  register_owner_wallet: "use this wallet as the owner wallet",
  change_owner_wallet: "replace the owner wallet",
  cancel_owner_wallet_change: "cancel the waiting owner-wallet change",
  add_payee: "add a payee",
  confirm_owner_change: "confirm a payee address change myself",
  raise_limits: "loosen spending limits",
  create_schedule: "create a scheduled payment",
  change_schedule: "change a scheduled payment",
  delete_schedule: "delete a scheduled payment",
  retract_shared_report: "retract a scam report shared with other agents",
};

export function approvalMessage(ownerId: string, kind: ApprovalKind, payload: Payload, nonce: string, expires: string): string {
  const fields = Object.keys(payload).sort().map((key) => `${key}:${payload[key] ?? ""}`);
  return ["Countersign owner approval v1", `owner:${ownerId}`, `action:${kind}`, `meaning:${KIND_WORDS[kind]}`, ...fields, `nonce:${nonce}`, `expires:${expires}`].join("\n");
}

export class OwnerApprovals {
  readonly #rows: SqlRows;
  readonly #ownerId: string;
  readonly #now: () => number;
  readonly #verify: (message: string, signature: string, address: SuiAddress) => Promise<SignatureCheck>;

  private constructor(rows: SqlRows, ownerId: string, now: () => number, verify: (message: string, signature: string, address: SuiAddress) => Promise<SignatureCheck>) {
    this.#rows = rows;
    this.#ownerId = ownerId;
    this.#now = now;
    this.#verify = verify;
  }

  static async open(rows: SqlRows, ownerId: string, verify: (message: string, signature: string, address: SuiAddress) => Promise<SignatureCheck>, now: () => number = Date.now): Promise<OwnerApprovals> {
    await rows.exec(SCHEMA);
    return new OwnerApprovals(rows, ownerId, now, verify);
  }

  async challenge(kind: ApprovalKind, payload: Payload, signer: SuiAddress): Promise<Challenge> {
    const nonce = randomBytes(16).toString("hex");
    const expiresAt = this.#now() + APPROVAL_LIFETIME_MS;
    await this.#rows.run("INSERT INTO owner_approvals (nonce, kind, payload, signer, expires_at) VALUES (?,?,?,?,?)", [nonce, kind, canonicalJson(payload), signer, expiresAt]);
    return { nonce, signer, message: approvalMessage(this.#ownerId, kind, payload, nonce, new Date(expiresAt).toISOString()) };
  }

  async check(kind: ApprovalKind, payload: Payload, signer: SuiAddress, nonce: string, signature: string): Promise<Approved> {
    const row = await this.#rows.get("SELECT kind, payload, signer, expires_at, used FROM owner_approvals WHERE nonce = ?", [nonce]);
    if (!row) return { ok: false, problem: "APPROVAL_MISMATCH" };
    if (Number(row["used"]) === 1) return { ok: false, problem: "APPROVAL_USED" };
    if (Number(row["expires_at"]) <= this.#now()) return { ok: false, problem: "APPROVAL_EXPIRED" };
    if (row["kind"] !== kind || row["payload"] !== canonicalJson(payload) || row["signer"] !== signer) return { ok: false, problem: "APPROVAL_MISMATCH" };
    const message = approvalMessage(this.#ownerId, kind, payload, nonce, new Date(Number(row["expires_at"])).toISOString());
    const check = await this.#verify(message, signature, signer);
    if (check.result === "WRONG_SIGNER") return { ok: false, problem: "WRONG_WALLET" };
    if (check.result === "UNKNOWN") return { ok: false, problem: "CHAIN_UNKNOWN" };
    if (check.result !== "VALID") return { ok: false, problem: "SIGNATURE_INVALID" };
    return { ok: true, signer, message, signature, check };
  }

  async consume(nonce: string): Promise<boolean> {
    return (await this.#rows.run("UPDATE owner_approvals SET used = 1 WHERE nonce = ? AND used = 0", [nonce])) === 1;
  }
}
