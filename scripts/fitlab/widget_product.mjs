// Shop-widget files for one pants product (16 Nov 2026): every exported size of a product folder split into the light
// per-body files the /fit-widget page reads, plus its fit numbers and an info.json, so a new product (or the same one
// on the women's bodies) needs no code change.
//   node scripts/fitlab/widget_product.mjs <public product dir> <widget name> [--women] [--sizes a,b] [--brand x] [--name y]
//   e.g. node scripts/fitlab/widget_product.mjs public/models/fitlab/brands/uniqlo/barrel_leg_jeans uq_barrel_women --women
// Reads <dir>/[women/]{belt,drop}/jeans_<size>.glb(.gz) + .json and <dir>/product.json (name, brand, sizes).
// Writes public/models/fitlab/widget/<widget name>/{info.json, belt|drop/<size>/{base.json, *.bin.gz, tex_*, fit.json}}.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv.splice(i, 2)[1] : null; };
const flag = n => { const i = argv.indexOf(n); return i >= 0 ? (argv.splice(i, 1), true) : false; };
const women = flag('--women'), only = opt('--sizes'), brand = opt('--brand'), name = opt('--name');
const [dir, wname] = argv;
if (!dir || !wname || !/^[a-z0-9_-]{1,64}$/i.test(wname)) { console.error('usage: widget_product.mjs <public product dir> <widget name> [--women]'); process.exit(2); }
const prod = existsSync(`${dir}/product.json`) ? JSON.parse(readFileSync(`${dir}/product.json`, 'utf8')) : {};
const src = women ? `${dir}/women` : dir, out = `public/models/fitlab/widget/${wname}`;
const sets = women ? prod.women ?? {} : prod;
const sizes = (only ? only.split(',') : Object.keys(sets.belt ?? {})).filter(z => existsSync(`${src}/belt/jeans_${z}.json`));
if (!sizes.length) { console.error(`no exported sizes in ${src}/belt`); process.exit(1); }
for (const m of ['belt', 'drop']) for (const z of sizes) {
  const g = [`${src}/${m}/jeans_${z}.glb.gz`, `${src}/${m}/jeans_${z}.glb`].find(f => existsSync(f));
  if (!g) { console.log(`skip ${m} ${z}: no file`); continue; }
  const o = `${out}/${m}/${z}`; mkdirSync(o, { recursive: true });
  const r = spawnSync('node', ['scripts/fitlab/split_bodies.mjs', g, o, '--tex', '1024'], { encoding: 'utf8' });
  if (r.status) { console.error(r.stderr); process.exit(1); }
  console.log(`${m} ${z}: ${r.stdout.trim().split('\n').pop()}`);
  const j = JSON.parse(readFileSync(`${src}/${m}/jeans_${z}.json`, 'utf8'));
  writeFileSync(`${o}/fit.json`, JSON.stringify({ size: j.size, chart: j.chart, bodies: j.bodies, variants: j.variants ?? {} }));
}
const info = { name: name ?? prod.name ?? wname, brand: brand ?? prod.brand ?? '', sizes,
  ...(women ? { women: true, body: 'body_women', meta: '/models/fitlab/bodies/women/meta.json' } : {}) };
writeFileSync(`${out}/info.json`, JSON.stringify(info, null, 1));
console.log('WIDGET READY', `/fit-widget?p=${wname}`, sizes.join(' '));
