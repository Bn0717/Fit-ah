'use client';
// Brand upload form (goal E3): what a brand gives Fit-Ah for one garment, checked while it is typed.
// It asks for what makes the 3D garment accurate, best first: the sewing pattern if they will share it, the size
// chart with its tolerance, the fabric, flat photos, and one model photo with the model's height + size (that is
// the free ground truth for the "model-photo match" number of the launch gate).
// The size chart is checked live with the same rules as the pipeline (chartChecks.ts = blender/chart_checks.py).
// Nothing is sent anywhere yet: "Download" saves product.json in the exact format blender/new_pants.sh /
// new_shirt.sh read, plus a list of the files to send with it.
import { useMemo, useState } from 'react';
import { checkChart, parseChart, type Kind } from './chartChecks';

const EXAMPLE = { pants: 'Size\tWaist\tHip\tLength\tLeg opening\nS\t36\t51\t96\t24\nM\t39\t54\t98.5\t25.5\nL\t42\t57\t101\t27\nXL\t45\t60\t103.5\t28.5',
  top: 'Size\tBody width\tBody length\tShoulder width\tSleeve length\nM\t53\t71.5\t46.5\t20.9\nL\t56\t74\t48\t21.5\nXL\t59\t76.5\t49.5\t22' };
const FABRICS: Record<Kind, [string, string][]> = {
  pants: [['denim_rigid', 'Rigid denim (no stretch)'], ['denim_stretch', 'Stretch denim'], ['cotton_twill', 'Cotton twill / chino'], ['sweat_knit', 'Sweat / fleece knit'], ['mesh', 'Sports mesh'], ['other', 'Other (describe below)']],
  top: [['jersey', 'T-shirt jersey'], ['heavy_jersey', 'Heavy jersey'], ['sweat_knit', 'Sweat / fleece knit'], ['woven_shirt', 'Woven shirting'], ['other', 'Other (describe below)']],
};
const TONE = { ERROR: '#b91c1c', WARN: '#b45309', OK: '#15803d' } as const;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

