import { groupAddress } from "@countersign/web/addressGroups";

export type Format = {
  readonly escape: (text: string) => string;
  readonly bold: (escaped: string) => string;
  readonly underline: (escaped: string) => string;
  readonly link: (url: string) => string;
  readonly url: (url: string) => string;
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
}

export const HTML_FORMAT: Format = {
  escape: escapeHtml,
  bold: (escaped) => `<b>${escaped}</b>`,
  underline: (escaped) => `<u>${escaped}</u>`,
  link: (url) => `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`,
  url: escapeHtml,
};

export function grouped(f: Format, address: string, against?: string): string {
  const groups = groupAddress(address, against ? { against } : {}).groups;
  return groups.map((g) => (g.mark === "diff" ? f.bold(f.underline(f.escape(g.text))) : f.escape(g.text))).join(" ");
}
