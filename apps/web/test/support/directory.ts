import type { SqlRows } from "@countersign/adapters/sql";
import type { OwnerAuth } from "../../src/ownerAuth.ts";
import type { OwnerContext } from "../../src/ownerContext.ts";
import { OwnerDirectory, type OwnerRuntime } from "../../src/ownerDirectory.ts";

export function singleOwner(rows: SqlRows, auth: OwnerAuth, ctx: OwnerContext): Promise<OwnerDirectory> {
  const refuse = async (): Promise<OwnerRuntime> => {
    throw new Error("this test agent has one owner");
  };
  return OwnerDirectory.open({ rows, auth, adminOwnerId: ctx.ownerId, adminAddress: null, maxOwners: 1, create: refuse, notifyAdmin: ctx.notify, now: Date.now }, { ctx, tick: async () => undefined }, refuse);
}
