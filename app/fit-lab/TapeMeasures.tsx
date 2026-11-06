'use client';
// Optional tape measurements (waist, hips, inside leg) for the pants advice, with how to measure each one.
// The 3D body estimates them from height + chest (often 3-4 cm off at the waist); a tape is ~1-2 cm.
import { useState } from 'react';

export type Tape = { waist: number | null; hip: number | null; inseam: number | null };
export const NO_TAPE: Tape = { waist: null, hip: null, inseam: null };

const FIELDS: { k: keyof Tape; label: string; min: number; max: number; how: string }[] = [
  { k: 'waist', label: 'Waist', min: 50, max: 160, how: 'Round your natural waist (the narrowest part, above the belly button), tape level, breathing out normally.' },
  { k: 'hip', label: 'Hips', min: 60, max: 170, how: 'Round the widest part of your bottom, feet together, tape level.' },
  { k: 'inseam', label: 'Inside leg', min: 50, max: 100, how: 'From your crotch straight down to the floor, barefoot. Or measure trousers that fit you well, crotch seam to hem.' },
];

export function TapeMeasures({ tape, onChange, colors }: {
  tape: Tape; onChange: (t: Tape) => void;
  colors: { ink: string; navy: string; mute: string; line: string; amber: string; cream: string };
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<Partial<Record<keyof Tape, string>>>({});
  const [bad, setBad] = useState<keyof Tape | null>(null);
  const given = FIELDS.filter(f => tape[f.k] != null).length;
  const commit = (f: typeof FIELDS[number]) => {
    const raw = (text[f.k] ?? '').trim();
    if (raw === '') { setBad(null); if (tape[f.k] != null) onChange({ ...tape, [f.k]: null }); return; }
    const v = parseFloat(raw.replace(',', '.'));
    if (!(v >= f.min && v <= f.max)) { setBad(f.k); return; }
    setBad(null);
    const r = Math.round(v * 2) / 2;
    if (r !== tape[f.k]) onChange({ ...tape, [f.k]: r });
  };
  return (
    <div className="rounded-xl border px-3 py-2.5" style={{ borderColor: colors.line }}>
      <button onClick={() => setOpen(o => !o)} className="flex w-full min-w-0 items-center justify-between gap-2 text-left" aria-expanded={open}>
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold" style={{ color: colors.ink }}>Tape measure (optional)</span>
          <span className="block truncate text-[11px]" style={{ color: colors.mute }}>{given ? `${given} of 3 given, used for pants` : 'Waist, hips, inside leg (for pants)'}</span>
        </span>
        <span className="shrink-0 text-xs" style={{ color: colors.navy }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {FIELDS.map(f => (
            <div key={f.k} className="min-w-0">
              <label className="flex min-w-0 items-center justify-between gap-2">
                <span className="text-xs font-semibold" style={{ color: colors.ink }}>{f.label}</span>
                <span className="flex shrink-0 items-center gap-1">
                  <input inputMode="decimal" placeholder="not set" aria-label={`${f.label} in cm`}
                    value={text[f.k] ?? (tape[f.k] != null ? String(tape[f.k]) : '')}
                    onChange={e => setText(t => ({ ...t, [f.k]: e.target.value }))}
                    onBlur={() => commit(f)} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    className="w-20 rounded-md border px-2 py-1 text-right text-sm font-bold tabular-nums outline-none focus:ring-2"
                    style={{ borderColor: bad === f.k ? colors.amber : colors.line, color: colors.navy }} />
                  <span className="text-[11px]" style={{ color: colors.mute }}>cm</span>
                </span>
              </label>
              {bad === f.k
                ? <p className="mt-0.5 text-[10px]" style={{ color: colors.amber }}>Between {f.min} and {f.max} cm, please.</p>
                : <p className="mt-0.5 text-[10px] leading-snug" style={{ color: colors.mute }}>{f.how}</p>}
            </div>
          ))}
          <p className="rounded-lg px-2.5 py-2 text-[10px] leading-snug" style={{ background: colors.cream, color: colors.mute }}>
            A soft tape, snug but not tight. Most people measure about 1 cm small, so pants within 2 cm of your size are marked borderline. The 3D body stays as it is; only the pants advice uses these.
          </p>
        </div>
      )}
    </div>
  );
}
