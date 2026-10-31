import { openRecord, scheduleHeads, schedulesNamespace, sealRecord, type MemoryPort, type RecordSigner, type ScheduleRecord } from "@countersign/core";
import type { SqlRows } from "@countersign/adapters/sql";

const SCHEMA = "CREATE TABLE IF NOT EXISTS schedule_records (schedule_id TEXT NOT NULL, version INTEGER NOT NULL, sealed TEXT NOT NULL, PRIMARY KEY (schedule_id, version))";

export type ScheduleDeps = { readonly rows: SqlRows; readonly memory: MemoryPort; readonly signer: RecordSigner; readonly ownerId: string; readonly now: () => number };
export type ScheduleDraft = Omit<ScheduleRecord, "type" | "ownerId" | "version" | "createdAt">;

export class Schedules {
  readonly #d: ScheduleDeps;
  #heads = new Map<string, ScheduleRecord>();

  private constructor(deps: ScheduleDeps) {
    this.#d = deps;
  }

  static async open(deps: ScheduleDeps): Promise<Schedules> {
    await deps.rows.exec(SCHEMA);
    const schedules = new Schedules(deps);
    await schedules.restore();
    return schedules;
  }

  async restore(): Promise<void> {
    const read = await this.#d.memory.readAll(schedulesNamespace(this.#d.ownerId));
    if (!read.complete) {
      const cached = (await this.#d.rows.all("SELECT sealed FROM schedule_records")).map((row) => ({ text: String(row["sealed"]), blobId: "cache" }));
      this.#heads = scheduleHeads(this.#d.signer, this.#d.ownerId, cached);
      return;
    }
    this.#heads = scheduleHeads(this.#d.signer, this.#d.ownerId, read.records);
    await this.#d.rows.run("DELETE FROM schedule_records");
    for (const { text } of read.records) {
      const opened = openRecord(this.#d.signer, text);
      if (opened.ok && opened.record.type === "schedule" && opened.record.ownerId === this.#d.ownerId) await this.#d.rows.run("INSERT INTO schedule_records (schedule_id, version, sealed) VALUES (?,?,?) ON CONFLICT (schedule_id, version) DO NOTHING", [opened.record.scheduleId, opened.record.version, text]);
    }
  }

  active(): readonly ScheduleRecord[] {
    return [...this.#heads.values()].filter((s) => s.status === "ACTIVE").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  get(scheduleId: string): ScheduleRecord | null {
    return this.#heads.get(scheduleId) ?? null;
  }

  async write(draft: ScheduleDraft): Promise<{ readonly status: "WRITTEN"; readonly record: ScheduleRecord } | { readonly status: "UNKNOWN" }> {
    const version = (this.#heads.get(draft.scheduleId)?.version ?? 0) + 1;
    const record: ScheduleRecord = { ...draft, type: "schedule", ownerId: this.#d.ownerId, version, createdAt: new Date(this.#d.now()).toISOString() };
    const sealed = sealRecord(this.#d.signer, record);
    const written = await this.#d.memory.remember(schedulesNamespace(this.#d.ownerId), sealed, `schedule:${record.scheduleId}:v${version}`);
    if (written.status !== "WRITTEN") return { status: "UNKNOWN" };
    await this.#d.rows.run("INSERT INTO schedule_records (schedule_id, version, sealed) VALUES (?,?,?) ON CONFLICT (schedule_id, version) DO NOTHING", [record.scheduleId, version, sealed]);
    this.#heads.set(record.scheduleId, record);
    return { status: "WRITTEN", record };
  }
}
