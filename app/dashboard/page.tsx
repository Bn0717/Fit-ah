// app/dashboard/page.tsx
// Your Fit Lab wardrobe at a glance, on your saved body:
//   header      your body (around the body, like a tailor)          stats   pieces, tops, bottoms, how many fit
//   fit check   every Fit Lab shirt and pants: the size that fits you, how it fits, and every size at a glance
//   size by brand, and a to-do list built from your data
// The verdicts come from the cloth simulations, with the same rules as My fitting room (labFit.ts).
'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Inter_Tight, Archivo } from 'next/font/google';
import { useAuth } from '@/lib/contexts/AuthContext';
import { getAvatar } from '@/lib/firebase/firestore';
import type { ParametricAvatar } from '@/lib/types/avatar';
import { loadLab, labPieces, bodyFromProfile, outsideRange, type LabData, type LabPiece, type Tone } from './labFit';

const body = Inter_Tight({ subsets: ['latin'] });
const brand = Archivo({ subsets: ['latin'], axes: ['wdth'] });
const wide = { fontStretch: '125%' } as const;
const C = { cream: '#F8F3EA', navy: '#0B1957', peach: '#FFDBD1', pink: '#FA9EBC' };
const TONE: Record<Tone, { dot: string; bg: string; name: string }> = {
  green: { dot: '#10b981', bg: '#10b9811a', name: 'fits well' },
  amber: { dot: '#d97706', bg: '#d977061f', name: 'snug' },
  blue:  { dot: '#2563eb', bg: '#2563eb17', name: 'loose' },
  red:   { dot: '#dc2626', bg: '#dc26261a', name: "doesn't fit" },
  grey:  { dot: '#0B195755', bg: '#0B19570d', name: 'not simulated for you' },
};
const FITTING_ROOM = '/profile';   // My fitting room (app/fit-lab-profile)

