// Stretch table of one garment's simulations (19 Nov 2026): the fabric stretch (p95 %) of every size on every grid
// body, as a size x height x chest/bust table, with a FLAG for any result far more stretched than the same size on
// the bodies next to it (a failed dressing, not a fit: e.g. the 150 cm row of the women's tees, whose sleeves started
// inside the arm). Run it on every new garment or body range before trusting the run.
//   node scripts/fitlab/stretch_table.mjs <grid dir with drape_*_report.json or jeans_*_report.json> [--flag-only]
// Exit code 1 when anything is flagged.
import { readdirSync, readFileSync } from 'node:fs';
const [dir, opt] = process.argv.slice(2);
if (!dir) { console.error('usage: stretch_table.mjs <grid dir> [--flag-only]'); process.exit(2); }
const R = new Map(), sizes = [], H = new Set(), C = new Set();
for (const f of readdirSync(dir)) {
  const m = f.match(/^(?:drape|jeans)_(.+)_h(\d+)_c(\d+)_report\.json$/);
  if (!m) continue;
  const r = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
  const p = r.fabric_stretch_vs_pattern_pct?.p95 ?? r.fabric_stretch_pct?.p95 ?? r.stretch_p95;   // shirts / pants / exported
  if (typeof p !== 'number') continue;
  const [, s, h, c] = m; if (!sizes.includes(s)) sizes.push(s); H.add(+h); C.add(+c);
  R.set(`${s}|${h}|${c}`, p);
}
if (!R.size) { console.log(`STRETCH_TABLE NO DATA in ${dir} (no report with a stretch number): nothing was checked`); process.exit(1); }
const order = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '4XL'];
sizes.sort((a, b) => (order.indexOf(a) - order.indexOf(b)) || (parseFloat(a) - parseFloat(b)) || a.localeCompare(b));
const hs = [...H].sort((a, b) => a - b), cs = [...C].sort((a, b) => a - b);
const get = (s, h, c) => R.get(`${s}|${h}|${c}`);
// neighbours: the same size, the heights just above / below and the chests just either side (where simulated)
const flags = [];
for (const s of sizes) for (const [hi, h] of hs.entries()) for (const [ci, c] of cs.entries()) {
  const v = get(s, h, c); if (v === undefined) continue;
  const nb = [[hi - 1, ci], [hi + 1, ci], [hi, ci - 1], [hi, ci + 1]].map(([a, b]) => hs[a] !== undefined && cs[b] !== undefined ? get(s, hs[a], cs[b]) : undefined)
    .filter(x => x !== undefined).sort((a, b) => a - b);
  if (!nb.length) continue;
  const med = nb[Math.floor(nb.length / 2)];
  // also against the heights just above / below alone: a whole failed row has equally bad neighbours on its own row
  const vt = [hi - 1, hi + 1].map(a => hs[a] !== undefined ? get(s, hs[a], c) : undefined).filter(x => x !== undefined).sort((a, b) => a - b);
  const vmed = vt.length ? vt[0] : Infinity;
  if (v >= 10 && (v > 3 * Math.max(med, 3) || v > 3 * Math.max(vmed, 3)))
    flags.push(`FLAG ${s} h${h} c${c}: ${v.toFixed(0)} % stretched, neighbours ~${Math.min(med, vmed).toFixed(0)} % (a failed dressing?)`);
}
if (opt !== '--flag-only') {
  console.log(`p95 fabric stretch % in ${dir}; rows = height, columns = chest/bust ${cs.join(' ')}`);
  for (const s of sizes) {
    console.log(s);
    for (const h of hs) console.log(`  ${h} ${cs.map(c => { const v = get(s, h, c); return v === undefined ? '    .' : String(Math.round(v)).padStart(5); }).join('')}`);
  }
}
for (const f of flags) console.log(f);
console.log(flags.length ? `STRETCH_TABLE ${flags.length} flagged` : 'STRETCH_TABLE OK');
process.exit(flags.length ? 1 : 0);
