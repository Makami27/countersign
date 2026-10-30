import type { SuiAddress } from "./types.ts";

export const LOOKALIKE_PREFIX_HEX = 4;
export const LOOKALIKE_SUFFIX_HEX = 4;
const ADDRESS_PATTERN = /0x[0-9a-f]{64}/g;
const SINGLE_ADDRESS = /^0x[0-9a-f]{64}$/;

export function parseSuiAddress(value: string): SuiAddress | null {
  const lowered = value.trim().toLowerCase();
  return SINGLE_ADDRESS.test(lowered) ? (lowered as SuiAddress) : null;
}

export function addressesIn(text: string): readonly SuiAddress[] {
  return [...text.toLowerCase().matchAll(ADDRESS_PATTERN)].map((match) => match[0] as SuiAddress);
}

export function appearsVerbatim(address: SuiAddress, text: string): boolean {
  return addressesIn(text).includes(address);
}

export function isLookalike(candidate: SuiAddress, known: SuiAddress): boolean {
  if (candidate === known) return false;
  const a = candidate.slice(2);
  const b = known.slice(2);
  return a.slice(0, LOOKALIKE_PREFIX_HEX) === b.slice(0, LOOKALIKE_PREFIX_HEX) && a.slice(-LOOKALIKE_SUFFIX_HEX) === b.slice(-LOOKALIKE_SUFFIX_HEX);
}

export function imitatesAny(candidate: SuiAddress, known: readonly SuiAddress[]): boolean {
  return known.some((address) => isLookalike(candidate, address));
}
