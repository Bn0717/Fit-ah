// app/fit-lab/SkinTonePicker.tsx
// The 10 Monk skin tones for the 3D body (skinTone.ts), shared by the Profile page and the fitting room.
'use client';
import { SKIN_TONES, type SkinToneId } from './skinTone';

const NAVY = '#0B1957';

export function SkinTonePicker({ value, onChange }: { value: SkinToneId | null; onChange: (id: SkinToneId | null) => void }) {
  return (
    <div role="radiogroup" aria-label="Skin tone of your 3D body">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs font-semibold" style={{ color: '#1f2a52' }}>Skin tone</span>
        <button role="radio" aria-checked={value === null} onClick={() => onChange(null)} className="rounded-md px-1 text-[11px] font-semibold"
          style={{ color: value === null ? NAVY : '#6b7280', textDecoration: value === null ? 'underline' : 'none' }}>Original</button>
      </div>
      <div className="grid grid-cols-10 gap-1">
        {SKIN_TONES.map((t, i) => (
          <button key={t.id} role="radio" aria-checked={value === t.id} aria-label={`Skin tone ${i + 1} of ${SKIN_TONES.length}`} title={`Tone ${i + 1}`}
            onClick={() => onChange(t.id)} className="aspect-square w-full rounded-full transition"
            style={{ background: t.hex, boxShadow: value === t.id ? `0 0 0 2px #fff, 0 0 0 4px ${NAVY}` : 'inset 0 0 0 1px rgba(0,0,0,0.12)' }} />
        ))}
      </div>
      <p className="mt-1 text-[10px]" style={{ color: '#6b7280' }}>Monk Skin Tone Scale. Only changes how your 3D body looks, not the fit.</p>
    </div>
  );
}
