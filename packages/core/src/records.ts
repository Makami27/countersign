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

export type OpenedRecord = { readonly ok: true; readonly record: MemoryRecord } | { readonly ok: false; readonly why: "NOT_JSON" | "NOT_ENVELOPE" | "LEGACY_RECORD" | "BAD_SIGNATURE" };

export function openRecord(signer: RecordSigner, text: string): OpenedRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, why: "NOT_JSON" };
  }
  if (!isSignedObject(parsed)) return { ok: false, why: "NOT_ENVELOPE" };
  if (!signer.verify(canonicalJson(parsed.record), parsed.sig)) return { ok: false, why: "BAD_SIGNATURE" };
  if (isLegacyRefusal(parsed)) return { ok: false, why: "LEGACY_RECORD" };
  if (!isEnvelopeShape(parsed)) return { ok: false, why: "NOT_ENVELOPE" };
  return { ok: true, record: parsed.record };
}

function isSignedObject(value: unknown): value is { record: object; sig: string } {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as { record?: unknown; sig?: unknown };
  return typeof candidate.sig === "string" && candidate.record !== null && typeof candidate.record === "object";
}

function isEnvelopeShape(value: unknown): value is Envelope {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as { record?: unknown; sig?: unknown };
  if (typeof candidate.sig !== "string") return false;
  const record = candidate.record as { type?: unknown } | null | undefined;
  return record !== null && typeof record === "object" && (record.type === "payee_version" || record.type === "receipt" || record.type === "owner_wallet");
}

function isLegacyRefusal(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const record = (value as { record?: unknown }).record;
  if (record === null || typeof record !== "object") return false;
  const shaped = record as { type?: unknown; name?: unknown; evidence?: { kind?: unknown } };
  if (shaped.type === "refusal") return true;
  return shaped.type === "payee_version" && (typeof shaped.name !== "string" || shaped.evidence?.kind === "owner_onboarding");
}
