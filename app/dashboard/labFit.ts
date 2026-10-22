// app/dashboard/labFit.ts
// The Fit Lab verdicts for the dashboard: every Fit Lab shirt and pants on your saved body, in every size.
// Same functions and the same steps as "My fitting room" (app/fit-lab-profile/page.tsx), so both pages agree:
// tops use the simulated chest room (fitTier), bottoms use the simulated waistband (jeansState).
import { SIZES, solveBody, shirtShapeOk, fitNumbers, clamp, fitTier, type GridMeta } from '../fit-lab/engine';
import { jeansState, wornBody, type PantsData } from '../fit-lab/jeansFit';
import { syncWardrobe } from '../fit-lab/wardrobeCloud';
import { auth } from '@/lib/firebase/config';

export const GRID_DIR = '/models/fitlab/grid';
export const RANGE = { height: [160, 190], chest: [92, 116] } as const;      // the simulated bodies
const JEANS_SIZES = ['M', 'L', 'XL', '2XL'];

export type Tone = 'green' | 'amber' | 'blue' | 'red' | 'grey';
export type LabBody = { height: number; chest: number; waist: number; shoulder: number; belly: number };   // cm around
export type SizeVerdict = { size: string; tone: Tone; label: string; best: boolean };
export type LabPiece = {
  id: string; name: string; brand: string; img: string; group: 'tops' | 'bottoms';
  best: string | null;                      // the size that fits you (null: none fits, or not simulated for you)
  verdict: { text: string; tone: Tone };    // in the best size, or why none can be shown
  sizes: SizeVerdict[];
};
export type LabData = { meta: GridMeta; products: (PantsData & { id: string; name: string; brand: string; dir: string })[];
  stored: { id: string; name: string; brand: string; front: Blob; kind: 'shirt' | 'pants' }[]; hidden: string[] };

// the profile keeps chest and waist as half widths; Fit Lab works around the body (same conversion as My fitting room)
export function bodyFromProfile(a: Record<string, number | undefined> | null): LabBody | null {
  if (!a) return null;
  const n = (k: string) => Number(a[k]);
  return {
    height: n('height') > 120 && n('height') < 230 ? n('height') : 175,
    chest: n('chest') > 35 && n('chest') < 80 ? n('chest') * 2 : 101,
    waist: n('waist') > 25 && n('waist') < 80 ? n('waist') * 2 : 78,
    shoulder: n('shoulder') > 30 && n('shoulder') < 65 ? n('shoulder') : 45,
    belly: Number(a.belly ?? 0) || 0,
  };
}

export async function loadLab(): Promise<LabData> {
  const meta: GridMeta = await fetch(`${GRID_DIR}/meta.json`).then(r => r.json());
  const index: { id: string; name: string; brand: string; dir: string }[] = await fetch('/models/fitlab/products/index.json').then(r => r.json())
    .then((l: { id: string; name: string; brand: string; dir: string; hidden?: boolean }[]) => l.filter(p => !p.hidden)).catch(() => []);   // "hidden": not ready for shoppers yet
  const products = await Promise.all(index.filter(p => p.id !== 'xin_check').map(p =>
    fetch(`${p.dir}/product.json`).then(r => r.json()).then(j => ({ id: p.id, name: p.name, brand: p.brand, dir: p.dir,
      sizes: j.belt, drop: j.drop, belt: j.belt, elasticStretch: j.elastic_stretch } as LabData['products'][number])).catch(() => null)));
  const stored = (auth.currentUser ? await syncWardrobe(auth.currentUser.uid, message => console.warn(message)) : []).sort((a, b) => a.created - b.created).map(s => ({ id: s.id, name: s.name, brand: s.brand, front: s.front, kind: s.kind ?? 'shirt' as const }));
  let hidden: string[] = [];
  try { hidden = JSON.parse(localStorage.getItem('fitlab_hidden') || '[]'); } catch { /* storage blocked */ }
  return { meta, products: products.filter(Boolean) as LabData['products'], stored, hidden };
}

export function outsideRange(b: LabBody) {
  return [
    b.height < RANGE.height[0] || b.height > RANGE.height[1] ? `height ${RANGE.height[0]}–${RANGE.height[1]} cm` : null,
    b.chest < RANGE.chest[0] || b.chest > RANGE.chest[1] ? `chest ${RANGE.chest[0]}–${RANGE.chest[1]} cm` : null,
  ].filter(Boolean) as string[];
}

const toneOfTier = (tier: string): Tone => tier === 'Regular' ? 'green' : tier === 'Slim' || tier === 'Compression' ? 'amber' : 'blue';

