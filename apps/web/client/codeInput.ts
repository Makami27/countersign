export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_CHARS = 10;
const HALF = CODE_CHARS / 2;
export const CODE_DISPLAY_LENGTH = CODE_CHARS + 1;

function keep(text: string): string {
  return [...text.toUpperCase()].filter((c) => CODE_ALPHABET.includes(c)).join("");
}

export function formatCode(value: string, caret: number): { readonly value: string; readonly caret: number } {
  const raw = keep(value).slice(0, CODE_CHARS);
  const before = Math.min(keep(value.slice(0, caret)).length, raw.length);
  const shown = raw.length > HALF ? `${raw.slice(0, HALF)}-${raw.slice(HALF)}` : raw;
  return { value: shown, caret: before > HALF ? before + 1 : before };
}
