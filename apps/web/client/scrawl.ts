import { bounds, smoothPath, type Point } from "./strokes.ts";

export type Dot = { readonly x: number; readonly y: number; readonly r: number };
export type Scrawl = {
  readonly stroke: string;
  readonly underline: string | null;
  readonly dots: readonly Dot[];
  readonly loops: number;
  readonly tailAngle: number;
  readonly viewBox: string;
};

const BASE = 64;

function seedOf(text: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

function generator(text: string): (lo: number, hi: number) => number {
  let [a, b, c, d] = seedOf(text);
  const next = (): number => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const out = (t + d) | 0;
    c = (c + out) | 0;
    return (out >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  return (lo, hi) => lo + (hi - lo) * next();
}

function pickSlots(count: number, of: number, between: (lo: number, hi: number) => number): Set<number> {
  const slots = new Set<number>([0]);
  while (slots.size < count) slots.add(Math.floor(between(1, of)));
  return slots;
}

export function scrawlFor(address: string): Scrawl {
  const between = generator(address.trim().toLowerCase());
  const loops = Math.floor(between(1, 4));
  const glyphs = Math.max(loops + 2, Math.floor(between(4, 8)));
  const loopSlots = pickSlots(loops, glyphs, between);
  const size = between(0.85, 1.15);
  const points: Point[] = [[between(4, 12), BASE + between(2, 12)]];
  const humps: Point[] = [];
  let x = between(14, 22);
  for (let i = 0; i < glyphs; i++) {
    const fade = 1 - (i / glyphs) * 0.45;
    const w = i === 0 ? between(18, 28) : between(8, 18);
    if (loopSlots.has(i) && (i === 0 || between(0, 1) < 0.5)) {
      const h = (i === 0 ? between(46, 62) : between(20, 40) * fade) * size;
      points.push([x, BASE - between(4, 10)], [x + w * 0.9, BASE - h], [x - w * 0.15, BASE - h + between(8, 14)], [x - w * 0.1, BASE + 1], [x + w * 0.7, BASE - between(6, 12)]);
    } else if (loopSlots.has(i)) {
      const h = between(22, 34) * size;
      points.push([x, BASE - between(10, 16)], [x + w * 0.45, BASE + h], [x - w * 0.5, BASE + h - between(6, 12)], [x + w * 0.9, BASE - between(4, 10)]);
    } else if (between(0, 1) < 0.4) {
      const top: Point = [x + w, BASE - between(8, 20) * size * fade];
      humps.push(top);
      points.push([x + w * 0.4, BASE + between(0, 4)], top);
    } else {
      const top: Point = [x + w * 0.45, BASE - between(10, 24) * size * fade];
      humps.push(top);
      points.push(top, [x + w, BASE + between(-2, 4)]);
    }
    x += w * between(1, 1.35);
  }
  const last = points.at(-1) ?? [x, BASE];
  const tailAngle = Math.round(between(-26, 20));
  const length = between(52, 96);
  const rad = (tailAngle * Math.PI) / 180;
  const sweep = between(0, 1) < 0.35;
  const tail: Point[] = sweep
    ? [[last[0] + between(12, 20), BASE + between(10, 18)], [last[0] - length * 0.2, BASE + between(20, 28)], [last[0] - length * 0.75, BASE + between(16, 26) + Math.sin(rad) * 18]]
    : [[last[0] + length * 0.45 * Math.cos(rad), last[1] + length * 0.45 * Math.sin(rad) + between(2, 8)], [last[0] + length * Math.cos(rad), last[1] + length * Math.sin(rad)]];
  const slant = between(0.12, 0.38);
  const lean = (p: Point): Point => [p[0] + (BASE - p[1]) * slant, p[1]];
  const stroke = [...points, ...tail].map(lean);
  const right = Math.max(...stroke.map((p) => p[0]));
  const underlinePoints: Point[] | null = between(0, 1) < 0.55
    ? [[between(0, 18), BASE + between(8, 18)], [right * between(0.4, 0.6), BASE + between(10, 22)], [right * between(0.8, 1.05), BASE + between(2, 14)]]
    : null;
  const dotCount = Math.floor(between(1, 3));
  const dots: Dot[] = Array.from({ length: dotCount }, (_, i) => {
    const anchor = humps[i % Math.max(1, humps.length)] ?? [x * 0.5, BASE - 20];
    const [dx, dy] = lean([anchor[0] + between(-2, 6), BASE - between(32, 44) * size]);
    return { x: Math.round(dx * 10) / 10, y: Math.round(dy * 10) / 10, r: Math.round(between(1.6, 2.6) * 10) / 10 };
  });
  const box = bounds([...stroke, ...(underlinePoints ?? []), ...dots.map((d): Point => [d.x, d.y])], 8);
  return {
    stroke: smoothPath(stroke),
    underline: underlinePoints ? smoothPath(underlinePoints) : null,
    dots,
    loops,
    tailAngle,
    viewBox: `${box.x} ${box.y} ${box.w} ${box.h}`,
  };
}

export function scrawlMarkup(address: string, className = "scrawl"): string {
  const s = scrawlFor(address);
  const underline = s.underline ? `<path class="scrawl-under" d="${s.underline}" pathLength="1"/>` : "";
  const dots = s.dots.map((d) => `<circle cx="${d.x}" cy="${d.y}" r="${d.r}"/>`).join("");
  return `<svg class="${className}" viewBox="${s.viewBox}" preserveAspectRatio="xMinYMid meet" aria-hidden="true" focusable="false"><path class="scrawl-stroke" d="${s.stroke}" pathLength="1"/>${underline}${dots}</svg>`;
}
