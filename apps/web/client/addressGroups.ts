export type GroupMark = "same" | "diff" | null;
export type AddressGroup = { readonly text: string; readonly mark: GroupMark };
export type GroupedAddress = { readonly groups: readonly AddressGroup[]; readonly label: string; readonly full: string; readonly short: boolean };

const GROUP_SIZE = 4;
const HEX_ADDRESS = /^0x[0-9a-f]+$/;

function chunks(hex: string): string[] {
  return hex.match(new RegExp(`.{1,${GROUP_SIZE}}`, "g")) ?? [];
}

export function spokenAddress(address: string): string {
  return `Address ${address.split("").join(" ")}`;
}

export function groupAddress(address: string, options: { readonly against?: string; readonly short?: boolean } = {}): GroupedAddress {
  const full = address.trim().toLowerCase();
  const label = spokenAddress(full);
  if (!HEX_ADDRESS.test(full)) return { groups: [{ text: full, mark: null }], label, full, short: false };
  const groups = chunks(full.slice(2));
  if (options.short) {
    const first = groups[0] ?? "";
    const last = groups.at(-1) ?? "";
    return { groups: [{ text: `0x${first}`, mark: null }, { text: "…", mark: null }, { text: last, mark: null }], label, full, short: true };
  }
  const against = options.against?.trim().toLowerCase();
  const otherGroups = against && HEX_ADDRESS.test(against) ? chunks(against.slice(2)) : null;
  const marked = groups.map((text, i): AddressGroup => ({ text, mark: otherGroups ? (otherGroups[i] === text ? "same" : "diff") : null }));
  return { groups: [{ text: "0x", mark: null }, ...marked], label, full, short: false };
}

export function differingGroupCount(grouped: GroupedAddress): number {
  return grouped.groups.filter((g) => g.mark === "diff").length;
}
