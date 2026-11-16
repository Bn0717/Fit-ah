// Size-chart checks for the brand upload form: the same rules as blender/chart_checks.py (kept in step by
// tests/chart-checks.test.mjs), so a brand sees what is wrong with a chart while typing it, before anything is
// simulated. Fit-Ah convention: flat garment widths in cm (waist, hip, chest = half the way round; thigh, knee,
// opening = one leg laid flat), lengths in cm.
export type Kind = 'pants' | 'top';
export type Chart = Record<string, Record<string, number>>;
export type Finding = { level: 'ERROR' | 'WARN' | 'OK'; message: string };

const RANGES: Record<Kind, Record<string, [number, number]>> = {
  pants: { waist: [25, 75], hip: [38, 85], thigh: [18, 50], knee: [14, 45], opening: [10, 45], rise: [17, 45], length: [25, 135], inseam: [5, 95] },
  top: { chest: [38, 85], shoulder: [30, 70], length: [45, 100], sleeve: [8, 90], sleeve_cb: [25, 100] },
};
const GARMENT_ONLY: Record<Kind, string[]> = { pants: ['rise', 'opening', 'thigh', 'length'], top: ['length', 'shoulder', 'sleeve', 'sleeve_cb'] };
const MAIN: Record<Kind, string> = { pants: 'waist', top: 'chest' };
export const GIRTHS = ['waist', 'hip', 'chest', 'thigh', 'opening', 'knee'];
// column names brands use -> ours (lower case, spaces / dashes as underscores)
export const ALIAS: Record<string, string> = {
  body_width: 'chest', chest_width: 'chest', bust: 'chest', pit_to_pit: 'chest', body_length_back: 'length', body_length: 'length',
  total_length: 'length', outseam: 'length', outside_leg: 'length', shoulder_width: 'shoulder', sleeve_length: 'sleeve',
  sleeve_length_center_back: 'sleeve_cb', hip_width: 'hip', hips: 'hip', seat: 'hip', hem_width: 'opening', hem: 'opening', leg_opening: 'opening',
  bottom_width: 'opening', rising_length: 'rise', front_rise: 'rise', waist_width: 'waist', inside_leg: 'inseam', inseam_length: 'inseam',
  thigh_width: 'thigh', knee_width: 'knee',
};
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const g = (x: number) => String(+x.toFixed(2));

