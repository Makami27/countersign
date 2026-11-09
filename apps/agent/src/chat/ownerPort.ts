import type { OwnerContext } from "@countersign/web/ownerContext";
import { payeeSummary } from "@countersign/web/ownerViews";
import { scheduleList } from "@countersign/web/scheduleRoutes";
import type { ChatOwner } from "./conversation.ts";

export function chatOwnerOf(ctx: OwnerContext): ChatOwner {
  return {
    ownerId: ctx.ownerId, engine: ctx.engine, index: ctx.index, sendPayment: ctx.sendPayment, busy: () => ctx.quota.busy(), countModel: () => ctx.quota.record("model"),
    agentAddress: ctx.agentAddress, balances: ctx.balances, perPaymentCap: () => ctx.settings.values().perPaymentBaseUnits, schedules: () => scheduleList(ctx, Date.now()).schedules,
    payees: async () => Promise.all((await ctx.index.payeeIds()).map((id) => payeeSummary(ctx, id, Date.now()))),
  };
}
