import { z } from "zod";
import { canonicalJson } from "./records.ts";
import { SHARED_REASONS, type SharedReason } from "./vocabulary.ts";
import type { MemoryPort, MemoryWrite, RecordSigner, SharedAttackMemory, SharedFlag } from "./ports.ts";
import type { AttackSeenRecord, SharedRecord, SuiAddress } from "./types.ts";

export const SHARED_ATTACKS_NAMESPACE = "countersign:shared:attacks";
export const SHARED_REPORT_LIFETIME_MS = 90 * 24 * 3600 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const Address = z.string().regex(/^0x[0-9a-f]{64}$/);
const Receipt = z.string().regex(/^rcpt_[0-9A-Za-z_-]{4,64}$/);
const AgentKey = z.string().regex(/^[A-Za-z0-9+/]{43}=$/);
const SharedEnvelope = z.object({
  record: z.discriminatedUnion("type", [
    z.object({ type: z.literal("attack_seen"), address: Address, reason: z.enum(SHARED_REASONS), receipt: Receipt, agentKey: AgentKey, seenAt: z.iso.datetime() }).strict(),
    z.object({ type: z.literal("attack_retracted"), address: Address, receipt: Receipt, agentKey: AgentKey, retractedAt: z.iso.datetime() }).strict(),
  ]),
  sig: z.string().min(1).max(200),
}).strict();

function keyTag(agentKey: string): string {
  return agentKey.replace(/[^A-Za-z0-9]/g, "");
}

export function openShared(signer: RecordSigner, text: string): SharedRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const envelope = SharedEnvelope.safeParse(parsed);
  if (!envelope.success) return null;
  const record = envelope.data.record as SharedRecord;
  return signer.verifyAgent(record.agentKey, canonicalJson(record), envelope.data.sig) ? record : null;
}

export function sealShared(signer: RecordSigner, record: SharedRecord): string {
  return JSON.stringify({ record, sig: signer.sign(canonicalJson(record)) });
}

export type SharedAttackDeps = { readonly memory: MemoryPort; readonly signer: RecordSigner; readonly now: () => Date };

export class SharedAttackList implements SharedAttackMemory {
  readonly #d: SharedAttackDeps;
  #seen: AttackSeenRecord[] | null = null;
  #retracted = new Set<string>();

  constructor(deps: SharedAttackDeps) {
    this.#d = deps;
  }

  async refresh(): Promise<boolean> {
    const read = await this.#d.memory.readAll(SHARED_ATTACKS_NAMESPACE);
    if (!read.complete) {
      this.#seen = null;
      return false;
    }
    const records = read.records.map(({ text }) => openShared(this.#d.signer, text)).filter((r) => r !== null);
    this.#seen = records.filter((r) => r.type === "attack_seen");
    this.#retracted = new Set(records.filter((r) => r.type === "attack_retracted").map((r) => `${r.agentKey}:${r.receipt}`));
    return true;
  }

  flag(address: SuiAddress): SharedFlag {
    if (this.#seen === null) return { status: "UNKNOWN" };
    const now = this.#d.now().getTime();
    const active = this.#seen.filter((r) => {
      const at = Date.parse(r.seenAt);
      return r.address === address && r.agentKey !== this.#d.signer.agentKey && !this.#retracted.has(`${r.agentKey}:${r.receipt}`) && at <= now + CLOCK_SKEW_MS && now - at <= SHARED_REPORT_LIFETIME_MS;
    }).sort((a, b) => a.seenAt.localeCompare(b.seenAt));
    const first = active[0];
    return first ? { status: "SEEN", firstReceipt: first.receipt, agents: new Set(active.map((r) => r.agentKey)).size } : { status: "CLEAR" };
  }

  summary(): { readonly agents: number; readonly reports: number } | null {
    if (this.#seen === null) return null;
    const now = this.#d.now().getTime();
    const active = this.#seen.filter((r) => !this.#retracted.has(`${r.agentKey}:${r.receipt}`) && now - Date.parse(r.seenAt) <= SHARED_REPORT_LIFETIME_MS);
    return { agents: new Set(active.map((r) => r.agentKey)).size, reports: active.length };
  }

  async report(sighting: { readonly address: SuiAddress; readonly reason: SharedReason; readonly receipt: string }): Promise<MemoryWrite> {
    const record: AttackSeenRecord = { type: "attack_seen", ...sighting, agentKey: this.#d.signer.agentKey, seenAt: this.#d.now().toISOString() };
    const written = await this.#d.memory.remember(SHARED_ATTACKS_NAMESPACE, sealShared(this.#d.signer, record), `attack:${keyTag(this.#d.signer.agentKey)}:${sighting.receipt}`);
    if (written.status === "WRITTEN") this.#seen?.push(record);
    return written;
  }

  async retract(sighting: { readonly address: SuiAddress; readonly receipt: string }): Promise<MemoryWrite> {
    const agentKey = this.#d.signer.agentKey;
    const written = await this.#d.memory.remember(SHARED_ATTACKS_NAMESPACE, sealShared(this.#d.signer, { type: "attack_retracted", ...sighting, agentKey, retractedAt: this.#d.now().toISOString() }), `retract:${keyTag(agentKey)}:${sighting.receipt}`);
    if (written.status === "WRITTEN") this.#retracted.add(`${agentKey}:${sighting.receipt}`);
    return written;
  }
}
