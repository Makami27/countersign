const GROUPED_ADDRESS = /0x(?:\s*[0-9a-fA-F]){64}/g;
const ONLY_GROUPS = /^(?:0x)?[0-9a-fA-F]{1,4}(?:\s+[0-9a-fA-F]{1,4})+$/;
const LINK = /^https?:\/\/\S+(?:\s+\S+)*$/;

export function plainCopy(selected: string): string {
  const trimmed = selected.trim();
  if (ONLY_GROUPS.test(trimmed) || LINK.test(trimmed)) return trimmed.replace(/\s+/g, "");
  return selected.replace(GROUPED_ADDRESS, (address) => address.replace(/\s+/g, ""));
}
