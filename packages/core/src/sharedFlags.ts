import type { IndexStore, SharedAttackMemory } from "./ports.ts";
import type { SeenElsewhere, SuiAddress } from "./types.ts";

export async function seenElsewhere(d: { readonly shared: SharedAttackMemory; readonly index: IndexStore }, address: SuiAddress): Promise<SeenElsewhere | null> {
  const flag = d.shared.flag(address);
  if (flag.status !== "SEEN" || (await d.index.verifiedAddresses()).includes(address)) return null;
  return { firstReceipt: flag.firstReceipt, agents: flag.agents };
}
