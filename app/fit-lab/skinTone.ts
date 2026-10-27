// app/fit-lab/skinTone.ts
// Skin tones for the 3D body: the 10 tones of the Monk Skin Tone Scale (Google, CC BY 4.0, skintone.google),
// a scale made to represent the full range of human skin. The body keeps its skin photo texture (pores,
// shading, lips); the texture is only scaled lighter / darker towards the chosen tone, so every tone still looks
// like skin rather than flat paint. Applied to the static body and the walking body (material "Human.body*").
// No imports here: tests load this file on its own.

export const SKIN_TONES = [
  { id: 'mst01', hex: '#f6ede4' }, { id: 'mst02', hex: '#f3e7db' }, { id: 'mst03', hex: '#f7ead0' },
  { id: 'mst04', hex: '#eadaba' }, { id: 'mst05', hex: '#d7bd96' }, { id: 'mst06', hex: '#a07e56' },
  { id: 'mst07', hex: '#825c43' }, { id: 'mst08', hex: '#604134' }, { id: 'mst09', hex: '#3a312a' },
  { id: 'mst10', hex: '#292420' },
] as const;
export type SkinToneId = typeof SKIN_TONES[number]['id'];
export const isSkinTone = (v: unknown): v is SkinToneId => SKIN_TONES.some(t => t.id === v);
export const toneHex = (id: SkinToneId | null | undefined) => SKIN_TONES.find(t => t.id === id)?.hex ?? null;

// sRGB (0..1) -> linear light, the space three.js mixes colours in
export const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export function hexToLinear(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => srgbToLinear(v / 255)) as [number, number, number];
}

// The body's skin texture is lit skin whose average (sRGB #CFA187, measured on body.glb) sits nearest Monk tone 5
// in brightness. A tone is reached by scaling the texture by (tone / tone 5), channel by channel in linear light:
// tone 5 = the model's own skin, lighter / darker tones keep its warmth and detail. (Mapping the texture average
// straight onto the swatch colours was tried: light tones washed out to near white, dark ones turned grey.)
export const REFERENCE_TONE = 'mst05';
export function toneFactor(toneHexValue: string, referenceHex: string = SKIN_TONES[4].hex): [number, number, number] {
  const t = hexToLinear(toneHexValue), r = hexToLinear(referenceHex);
  return t.map((v, i) => v / r[i]) as [number, number, number];
}

// Set (or reset with null) the skin tone on every skin material under root (a three.js Object3D).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applySkinTone(root: any, id: SkinToneId | null | undefined) {
  const hex = toneHex(id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  root?.traverse?.((o: any) => {
    const mats = o.isMesh ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      if (!m || !/^Human\.body/i.test(m.name || '')) continue;
      if (!hex) { m.color.setRGB(1, 1, 1); m.needsUpdate = true; continue; }
      const f = toneFactor(hex);
      m.color.setRGB(f[0], f[1], f[2]);
      m.needsUpdate = true;
    }
  });
}
