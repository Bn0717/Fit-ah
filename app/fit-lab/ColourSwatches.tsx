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
import { colourDistance } from './garmentColour';

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
// chosen one; the white card background round the garment is kept) ──
const cardCache: Record<string, Promise<string>> = {};
const toLin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
export function recolouredCard(url: string, baseHex: string, hex: string): Promise<string> {
  const key = `${url}|${baseHex}|${hex}`;
  return (cardCache[key] ||= new Promise<string>((res, rej) => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => {
      const W = Math.min(img.naturalWidth, 1000), H = Math.round(img.naturalHeight * W / img.naturalWidth), n = W * H;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const g = cv.getContext('2d')!; g.drawImage(img, 0, 0, W, H);
      const d = g.getImageData(0, 0, W, H), px = d.data;
      const b = hexToLinear(baseHex), t = hexToLinear(hex), k = [t[0] / b[0], t[1] / b[1], t[2] / b[2]];
      const morph = (src: Float32Array, grow: boolean, R: number) => {  // square max (grow) / min (shrink), separable
        const a = new Float32Array(n), out = new Float32Array(n), v = grow ? 1 : 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          let hit = false;
          for (let e = Math.max(0, x - R); e <= Math.min(W - 1, x + R) && !hit; e++) hit = src[y * W + e] === v;
          a[y * W + x] = hit ? v : 1 - v;
        }
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          let hit = false;
          for (let e = Math.max(0, y - R); e <= Math.min(H - 1, y + R) && !hit; e++) hit = a[e * W + x] === v;
          out[y * W + x] = hit ? v : 1 - v;
        }
        return out;
      };
      const blur = (src: Float32Array, r: number) => {                  // box blur, separable
        const a = new Float32Array(n), out = new Float32Array(n), w = 2 * r + 1;
        for (let y = 0; y < H; y++) { let s = 0; for (let x = -r; x <= r; x++) s += src[y * W + Math.min(W - 1, Math.max(0, x))];
          for (let x = 0; x < W; x++) { a[y * W + x] = s / w; s += src[y * W + Math.min(W - 1, x + r + 1)] - src[y * W + Math.max(0, x - r)]; } }
        for (let x = 0; x < W; x++) { let s = 0; for (let y = -r; y <= r; y++) s += a[Math.min(H - 1, Math.max(0, y)) * W + x];
          for (let y = 0; y < H; y++) { out[y * W + x] = s / w; s += a[Math.min(H - 1, y + r + 1) * W + x] - a[Math.max(0, y - r) * W + x]; } }
        return out;
      };
      // 1. background = pure white (255) joined to the photo's edge. A white tee's highlights are pure white too, and
      //    its outline is only a faint dotted line of off-white pixels: the gaps in that line are closed first (the
      //    off-white pixels grown by G px), so the background cannot seep into the garment.
      const G = Math.max(2, Math.round(W / 250));
      const ink = new Float32Array(n);
      for (let j = 0; j < n; j++) ink[j] = px[j * 4] === 255 && px[j * 4 + 1] === 255 && px[j * 4 + 2] === 255 ? 0 : 1;
      const wall = morph(ink, true, G);
      const bg = new Uint8Array(n), stack: number[] = [];
      const seed = (j: number) => { if (!bg[j] && !wall[j]) { bg[j] = 1; stack.push(j); } };
      for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
      for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
      while (stack.length) {
        const j = stack.pop()!, x = j % W;
        if (x > 0) seed(j - 1); if (x < W - 1) seed(j + 1); if (j >= W) seed(j - W); if (j < n - W) seed(j + W);
      }
      // 2. garment shape = everything else, shrunk back by G (undoes the growing) and closed (grow then shrink by R)
      //    against any nick left at the edge
      const R = Math.max(2, Math.round(W / 150));
      let m = new Float32Array(n); for (let j = 0; j < n; j++) m[j] = bg[j] ? 0 : 1;
      m = morph(morph(morph(m, false, G), true, R), false, R);
      // 3. smooth outline: the shape's pixel steps are blurred and re-sharpened into a smooth ~2 px soft edge
      const sm = blur(blur(m, 3), 3);
      // 4. colour: garment pixels scaled in linear light from the base colour to the chosen one, laid on the white
      //    background by the soft outline (pixels the outline added, white in the photo, take the plain new colour).
      //    A coloured photo: a pixel lighter than its fabric is that fabric mixed with white (the outline's blend with
      //    the background, a sheen), so it becomes the new colour mixed with the same share of white; scaling it
      //    instead pushes the channels the base lacks (blue -> grey: a peach halo round the outline).
      const lum = (r: number, gg: number, bb: number) => 0.2126 * r + 0.7152 * gg + 0.0722 * bb;
      const Ls = lum(b[0], b[1], b[2]), coloured = Ls < 0.75;     // not a white base (its highlights are pure white)
      for (let j = 0; j < n; j++) {
        const al = Math.min(1, Math.max(0, (sm[j] - 0.3) / 0.4));
        if (al === 0) { px[j * 4] = px[j * 4 + 1] = px[j * 4 + 2] = 255; continue; }
        const P = [toLin(px[j * 4] / 255), toLin(px[j * 4 + 1] / 255), toLin(px[j * 4 + 2] / 255)];
        const Lp = lum(P[0], P[1], P[2]);
        const mixW = coloured && Lp > Ls ? Math.min(1, Math.max(0, (1 - Lp) / (1 - Ls))) : -1;   // fabric share
        for (let c = 0; c < 3; c++) {
          const lin = mixW >= 0 ? mixW * t[c] + (1 - mixW) : Math.min(P[c] * k[c], 1);
          const col = 255 * Math.min(toSrgb(lin), 1);
          px[j * 4 + c] = Math.round(col * al + 255 * (1 - al));
        }
      }
      g.putImageData(d, 0, 0); res(cv.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = rej; img.src = url;
  }));
}
// the card image for a product colour (null: the product's own photo is right, e.g. its base colour). Front: that
// colour's own flat photo when the brand has one; else the brand photo of the closest colour, recoloured (a coloured
// photo has a crisp outline; a white tee's outline fades into the white background). Back: the product's back photo
// recoloured (colour photos are front only).
export function colourCard(p: ShirtProduct & { dir?: string }, hex: string | null, productCard: string, front = true): string | Promise<string> | null {
  if (!hex || !p.colours) return null;
  const c = p.colours.find(x => x.hex === hex);
  if (!c) return null;
  if (front && c.card && p.dir) return `${p.dir}/${c.card}`;
  if (!p.base_hex || hex === p.base_hex) return null;
  const src = front && p.dir ? p.colours.filter(x => x.card).sort((a, b) => colourDistance(a.hex, hex) - colourDistance(b.hex, hex))[0] : null;
  if (src && colourDistance(src.hex, hex) < colourDistance(p.base_hex, hex)) return recolouredCard(`${p.dir}/${src.card}`, src.hex, hex);
  return recolouredCard(productCard, p.base_hex, hex);
}

// a garment the user added with colours (garmentColour.ts): the same shape as a brand product's colours, so the swatch
// row, saving, the card and the 3D recolouring work the same; its base colour is the photo's own colour
export function userColourProduct(it: { id: string; colours?: { name: string; hex: string }[] } | null | undefined): ShirtProduct | null {
  if (!it?.colours || it.colours.length < 2) return null;
  return { id: it.id, base_hex: it.colours[0].hex, colours: it.colours.map(c => ({ name: c.name, hex: c.hex })) } as unknown as ShirtProduct;
}
