// app/fit-lab/garmentColour.ts
// Colours of a garment a user adds: the colour of their photo (found automatically and named), plus any other colours
// of the same garment they type ("olive", "#2f4f4f", "black, cream") or pick. No imports: tests load this file alone.

export type GarmentColour = { name: string; hex: string; fromPhoto?: boolean };

// everyday clothing colour names (what a shopper would call them), sRGB hex
export const NAMED: [string, string][] = [
  ['Black', '#27272b'], ['Charcoal', '#3d4047'], ['Dark Grey', '#4f5257'], ['Grey', '#8a8d91'], ['Light Grey', '#c4c6c8'],
  ['White', '#f4f4f2'], ['Off-White', '#ece7dc'], ['Cream', '#f1e6cc'], ['Beige', '#d8c7a8'], ['Khaki', '#bba982'],
  ['Camel', '#b98a55'], ['Tan', '#c49e72'], ['Brown', '#7a5536'], ['Dark Brown', '#4a3426'], ['Olive', '#6b6b3a'],
  ['Dark Green', '#2f4a36'], ['Green', '#3f8a4f'], ['Sage', '#a3b39b'], ['Mint', '#b7e0c8'], ['Teal', '#2c7a7b'],
  ['Navy', '#1f2a44'], ['Dark Blue', '#23395d'], ['Blue', '#3264b8'], ['Denim Blue', '#5679a6'], ['Light Blue', '#a9c6e8'],
  ['Sky Blue', '#87c3ec'], ['Purple', '#6a4c93'], ['Lavender', '#c3b5e0'], ['Burgundy', '#6d2132'], ['Maroon', '#7a2a2a'],
  ['Red', '#c0392b'], ['Coral', '#ee7f6d'], ['Orange', '#e3772e'], ['Mustard', '#d2a52c'], ['Yellow', '#f2d34b'],
  ['Pink', '#e7a2b4'], ['Light Pink', '#f3cfd7'], ['Hot Pink', '#e0457b'],
];

const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
export const rgbToHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

// CIE Lab (D65): colour differences people see
function lab(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex)!.map(v => lin(v / 255));
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

// how different two colours look (CIE76 ΔE²)
export function colourDistance(a: string, b: string): number {
  const x = lab(a), y = lab(b);
  return (x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2;
}

// the everyday name closest to a colour
export function nameOf(hex: string): string {
  const a = lab(hex);
  let best = NAMED[0][0], d = Infinity;
  for (const [n, h] of NAMED) {
    const b = lab(h), e = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
    if (e < d) { d = e; best = n; }
  }
  return best;
}

// one typed colour: a hex code ("#2f4f4f"), a known name ("olive", "light blue"), or "name #hex" ("Forest #2f4f36")
export function parseColour(text: string): GarmentColour | null {
  const t = text.trim();
  if (!t) return null;
  const hexIn = /#?[0-9a-f]{6}\b|#[0-9a-f]{3}\b/i.exec(t)?.[0];
  if (hexIn && hexToRgb(hexIn)) {
    const hex = rgbToHex(...hexToRgb(hexIn)!);
    const label = t.replace(hexIn, '').replace(/[()\-–:]/g, ' ').trim();
    return { name: label ? title(label) : nameOf(hex), hex };
  }
  const known = NAMED.find(([n]) => n.toLowerCase() === t.toLowerCase().replace(/\s+/g, ' '))
    ?? NAMED.find(([n]) => n.toLowerCase().replace(/[\s-]/g, '') === t.toLowerCase().replace(/[\s-]/g, ''));
  return known ? { name: known[0], hex: known[1] } : null;
}
const title = (s: string) => s.replace(/\s+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// a pasted list: "black, cream; #2f4f4f\nolive". Unknown words are returned so the form can ask about them.
export function parsePalette(text: string): { colours: GarmentColour[]; unknown: string[] } {
  const colours: GarmentColour[] = [], unknown: string[] = [];
  for (const part of text.split(/[,;\n]+/)) {
    if (!part.trim()) continue;
    const c = parseColour(part);
    if (c) { if (!colours.some(x => x.hex === c.hex)) colours.push(c); } else unknown.push(part.trim());
  }
  return { colours, unknown };
}

// the colour of the garment in an RGBA pixel array (a flat-lay photo): the background is the colour round the photo's
// edge (or transparent); the garment colour is the median of the pixels that differ from it
export function garmentColourOf(px: Uint8ClampedArray, w: number, h: number): string | null {
  const edge: number[][] = [];
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) { const i = (y * w + x) * 4; if (px[i + 3] > 128) edge.push([px[i], px[i + 1], px[i + 2]]); }
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) { const i = (y * w + x) * 4; if (px[i + 3] > 128) edge.push([px[i], px[i + 1], px[i + 2]]); }
  const med = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[s.length >> 1] ?? 0; };
  const bg = edge.length ? [0, 1, 2].map(c => med(edge.map(e => e[c]))) : null;
  const R: number[] = [], G: number[] = [], B: number[] = [];
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;                                            // transparent background
    if (bg && Math.max(Math.abs(px[i] - bg[0]), Math.abs(px[i + 1] - bg[1]), Math.abs(px[i + 2] - bg[2])) < 28) continue;
    R.push(px[i]); G.push(px[i + 1]); B.push(px[i + 2]);
  }
  if (R.length < (w * h) / 50) return null;                                  // no garment found
  return rgbToHex(med(R), med(G), med(B));
}

// the same on a photo file (browser)
export async function photoColour(file: Blob): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const W = 160, H = Math.max(1, Math.round(img.naturalHeight * W / img.naturalWidth));
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d')!; g.drawImage(img, 0, 0, W, H);
    return garmentColourOf(g.getImageData(0, 0, W, H).data, W, H);
  } catch { return null; } finally { URL.revokeObjectURL(url); }
}
