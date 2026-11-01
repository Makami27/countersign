import { api } from "../api.ts";
import { withApprovals } from "../approvals.ts";
import { h, listen, liveRegion, when } from "../dom.ts";

type Usage = { readonly limits: Record<string, number> | null; readonly lastHour: Record<string, number> };
type OwnerRow = { readonly ownerId: string; readonly admin: boolean; readonly address: string | null; readonly joinedAt: string | null; readonly payees: number; readonly lastActive: string | null; readonly usage: Usage };

function usageLine(usage: Usage): string {
  const used = `${usage.lastHour["walrus"] ?? 0} Walrus writes, ${usage.lastHour["tatum"] ?? 0} Tatum calls, ${usage.lastHour["model"] ?? 0} model calls in the last hour`;
  return usage.limits ? `${used} (limits ${usage.limits["walrus"]}, ${usage.limits["tatum"]}, ${usage.limits["model"]})` : `${used} (no limits: admin)`;
}

export async function adminPage(network: "mainnet" | "testnet"): Promise<HTMLElement> {
  const status = liveRegion();
  const result = await api<{ owners: OwnerRow[] }>("GET", "/api/app/admin");
  if (!result.ok) return h("section", { class: "narrow" }, h("h1", { tabindex: "-1" }, "Admin"), h("p", {}, result.error.message));
  const rows = result.data.owners.map((o) => {
    const remove = o.admin ? null : h("button", { class: "btn", type: "button" }, "Remove");
    if (remove) listen(remove, "click", async () => {
      if (!window.confirm(`Remove owner ${o.ownerId}? Their sessions, keys and database records are deleted. Walrus Memory records can't be erased. Funds left in their agent wallet become unreachable.`)) return;
      const removed = await withApprovals("POST", `/api/app/admin/owners/${encodeURIComponent(o.ownerId)}/remove`, {}, network, status);
      status.textContent = removed.ok ? `Removed ${o.ownerId}.` : removed.error.message;
      if (removed.ok) remove.closest("li")?.remove();
    }, status);
    return h("li", {}, h("span", { class: "v" }, o.admin ? "Admin" : "Owner"),
      h("span", { class: "what" }, h("span", {}, `${o.ownerId} · ${o.address ?? "no wallet yet"}`), h("span", { class: "meta" }, `${o.joinedAt ? `Joined ${when(o.joinedAt)}. ` : ""}${o.payees} payees. ${o.lastActive ? `Last active ${when(o.lastActive)}.` : "Not active since the last restart."} ${usageLine(o.usage)}.`)), remove);
  });
  return h("section", { class: "narrow", "aria-labelledby": "admin-title" }, h("h1", { id: "admin-title", tabindex: "-1" }, "Admin"), h("p", { class: "lede" }, "Owners of this agent. Removing one needs your owner wallet's signature."), status, h("ol", { class: "rows" }, ...rows));
}
