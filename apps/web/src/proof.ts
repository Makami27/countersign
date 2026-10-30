import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export type ProofView =
  | { readonly connected: false; readonly why: string }
  | {
      readonly connected: true;
      readonly network: string;
      readonly verifiedPayees: number;
      readonly addressChangesVerified: number;
      readonly refusals: number;
      readonly refusalsByReason: readonly { reason: string; count: number }[];
      readonly recent: readonly { receipt: string; reason: string; at: string }[];
    };

export function readProof(databasePath: string | undefined, network: string): ProofView {
  if (!databasePath) return { connected: false, why: "The live agent isn't connected to this page yet." };
  if (!existsSync(databasePath)) return { connected: false, why: "The live agent hasn't written any records yet." };
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const one = (sql: string): number => Number((db.prepare(sql).get() ?? {})["n"] ?? 0);
    const byReason = db.prepare("SELECT json_extract(record, '$.reason') AS reason, COUNT(*) AS n FROM refusals GROUP BY reason ORDER BY n DESC").all();
    const recent = db.prepare("SELECT receipt, json_extract(record, '$.reason') AS reason, json_extract(record, '$.createdAt') AS at FROM refusals ORDER BY at DESC LIMIT 8").all();
    return {
      connected: true,
      network,
      verifiedPayees: one("SELECT COUNT(DISTINCT payee_id) AS n FROM payee_versions WHERE status = 'VERIFIED'"),
      addressChangesVerified: one("SELECT COUNT(*) AS n FROM payee_versions WHERE status = 'VERIFIED' AND json_extract(record, '$.supersedes') IS NOT NULL"),
      refusals: one("SELECT COUNT(*) AS n FROM refusals"),
      refusalsByReason: byReason.map((r) => ({ reason: String(r["reason"]), count: Number(r["n"]) })),
      recent: recent.map((r) => ({ receipt: String(r["receipt"]), reason: String(r["reason"]), at: String(r["at"]) })),
    };
  } finally {
    db.close();
  }
}
