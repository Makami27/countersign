import type { Envelope, MemoryRecord } from "./types.ts";
import type { RecordSigner } from "./ports.ts";

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sealRecord(signer: RecordSigner, record: MemoryRecord): string {
  const envelope: Envelope = { record, sig: signer.sign(canonicalJson(record)) };
  return JSON.stringify(envelope);
}

export type OpenedRecord = { readonly ok: true; readonly record: MemoryRecord } | { readonly ok: false; readonly why: "NOT_JSON" | "NOT_ENVELOPE" | "BAD_SIGNATURE" };

export function openRecord(signer: RecordSigner, text: string): OpenedRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, why: "NOT_JSON" };
  }
  if (!isEnvelopeShape(parsed)) return { ok: false, why: "NOT_ENVELOPE" };
  if (!signer.verify(canonicalJson(parsed.record), parsed.sig)) return { ok: false, why: "BAD_SIGNATURE" };
  return { ok: true, record: parsed.record };
}

function isEnvelopeShape(value: unknown): value is Envelope {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as { record?: unknown; sig?: unknown };
  if (typeof candidate.sig !== "string") return false;
  const record = candidate.record as { type?: unknown } | null | undefined;
  return record !== null && typeof record === "object" && (record.type === "payee_version" || record.type === "refusal");
}
