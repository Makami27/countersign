import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import type { MemoryPort } from "@countersign/core";
import type { SqlRows } from "@countersign/adapters/sql";
import { z } from "zod";

const SCHEMA = "CREATE TABLE IF NOT EXISTS owner_keys (owner_id TEXT PRIMARY KEY, sealed TEXT NOT NULL)";
const PREFIX = "countersign-keys-v1:";
const Keys = z.object({ agentWalletKey: z.string().startsWith("suiprivkey"), recordSeed: z.string().length(44) }).strict();

export type OwnerKeys = z.infer<typeof Keys>;

export function keysNamespace(ownerId: string): string {
  return `countersign:${ownerId}:keys`;
}

export function seal(masterKey: Buffer, ownerId: string, keys: OwnerKeys): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  cipher.setAAD(Buffer.from(ownerId));
  const body = Buffer.concat([cipher.update(JSON.stringify(keys), "utf8"), cipher.final()]);
  return `${PREFIX}${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
}

export function unseal(masterKey: Buffer, ownerId: string, sealed: string): OwnerKeys | null {
  if (!sealed.startsWith(PREFIX)) return null;
  try {
    const raw = Buffer.from(sealed.slice(PREFIX.length), "base64");
    const decipher = createDecipheriv("aes-256-gcm", masterKey, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(ownerId));
    decipher.setAuthTag(raw.subarray(12, 28));
    const parsed = Keys.safeParse(JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export class OwnerKeyStore {
  readonly #rows: SqlRows;
  readonly #memory: MemoryPort;
  readonly #masterKey: Buffer;

  private constructor(rows: SqlRows, memory: MemoryPort, masterKey: Buffer) {
    this.#rows = rows;
    this.#memory = memory;
    this.#masterKey = masterKey;
  }

  static async open(rows: SqlRows, memory: MemoryPort, masterKey: Buffer): Promise<OwnerKeyStore> {
    if (masterKey.length !== 32) throw new Error("MASTER_KEY must be 32 bytes, base64. Nothing was started.");
    await rows.exec(SCHEMA);
    return new OwnerKeyStore(rows, memory, masterKey);
  }

  async create(ownerId: string): Promise<OwnerKeys | null> {
    const keys: OwnerKeys = { agentWalletKey: Ed25519Keypair.generate().getSecretKey(), recordSeed: randomBytes(32).toString("base64") };
    const sealed = seal(this.#masterKey, ownerId, keys);
    const backup = await this.#memory.remember(keysNamespace(ownerId), sealed, `keys:${ownerId}`);
    if (backup.status !== "WRITTEN") return null;
    await this.#rows.run("INSERT INTO owner_keys (owner_id, sealed) VALUES (?,?)", [ownerId, sealed]);
    return keys;
  }

  async load(ownerId: string): Promise<OwnerKeys | null> {
    const row = await this.#rows.get("SELECT sealed FROM owner_keys WHERE owner_id = ?", [ownerId]);
    if (row) return unseal(this.#masterKey, ownerId, String(row["sealed"]));
    const read = await this.#memory.readAll(keysNamespace(ownerId));
    if (!read.complete) return null;
    for (const { text } of read.records) {
      const keys = unseal(this.#masterKey, ownerId, text);
      if (keys) {
        await this.#rows.run("INSERT INTO owner_keys (owner_id, sealed) VALUES (?,?) ON CONFLICT (owner_id) DO NOTHING", [ownerId, text]);
        return keys;
      }
    }
    return null;
  }

  async forget(ownerId: string): Promise<void> {
    await this.#rows.run("DELETE FROM owner_keys WHERE owner_id = ?", [ownerId]);
  }
}
