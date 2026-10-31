import type { SqlRows } from "@countersign/adapters/sql";

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

export async function readProof(rows: SqlRows | undefined, network: string): Promise<ProofView> {
  if (!rows) return { connected: false, why: "The live agent isn't connected to this page yet." };
  try {
    return await countProof(rows, network);
  } catch {
    return { connected: false, why: "The live agent's records couldn't be read just now." };
  }
}

async function countProof(rows: SqlRows, network: string): Promise<ProofView> {
  const reason = rows.jsonText("record", "reason");
  const createdAt = rows.jsonText("record", "createdAt");
  const one = async (sql: string): Promise<number> => Number((await rows.get(sql))?.["n"] ?? 0);
  const refused = "verdict IN ('REFUSED','CHANGE_REJECTED')";
  const byReason = await rows.all(`SELECT ${reason} AS reason, COUNT(*) AS n FROM receipts WHERE ${refused} GROUP BY ${reason} ORDER BY n DESC`);
  const recent = await rows.all(`SELECT receipt, ${reason} AS reason, ${createdAt} AS at FROM receipts WHERE ${refused} ORDER BY at DESC LIMIT 8`);
  return {
    connected: true,
    network,
    verifiedPayees: await one("SELECT COUNT(DISTINCT payee_id) AS n FROM payee_versions WHERE status = 'VERIFIED'"),
    addressChangesVerified: await one(`SELECT COUNT(*) AS n FROM payee_versions WHERE status = 'VERIFIED' AND ${rows.jsonText("record", "supersedes")} IS NOT NULL`),
    refusals: await one(`SELECT COUNT(*) AS n FROM receipts WHERE ${refused}`),
    refusalsByReason: byReason.map((r) => ({ reason: String(r["reason"]), count: Number(r["n"]) })),
    recent: recent.map((r) => ({ receipt: String(r["receipt"]), reason: String(r["reason"]), at: String(r["at"]) })),
  };
}
