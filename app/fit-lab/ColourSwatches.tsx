// app/fit-lab/ColourSwatches.tsx
// Colours of a shirt product, shared by the fitting room (/items) and My fitting room (/profile): the swatch row,
// the remembered choice (one per product, in this browser, same on both pages) and the fabric colour that shows
// as the swatch under the fitting room's lights (displayColour.ts). Same cut in every colour: only the fabric
// colour changes, the fit does not.
'use client';

import { useState } from 'react';
import { hexToLinear } from './skinTone';
import { fabricFor } from './displayColour';
import type { ShirtProduct } from './engine';

const KEY = 'fitlab_top_colour';
const NAVY = '#0B1957';

export function useTopColours() {
  const [chosen, setChosen] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
  });
  const pick = (id: string, hex: string) => setChosen(c => {
    const n = { ...c, [id]: hex };
    try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* storage blocked */ }
    return n;
  });
  return { chosen, pick };
}

// the colour shown for a product: the chosen one, else the swatch closest to the colour it was built in
export function currentHex(p: ShirtProduct, chosen: Record<string, string>): string | null {
  if (!p.base_hex) return null;
  if (chosen[p.id]) return chosen[p.id];
  const b = hexToLinear(p.base_hex), d = (h: string) => { const x = hexToLinear(h); return Math.hypot(x[0] - b[0], x[1] - b[1], x[2] - b[2]); };
  return [...(p.colours ?? [])].sort((x, y) => d(x.hex) - d(y.hex))[0]?.hex ?? p.base_hex;
}

// recolour the loaded shirt's fabric materials (parts from the shirt loader) to show as `hex`
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyTopColour(parts: any[] | undefined, p: ShirtProduct | null | undefined, hex: string | null) {
  if (!parts || !p?.base_hex || !hex) return;
  const b = hexToLinear(p.base_hex), t = fabricFor(hexToLinear(hex));
  for (const part of parts) {
    if (part.isJeans) continue;
    part.fabric.color.setRGB(t[0] / b[0], t[1] / b[1], t[2] / b[2]);
    // the cotton sheen follows the fabric colour (a white sheen washes every colour out to pastel)
    if (part.fabric.sheenColor) part.fabric.sheenColor.setRGB(0.9 * t[0], 0.9 * t[1], 0.9 * t[2]);
    part.fabric.needsUpdate = true;
  }
}

// the fabric colour multiplier that shows a plain-fabric shirt product (simulated in base_hex) as `hex`
export function topTint(p: ShirtProduct | null | undefined, hex: string | null): number[] | null {
  if (!p?.base_hex || !hex) return null;
  const b = hexToLinear(p.base_hex), t = fabricFor(hexToLinear(hex));
  return [t[0] / b[0], t[1] / b[1], t[2] / b[2]];
}

