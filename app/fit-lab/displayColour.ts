// app/fit-lab/displayColour.ts
// Which fabric colour to give a 3D garment so that it LOOKS like the brand's swatch on screen. The fitting room
// renders with ACES filmic tone mapping (exposure 0.9) and studio lights, which lift darks (~2x) and compress
// whites, so a swatch colour used directly comes out pastel. Measured 27 Oct 2026 on the shirt's chest in the
// fitting room (black, blue, white, red Uniqlo swatches): shown = ACES(L * fabric + S) with L = 1.77 (light on the
// chest) and S = 0.028 (sheen / gloss added whatever the colour), error < 0.01 in linear light. Inverting that
// gives the fabric colour for any swatch. No imports here: tests load this file on its own.

const L = 1.77, S = 0.028, EXPOSURE = 0.9;
// three.js ACESFilmicToneMapping (r150+): rows of ACESInputMat / ACESOutputMat
const IN = [[0.59719, 0.35458, 0.04823], [0.07600, 0.90834, 0.01566], [0.02840, 0.13383, 0.83777]];
const OUT = [[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]];

const mul = (m: number[][], v: number[]) => m.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
function inv3(m: number[][]) {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  return [[A, -(b * i - c * h), b * f - c * e], [B, a * i - c * g, -(a * f - c * d)], [C, -(a * h - b * g), a * e - b * d]].map(r => r.map(x => x / det));
}
const IN_INV = inv3(IN), OUT_INV = inv3(OUT);
const rrt = (v: number) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081);
const rrtInv = (y: number) => {   // the positive root of rrt(v) = y
  const A = 1 - 0.983729 * y, B = 0.0245786 - 0.4329510 * y, C = -0.000090537 - 0.238081 * y;
  return A === 0 ? -C / B : (-B + Math.sqrt(Math.max(B * B - 4 * A * C, 0))) / (2 * A);
};
// what the fitting room shows for a fabric colour (linear in, linear out): used by the tests
export function shown(fabric: number[]): number[] {
  const c = fabric.map(x => (L * x + S) * EXPOSURE / 0.6);
  return mul(OUT, mul(IN, c).map(rrt)).map(x => Math.min(Math.max(x, 0), 1));
}
// the fabric colour (linear) that shows as the given swatch colour (linear); clamped to what fabric can be (0..1)
export function fabricFor(swatch: number[]): number[] {
  const t = swatch.map(x => Math.min(Math.max(x, 0), 0.98));
  const v = mul(OUT_INV, t).map(rrtInv);
  return mul(IN_INV, v).map(x => Math.min(Math.max((x * 0.6 / EXPOSURE - S) / L, 0), 1));
}
