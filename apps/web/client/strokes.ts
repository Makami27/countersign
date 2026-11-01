export type Point = readonly [number, number];

function at(points: readonly Point[], i: number): Point {
  return points[Math.max(0, Math.min(points.length - 1, i))] ?? [0, 0];
}

function num(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

export function smoothPath(points: readonly Point[]): string {
  const first = at(points, 0);
  let d = `M${num(first[0])} ${num(first[1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [p0, p1, p2, p3] = [at(points, i - 1), at(points, i), at(points, i + 1), at(points, i + 2)];
    const c1: Point = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Point = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${num(c1[0])} ${num(c1[1])} ${num(c2[0])} ${num(c2[1])} ${num(p2[0])} ${num(p2[1])}`;
  }
  return d;
}

export function bounds(points: readonly Point[], pad: number): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.floor(Math.min(...xs) - pad);
  const y = Math.floor(Math.min(...ys) - pad);
  return { x, y, w: Math.ceil(Math.max(...xs) + pad) - x, h: Math.ceil(Math.max(...ys) + pad) - y };
}
