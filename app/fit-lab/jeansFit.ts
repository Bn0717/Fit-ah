// app/fit-lab/jeansFit.ts
// The jeans verdict for one body, shared by pages that show the Fit Lab jeans (/fit-lab-profile; /fit-lab has the
// same rules inline): which simulation to show (nothing holding them up / belt), whether they can be worn at all,
// whether this body + waist / belly was really simulated, and the fit label in cm.
// Hide unsupported/failed simulations. A size-chart deficit alone does not establish physical inability to wear.
import { solveBody, blend, VARIANTS, jeansVarWeights, elasticFit, type ProductWalk, type GridMeta, type JeansSim, type JeansBody, type Tape, type Variant } from './engine';

export type PantsData = { walk?: ProductWalk; name: string; sizes: Record<string, JeansSim>; drop?: Record<string, JeansSim>; belt?: Record<string, JeansSim>;
  elasticStretch?: number | null };   // elastic waist: stretches up to this x relaxed
export type JeansVariant = 'held' | 'drop' | 'belt';
// Rigid-waist pants (jeans, chinos): the most fabric stretch (95th percentile of the change in fabric area vs the flat
// pattern, %) a simulation may show and still be drawn. Normal results sit at 3-5 % (folds and weave shear count a
// little); every result above ~7.5 % looked broken when checked by eye on 6 Nov 2026 (crumpled thighs, white flaps
// at the hem: output/qa/review/tiles_fin), while real denim stretches ~0-3 % (rigid) to ~10-25 % (comfort stretch)
// only under heavy load. Elastic-waist pants (shorts, joggers) are other fabrics: no limit until measured.
export const RIGID_STRETCH_LIMIT = 7.5;
// a contributing simulation counts only when it carries at least this share of the blend (a 5 % share of a broken
// neighbour barely shows, and would otherwise hide the pants over a wide band of the sliders)
const STRETCH_SHARE = 0.15;
// the shopper's own tape measurements (cm, all the way round / crotch to floor), when they gave them: the fit advice
// uses these instead of the 3D body's (estimated from height + chest, ~3-4 cm off at the waist for many people)
export type TapeMeasures = { waist?: number | null; hip?: number | null; inseam?: number | null };
// a tape measure is ~1-2 cm off (self-measured waist / hips read ~1 cm small): a fit this close to the limit is
// called borderline rather than certain
export const TAPE_ERROR = 2;
export interface JeansNow {
  chart: JeansSim['chart']; waistEase: number; hipEase: number; hem: number; drop: number; extra: number;
  basis: 'tape' | 'body';   // the waist / hips the advice is about: the shopper's tape, or the 3D body's
  borderline: boolean;      // within a tape measure's error of the next fit band
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
  height: number, chest: number, shoulder: number | null, waist: number | null, belly: number, tape: TapeMeasures = {}): JeansState | null {
  if (!pants || !size || !pants.sizes[size]) return null;
  const hasVar = !!(pants.belt?.[size]?.variants && pants.drop?.[size]?.variants);
  const lock = !hasVar;
  const bl = lock ? 0 : belly, wt = lock ? null : waist;
  const { w, vw } = solveBody(meta, height, chest, shoulder, wt, bl);
  // elastic waist (shorts, joggers): the relaxed elastic stretches round the waist and holds them up (no belt, no
  // "drop" result: the held simulation is the worn one); too small only past the elastic's stretch
  const ew = pants.sizes[size].chart.elastic_waist, elastic = !!ew, stretch = pants.elasticStretch ?? 1.3;
  const bodyW = tapeAt(meta, 'waist', w, vw);
  const tW = tape.waist && tape.waist > 0 ? tape.waist : null, tH = tape.hip && tape.hip > 0 ? tape.hip : null;
  const tI = tape.inseam && tape.inseam > 0 ? tape.inseam : null;
  // Only the configured elastic range has an explicit capacity here. Rigid denim has no
  // validated closure limit: the old -2 cm cutoff falsely hid otherwise available simulations.
  const tooSmall = elastic ? bodyW > 2 * ew! * stretch + 1e-6 : false;
  // Elastic assets are held at the natural waist. Below the relaxed band size they
  // would need a separate slipping simulation; pinned geometry cannot establish that fit.
  const looseElastic = elastic && bodyW < 2 * ew! - 4; // existing loose-fit band; held pose cannot model large slip
  const variant: JeansVariant = elastic ? (pants.belt ? 'belt' : 'held') : pants.drop && pants.belt ? (belt ? 'belt' : 'drop') : 'held';
  const J = variant === 'held' ? pants.sizes[size] : pants[variant]?.[size];
  if (!J) return null;
  // at the edge of the bodies these pants were simulated on, the blend can lean a few % on a neighbour body they
  // were not (chest 92 exactly: 4 % on chest 84). Under 10 % in all, that neighbour is dropped and the rest
  // re-weighted; more than that and the body is really outside the simulated range ("not available")
  const all = Object.fromEntries(Object.entries(w).filter(([, v]) => v > 1e-6));
  const missing = Object.entries(all).filter(([k]) => !J.bodies[k]).reduce((t, [, v]) => t + v, 0);
  const jw = missing > 0 && missing < 0.1
    ? Object.fromEntries(Object.entries(all).filter(([k]) => J.bodies[k]).map(([k, v]) => [k, v / (1 - missing)])) : all;
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
    if (!elastic && (jw[key] ?? 0) >= STRETCH_SHARE && (sample.stretch_p95 ?? 0) > RIGID_STRETCH_LIMIT) report('over-stretched fabric');
    if (![sample.waistband_height_cm, sample.hem_lowest_cm, sample.crotch_drop_cm].every(Number.isFinite)) report('invalid measurements');
    if (J.chart.length >= 80) {
      if (sample.crotch_drop_cm < -5) report('crotch above body');
      if (sample.hem_lowest_cm > J.chart.rise) report('legs did not dress');
    }
    // a rigid waistband can only slide down past body parts smaller than it: below the waist it must be bigger than
    // the waist, far down (past the seat) bigger than the hips too. The cloth sim sometimes lets a too-small band
    // pass through the body (27inch on 160 cm / chest 132 fell 27 cm to the thighs): that result is not real
    const dropped = variant === 'drop' ? sample.drop_cm ?? 0 : 0, band = 2 * J.chart.waist;
    if ((dropped > 5 && band < body.waist - 2) || (dropped > 15 && band < body.hip - 2)) report('undersized waistband passed through body');
    if (variant === 'drop' && dropped > 30 && !((sample.body_girth_at_waistband_cm ?? 0) > 0)) report('waistband left valid torso region');
  }
  // a rigid waistband more than 5 cm (~6 %) smaller than your waist cannot be buttoned at all (belt or not): the sim then
  // squashes the band into layers. Too small, not drawn
  if (!elastic && 2 * J.chart.waist < (tW ?? bodyW) - 5) qualityIssues.push('body: undersized waistband passed through body');
  const cantPullOn = qualityIssues.length > 0;
  // the only problem is a waistband smaller than the body: say "too small", not "unavailable"
  const undersized = cantPullOn && qualityIssues.every(q => q.endsWith('undersized waistband passed through body'));
  // over-stretched denim on a body the waistband is (nearly) too small for = really too tight; on a looser fit the
  // stretch is a simulation fault (a glitch), not the fit: "unavailable", never "too tight"
  const tightEase = 2 * J.chart.waist - (tW ?? bodyW);
  const overTight = cantPullOn && !undersized && tightEase < 2
    && qualityIssues.every(q => q.endsWith('over-stretched fabric') || q.endsWith('undersized waistband passed through body'));
  // waist / belly versions exist for the centre body only: elsewhere a changed waist or belly would be a guess
  const moved = (['w70', 'w86', 'bm', 'bp'] as Variant[]).some(v => vw[v] > 0.05);
  const noSim = looseElastic || !simulated || (!lock && moved && (w[meta.centre] ?? 0) < 0.5);
  const hide = cantPullOn || tooSmall || noSim;
  let now: JeansNow | null = null;
  if (simulated) {
    const bw = tW ?? tapeAt(meta, 'waist', jw, vw), bh = tH ?? tapeAt(meta, 'hip', jw, vw);
    const e = 2 * J.chart.waist - bw, eh = 2 * J.chart.hip - bh;
    const jv = (f: (b: JeansBody) => number) => jeansVal(meta, J, jw, vw, f);
    const drop = variant === 'drop' ? jv(b => b.drop_cm ?? 0) : 0;
    const extra = J.chart.length - (jv(b => b.waistband_height_cm) - jv(b => b.floor_cm ?? -1.7));
    let label: string, tone: JeansNow['tone'];
    const rel = elastic ? 2 * ew! : 0, st = elastic ? (bw - rel) / rel : 0;
    if (undersized) { label = 'Too small at the waist: try a larger size'; tone = 'red'; }
    else if (overTight) { label = 'Too tight: try a larger size'; tone = 'red'; }
    else if (cantPullOn) { label = 'Simulation unavailable for this size and body'; tone = 'red'; }
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
    else if (e < 0) { label = e > -TAPE_ERROR ? 'Tight at the waist (borderline: under 2 cm): a larger size is safer' : 'Tight at the waist: try a larger size'; tone = 'red'; }
    // hips only judged on the shopper's own tape (the 3D bodies' hips are estimated): rigid denim cannot stretch round them
    else if (tH !== null && J.chart.hip && eh < 0) { label = eh > -TAPE_ERROR ? 'Tight at the hips (borderline: under 2 cm): a larger size is safer' : 'Tight at the hips: try a larger size'; tone = 'red'; }
    else if (drop > 30) { label = 'Too big: falls down without a belt'; tone = 'red'; }
    // a waistband that is not loose but still slides has slipped under a belly, not fallen off loose hips
    else if (drop > 4) { label = e < 6 ? `Slides ${drop.toFixed(0)} cm down under the belly (try the belt)` : `Too big at the waist: slides ${drop.toFixed(0)} cm down onto the hips (try the belt)`; tone = 'blue'; }
    else if (variant === 'belt' && e >= 6) { label = `Held up by the belt (${e.toFixed(0)} cm of waistband gathered)`; tone = 'green'; }
    else if (e < 2) { label = 'Snug at the waist'; tone = 'amber'; }
    else if (e < 6) { label = 'Comfortable at the waist'; tone = 'green'; }
    else { label = 'Loose at the waist (needs a belt)'; tone = 'blue'; }
    // length: the shopper's inside leg against the chart's when both are known (crotch to floor vs crotch to hem),
    // else what the simulation shows
    const tapeExtra = tI !== null && J.chart.inseam ? J.chart.inseam - tI : null;
    const lengthFit: JeansNow['lengthFit'] = tapeExtra !== null ? (tapeExtra > 4 ? 'pooling' : !elastic && tapeExtra < -6 ? 'short' : 'neutral')
      : extra > 4 && jv(b => b.hem_lowest_cm) <= 0.5 ? 'pooling' : !elastic && extra <= 4 && jv(b => b.hem_lowest_cm) > 6 ? 'short' : 'neutral';
    const borderline = !elastic && (Math.abs(e) < TAPE_ERROR || (tH !== null && !!J.chart.hip && Math.abs(eh) < TAPE_ERROR));
    now = { chart: J.chart, waistEase: elastic ? rel - bw : e, elasticExtension: elastic ? st : null, elasticLimit: elastic ? stretch - 1 : null, relaxedWaist: elastic ? rel : 2 * J.chart.waist, lengthFit, hipEase: eh, hem: tapeExtra !== null ? -tapeExtra : jv(b => b.hem_lowest_cm), drop, extra: tapeExtra ?? extra, bodyWaist: bw, bodyHip: bh, label, tone,
      basis: tW !== null || tH !== null ? 'tape' : 'body', borderline };
  }
  // short, plain words for shoppers
  const reason = undersized ? `Too small to close at the waist. Try a larger size.`
    : overTight ? `Too tight on your body: the fabric would have to stretch more than denim can. Try a larger size.`
    : cantPullOn ? `Simulation unavailable for this size and body. Try another size.`
    : elastic && tooSmall ? `Outside the simulated elastic range. Try a larger size.`
    : looseElastic ? `The relaxed elastic waist is larger than your waist. A slipping preview is not available.`
    : noSim ? (simulated ? 'Not available for your exact shape yet: we have tried these on bodies with your height, but not yet with your waist / belly. Tap below to see them with a natural waist and belly.' : 'Not available for your body size yet.')
    : null;
  return { variant, tooSmall, cantPullOn, noSim, hide, lock, now, reason, elastic, qualityIssues };
}
