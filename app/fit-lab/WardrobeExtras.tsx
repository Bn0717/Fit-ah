// app/fit-lab/WardrobeExtras.tsx
// Fit Lab wardrobe extras, in the style of /items: favourites / recent / outfits (kept in this browser), the size
// chart editor (simulated default, scan a photo of the brand's chart, or type it in) and the user guide.
// Honesty rule: the 3D clothes are cloth simulations of ONE size chart per cut (the Gon Tee, the Xin jeans). A new
// item whose chart matches it (within CHART_TOL cm) reuses those simulations; a size that differs is a different
// garment, so it is saved but marked "not simulated" and cannot be tried on (no stretched or guessed 3D).
'use client';

import React, { useEffect, useState } from 'react';

const C = { cream: '#F8F3EA', navy: '#0B1957', peach: '#FFDBD1', pink: '#FA9EBC', red: '#ef4444', amber: '#d97706', green: '#16a34a' };

// ─── small browser-stored lists (favourites, recent, outfits) ──────────────────────
export function useStored<T>(key: string, init: T): [T, (v: T | ((x: T) => T)) => void] {
  const [v, setV] = useState<T>(init);
  useEffect(() => { try { const s = localStorage.getItem(key); if (s) setV(JSON.parse(s)); } catch { /* storage blocked */ } }, [key]);
  const set = (n: T | ((x: T) => T)) => setV(x => {
    const y = typeof n === 'function' ? (n as (x: T) => T)(x) : n;
    try { localStorage.setItem(key, JSON.stringify(y)); } catch { /* storage blocked */ }
    return y;
  });
  return [v, set];
}

export interface Outfit {
  id: string; name: string; top: string | null; topSize: string | null; bottom: string | null; bottomSize: string | null;
  belt?: boolean; fav?: boolean; created: number;
}

// ─── size charts ─────────────────────────────────────────────────────────────────
export type ChartKind = 'shirt' | 'pants';
export type SizeChartData = Record<string, Record<string, number>>;   // size -> measure -> cm (flat widths, like brand charts)
export const CHART_FIELDS: Record<ChartKind, [string, string][]> = {
  shirt: [['chest', 'Chest (flat)'], ['length', 'Length'], ['shoulder', 'Shoulder'], ['sleeve', 'Sleeve']],
  pants: [['waist', 'Waist (flat)'], ['hip', 'Hip (flat)'], ['length', 'Length'], ['opening', 'Leg opening']],
};
// a brand's own sewing tolerance is about +-1-2 cm, so a chart within 1.5 cm is the same garment
export const CHART_TOL = 1.5;
export type SizeMatch = { ok: boolean; diff: number; field: string | null };
// does each size of this chart match the simulated chart? (missing size = not simulated)
export function matchChart(kind: ChartKind, chart: SizeChartData | undefined, ref: SizeChartData): Record<string, SizeMatch> {
  const out: Record<string, SizeMatch> = {};
  for (const s of Object.keys(ref)) {
    if (!chart) { out[s] = { ok: true, diff: 0, field: null }; continue; }
    const row = chart[s];
    if (!row) { out[s] = { ok: false, diff: Infinity, field: null }; continue; }
    let diff = 0, field: string | null = null;
    for (const [f] of CHART_FIELDS[kind]) {
      if (!(row[f] > 0) || !(ref[s][f] > 0)) continue;
      const d = Math.abs(row[f] - ref[s][f]);
      if (d > diff) { diff = d; field = f; }
    }
    out[s] = { ok: diff <= CHART_TOL, diff, field };
  }
  return out;
}
export const fieldName = (kind: ChartKind, f: string | null) => (CHART_FIELDS[kind].find(([k]) => k === f)?.[1] ?? '').replace(' (flat)', '').toLowerCase();
export const notSimText = (kind: ChartKind, m: SizeMatch | undefined, ref: string) =>
  !m || m.ok ? '' : m.diff === Infinity ? 'This size is not in its size chart.'
    : `Its size chart differs from the simulated ${ref} by ${m.diff.toFixed(1)} cm at the ${fieldName(kind, m.field)}, so it is a different garment: it needs its own cloth simulation before it can be tried on.`;

// shrink a photo before sending it (a size chart reads fine at 1600 px)
async function toJpegBase64(file: File, max = 1600): Promise<string> {
  const img = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.9).split(',')[1];
}

