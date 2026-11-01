import type { ServerResponse } from "node:http";
import { problem, send } from "./http.ts";
import { ownerSigned } from "./ownerGate.ts";
import type { OwnerContext } from "./ownerContext.ts";
import type { OwnerDirectory } from "./ownerDirectory.ts";

export async function adminRoute(owners: OwnerDirectory, ctx: OwnerContext, res: ServerResponse, method: string, parts: readonly string[], input: Record<string, unknown> | null): Promise<void> {
  if (!ctx.isAdmin) return problem(res, 404, "Not found.");
  if (method === "GET" && parts.length === 1) {
    const joined = new Map((await owners.listing()).map((o) => [o.ownerId, o.createdAt]));
    const rows = await Promise.all(owners.all().map(async ({ ctx: owner }) => ({
      ownerId: owner.ownerId, admin: owner.isAdmin, address: owner.wallets.current(), joinedAt: joined.has(owner.ownerId) ? new Date(joined.get(owner.ownerId) ?? 0).toISOString() : null,
      payees: (await owner.index.payeeIds()).length, lastActive: owners.lastActive(owner.ownerId), usage: owner.quota.view(),
    })));
    return send(res, 200, { owners: rows });
  }
  const target = parts[2] ? decodeURIComponent(parts[2]) : "";
  if (method === "POST" && parts[1] === "owners" && parts[3] === "remove" && input) {
    if (!owners.get(target) || target === owners.adminOwnerId) return problem(res, 404, "No owner with that id that can be removed.");
    if (!(await ownerSigned(ctx, res, input, "remove_owner", { owner: target }))) return;
    if (!(await owners.remove(target))) return problem(res, 404, "No owner with that id that can be removed.");
    await ctx.notify(`Owner ${target} was removed with your owner wallet's signature. Their sessions, keys and database records are deleted; their Walrus Memory records can't be erased.`);
    return send(res, 200, { removed: target });
  }
  return problem(res, 404, "Not found.");
}
