export type StoreLike = Pick<Storage, "getItem" | "setItem">;
export type StampNote = { readonly wave: "sine" | "triangle"; readonly at: number; readonly length: number; readonly from: number; readonly to: number; readonly volume: number };

const MUTE_KEY = "countersign:muted";
const SEEN_KEY = "countersign:payees-seen";

export const STAMP_NOTES: readonly StampNote[] = [
  { wave: "sine", at: 0, length: 0.12, from: 170, to: 70, volume: 0.28 },
  { wave: "triangle", at: 0.11, length: 0.2, from: 784, to: 784, volume: 0.07 },
  { wave: "triangle", at: 0.2, length: 0.26, from: 1175, to: 1175, volume: 0.06 },
];

export function readMuted(store: StoreLike | null): boolean {
  try {
    return store?.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeMuted(store: StoreLike | null, muted: boolean): void {
  try {
    store?.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    return;
  }
}

export type PayeeSeen = { readonly id: string; readonly name: string; readonly payable: boolean; readonly address: string | null };
export type PayeeEvent = { readonly kind: "verified" | "changed"; readonly name: string; readonly address: string };
type Remembered = Record<string, { readonly payable: boolean; readonly address: string | null }>;

export function payeeEvents(before: Remembered | null, now: readonly PayeeSeen[]): readonly PayeeEvent[] {
  if (!before) return [];
  return now.flatMap((payee): PayeeEvent[] => {
    const was = before[payee.id];
    if (!was || !payee.payable || !payee.address) return [];
    if (!was.payable) return [{ kind: "verified", name: payee.name, address: payee.address }];
    return was.address !== payee.address ? [{ kind: "changed", name: payee.name, address: payee.address }] : [];
  });
}

function readSeen(store: StoreLike | null): Remembered | null {
  try {
    const stored = store?.getItem(SEEN_KEY);
    return stored ? (JSON.parse(stored) as Remembered) : null;
  } catch {
    return null;
  }
}

export function notePayees(store: StoreLike | null, now: readonly PayeeSeen[]): readonly PayeeEvent[] {
  const events = payeeEvents(readSeen(store), now);
  try {
    store?.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(now.map((p) => [p.id, { payable: p.payable, address: p.address }]))));
  } catch {
    return events;
  }
  return events;
}