export default function BrandUpload() {
  const [kind, setKind] = useState<Kind>('pants');
  const [f, setF] = useState({ brand: '', contact: '', name: '', sku: '', fabric: 'denim_rigid', composition: '', weight: '', stretch: '', waistType: 'rigid',
    tolerance: '1', photoSize: '', modelHeight: '', modelSize: '', modelChest: '', modelWaist: '', notes: '', measuring: '' });
  const [text, setText] = useState(''), [unit, setUnit] = useState<'cm' | 'in'>('cm'), [round, setRound] = useState(false);
  const [files, setFiles] = useState<Record<string, string>>({});
  const up = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(p => ({ ...p, [k]: e.target.value }));
  const parsed = useMemo(() => parseChart(text, unit, round), [text, unit, round]);
  const findings = useMemo(() => (Object.keys(parsed.chart).length ? checkChart(parsed.chart, kind) : []), [parsed, kind]);
  const sizes = Object.keys(parsed.chart), cols = [...new Set(sizes.flatMap(s => Object.keys(parsed.chart[s])))];
  const errors = findings.filter(x => x.level === 'ERROR').length;
  const need: [string, boolean][] = [['Brand name', !!f.brand.trim()], ['Contact email', /.+@.+\..+/.test(f.contact)], ['Product name', !!f.name.trim()],
    ['Size chart without errors', sizes.length > 0 && errors === 0], ['Which size is in the flat photos', !!f.photoSize && sizes.includes(f.photoSize)],
    ['Flat photo, front', !!files.front], ['Flat photo, back', !!files.back]];
  const ready = need.every(n => n[1]);

  const download = () => {
    const product = {
      id: slug(f.sku || f.name), name: f.name.trim(), brand: f.brand.trim(), fabric: f.fabric, photo_size: f.photoSize, chart: parsed.chart,
      front: files.front, back: files.back, ...(kind === 'pants' ? { waist_type: f.waistType } : {}),
      upload: { kind, contact: f.contact.trim(), sku: f.sku.trim(), composition: f.composition.trim(), weight_gsm: +f.weight || null, stretch_pct: +f.stretch || null,
        tolerance_cm: +f.tolerance || null, chart_unit_entered: unit, chart_entered_all_round: round, measuring_guide: f.measuring.trim(), pattern_file: files.pattern ?? null,
        model_photo: files.model ? { file: files.model, height_cm: +f.modelHeight || null, size: f.modelSize, chest_cm: +f.modelChest || null, waist_cm: +f.modelWaist || null } : null,
        notes: f.notes.trim(), chart_warnings: findings.filter(x => x.level === 'WARN').map(x => x.message), date: new Date().toISOString().slice(0, 10) },
    };
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(product, null, 1)], { type: 'application/json' }));
    a.download = 'product.json'; a.click(); URL.revokeObjectURL(a.href);
  };

  const input = 'w-full rounded-lg border px-3 py-2 text-sm bg-white', label = 'flex flex-col gap-1 text-sm';
  const file = (key: string, title: string, hint: string, accept = 'image/*') => (
    <label className={label}><span className="font-medium">{title}</span><span className="text-xs" style={{ opacity: 0.65 }}>{hint}</span>
      <input type="file" accept={accept} className="text-sm" onChange={e => setFiles(p => { const n = { ...p }; const x = e.target.files?.[0]; if (x) n[key] = x.name; else delete n[key]; return n; })} /></label>);

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6 space-y-6" style={{ color: '#1c1917' }}>
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Add a garment to Fit-Ah</h1>
        <p className="text-sm" style={{ opacity: 0.75 }}>Five minutes per garment. We turn this into a 3D garment, simulate it on a range of bodies, and show shoppers how each size hangs. The more exact the chart and fabric, the more exact the picture.</p>
      </header>

      <section className="rounded-2xl p-4 space-y-3" style={{ background: '#fff' }}>
        <h2 className="font-semibold">1. About you and the garment</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className={label}>Brand<input className={input} value={f.brand} onChange={up('brand')} /></label>
          <label className={label}>Contact email<input className={input} type="email" value={f.contact} onChange={up('contact')} /></label>
          <label className={label}>Product name<input className={input} value={f.name} onChange={up('name')} placeholder="e.g. Stallion Pants (Brown)" /></label>
          <label className={label}>Your product code (optional)<input className={input} value={f.sku} onChange={up('sku')} /></label>
          <label className={label}>Type<select className={input} value={kind} onChange={e => { const k = e.target.value as Kind; setKind(k); setF(p => ({ ...p, fabric: FABRICS[k][0][0] })); }}><option value="pants">Pants / shorts</option><option value="top">T-shirt / top</option></select></label>
          {kind === 'pants' && <label className={label}>Waist<select className={input} value={f.waistType} onChange={up('waistType')}><option value="rigid">Button / zip (does not stretch)</option><option value="elastic">Elastic or drawstring</option></select></label>}
        </div>
      </section>

      <section className="rounded-2xl p-4 space-y-3" style={{ background: '#fff' }}>
        <h2 className="font-semibold">2. Size chart of the garment</h2>
        <p className="text-sm" style={{ opacity: 0.75 }}>Paste it from your spreadsheet or website: first row the column names, one row per size, smallest first. We need the <b>garment</b> measured laid flat, not the body it is meant for.</p>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm items-center">
          <label className="flex items-center gap-1"><input type="radio" checked={unit === 'cm'} onChange={() => setUnit('cm')} />cm</label>
          <label className="flex items-center gap-1"><input type="radio" checked={unit === 'in'} onChange={() => setUnit('in')} />inches</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={round} onChange={e => setRound(e.target.checked)} />widths are all the way round (not edge to edge)</label>
          <button type="button" className="underline" onClick={() => setText(EXAMPLE[kind])}>use an example</button>
        </div>
        <textarea className={`${input} font-mono`} rows={6} value={text} onChange={e => setText(e.target.value)} placeholder={EXAMPLE[kind]} />
        {sizes.length > 0 && (
          <div className="overflow-x-auto"><table className="text-xs w-full" style={{ borderCollapse: 'collapse' }}>
            <thead><tr><th className="text-left p-1">Size</th>{cols.map(c => <th key={c} className="text-right p-1">{c.replace(/_/g, ' ')}</th>)}</tr></thead>
            <tbody>{sizes.map(s => <tr key={s} style={{ borderTop: '1px solid #eee' }}><td className="p-1 font-semibold">{s}</td>{cols.map(c => <td key={c} className="text-right p-1">{parsed.chart[s][c] ?? ''}</td>)}</tr>)}</tbody>
          </table><p className="text-xs mt-1" style={{ opacity: 0.6 }}>As we read it: flat widths and lengths in cm.</p></div>)}
        {parsed.unknown.length > 0 && <p className="text-xs" style={{ color: TONE.WARN }}>Columns we did not recognise (kept, not used): {parsed.unknown.join(', ')}</p>}
        <ul className="space-y-1 text-sm">{findings.map((x, i) => <li key={i} style={{ color: TONE[x.level] }}><b>{x.level === 'ERROR' ? 'Fix: ' : x.level === 'WARN' ? 'Check: ' : 'Looks right: '}</b>{x.message}</li>)}</ul>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className={label}>Tolerance: how far a real garment may differ from the chart (cm)<input className={input} type="number" step="0.5" value={f.tolerance} onChange={up('tolerance')} /></label>
          <label className={label}>How you measure (link or a few words, optional)<input className={input} value={f.measuring} onChange={up('measuring')} placeholder="e.g. waist edge to edge at the top, buttoned" /></label>
        </div>
      </section>

      <section className="rounded-2xl p-4 space-y-3" style={{ background: '#fff' }}>
        <h2 className="font-semibold">3. Fabric</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className={label}>Fabric type<select className={input} value={f.fabric} onChange={up('fabric')}>{FABRICS[kind].map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
          <label className={label}>Composition<input className={input} value={f.composition} onChange={up('composition')} placeholder="e.g. 98 % cotton, 2 % elastane" /></label>
          <label className={label}>Weight (g/m², if you know it)<input className={input} type="number" value={f.weight} onChange={up('weight')} /></label>
          <label className={label}>Stretch across the width (%, if you know it)<input className={input} type="number" value={f.stretch} onChange={up('stretch')} placeholder="0 for rigid denim" /></label>
        </div>
      </section>

      <section className="rounded-2xl p-4 space-y-3" style={{ background: '#fff' }}>
        <h2 className="font-semibold">4. Photos and files</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {file('front', 'Flat photo, front', 'Laid flat on a plain background, whole garment, straight from above.')}
          {file('back', 'Flat photo, back', 'Same garment and size, turned over.')}
          <label className={label}><span className="font-medium">Which size is in the flat photos?</span><select className={input} value={f.photoSize} onChange={up('photoSize')}><option value="">choose</option>{sizes.map(s => <option key={s}>{s}</option>)}</select></label>
          {file('pattern', 'Sewing pattern (optional, best accuracy)', 'DXF, PDF or your CAD export. Kept private; replaces our estimate from the chart.', '.dxf,.pdf,.zip,.ai,.plt,.zprj,.bw')}
          {file('model', 'One model photo (optional)', 'Front view, standing. We compare our 3D picture with it.')}
          <div className="grid grid-cols-2 gap-2">
            <label className={label}>Model height (cm)<input className={input} type="number" value={f.modelHeight} onChange={up('modelHeight')} /></label>
            <label className={label}>Size worn<input className={input} value={f.modelSize} onChange={up('modelSize')} /></label>
            <label className={label}>Model chest (cm)<input className={input} type="number" value={f.modelChest} onChange={up('modelChest')} /></label>
            <label className={label}>Model waist (cm)<input className={input} type="number" value={f.modelWaist} onChange={up('modelWaist')} /></label>
          </div>
        </div>
        <label className={label}>Anything else we should know<textarea className={input} rows={2} value={f.notes} onChange={up('notes')} /></label>
      </section>

      <section className="rounded-2xl p-4 space-y-3" style={{ background: '#fff' }}>
        <h2 className="font-semibold">5. Check and save</h2>
        <ul className="text-sm space-y-0.5">{need.map(([t, ok]) => <li key={t} style={{ color: ok ? TONE.OK : '#78716c' }}>{ok ? '✓' : '○'} {t}</li>)}</ul>
        <button type="button" disabled={!ready} onClick={download} className="rounded-full px-5 py-2 text-sm font-semibold" style={{ background: ready ? '#1c1917' : '#d6d3d1', color: '#fff' }}>Download product.json</button>
        <p className="text-xs" style={{ opacity: 0.65 }}>This saves one small file describing the garment. Send it to Fit-Ah together with: {['front', 'back', 'pattern', 'model'].filter(k => files[k]).map(k => files[k]).join(', ') || 'the photos you chose above'}. Nothing on this page is uploaded or stored by us until you send it.</p>
      </section>
    </main>
  );
}