const toDate = (v: unknown): Date | null => {
  if (!v) return null;
  if (typeof (v as { toDate?: () => Date }).toDate === 'function') return (v as { toDate: () => Date }).toDate();
  const d = new Date(v as string); return isNaN(d.getTime()) ? null : d;
};
const daysAgo = (d: Date) => Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<ParametricAvatar | null>(null);
  const [lab, setLab] = useState<LabData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => { if (!authLoading && !user) router.push('/login'); }, [user, authLoading, router]);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    setLoading(true);
    Promise.all([getAvatar(user.uid), loadLab()])
      .then(([p, l]) => { if (alive) { setProfile(p); setLab(l); } })
      .catch(e => { console.error('Error loading dashboard:', e); if (alive) setError(true); })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [user]);

  // photos of pieces added in Fit Lab live in this browser: one image link each, freed when the page closes
  const urls = useRef<Record<string, string>>({});
  useEffect(() => () => { Object.values(urls.current).forEach(u => URL.revokeObjectURL(u)); }, []);
  const img = (id: string, blob: Blob) => (urls.current[id] ||= URL.createObjectURL(blob));

  const me = useMemo(() => bodyFromProfile(profile as unknown as Record<string, number> | null), [profile]);
  const outside = me ? outsideRange(me) : [];
  const pieces = useMemo<LabPiece[]>(() => (lab && me && !outside.length ? labPieces(lab, me, img) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lab, me, outside.length]);
  const tops = pieces.filter(p => p.group === 'tops'), bottoms = pieces.filter(p => p.group === 'bottoms');
  const fit = pieces.filter(p => p.best).length;
  const counts = pieces.reduce((a, p) => ({ ...a, [p.verdict.tone]: (a[p.verdict.tone] ?? 0) + 1 }), {} as Partial<Record<Tone, number>>);

  // your size per brand, tops and bottoms apart
  const bySize = useMemo(() => {
    const g: Record<string, { name: string; group: string; sizes: Record<string, number>; n: number }> = {};
    pieces.forEach(p => {
      const k = `${p.brand}|${p.group}`;
      const e = (g[k] ??= { name: p.brand, group: p.group === 'tops' ? 'Tops' : 'Bottoms', sizes: {}, n: 0 });
      e.n++; if (p.best) e.sizes[p.best] = (e.sizes[p.best] ?? 0) + 1;
    });
    return Object.values(g).map(e => {
      const s = Object.entries(e.sizes).sort((a, b) => b[1] - a[1]);
      return { ...e, size: s[0]?.[0] ?? null, other: s.slice(1) };
    });
  }, [pieces]);

  const updated = toDate(profile?.updatedAt) ?? toDate(profile?.createdAt);
  const todo: { text: string; href: string }[] = [];
  if (!loading) {
    if (!profile) todo.push({ text: 'Set up your body to see how every piece fits you', href: FITTING_ROOM });
    else if (outside.length) todo.push({ text: `Your body is outside what has been simulated so far (${outside.join(', ')}). Check your measurements`, href: FITTING_ROOM });
    pieces.filter(p => !p.best).forEach(p => todo.push({ text: `${p.name}: ${p.verdict.text.replace(/\.$/, '')}`, href: FITTING_ROOM }));
    if (updated && daysAgo(updated) > 30) todo.push({ text: `Your body was last updated ${daysAgo(updated)} days ago. Scan again if it changed`, href: FITTING_ROOM });
  }

  const tryOn = (p: LabPiece, size: string) => router.push(`${FITTING_ROOM}?wear=${encodeURIComponent(p.id)}&size=${encodeURIComponent(size)}`);
  const name = user?.displayName?.split(' ')[0] || user?.email?.split('@')[0] || 'there';

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: C.cream }}>
        <div className="w-10 h-10 border-4 rounded-full animate-spin" style={{ borderColor: C.navy, borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <main className={`${body.className} min-h-screen`} style={{ backgroundColor: C.cream, color: C.navy }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10 space-y-5 sm:space-y-6">

        {/* ── header: who you are ─────────────────────────── */}
        <section className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div className="min-w-0">
            <h1 className={`${brand.className} font-extrabold uppercase leading-[0.9] tracking-[-0.01em] text-[28px] sm:text-[40px] lg:text-[48px] break-words`} style={wide}>
              Hi, {name}
            </h1>
            {me ? (
              <div className="flex flex-wrap gap-2 mt-4">
                {([['Height', me.height], ['Chest', me.chest], ['Waist', me.waist], ['Shoulder', me.shoulder]] as const).map(([k, v]) => (
                  <span key={k} className="px-3 py-1.5 rounded-full bg-white border text-[12px] sm:text-[13px]" style={{ borderColor: C.peach }}>
                    <span className="opacity-60">{k}</span> <b className="font-semibold">{Math.round(v * 10) / 10} cm</b>
                  </span>
                ))}
              </div>
            ) : !loading && <p className="mt-3 text-[14px] opacity-70">No body yet. Set one up to see how every piece fits you.</p>}
            {me && <p className="mt-2 text-[11px] opacity-50">Measured around the body, like a tailor.{updated ? ` Updated ${daysAgo(updated) === 0 ? 'today' : `${daysAgo(updated)} days ago`}.` : ''}</p>}
          </div>
          <button onClick={() => router.push(FITTING_ROOM)}
            className="self-start md:self-auto shrink-0 px-5 py-2.5 rounded-full text-sm font-semibold text-white transition-transform hover:scale-[1.03] active:scale-95"
            style={{ backgroundColor: C.navy }}>
            Open my fitting room →
          </button>
        </section>

        {/* ── stats ────────────────────────────────────────── */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {loading ? [0, 1, 2, 3].map(i => <div key={i} className="h-[104px] sm:h-[118px] rounded-2xl bg-white/70 animate-pulse" />) : [
            { k: 'Pieces', v: pieces.length, s: 'in Wardrobe' },
            { k: 'Tops', v: tops.length, s: 'Shirts, T-shirts, and blouses' },
            { k: 'Bottoms', v: bottoms.length, s: 'jeans, pants and shorts' },
            { k: 'Fit you', v: fit, s: pieces.length ? 'in at least one size' : 'add pieces in Fit Lab' },
          ].map(c => (
            <div key={c.k} className="rounded-2xl bg-white border p-4 sm:p-5 min-w-0" style={{ borderColor: C.peach }}>
              <p className="text-[10px] sm:text-[11px] tracking-[0.14em] uppercase opacity-60 truncate">{c.k}</p>
              <p className="text-[24px] sm:text-[32px] font-semibold tracking-[-0.03em] mt-1 sm:mt-2">{c.v}</p>
              <p className="text-[11px] sm:text-[12px] opacity-55 truncate">{c.s}</p>
            </div>
          ))}
        </section>

        {/* ── fit check ────────────────────────────────────── */}
        <section className="rounded-2xl bg-white border p-4 sm:p-6" style={{ borderColor: C.peach }}>
          <div className="mb-4">
            <h2 className={`${brand.className} font-extrabold uppercase text-[18px] sm:text-[22px]`} style={wide}>Fit check</h2>
            <p className="text-[13px] opacity-60">From the cloth simulations: the size that fits you, and how every size fits.</p>
          </div>

          {loading ? (
            <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="h-16 rounded-xl animate-pulse" style={{ backgroundColor: C.cream }} />)}</div>
          ) : error ? (
            <Empty text="Fit Lab's simulations could not be loaded. Try again in a moment." cta="Reload" onClick={() => location.reload()} />
          ) : !me ? (
            <Empty text="Set up your body and Fit-Ah will check every piece for you." cta="Set up my body" onClick={() => router.push(FITTING_ROOM)} />
          ) : outside.length ? (
            <Empty text={`Your body is outside what has been simulated so far (${outside.join(', ')}), so there is nothing honest to show yet.`} cta="Check my measurements" onClick={() => router.push(FITTING_ROOM)} />
          ) : (
            <>
              {pieces.length > 0 && (
                <>
                  <div className="flex h-2.5 rounded-full overflow-hidden mb-3" style={{ backgroundColor: C.cream }} role="img"
                    aria-label={(Object.keys(TONE) as Tone[]).filter(t => counts[t]).map(t => `${counts[t]} ${TONE[t].name}`).join(', ')}>
                    {(Object.keys(TONE) as Tone[]).map(t => counts[t] ? <div key={t} style={{ width: `${(counts[t]! / pieces.length) * 100}%`, backgroundColor: TONE[t].dot }} /> : null)}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2 text-[12px]">
                    {(Object.keys(TONE) as Tone[]).map(t => counts[t] ? (
                      <span key={t} className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: TONE[t].dot }} />{counts[t]} {TONE[t].name}</span>
                    ) : null)}
                  </div>
                </>
              )}
              <Group title="Tops" pieces={tops} onTry={tryOn} />
              <Group title="Bottoms" pieces={bottoms} onTry={tryOn} />
            </>
          )}
        </section>

        {/* ── size by brand + to do ────────────────────────── */}
        {!loading && me && !outside.length && (
          <section className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6 items-start">
            <div className="rounded-2xl bg-white border p-4 sm:p-6 min-w-0" style={{ borderColor: C.peach }}>
              <h2 className={`${brand.className} font-extrabold uppercase text-[18px] sm:text-[22px]`} style={wide}>Your size by brand</h2>
              <p className="text-[13px] opacity-60 mb-4">The size that fits you best, from the simulations.</p>
              {bySize.length ? (
                <ul className="divide-y" style={{ borderColor: `${C.navy}14` }}>
                  {bySize.map(b => (
                    <li key={`${b.name}${b.group}`} className="py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-[14px] truncate">{b.name} · {b.group}</p>
                        <p className="text-[12px] opacity-55">{b.n} {b.n === 1 ? 'piece' : 'pieces'}{b.other.length ? ` · ${b.other.map(([s, n]) => `${s} for ${n}`).join(', ')}` : ''}</p>
                      </div>
                      <span className={`${brand.className} shrink-0 min-w-[52px] text-center px-3 py-1.5 rounded-full text-[15px] font-extrabold`}
                        style={{ backgroundColor: b.size ? C.pink : `${C.navy}10`, ...wide }}>{b.size ?? '–'}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[13px] opacity-60 py-4">No pieces yet.</p>}
            </div>

            <div className="rounded-2xl p-4 sm:p-6 min-w-0" style={{ backgroundColor: C.peach }}>
              <h2 className={`${brand.className} font-extrabold uppercase text-[18px] sm:text-[22px] mb-3`} style={wide}>To do</h2>
              {todo.length ? (
                <ul className="space-y-2">
                  {todo.map(t => (
                    <li key={t.text}>
                      <button onClick={() => router.push(t.href)} className="w-full text-left flex items-center justify-between gap-3 rounded-xl bg-white/70 hover:bg-white px-4 py-3 text-[13px] sm:text-[14px] transition-colors">
                        <span className="min-w-0">{t.text}</span><span className="shrink-0 opacity-50" aria-hidden="true">→</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[14px] opacity-70">Nothing to do. Every piece has a size that fits you.</p>}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function Group({ title, pieces, onTry }: { title: string; pieces: LabPiece[]; onTry: (p: LabPiece, size: string) => void }) {
  if (!pieces.length) return null;
  return (
    <div>
      <p className="text-[10px] tracking-[0.14em] uppercase opacity-50 mb-2 mt-5">{title} · {pieces.length}</p>
      <ul className="space-y-2">{pieces.map(p => <PieceRow key={p.id} p={p} onTry={onTry} />)}</ul>
    </div>
  );
}

// one piece: tap a size to see how it fits, then try that size on in the fitting room
function PieceRow({ p, onTry }: { p: LabPiece; onTry: (p: LabPiece, size: string) => void }) {
  const [sel, setSel] = useState<string | null>(p.best);
  const s = p.sizes.find(x => x.size === sel) ?? null;
  const tone = s ? s.tone : p.verdict.tone, text = s ? s.label : p.verdict.text;
  const canTry = !!s && s.tone !== 'grey' && s.tone !== 'red';      // the fitting room only shows what was simulated and can be worn
  return (
    <li className="rounded-xl p-3 grid grid-cols-[48px_minmax(0,1fr)] md:grid-cols-[56px_minmax(0,1fr)_minmax(0,1.3fr)_auto] gap-x-3 md:gap-x-4 gap-y-2 items-center" style={{ backgroundColor: C.cream }}>
      <div className="w-12 h-12 md:w-14 md:h-14 rounded-lg bg-white overflow-hidden flex items-center justify-center row-span-4 md:row-span-1 self-start md:self-center">
        <img src={p.img} alt="" className="w-full h-full object-contain p-1 mix-blend-multiply" loading="lazy" />
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-[14px] truncate">{p.name}</p>
        <p className="text-[12px] opacity-55 truncate">{p.brand}{p.best ? ` · best size ${p.best}` : ''}</p>
      </div>
      <p className="text-[12px] leading-snug flex items-start gap-1.5 min-w-0" aria-live="polite">
        <span className="w-2 h-2 rounded-full mt-[5px] shrink-0" style={{ backgroundColor: TONE[tone].dot }} />
        <span className="opacity-80">{s ? <b className="font-semibold">{s.size}{s.best ? ' (best)' : ''}: </b> : null}{text}</span>
      </p>
      <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
        <div className="flex gap-1" role="group" aria-label={`Sizes of ${p.name}`}>
          {p.sizes.map(z => (
            <button key={z.size} onClick={() => setSel(z.size)} aria-pressed={z.size === sel} title={`${z.size}: ${z.label}`}
              className="min-w-[32px] h-[28px] px-1.5 rounded-md text-[11px] font-semibold flex items-center justify-center transition-transform hover:scale-105"
              style={{ backgroundColor: z.size === sel ? C.navy : TONE[z.tone].bg, color: z.size === sel ? 'white' : C.navy,
                boxShadow: z.size === sel ? 'none' : `inset 0 -2px 0 ${TONE[z.tone].dot}` }}>
              {z.size}
            </button>
          ))}
        </div>
        <button onClick={() => s && onTry(p, s.size)} disabled={!canTry}
          className="h-[28px] px-3 rounded-full text-[11px] sm:text-[12px] font-semibold text-white whitespace-nowrap transition-opacity disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90"
          style={{ backgroundColor: C.navy }}
          title={canTry ? `Put ${p.name} on in ${s!.size} in your fitting room` : 'This size can\'t be shown on your body'}>
          {s ? `Try ${s.size} on →` : 'Try it on →'}
        </button>
      </div>
    </li>
  );
}

function Empty({ text, cta, onClick }: { text: string; cta: string; onClick: () => void }) {
  return (
    <div className="text-center py-8 px-4 rounded-xl" style={{ backgroundColor: C.cream }}>
      <p className="text-[14px] opacity-70 mb-4 max-w-md mx-auto">{text}</p>
      <button onClick={onClick} className="px-5 py-2.5 rounded-full text-sm font-semibold text-white" style={{ backgroundColor: C.navy }}>{cta}</button>
    </div>
  );
}
