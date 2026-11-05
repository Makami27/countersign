export type Live = { readonly memories: number | null; readonly sharedAgents: number | null; readonly sharedReports: number | null };

export function sharedSentence(live: Live | undefined): string | null {
  if (!live || live.sharedReports === null || live.sharedAgents === null) return null;
  if (live.sharedReports === 0) return "No shared reports yet.";
  return `Shared scam reports right now: ${live.sharedReports}, from ${live.sharedAgents} ${live.sharedAgents === 1 ? "agent" : "agents"}.`;
}

export function countText(value: number | null | undefined): string {
  return typeof value === "number" ? String(value) : "—";
}
