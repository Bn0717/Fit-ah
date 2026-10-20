// app/fit-lab/jeansFit.ts
// The jeans verdict for one body, shared by pages that show the Fit Lab jeans (/fit-lab-profile; /fit-lab has the
// same rules inline): which simulation to show (nothing holding them up / belt), whether they can be worn at all,
// whether this body + waist / belly was really simulated, and the fit label in cm.
// Rule: jeans that cannot be worn, or were not simulated for this body, are not drawn (an honest "can't" is
// better than a broken-looking simulation).
import { solveBody, blend, VARIANTS, jeansVarWeights, type ProductWalk, type GridMeta, type JeansSim, type JeansBody, type Tape, type Variant } from './engine';

export type PantsData = { walk?: ProductWalk; name: string; sizes: Record<string, JeansSim>; drop?: Record<string, JeansSim>; belt?: Record<string, JeansSim>;
  elasticStretch?: number | null };   // elastic waist: stretches up to this x relaxed
export type JeansVariant = 'held' | 'drop' | 'belt';
export interface JeansNow {
  chart: JeansSim['chart']; waistEase: number; hipEase: number; hem: number; drop: number; extra: number;
  bodyWaist: number; bodyHip: number; label: string; tone: 'red' | 'amber' | 'green' | 'blue';
}
export interface JeansState {
  variant: JeansVariant; tooSmall: boolean; cantPullOn: boolean; noSim: boolean; hide: boolean;
  lock: boolean;           // waist / belly sliders cannot be used with these pants (not simulated on those versions)
  now: JeansNow | null;
  reason: string | null;   // why the jeans are not drawn, in plain words
  elastic: boolean;        // elastic waist: no belt
}

// a value of the jeans on this body: grid blend, plus the waist / belly versions' change on the centre body
export function jeansVal(meta: GridMeta, J: JeansSim, w: Record<string, number>, vw: Record<Variant, number>, f: (b: JeansBody) => number) {
  const ks = Object.entries(w).filter(([k, v]) => v > 1e-6 && J.bodies[k]), tot = ks.reduce((a, [, v]) => a + v, 0);
  const c = J.bodies[meta.centre], V = J.variants;
  return ks.reduce((a, [k, v]) => a + v * f(J.bodies[k]), 0) / (tot || 1)
    + (c && V ? Object.entries(jeansVarWeights(vw, n => !!V[n])).reduce((a, [n, x]) => a + x * (f(V[n]) - f(c)), 0) : 0);
}

// body tape at this slider position, including the slim / full waist and belly versions
export function tapeAt(meta: GridMeta, m: keyof Tape, w: Record<string, number>, vw: Record<Variant, number>) {
  return blend(w, k => meta.body[k][m] ?? 0)
    + VARIANTS.reduce((a, v) => a + (vw[v] ? vw[v] * blend(w, k => meta.shape?.[k]?.[v]?.[m] ?? 0) : 0), 0);
}

// The body the 3D, the shirt and the pants all use while these pants are worn (same rule on /fit-lab and
// /fit-lab-profile, so both show the same thing):
//  - pants simulated at the natural waist and belly only (no waist / belly versions: products, shorts): natural
//    waist and belly (lock), as that is the only body they were simulated on
//  - pants with waist / belly versions (centre body only): away from the centre body, a waist within 2 cm of this
//    body's natural waist (about a tape measure's own error) with a natural belly is shown at the natural waist
//    (snap), so the pants can be drawn; bigger changes stay (and the pants then say they were not simulated)
export function wornBody(meta: GridMeta, pants: PantsData | null, size: string | null,
  height: number, chest: number, shoulder: number | null, waist: number | null, belly: number) {
  if (!pants || !size || !pants.sizes[size]) return { waist, belly, lock: false, snap: false };
  const lock = !(pants.belt?.[size]?.variants && pants.drop?.[size]?.variants);
  if (lock) return { waist: null, belly: 0, lock, snap: false };
  const sb0 = solveBody(meta, height, chest, shoulder, null, 0);
  const snap = sb0.ok && (sb0.w[meta.centre] ?? 0) < 0.5 && Math.abs(belly) <= 0.15
    && (waist === null || Math.abs(waist - sb0.natural.waist) <= 2);
  return snap ? { waist: null, belly: 0, lock, snap } : { waist, belly, lock, snap };
}

