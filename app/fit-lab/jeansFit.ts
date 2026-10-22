// app/fit-lab/jeansFit.ts
// The jeans verdict for one body, shared by pages that show the Fit Lab jeans (/fit-lab-profile; /fit-lab has the
// same rules inline): which simulation to show (nothing holding them up / belt), whether they can be worn at all,
// whether this body + waist / belly was really simulated, and the fit label in cm.
// Hide unsupported/failed simulations. A size-chart deficit alone does not establish physical inability to wear.
import { solveBody, blend, VARIANTS, jeansVarWeights, elasticFit, type ProductWalk, type GridMeta, type JeansSim, type JeansBody, type Tape, type Variant } from './engine';

export type PantsData = { walk?: ProductWalk; name: string; sizes: Record<string, JeansSim>; drop?: Record<string, JeansSim>; belt?: Record<string, JeansSim>;
  elasticStretch?: number | null };   // elastic waist: stretches up to this x relaxed
export type JeansVariant = 'held' | 'drop' | 'belt';
export interface JeansNow {
  chart: JeansSim['chart']; waistEase: number; hipEase: number; hem: number; drop: number; extra: number;
  bodyWaist: number; bodyHip: number; elasticExtension: number | null; elasticLimit: number | null; relaxedWaist: number; lengthFit: 'pooling' | 'short' | 'neutral'; label: string; tone: 'red' | 'amber' | 'green' | 'blue';
}
export interface JeansState {
  variant: JeansVariant; tooSmall: boolean; cantPullOn: boolean; noSim: boolean; hide: boolean;
  lock: boolean;           // waist / belly sliders cannot be used with these pants (not simulated on those versions)
  now: JeansNow | null;
  reason: string | null;   // why the jeans are not drawn, in plain words
  qualityIssues: string[]; // internal audit reasons, never physical wearability claims
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

// Keep pants on their natural waist/belly body. The requested waist is retained by the caller,
// so removing the pants restores shirt-only adjustments without changing saved measurements.
export function wornBody(meta: GridMeta, pants: PantsData | null, size: string | null,
  height: number, chest: number, shoulder: number | null, waist: number | null, belly: number) {
  if (!pants || !size || !pants.sizes[size]) return { waist, belly, lock: false, snap: false };
  return { waist: null, belly: 0, lock: true, snap: false };
}

export function jeansState(meta: GridMeta, pants: PantsData | null, size: string | null, belt: boolean,
  height: number, chest: number, shoulder: number | null, waist: number | null, belly: number): JeansState | null {
  if (!pants || !size || !pants.sizes[size]) return null;
  const hasVar = !!(pants.belt?.[size]?.variants && pants.drop?.[size]?.variants);
  const lock = !hasVar;
  const bl = lock ? 0 : belly, wt = lock ? null : waist;
  const { w, vw } = solveBody(meta, height, chest, shoulder, wt, bl);
  // elastic waist (shorts, joggers): the relaxed elastic stretches round the waist and holds them up (no belt, no
  // "drop" result: the held simulation is the worn one); too small only past the elastic's stretch
  const ew = pants.sizes[size].chart.elastic_waist, elastic = !!ew, stretch = pants.elasticStretch ?? 1.3;
  const bodyW = tapeAt(meta, 'waist', w, vw);
  // Only the configured elastic range has an explicit capacity here. Rigid denim has no
  // validated closure limit: the old -2 cm cutoff falsely hid otherwise available simulations.
  const tooSmall = elastic ? bodyW > 2 * ew! * stretch + 1e-6 : false;
  // Elastic assets are held at the natural waist. Below the relaxed band size they
  // would need a separate slipping simulation; pinned geometry cannot establish that fit.
  const looseElastic = elastic && bodyW < 2 * ew! - 4; // existing loose-fit band; held pose cannot model large slip
  const variant: JeansVariant = elastic ? (pants.belt ? 'belt' : 'held') : pants.drop && pants.belt ? (belt ? 'belt' : 'drop') : 'held';
  const J = variant === 'held' ? pants.sizes[size] : pants[variant]?.[size];
  if (!J) return null;
  const jw = Object.fromEntries(Object.entries(w).filter(([, v]) => v > 1e-6));
  const simulated = Object.keys(jw).every(k => J.bodies[k]);
  // Validate every contributing simulation BEFORE interpolation. A failed corner cannot
  // become a valid preview by averaging its boolean flag or collapsing measurements.
  const qualityIssues: string[] = [];
  for (const key of Object.keys(jw)) {
    const sample = J.bodies[key];
    if (!sample) continue;
    const body = meta.body[key];
    const report = (reason: string) => qualityIssues.push(`${key}: ${reason}`);
    if (!body) { report('missing body measurements'); continue; }
    if (sample.put_on_failed) report('dressing failed');
    if ((sample.seam_gap_mean_cm ?? 0) > 0.25) report('seam separation');
    if (![sample.waistband_height_cm, sample.hem_lowest_cm, sample.crotch_drop_cm].every(Number.isFinite)) report('invalid measurements');
    if (J.chart.length >= 80) {
      if (sample.crotch_drop_cm < -5) report('crotch above body');
      if (sample.hem_lowest_cm > J.chart.rise) report('legs did not dress');
    }
    if (variant === 'drop' && (sample.drop_cm ?? 0) > 30) {
      if (2 * J.chart.waist < body.waist || 2 * J.chart.waist < body.hip) report('undersized waistband passed through body');
      if (!((sample.body_girth_at_waistband_cm ?? 0) > 0)) report('waistband left valid torso region');
    }
  }
  const cantPullOn = qualityIssues.length > 0;
  // waist / belly versions exist for the centre body only: elsewhere a changed waist or belly would be a guess
  const moved = (['w70', 'w86', 'bm', 'bp'] as Variant[]).some(v => vw[v] > 0.05);
  const noSim = looseElastic || !simulated || (!lock && moved && (w[meta.centre] ?? 0) < 0.5);
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
    if (cantPullOn) { label = 'Simulation unavailable for this size and body'; tone = 'red'; }
    else if (elastic && tooSmall) { label = 'Outside the simulated elastic range: try a larger size'; tone = 'red'; }
    else if (elastic && noSim) { label = looseElastic ? 'Loose elastic waist: preview unavailable' : 'Not simulated for this body yet'; tone = looseElastic ? 'blue' : 'amber'; }
    else if (elastic && bw < rel - 4) { label = `Loose: the elastic is ${(rel - bw).toFixed(0)} cm bigger than your waist and may slide down`; tone = 'blue'; }
    else if (elastic) {
      const grade = elasticFit(st, stretch - 1);
      label = grade === 'unknown' ? 'Elastic fit unavailable' : grade === 'too tight' ? 'Very tight at the elastic waist: try a larger size'
        : grade === 'tight' ? 'Tight at the elastic waist'
        : grade === 'snug' ? 'Snug at the elastic waist' : st < 0 ? 'Roomy at the elastic waist' : 'Comfortable at the elastic waist';
      tone = grade === 'unknown' ? 'amber' : st < 0 ? 'blue' : grade === 'too tight' ? 'red' : grade === 'tight' || grade === 'snug' ? 'amber' : 'green';
    }
    else if (noSim) { label = 'Not simulated for this body yet'; tone = 'amber'; }
    else if (e < 0) { label = 'Tight at the waist: try a larger size'; tone = 'red'; }
    else if (drop > 30) { label = 'Too big: falls down without a belt'; tone = 'red'; }
    // a waistband that is not loose but still slides has slipped under a belly, not fallen off loose hips
    else if (drop > 4) { label = e < 6 ? `Slides ${drop.toFixed(0)} cm down under the belly (try the belt)` : `Too big at the waist: slides ${drop.toFixed(0)} cm down onto the hips (try the belt)`; tone = 'blue'; }
    else if (variant === 'belt' && e >= 6) { label = `Held up by the belt (${e.toFixed(0)} cm of waistband gathered)`; tone = 'green'; }
    else if (e < 2) { label = 'Snug at the waist'; tone = 'amber'; }
    else if (e < 6) { label = 'Comfortable at the waist'; tone = 'green'; }
    else { label = 'Loose at the waist (needs a belt)'; tone = 'blue'; }
    now = { chart: J.chart, waistEase: elastic ? rel - bw : e, elasticExtension: elastic ? st : null, elasticLimit: elastic ? stretch - 1 : null, relaxedWaist: elastic ? rel : 2 * J.chart.waist, lengthFit: extra > 4 && jv(b => b.hem_lowest_cm) <= 0.5 ? 'pooling' : !elastic && extra <= 4 && jv(b => b.hem_lowest_cm) > 6 ? 'short' : 'neutral', hipEase: eh, hem: jv(b => b.hem_lowest_cm), drop, extra, bodyWaist: bw, bodyHip: bh, label, tone };
  }
  // short, plain words for shoppers
  const reason = cantPullOn ? `Simulation unavailable for this size and body. Try another size.`
    : elastic && tooSmall ? `Outside the simulated elastic range. Try a larger size.`
    : looseElastic ? `The relaxed elastic waist is larger than your waist. A slipping preview is not available.`
    : noSim ? (simulated ? 'Not available for your exact shape yet: we have tried these on bodies with your height, but not yet with your waist / belly. Tap below to see them with a natural waist and belly.' : 'Not available for your body size yet.')
    : null;
  return { variant, tooSmall, cantPullOn, noSim, hide, lock, now, reason, elastic, qualityIssues };
}