// read a size chart photo with Gemini (server route /api/gemini keeps the key secret); returns cm, flat widths
export async function scanSizeChart(file: File, kind: ChartKind, sizes: string[]): Promise<{ chart: SizeChartData; notes: string[] }> {
  const data = await toJpegBase64(file);
  const fields = CHART_FIELDS[kind].map(([k]) => k).join(', ');
  const prompt = `This is a photo of a clothing brand's size chart for ${kind === 'shirt' ? 'a T-shirt / top' : 'pants'}.
Read every size row. Return JSON only:
{"unit":"cm" or "in","widths":"flat" if chest/waist/hip are measured across a flat garment (half the way round) or "around" if they are the full circumference,
 "rows":[{"size":"M", ${CHART_FIELDS[kind].map(([k]) => `"${k}":number`).join(', ')}}]}
Fields: ${fields}. ${kind === 'shirt' ? 'chest = chest / pit-to-pit width; length = body length from the shoulder; shoulder = shoulder width; sleeve = sleeve length.' : 'waist = waist width; hip = hip / seat width; length = outseam / total length; opening = leg opening / hem width.'}
Use null for a field that is not in the chart. Size labels as printed (XS, S, M, L, XL, 2XL...). Do not guess numbers.`;
  const res = await fetch('/api/gemini', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: 'image/jpeg', data } }, { text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 } }),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error(j?.error?.message || j?.error || 'The size chart reader is not available right now. Type the numbers in instead.');
  const text: string | undefined = j?.candidates?.[0]?.content?.parts?.[0]?.text;
  let p: { unit?: string; widths?: string; rows?: Record<string, unknown>[] };
  try { p = JSON.parse(text ?? ''); } catch { throw new Error("We couldn't read a size chart in this photo. Try a sharper, straight-on photo, or type the numbers in."); }
  const notes: string[] = [];
  const inch = p.unit === 'in', around = p.widths === 'around';
  if (inch) notes.push('The chart was in inches: converted to cm.');
  if (around) notes.push(`The chart gave the full way round: halved to flat widths (${kind === 'shirt' ? 'chest' : 'waist, hip'}).`);
  const norm = (s: string) => s.toUpperCase().replace(/\s/g, '').replace(/^XXL$/, '2XL').replace(/^XXXL$/, '3XL');
  const chart: SizeChartData = {};
  for (const r of p.rows ?? []) {
    const size = norm(String(r.size ?? ''));
    if (!size) continue;
    const row: Record<string, number> = {};
    for (const [f] of CHART_FIELDS[kind]) {
      let v = Number(r[f]);
      if (!(v > 0)) continue;
      if (inch) v *= 2.54;
      if (around && (f === 'chest' || f === 'waist' || f === 'hip')) v /= 2;
      row[f] = Math.round(v * 2) / 2;
    }
    if (Object.keys(row).length) chart[size] = row;
  }
  if (!Object.keys(chart).length) throw new Error("We couldn't find any sizes in this photo. Try a sharper photo, or type the numbers in.");
  const extra = Object.keys(chart).filter(s => !sizes.includes(s));
  if (extra.length) notes.push(`Sizes ${extra.join(', ')} are kept in the chart but have no simulation (simulated: ${sizes.join(', ')}).`);
  return { chart, notes };
}