export function jeansState(meta: GridMeta, pants: PantsData | null, size: string | null, belt: boolean,
  height: number, chest: number, shoulder: number | null, waist: number | null, belly: number): JeansState | null {
  if (!pants || !size || !pants.sizes[size]) return null;
  const hasVar = !!(pants.belt?.[size]?.variants && pants.drop?.[size]?.variants);
  const lock = !hasVar;
  const bl = lock ? 0 : belly, wt = lock ? null : waist;
  const { w, vw } = solveBody(meta, height, chest, shoulder, wt, bl);
  const D = pants.drop?.[size];
  // elastic waist (shorts, joggers): the relaxed elastic stretches round the waist and holds them up (no belt, no
  // "drop" result: the held simulation is the worn one); too small only past the elastic's stretch
  const ew = pants.sizes[size].chart.elastic_waist, elastic = !!ew, stretch = pants.elasticStretch ?? 1.3;
  const bodyW = tapeAt(meta, 'waist', w, vw);
  // a waistband smaller than the waist cannot close: cannot be worn
  const tooSmall = elastic ? bodyW > 2 * ew! * stretch : !!D && 2 * D.chart.waist - bodyW < -2;
  const variant: JeansVariant = elastic ? (pants.belt ? 'belt' : 'held') : pants.drop && pants.belt ? (belt || tooSmall ? 'belt' : 'drop') : 'held';
  const J = variant === 'held' ? pants.sizes[size] : pants[variant]?.[size];
  if (!J) return null;
  const jw = Object.fromEntries(Object.entries(w).filter(([, v]) => v > 1e-6));
  const simulated = Object.keys(jw).every(k => J.bodies[k]);
  // the simulation could not put them on (seams torn open): far too tight in the legs or waist
  // or the simulation could not get them on (one leg stuck at the thigh: blender/check_legs.py)
  const cantPullOn = simulated && (jeansVal(meta, J, jw, vw, b => b.seam_gap_mean_cm ?? 0) > 0.25
    || jeansVal(meta, J, jw, vw, b => b.put_on_failed ? 1 : 0) > 0.5);
  // waist / belly versions exist for the centre body only: elsewhere a changed waist or belly would be a guess
  const moved = (['w70', 'w86', 'bm', 'bp'] as Variant[]).some(v => vw[v] > 0.05);
  const noSim = !simulated || (!lock && moved && (w[meta.centre] ?? 0) < 0.5);
  const hide = cantPullOn || tooSmall || noSim;
  let now: JeansNow | null = null;
  if (simulated) {
    const bw = tapeAt(meta, 'waist', jw, vw), bh = tapeAt(meta, 'hip', jw, vw);
    const e = 2 * J.chart.waist - bw, eh = 2 * J.chart.hip - bh;
    const jv = (f: (b: JeansBody) => number) => jeansVal(meta, J, jw, vw, f);
    const drop = variant === 'drop' ? jv(b => b.drop_cm ?? 0) : 0;
    const extra = J.chart.length - (jv(b => b.waistband_height_cm) - jv(b => b.floor_cm ?? -1.7));
    let label: string, tone: JeansNow['tone'];
    const rel = elastic ? 2 * ew! : 0, st = elastic ? (bw - rel) / rel : 0;
    if (cantPullOn) { label = 'Too small: cannot be pulled on'; tone = 'red'; }
    else if (elastic && tooSmall) { label = `Too small: the elastic can't stretch round a ${bw.toFixed(0)} cm waist`; tone = 'red'; }
    else if (elastic && noSim) { label = 'Not simulated for this body yet'; tone = 'amber'; }
    else if (elastic && bw < rel - 4) { label = `Loose: the elastic is ${(rel - bw).toFixed(0)} cm bigger than your waist and may slide down`; tone = 'blue'; }
    else if (elastic && st > 0.2) { label = `Snug: the elastic is stretched ${(st * 100).toFixed(0)} % (grips firmly)`; tone = 'amber'; }
    else if (elastic) { label = `Comfortable: the elastic holds them up${st > 0 ? ` (stretched ${(st * 100).toFixed(0)} %)` : ''}`; tone = 'green'; }
    else if (e < -2 || tooSmall) { label = "Too small: can't be worn (the waistband cannot close)"; tone = 'red'; }
    else if (noSim) { label = 'Not simulated for this body yet'; tone = 'amber'; }
    else if (drop > 30) { label = 'Too big: falls down without a belt'; tone = 'red'; }
    // a waistband that is not loose but still slides has slipped under a belly, not fallen off loose hips
    else if (drop > 4) { label = e < 6 ? `Slides ${drop.toFixed(0)} cm down under the belly (try the belt)` : `Too big at the waist: slides ${drop.toFixed(0)} cm down onto the hips (try the belt)`; tone = 'blue'; }
    else if (variant === 'belt' && e >= 6) { label = `Held up by the belt (${e.toFixed(0)} cm of waistband gathered)`; tone = 'green'; }
    else if (e < 2) { label = 'Snug at the waist'; tone = 'amber'; }
    else if (e < 6) { label = 'Comfortable at the waist'; tone = 'green'; }
    else { label = 'Loose at the waist (needs a belt)'; tone = 'blue'; }
    now = { chart: J.chart, waistEase: elastic ? (st <= 0.2 ? rel - bw + 4 : -1) : e, hipEase: eh, hem: jv(b => b.hem_lowest_cm), drop, extra, bodyWaist: bw, bodyHip: bh, label, tone };
  }
  // short, plain words for shoppers
  const reason = cantPullOn ? `Too small to pull on over your hips and legs. Try a bigger size.`
    : elastic && tooSmall ? `Too small: the elastic can't stretch round your ${bodyW.toFixed(0)} cm waist. Try a bigger size.`
    : !elastic && (tooSmall || (now && now.waistEase < -2)) ? `Too small: the waistband won't close on your ${now?.bodyWaist.toFixed(0) ?? ''} cm waist. Try a bigger size.`
    : noSim ? (simulated ? 'Not available for your exact shape yet: we have tried these on bodies with your height, but not yet with your waist / belly. Tap below to see them with a natural waist and belly.' : 'Not available for your body size yet.')
    : null;
  return { variant, tooSmall, cantPullOn, noSim, hide, lock, now, reason, elastic };
}
