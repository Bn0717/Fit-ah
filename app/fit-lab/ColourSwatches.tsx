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