// The wardrobe item window: try a colour (the 3D / photo previews follow), then save it as this item's colour in the
// wardrobe (the fitting room and My fitting room show it from then on). Saved = the colour already in the wardrobe.
export function ColourPick({ product, saved, preview, onPreview, onSave }: {
  product: ShirtProduct; saved: string | null; preview: string | null; onPreview: (hex: string) => void; onSave: (hex: string) => void;
}) {
  const colours = product.colours ?? [];
  if (colours.length < 2) return null;
  const cur = preview ?? saved;
  const dirty = !!preview && preview !== saved;
  const nameOf = (h: string | null) => colours.find(c => c.hex === h)?.name ?? '';
  return (
    <div className="mb-4 rounded-xl p-3" style={{ backgroundColor: '#FFF8F0', border: '1px solid #F6D7B0' }}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-bold" style={{ color: NAVY }}>Colour</span>
        <span className="min-w-0 truncate text-xs" style={{ color: NAVY }}>{nameOf(cur)}{saved && !dirty ? ' · in your wardrobe' : ''}</span>
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Colour">
        {colours.map(c => (
          <button key={c.hex + c.name} role="radio" aria-checked={c.hex === cur} aria-label={c.name} title={c.name}
            onClick={() => onPreview(c.hex)} className="h-8 w-8 shrink-0 rounded-full transition"
            style={{ background: c.hex, boxShadow: c.hex === cur ? `0 0 0 2px #fff, 0 0 0 4px ${NAVY}` : 'inset 0 0 0 1px rgba(0,0,0,0.15)' }} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={() => cur && onSave(cur)} disabled={!dirty} className="min-h-[40px] rounded-lg px-4 text-sm font-semibold text-white"
          style={{ backgroundColor: NAVY, opacity: dirty ? 1 : 0.4 }}>{dirty ? `Save ${nameOf(cur).replace(/^\d+\s*/, '')}` : 'Saved'}</button>
        {dirty && <button onClick={() => saved && onPreview(saved)} className="min-h-[40px] rounded-lg px-3 text-sm" style={{ color: NAVY }}>Undo</button>}
        <span className="text-xs" style={{ color: NAVY, opacity: 0.6 }}>Same fit in every colour</span>
      </div>
    </div>
  );
}

export function ColourSwatches({ product, chosen, onPick, size = 28 }: {
  product: ShirtProduct; chosen: Record<string, string>; onPick: (id: string, hex: string) => void; size?: number;
}) {
  const colours = product.colours ?? [];
  if (colours.length < 2 || !product.base_hex) return null;
  const cur = currentHex(product, chosen);
  const name = colours.find(c => c.hex === cur)?.name ?? '';
  return (
    <div className="min-w-0">
      <div className="mb-1.5 truncate text-xs" style={{ color: NAVY }}>Colour: <span className="font-semibold">{name}</span> <span style={{ opacity: 0.6 }}>· same fit in every colour</span></div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colour">
        {colours.map(c => (
          <button key={c.hex + c.name} role="radio" aria-checked={c.hex === cur} aria-label={c.name} title={c.name}
            onClick={() => onPick(product.id, c.hex)} className="shrink-0 rounded-full transition"
            style={{ width: size, height: size, background: c.hex, boxShadow: c.hex === cur ? `0 0 0 2px #fff, 0 0 0 4px ${NAVY}` : 'inset 0 0 0 1px rgba(0,0,0,0.15)' }} />
        ))}
      </div>
    </div>
  );
}

// ── pants colours (blender/pants_colours.py): each colour is its own photo texture lined up on the same pattern,
// so the fit is unchanged; the colour the pants were simulated in (base) keeps the texture inside the 3D file ──
export type PantsColour = { code: string; name: string; hex: string; front?: string; back?: string; base?: boolean; card?: string };
export type PantsColours = { id: string; dir: string; colours?: PantsColour[]; base_colour?: string };

// the swatch row's view of a pants product (same component as the shirts)
export function pantsSwatches(p: PantsColours): ShirtProduct | null {
  const base = p.colours?.find(c => c.base);
  if (!base || (p.colours?.length ?? 0) < 2) return null;
  return { id: p.id, dir: p.dir, colours: p.colours!.map(c => ({ hex: c.hex, name: c.name, code: c.code, card: c.card })), base_hex: base.hex } as unknown as ShirtProduct;
}

// the chosen colour's texture files (none chosen: the base colour's cleaned files, whose edges have no white photo
// rim), or null for the texture inside the 3D file (products made before the base colour had its own files)
export function pantsColourFiles(p: PantsColours | null | undefined, chosen: Record<string, string>): { front: string; back: string } | null {
  const c = p?.colours?.find(x => x.hex === chosen[p.id]) ?? p?.colours?.find(x => x.base);
  return c && c.front && c.back ? { front: `${p!.dir}/${c.front}`, back: `${p!.dir}/${c.back}` } : null;
}

// the multiplier that makes a photo texture of average colour `hex` show as that colour under the fitting room's
// lights (same calibration as the shirts, displayColour.ts); null when the product has no measured colours
export function pantsTint(p: PantsColours | null | undefined, chosen: Record<string, string>): number[] | null {
  const c = p?.colours?.find(x => x.hex === chosen[p.id]) ?? p?.colours?.find(x => x.base);
  if (!c) return null;
  const lin = hexToLinear(c.hex), want = fabricFor(lin);
  return want.map((w, i) => Math.min(w / Math.max(lin[i], 1e-4), 1));
}

// load (once) the two textures of a colour; flipY false + sRGB like the textures inside the glTF files
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const texCache: Record<string, Promise<any>> = {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadPantsColour(THREE: any, files: { front: string; back: string }): Promise<{ front: any; back: any }> {
  const one = (url: string) => (texCache[url] ||= new THREE.TextureLoader().loadAsync(url).then((t: { flipY: boolean; colorSpace: string; anisotropy: number }) => {
    t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
  }));
  return Promise.all([one(files.front), one(files.back)]).then(([front, back]) => ({ front, back }));
}

// ── wardrobe card in a chosen colour: that colour's own flat photo (card) when the brand has one, else the product's
// card recoloured in the browser (plain fabric: garment pixels scaled in linear light from the base colour to the
// chosen one; the pure-white card background is kept) ──
const cardCache: Record<string, Promise<string>> = {};
const toLin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
export function recolouredCard(url: string, baseHex: string, hex: string): Promise<string> {
  const key = `${url}|${baseHex}|${hex}`;
  return (cardCache[key] ||= new Promise<string>((res, rej) => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => {
      const W = Math.min(img.naturalWidth, 600), H = Math.round(img.naturalHeight * W / img.naturalWidth);
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const g = cv.getContext('2d')!; g.drawImage(img, 0, 0, W, H);
      const d = g.getImageData(0, 0, W, H), px = d.data;
      const b = hexToLinear(baseHex), t = hexToLinear(hex), k = [t[0] / b[0], t[1] / b[1], t[2] / b[2]];
      for (let i = 0; i < px.length; i += 4) {
        if (px[i] > 250 && px[i + 1] > 250 && px[i + 2] > 250) continue;           // background
        for (let c = 0; c < 3; c++) px[i + c] = Math.round(255 * Math.min(toSrgb(Math.min(toLin(px[i + c] / 255) * k[c], 1)), 1));
      }
      g.putImageData(d, 0, 0); res(cv.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = rej; img.src = url;
  }));
}
// the card image for a product colour (null: the product's own card is right, e.g. its base colour)
export function colourCard(p: ShirtProduct & { dir?: string }, hex: string | null, productCard: string): string | Promise<string> | null {
  if (!hex || !p.colours) return null;
  const c = p.colours.find(x => x.hex === hex);
  if (!c) return null;
  if (c.card && p.dir) return `${p.dir}/${c.card}`;
  if (!p.base_hex || hex === p.base_hex) return null;
  return recolouredCard(productCard, p.base_hex, hex);
}
