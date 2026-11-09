export type Live = { readonly memories: number | null; readonly sharedAgents: number | null; readonly sharedReports: number | null };

export type SharedLine = { readonly show: true; readonly text: string } | { readonly show: false };

export function sharedLine(live: Live | undefined | null): SharedLine | null {
  if (!live || live.sharedReports === null || live.sharedAgents === null) return null;
  if (live.sharedReports === 0) return { show: false };
  return { show: true, text: `Shared scam reports right now: ${live.sharedReports}, from ${live.sharedAgents} ${live.sharedAgents === 1 ? "agent" : "agents"}.` };
}

export function countText(value: number | null | undefined): string {
  return typeof value === "number" ? String(value) : "—";
}