export function labPieces(lab: LabData, b: LabBody, img: (id: string, blob: Blob) => string): LabPiece[] {
  const { meta } = lab;
  const simH = clamp(b.height, RANGE.height[0], RANGE.height[1]), simC = clamp(b.chest, RANGE.chest[0], RANGE.chest[1]);
  const sb0 = solveBody(meta, simH, simC, null, null, 0);
  const wRange = sb0.ok ? [Math.ceil(sb0.range.waist[0]), Math.floor(sb0.range.waist[1])] : [70, 90];
  const shRange = sb0.ok ? [Math.ceil(sb0.range.shoulder[0] * 2) / 2, Math.floor(sb0.range.shoulder[1] * 2) / 2] : [42, 50];
  const waist = clamp(b.waist, wRange[0], wRange[1]);

  // ── tops: every shirt is the Gon Tee cut (photo colourways reuse its simulation) ──
  const shirtLock = !shirtShapeOk(meta, simH, simC);
  const simS = shirtLock ? null : clamp(b.shoulder, shRange[0], shRange[1]);
  const sb = solveBody(meta, simH, simC, simS, shirtLock ? null : waist, shirtLock ? 0 : b.belly);
  const topSizes: SizeVerdict[] = SIZES.map(sz => {
    const f = fitNumbers(meta, sb, sz);
    if (!f.shirt) return { size: sz, tone: 'grey' as Tone, label: 'Not simulated', best: false };
    const e = f.shirt.chest - f.body.chest, t = fitTier(e, f.body.chest);
    return { size: sz, tone: toneOfTier(t.tier), label: `${t.label} · ${e >= 0 ? '+' : ''}${e.toFixed(0)} cm at the chest`, best: false, tier: t.tier } as SizeVerdict & { tier: string };
  });
  const topBest = (topSizes as (SizeVerdict & { tier?: string })[]).find(s => s.tier && s.tier !== 'Compression' && s.tier !== 'Slim')?.size ?? null;
  const tops = (): Omit<LabPiece, 'id' | 'name' | 'brand' | 'img'> => {
    const sizes = topSizes.map(s => ({ size: s.size, tone: s.tone, label: s.label, best: s.size === topBest }));
    const at = sizes.find(s => s.best);
    return { group: 'tops', best: topBest, sizes,
      verdict: at ? { text: at.label, tone: at.tone } : { text: 'Every size is tight on you', tone: 'red' } };
  };

  // ── bottoms: Xin (and its photo swaps) from the grid, other cuts from their own simulation ──
  const bottoms = (P: PantsData | null, sizes: string[]): Omit<LabPiece, 'id' | 'name' | 'brand' | 'img'> => {
    const per = sizes.map(sz => {
      const wb = wornBody(meta, P, sz, simH, simC, simS, waist, b.belly);
      return { sz, s: jeansState(meta, P, sz, false, simH, simC, simS, wb.waist, wb.belly) };
    });
    const best = per.find(({ s }) => s && !s.hide && s.now && s.now.waistEase >= 0)?.sz ?? null;
    const out: SizeVerdict[] = per.map(({ sz, s }) => ({
      size: sz, best: sz === best,
      tone: !s || (s.noSim && !s.tooSmall && !s.cantPullOn) ? 'grey' : s.hide ? 'red' : (s.now?.tone ?? 'green'),
      label: s?.now?.label ?? (s?.reason || 'Not simulated'),
    }));
    const at = per.find(({ sz }) => sz === best)?.s;
    const why = per.map(({ s }) => s?.reason).find(Boolean);
    return { group: 'bottoms', best, sizes: out,
      verdict: at?.now ? { text: at.now.label, tone: at.now.tone } : { text: why || 'Not simulated for your body yet', tone: why?.startsWith('Too small') ? 'red' : 'grey' } };
  };
  const xin = meta.jeans ? { ...meta.jeans } as PantsData : null;

  const list: LabPiece[] = [
    { id: 'gon', name: 'Gon Tee (green)', brand: 'TNT CO', img: '/models/fitlab/items/gon_front.png', ...tops() },
    ...lab.stored.filter(s => s.kind === 'shirt').map(s => ({ id: s.id, name: s.name, brand: s.brand, img: img(s.id, s.front), ...tops() })),
    ...(xin ? [{ id: 'xin', name: '"Xin" Denim Biker Pants (grey)', brand: 'TNT CO', img: '/models/fitlab/items/xin_front.jpg', ...bottoms(xin, JEANS_SIZES) }] : []),
    ...(xin ? lab.stored.filter(s => s.kind === 'pants').map(s => ({ id: s.id, name: s.name, brand: s.brand, img: img(s.id, s.front), ...bottoms(xin, JEANS_SIZES) })) : []),
    ...lab.products.map(p => ({ id: p.id, name: p.name, brand: p.brand, img: `${p.dir}/front.png`, ...bottoms(p, Object.keys(p.sizes ?? {})) })),
  ];
  return list.filter(p => !lab.hidden.includes(p.id));
}
