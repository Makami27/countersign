import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ACT1 = "evidence/acts/act1-2026-10-30T21-53-37-449Z.json";

export type Check = { readonly check: string; readonly result: "PASS" | "FAIL" };
export type ActReceipt = { readonly receipt: string; readonly verdict: string; readonly reason: string | null; readonly ref: string; readonly address: string | null; readonly amountBaseUnits: string | null; readonly checks: readonly Check[]; readonly createdAt: string; readonly suiDigest: string | null };
export type RecordedAct = { readonly source: string; readonly receipt: ActReceipt; readonly blobId: string | null };
export type Trial = { readonly attack: string; readonly name: string; readonly trial: number; readonly message: string; readonly attacker: string; readonly verified: string; readonly countersign: { readonly verdict: string; readonly reason: string | null }; readonly baselinePaidAttacker: boolean; readonly at: string; readonly model: string };
export type Acts = { readonly paid: RecordedAct | null; readonly refused: RecordedAct | null; readonly repeated: RecordedAct | null; readonly changed: RecordedAct | null; readonly paidAfter: RecordedAct | null };

async function json(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(join(ROOT, path), "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function act(source: string, receipt: unknown, blob: unknown): RecordedAct | null {
  if (!receipt || typeof receipt !== "object") return null;
  const blobId = blob && typeof blob === "object" ? String((blob as Record<string, unknown>)["blobId"] ?? "") || null : null;
  return { source, receipt: receipt as ActReceipt, blobId };
}

export async function readActs(): Promise<Acts> {
  const [one, two, three, four] = await Promise.all([json(ACT1), json("evidence/acts/act2/records.json"), json("evidence/acts/act3/records.json"), json("evidence/acts/act4/records.json")]);
  const fourReceipts = (four?.["receipts"] as { receipt: unknown; receiptBlob: unknown }[] | undefined) ?? [];
  const pick = (verdict: string) => fourReceipts.find((r) => (r.receipt as ActReceipt | undefined)?.verdict === verdict);
  return {
    paid: act(ACT1, one?.["receiptRecord"], null),
    refused: act("evidence/acts/act2/records.json", two?.["receipt"], two?.["receiptBlob"]),
    repeated: act("evidence/acts/act3/records.json", three?.["receipt"], three?.["receiptBlob"]),
    changed: act("evidence/acts/act4/records.json", pick("CHANGE_VERIFIED")?.receipt, pick("CHANGE_VERIFIED")?.receiptBlob),
    paidAfter: act("evidence/acts/act4/records.json", pick("PAID")?.receipt, pick("PAID")?.receiptBlob),
  };
}

export async function readTrial(attack: string, trial: number): Promise<Trial | null> {
  const results = await json("evidence/measurement/results.json");
  const corpus = await json("evidence/measurement/corpus.json");
  const rawPath = typeof results?.["raw"] === "string" ? results["raw"] : null;
  if (!rawPath || !corpus) return null;
  let raw: string;
  try {
    raw = await readFile(join(ROOT, rawPath), "utf8");
  } catch {
    return null;
  }
  const row = raw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>).find((r) => r["kind"] === "attack" && r["attack"] === attack && r["trial"] === trial);
  const spec = (corpus["attacks"] as { id: string; name: string; message: string }[]).find((a) => a.id === attack);
  if (!row || !spec) return null;
  const attacker = (row["targets"] as string[])[0] ?? "";
  const cs = row["countersign"] as { change: { verdict: string; reason?: string } | null; paidTo: string };
  const model = row["model"] as { modelVersion?: string };
  return {
    attack, name: spec.name, trial, attacker, verified: cs.paidTo, message: spec.message.replace("<attacker address>", attacker),
    countersign: { verdict: cs.change?.verdict ?? "NONE", reason: cs.change?.reason ?? null },
    baselinePaidAttacker: (row["baseline"] as { attackerPaid: boolean }).attackerPaid, at: String(row["at"]), model: model.modelVersion ?? "",
  };
}
