import { randomBytes } from "node:crypto";
import type { SignatureCheck, SuiAddress } from "@countersign/core";
import type { SqlRows } from "@countersign/adapters/sql";
import type { OwnerAuth } from "./ownerAuth.ts";
import type { OwnerContext } from "./ownerContext.ts";

const SCHEMA = "CREATE TABLE IF NOT EXISTS owners (owner_id TEXT PRIMARY KEY, created_at BIGINT NOT NULL, first_address TEXT NOT NULL)";
export const OWNER_ID = /^o[0-9a-f]{10}$/;

export type OwnerRuntime = { readonly ctx: OwnerContext; readonly tick: () => Promise<void> };
export type SignInOwner = { readonly ok: true; readonly ownerId: string; readonly created: boolean } | { readonly ok: false; readonly status: number; readonly message: string };
export type OwnerListing = { readonly ownerId: string; readonly createdAt: number; readonly firstAddress: string };

export type OwnerDirectoryDeps = {
  readonly rows: SqlRows;
  readonly auth: OwnerAuth;
  readonly adminOwnerId: string;
  readonly adminAddress: SuiAddress | null;
  readonly maxOwners: number;
  readonly create: (ownerId: string) => Promise<OwnerRuntime>;
  readonly notifyAdmin: (text: string) => Promise<void>;
  readonly now: () => number;
};

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export class OwnerDirectory {
  readonly #d: OwnerDirectoryDeps;
  readonly #owners = new Map<string, OwnerRuntime>();
  #creating: Promise<SignInOwner> | null = null;

  private constructor(deps: OwnerDirectoryDeps) {
    this.#d = deps;
  }

  static async open(deps: OwnerDirectoryDeps, admin: OwnerRuntime, load: (ownerId: string) => Promise<OwnerRuntime>): Promise<OwnerDirectory> {
    await deps.rows.exec(SCHEMA);
    const directory = new OwnerDirectory(deps);
    directory.#owners.set(deps.adminOwnerId, admin);
    for (const row of await deps.rows.all("SELECT owner_id FROM owners ORDER BY created_at")) {
      const ownerId = String(row["owner_id"]);
      if (!OWNER_ID.test(ownerId)) continue;
      try {
        directory.#owners.set(ownerId, await load(ownerId));
      } catch (error) {
        console.error(`Owner ${ownerId} not loaded: ${error instanceof Error ? error.message.slice(0, 200) : "unknown error"}`);
      }
    }
    return directory;
  }

  get auth(): OwnerAuth {
    return this.#d.auth;
  }

  get adminOwnerId(): string {
    return this.#d.adminOwnerId;
  }

  all(): readonly OwnerRuntime[] {
    return [...this.#owners.values()];
  }

  get(ownerId: string): OwnerContext | null {
    return this.#owners.get(ownerId)?.ctx ?? null;
  }

  async forSession(token: string | null): Promise<OwnerContext | null> {
    const session = await this.#d.auth.session(token);
    return session ? this.get(session.ownerId) : null;
  }

  async listing(): Promise<readonly OwnerListing[]> {
    return (await this.#d.rows.all("SELECT owner_id, created_at, first_address FROM owners ORDER BY created_at")).map((r) => ({ ownerId: String(r["owner_id"]), createdAt: Number(r["created_at"]), firstAddress: String(r["first_address"]) }));
  }

  async tickAll(): Promise<void> {
    for (const runtime of this.#owners.values()) await runtime.tick().catch((error: Error) => console.error(`Owner ${runtime.ctx.ownerId} loop skipped: ${error.message.slice(0, 200)}`));
  }

  async signIn(address: SuiAddress, message: string, signature: string, check: Extract<SignatureCheck, { result: "VALID" }>): Promise<SignInOwner> {
    for (const { ctx } of this.#owners.values()) if (ctx.wallets.current() === address) return { ok: true, ownerId: ctx.ownerId, created: false };
    const unknown = [...this.#owners.values()].find(({ ctx }) => !ctx.wallets.state().known);
    if (unknown) return { ok: false, status: 503, message: "An owner wallet record couldn't be read from Walrus Memory, so we can't tell whose wallet this is. You're not signed in. Try again shortly." };
    const admin = this.#owners.get(this.#d.adminOwnerId)?.ctx;
    if (admin && !admin.wallets.current() && (this.#d.adminAddress === null || address === this.#d.adminAddress)) return this.#register(admin, address, message, signature, check, false);
    this.#creating ??= this.#createOwner(address, message, signature, check).finally(() => {
      this.#creating = null;
    });
    return this.#creating;
  }

  async #createOwner(address: SuiAddress, message: string, signature: string, check: Extract<SignatureCheck, { result: "VALID" }>): Promise<SignInOwner> {
    for (const { ctx } of this.#owners.values()) if (ctx.wallets.current() === address) return { ok: true, ownerId: ctx.ownerId, created: false };
    if (this.#owners.size >= this.#d.maxOwners) return { ok: false, status: 403, message: `This agent has room for ${this.#d.maxOwners} owners and they're all taken. Try the demo instead.` };
    const ownerId = `o${randomBytes(5).toString("hex")}`;
    let runtime: OwnerRuntime;
    try {
      runtime = await this.#d.create(ownerId);
    } catch (error) {
      console.error(`Owner ${ownerId} not created: ${error instanceof Error ? error.message.slice(0, 200) : "unknown error"}`);
      return { ok: false, status: 503, message: "Your agent couldn't be set up just now (its keys weren't confirmed by Walrus Memory). You're not signed in. Try again in a few minutes." };
    }
    const registered = await this.#register(runtime.ctx, address, message, signature, check, true);
    if (!registered.ok) return registered;
    await this.#d.rows.run("INSERT INTO owners (owner_id, created_at, first_address) VALUES (?,?,?)", [ownerId, this.#d.now(), address]);
    this.#owners.set(ownerId, runtime);
    await this.#d.notifyAdmin(`New owner joined: ${short(address)} (${ownerId}). ${this.#owners.size} of ${this.#d.maxOwners} places used.`);
    return registered;
  }

  async #register(ctx: OwnerContext, address: SuiAddress, message: string, signature: string, check: Extract<SignatureCheck, { result: "VALID" }>, created: boolean): Promise<SignInOwner> {
    const verification = { role: "control" as const, signer: address, scheme: check.scheme, maxEpoch: check.maxEpoch, checkedAtEpoch: check.checkedAtEpoch };
    if ((await ctx.wallets.record(address, "first_registration", [{ signer: address, message, signature }], [verification])) !== "WRITTEN") return { ok: false, status: 503, message: "Walrus Memory didn't confirm your owner wallet record, so you're not signed in. Try again in a few minutes." };
    await ctx.notify(`Owner wallet registered by signing in: ${short(address)}. From now on, signing in, adding payees, confirming address changes yourself and loosening limits need this wallet. If this wasn't you, act now.`);
    return { ok: true, ownerId: ctx.ownerId, created };
  }

  async remove(ownerId: string): Promise<boolean> {
    if (ownerId === this.#d.adminOwnerId || !this.#owners.has(ownerId)) return false;
    this.#owners.delete(ownerId);
    await this.#d.rows.run("DELETE FROM owners WHERE owner_id = ?", [ownerId]);
    await this.#d.rows.run("DELETE FROM wallet_sessions WHERE owner_id = ?", [ownerId]);
    return true;
  }
}
