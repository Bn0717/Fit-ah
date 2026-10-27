// app/fit-lab/skinTone.ts
// Skin tones for the 3D body: the 10 tones of the Monk Skin Tone Scale (Google, CC BY 4.0, skintone.google),
// a scale made to represent the full range of human skin. The body keeps its skin photo texture (pores,
// shading, lips); the texture is only scaled lighter / darker towards the chosen tone, so every tone still looks
// like skin rather than flat paint. Applied to the static body and the walking body (material "Human.body*").
import { fabricFor, SKIN } from './displayColour';

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

// The skin as SHOWN in the fitting room matches the tone's swatch: the scene's lights and ACES tone mapping are
// inverted (displayColour.ts, skin calibration measured on the bare chest, 27 Oct 2026), and the texture is scaled
// from its own average colour to that. (Earlier: scaling relative to tone 5 looked right in a flat 2D preview but
// rendered every tone ~40-50 sRGB steps too light in the lit 3D scene.)
export const TEXTURE_AVG: [number, number, number] = [0.6245, 0.3595, 0.2395];   // body skin texture average, linear
export function toneFactor(toneHexValue: string): [number, number, number] {
  const a = fabricFor(hexToLinear(toneHexValue), SKIN);
  return a.map((v, i) => v / TEXTURE_AVG[i]) as [number, number, number];
}

// Realistic skin material: the glTF default reflects 4 % of the light as a white shine, which turned dark skin grey
// ("ashy") and made Monk tones 9-10 impossible to show. Physical material with lower specular (real skin F0 ~2.8 %)
// and softer room reflections. THREE is passed in (no imports here).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function realisticSkin(root: any, THREE: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  root?.traverse?.((o: any) => {
    const m = o.isMesh ? o.material : null;
    if (!m || Array.isArray(m) || !/^Human\.body/i.test(m.name || '')) return;
    // some body files already load as a physical material (glTF specular / ior extensions): only lower the shine
    const p = m.isMeshPhysicalMaterial ? m : new THREE.MeshPhysicalMaterial({ name: m.name, map: m.map, normalMap: m.normalMap,
      roughness: m.roughness ?? 0.7, side: m.side, transparent: m.transparent, alphaTest: m.alphaTest });
    p.metalness = 0; p.specularIntensity = 0.15; p.envMapIntensity = 0.35;
    if (p !== m) { p.color.copy(m.color); o.material = p; }
    p.needsUpdate = true;
  });
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