// ─── size chart editor (Add item window) ───────────────────────────────────────────
export function SizeChartEditor({ kind, refChart, refName, value, onChange }: {
  kind: ChartKind; refChart: SizeChartData; refName: string;
  value: { mode: 'default' | 'scan' | 'manual'; chart: SizeChartData }; onChange: (v: { mode: 'default' | 'scan' | 'manual'; chart: SizeChartData }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [photo, setPhoto] = useState<string | null>(null);
  const sizes = Object.keys(refChart);
  const rows = Array.from(new Set([...sizes, ...Object.keys(value.chart)]));
  const match = matchChart(kind, value.mode === 'default' ? undefined : value.chart, refChart);
  const edit = (s: string, f: string, v: string) => {
    const n = Number(v);
    const row = { ...(value.chart[s] ?? {}) };
    if (v === '' || !(n >= 0)) delete row[f]; else row[f] = n;
    onChange({ mode: value.mode, chart: { ...value.chart, [s]: row } });
  };
  const scan = async (f: File) => {
    setBusy(true); setErr(null); setNotes([]); setPhoto(URL.createObjectURL(f));
    try { const r = await scanSizeChart(f, kind, sizes); onChange({ mode: 'scan', chart: r.chart }); setNotes(r.notes); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const tabs: [typeof value.mode, string][] = [['default', '⭐ Default'], ['scan', '📷 Scan photo'], ['manual', '✍️ Type it in']];
  const ok = sizes.filter(s => match[s]?.ok);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold" style={{ color: C.navy }}>Size chart</span>
      </div>
      <div className="mb-3 grid grid-cols-3 gap-1.5">
        {tabs.map(([m, l]) => (
          <button key={m} type="button" onClick={() => { setErr(null); onChange({ mode: m, chart: m === 'scan' && value.mode !== 'scan' ? {} : m === 'default' ? refChart : value.mode === 'default' ? refChart : value.chart }); }}
            className="min-h-[40px] rounded-lg px-2 text-xs font-semibold transition"
            style={value.mode === m ? { background: C.navy, color: '#fff' } : { background: C.cream, color: C.navy }}>{l}</button>
        ))}
      </div>
      {value.mode === 'default' && (
        <p className="mb-2 rounded-lg p-2.5 text-xs" style={{ background: C.pink + '40', color: C.navy }}>
          The {refName} chart. Every size of it was cloth-simulated, so all sizes can be tried on.
        </p>
      )}
      {value.mode === 'scan' && (
        <label className="mb-2 flex min-h-[64px] cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed p-3 text-xs"
          style={{ borderColor: C.peach, background: C.cream, color: C.navy }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {photo ? <img src={photo} alt="Size chart" className="h-14 w-20 rounded object-cover" /> : <span className="text-2xl">📷</span>}
          <span className="flex-1">
            <b>{busy ? 'Reading the numbers…' : photo ? 'Scan another photo' : 'Upload a photo of the size chart'}</b><br />
            <span style={{ opacity: 0.65 }}>A screenshot from the shop page works best. The photo is sent to Google Gemini to read the numbers; check them below.</span>
          </span>
          {busy && <span className="h-5 w-5 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: C.navy, borderTopColor: 'transparent' }} />}
          <input type="file" accept="image/*" className="hidden" disabled={busy} onChange={e => { const f = e.target.files?.[0]; if (f) scan(f); e.target.value = ''; }} />
        </label>
      )}
      {err && <p className="mb-2 text-xs" style={{ color: C.red }}>{err}</p>}
      {notes.map(n => <p key={n} className="mb-1 text-[11px]" style={{ color: C.navy, opacity: 0.7 }}>ℹ️ {n}</p>)}
      {(value.mode !== 'scan' || Object.keys(value.chart).length > 0) && (
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[340px] text-xs" style={{ color: C.navy }}>
            <thead>
              <tr style={{ background: C.cream }}>
                <th className="px-1.5 py-2 text-left font-bold">Size</th>
                {CHART_FIELDS[kind].map(([f, l]) => <th key={f} className="px-1 py-2 text-left font-bold">{l}</th>)}
                <th className="px-1 py-2 text-left font-bold">3D</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(s => {
                const m = match[s];
                return (
                  <tr key={s} className="border-b" style={{ borderColor: C.peach }}>
                    <td className="px-1.5 py-1.5 font-bold">{s}</td>
                    {CHART_FIELDS[kind].map(([f]) => (
                      <td key={f} className="px-1 py-1">
                        {value.mode === 'default' ? <span>{refChart[s]?.[f] ?? '—'}</span> : (
                          <input inputMode="decimal" value={value.chart[s]?.[f] ?? ''} onChange={e => edit(s, f, e.target.value)} aria-label={`${s} ${f}`}
                            className="w-full min-w-[44px] rounded border px-1.5 py-1.5 text-xs" style={{ borderColor: C.peach, background: '#fff', fontSize: 16 }} />
                        )}
                      </td>
                    ))}
                    <td className="px-1 py-1 text-[11px] font-semibold" title={m && !m.ok ? notSimText(kind, m, refName) : ''}
                      style={{ color: !m ? C.navy : m.ok ? C.green : C.amber }}>
                      {!m ? '—' : m.ok ? '✓' : m.diff === Infinity ? '—' : `±${m.diff.toFixed(0)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {value.mode !== 'default' && Object.keys(value.chart).length > 0 && (
        <p className="mt-2 text-[11px]" style={{ color: ok.length === sizes.length ? C.green : C.amber }}>
          {ok.length === sizes.length ? `✓ Same as the simulated ${refName} chart (within ${CHART_TOL} cm): every size can be tried on.`
            : ok.length ? `Sizes ${ok.join(', ')} match the simulated chart and can be tried on. The others differ by more than ${CHART_TOL} cm: they are a different garment and need their own simulation first.`
              : `This chart differs from the simulated ${refName} by more than ${CHART_TOL} cm, so it is a different garment. It is saved with its own size chart, but it cannot be tried on until it has its own cloth simulation.`}
        </p>
      )}
    </div>
  );
}

// ─── user guide: the same one as the previous wardrobe (app/items-classic/page.tsx) ──────────────────────────
export function UserGuideModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const steps: { num: string; title: string; desc: string; note?: string | null; icon: string; color: string; border: string }[] = [
    {
      num: '1',
      title: 'Add Items',
      desc: 'Use this wardrobe page to upload or select the items you want to try on.',
      icon: '👕',
      color: '#EFF6FF',
      border: '#BFDBFE',
    },
    {
      num: '2',
      title: 'Virtual Try-On',
      desc: 'Click "Check My Fit" on any item to see how different sizes look on your 3D model.',
      note: null,
      icon: '🧍',
      color: '#F0FDF4',
      border: '#BBF7D0',
    },
    {
      num: '3',
      title: 'AI Recommendations',
      desc: 'Click "AI Outfit Suggestion" to receive outfit ideas based on weather conditions.',
      icon: '✨',
      color: '#FDF4FF',
      border: '#E9D5FF',
    },
  ];

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
        style={{ backgroundColor: 'white' }}
      >
        {/* Header */}
        <div className="px-6 py-5" style={{ background: `linear-gradient(135deg, ${C.navy} 0%, #1a2f7a 100%)` }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-white/50 mb-1">How to use</p>
              <h2 className="text-xl font-black text-white">Wardrobe Guide 📖</h2>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all font-bold text-lg"
            >×</button>
          </div>
        </div>

        {/* Steps */}
        <div className="p-5 space-y-3">
          {steps.map((step) => (
            <div
              key={step.num}
              className="rounded-xl p-4 border-2"
              style={{ backgroundColor: step.color, borderColor: step.border }}
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-black text-sm text-white"
                  style={{ backgroundColor: C.navy }}>
                  {step.num}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-black text-sm" style={{ color: C.navy }}>{step.title}</p>
                  </div>
                  <p className="text-xs leading-relaxed text-gray-600">{step.desc}</p>
                  {step.note && (
                    <p className="text-[10px] mt-1.5 font-semibold text-gray-400 italic">⚠️ {step.note}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 pb-5">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl font-bold text-sm text-white hover:opacity-90 transition-all"
            style={{ backgroundColor: C.navy }}
          >
            Got it! 👍
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── outfit card ─────────────────────────────────────────────────────────────────
export function OutfitCard({ o, top, bottom, onWear, onFav, onDelete }: {
  o: Outfit; top?: { name: string; frontUrl: string }; bottom?: { name: string; frontUrl: string };
  onWear: () => void; onFav: () => void; onDelete: () => void;
}) {
  const pic = (it: { name: string; frontUrl: string } | undefined, icon: string, gone: boolean) => (
    <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-white">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {it ? <img src={it.frontUrl} alt={it.name} className="h-full w-full object-contain p-1" /> : <span className="text-3xl opacity-25">{icon}</span>}
      {gone && <span className="absolute inset-x-1 bottom-1 rounded bg-white/90 text-center text-[10px] font-semibold" style={{ color: C.red }}>removed</span>}
    </div>
  );
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border-2 bg-white" style={{ borderColor: C.peach }}>
      <div className="grid grid-cols-2 gap-1.5 p-2" style={{ background: C.cream }}>
        {pic(top, '👕', !!o.top && !top)}
        {pic(bottom, '👖', !!o.bottom && !bottom)}
      </div>
      <div className="flex flex-1 flex-col p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 text-sm font-bold" style={{ color: C.navy }}>{o.name}</h3>
          <button onClick={onFav} aria-label={o.fav ? 'Remove from favourites' : 'Add to favourites'} className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center text-lg">{o.fav ? '⭐' : '☆'}</button>
        </div>
        <p className="mt-0.5 text-xs" style={{ color: C.navy, opacity: 0.6 }}>
          {[o.top && `Top ${o.topSize ?? ''}`, o.bottom && `Bottom ${o.bottomSize ?? ''}${o.belt ? ' + belt' : ''}`].filter(Boolean).join(' · ') || 'Nothing on'}
        </p>
        <div className="mt-auto flex gap-2 pt-3">
          <button onClick={onWear} className="min-h-[40px] flex-1 rounded-lg text-xs font-semibold text-white" style={{ background: C.navy }}>Try on</button>
          <button onClick={onDelete} aria-label="Delete outfit" className="min-h-[40px] rounded-lg px-3 text-xs font-semibold" style={{ background: C.peach, color: C.navy }}>Delete</button>
        </div>
      </div>
    </div>
  );
}