export function checkChart(chartIn: Chart, kind: Kind): Finding[] {
  const out: Finding[] = [], add = (level: Finding['level'], message: string) => out.push({ level, message });
  if (!chartIn || !Object.keys(chartIn).length) return [{ level: 'ERROR', message: 'no size chart' }];
  const chart: Chart = Object.fromEntries(Object.entries(chartIn).map(([s, c]) => [s, Object.fromEntries(Object.entries(c).map(([m, v]) => [ALIAS[m] ?? m, v]))]));
  const rng = RANGES[kind], main = MAIN[kind], sizes = Object.keys(chart);
  // 1. a garment chart, not a body chart
  const have = new Set(sizes.flatMap(s => Object.keys(chart[s])));
  if (!GARMENT_ONLY[kind].some(m => have.has(m))) add('ERROR', `looks like a BODY size chart (no ${GARMENT_ONLY[kind].join(', ')}): ask for the garment measurements`);
  if (!have.has(main)) { add('ERROR', `no ${main} measurement`); return out; }
  // 2. every number in a plausible flat range (entered all the way round = about double)
  for (const s of sizes) for (const [m, v] of Object.entries(chart[s])) {
    if (!(m in rng) || !num(v)) continue;
    const [lo, hi] = rng[m];
    if (v <= 0) add('ERROR', `${s} ${m} = ${g(v)}: not a measurement`);
    else if (v > hi && lo <= v / 2 && v / 2 <= hi && GIRTHS.includes(m)) add('ERROR', `${s} ${m} = ${g(v)} cm looks like all the way round (flat would be ${g(v / 2)}): halve it, or check the brand's measuring guide`);
    else if (!(lo <= v && v <= hi)) add('WARN', `${s} ${m} = ${g(v)} cm is outside the usual ${lo}-${hi} cm (inches? body measurement?)`);
  }
  // 3. sizes grow, in the order the brand lists them; steps roughly even
  for (const m of [...have].filter(x => x in rng).sort()) {
    const vals = sizes.filter(s => num(chart[s][m])).map(s => [s, chart[s][m]] as [string, number]);
    for (let i = 1; i < vals.length; i++) if (vals[i][1] < vals[i - 1][1] - 0.5) add(m === main ? 'ERROR' : 'WARN', `${m} shrinks from ${vals[i - 1][0]} (${g(vals[i - 1][1])}) to ${vals[i][0]} (${g(vals[i][1])})`);
    const pos = vals.slice(1).map((v, i) => v[1] - vals[i][1]).filter(x => x > 0).sort((a, b) => a - b);
    if (m === main && pos.length >= 2) {
      const med = pos[pos.length >> 1];
      for (let i = 1; i < vals.length; i++) {
        const st = vals[i][1] - vals[i - 1][1];
        if (st > 3 * med + 1) add('WARN', `${main} jumps ${g(st)} cm from ${vals[i - 1][0]} to ${vals[i][0]} (usual step ${g(med)}): a missing size or a typo?`);
        else if (st >= 0 && st < 0.25 * med) add('WARN', `${main} barely changes from ${vals[i - 1][0]} to ${vals[i][0]} (${g(st)} cm, usual step ${g(med)}): a typo?`);
      }
    }
  }
  // 4. shapes that cannot be
  for (const s of sizes) {
    const c = chart[s], v = (k: string) => (num(c[k]) ? c[k] : null);
    if (kind === 'pants') {
      const [hip, waist, thigh, knee, opening, length, inseam, rise] = ['hip', 'waist', 'thigh', 'knee', 'opening', 'length', 'inseam', 'rise'].map(v);
      if (hip && waist && hip < waist - 1 && !c.elastic_waist) add('ERROR', `${s}: hip ${g(hip)} smaller than the waist ${g(waist)}`);
      if (thigh && hip && thigh > hip) add('ERROR', `${s}: thigh ${g(thigh)} wider than half the hips ${g(hip)} (one leg vs the whole seat)`);
      if (knee && thigh && knee > thigh + 1) add('WARN', `${s}: knee ${g(knee)} wider than the thigh ${g(thigh)} (barrel / balloon leg?)`);
      if (opening && thigh && opening > thigh + 1) add('WARN', `${s}: leg opening ${g(opening)} wider than the thigh ${g(thigh)} (flare?)`);
      if (length && inseam && length <= inseam) add('ERROR', `${s}: length (outseam) ${g(length)} not longer than the inseam ${g(inseam)}`);
      if (length && inseam && rise && Math.abs(length - inseam - rise) > 8) add('WARN', `${s}: length ${g(length)} != inseam ${g(inseam)} + rise ${g(rise)} (by more than 8 cm): which length is it?`);
    } else {
      const shoulder = v('shoulder'), chest = v('chest');
      if (shoulder && chest && shoulder > 2 * chest * 0.75) add('WARN', `${s}: shoulder ${g(shoulder)} unusually wide for chest ${g(chest)} (flat)`);
    }
  }
  if (!out.some(f => f.level === 'ERROR')) add('OK', `${sizes.length} sizes, ${[...have].filter(x => x in rng).sort().join(', ')}`);
  return out;
}

// A chart pasted from a spreadsheet or a web page (tabs, commas or 2+ spaces between cells; first row = column
// names, first column = size). unit 'in' converts to cm; round = the girth columns were measured all the way round
// (halved to the flat convention). Returns the chart in the Fit-Ah convention + the columns that were not understood.
export function parseChart(text: string, unit: 'cm' | 'in', round: boolean): { chart: Chart; unknown: string[]; columns: string[] } {
  const rows = text.split(/\r?\n/).map(r => r.trim()).filter(Boolean).map(r => r.split(/\t|,|;|\s{2,}/).map(c => c.trim()));
  if (rows.length < 2) return { chart: {}, unknown: [], columns: [] };
  const key = (h: string) => { const k = h.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z]+/g, '_').replace(/^_|_$/g, ''); return ALIAS[k] ?? k; };
  const cols = rows[0].slice(1).map(key), known = new Set([...Object.keys(RANGES.pants), ...Object.keys(RANGES.top), 'elastic_waist']);
  const chart: Chart = {};
  for (const r of rows.slice(1)) {
    const size = r[0]; if (!size) continue;
    const c: Record<string, number> = {};
    cols.forEach((m, i) => {
      const v = parseFloat((r[i + 1] ?? '').replace(/[^0-9.\-]/g, '')); if (!Number.isFinite(v) || !m) return;
      let cm = unit === 'in' ? v * 2.54 : v; if (round && GIRTHS.includes(m)) cm /= 2;
      c[m] = +cm.toFixed(2);
    });
    if (Object.keys(c).length) chart[size] = c;
  }
  return { chart, unknown: cols.filter(m => m && !known.has(m)), columns: cols };
}
