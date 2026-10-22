'use client';

import { useEffect, useState } from 'react';

export function SavedSizeControl({ itemId, name, sizes, savedSize, recommended, previewSize, onSave, syncError }: {
  itemId: string; name: string; sizes: readonly string[]; savedSize?: string | null; recommended: string | null;
  previewSize?: string; onSave: (id: string, size: string | null) => Promise<void>; syncError?: string | null;
}) {
  const [draft, setDraft] = useState(savedSize ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { setDraft(savedSize ?? ''); setMessage(null); }, [itemId, savedSize]);
  const options = [...new Set([...sizes, ...(savedSize ? [savedSize] : [])])];
  const save = async (value: string) => {
    setBusy(true); setMessage(null);
    try { await onSave(itemId, value || null); }
    catch { setMessage('Could not save your size. Please try again.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="my-3 space-y-2 rounded-xl border border-[#FFDBD1] bg-[#F8F3EA] p-3 text-xs text-[#0B1957]">
      <p>Recommended: <strong>{recommended ?? 'No supported size recommendation'}</strong><span className="mx-2 opacity-40">·</span>Your size: <strong>{savedSize ?? 'Not set'}</strong></p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">Your size
          <select aria-label={`Your size for ${name}`} value={draft} disabled={busy} onChange={e => { setDraft(e.target.value); setMessage(null); }} className="min-h-9 rounded-lg border border-[#FFDBD1] bg-white px-2 text-base sm:text-xs">
            <option value="">Not set</option>{options.map(size => <option key={size} value={size}>{size}{size === recommended ? ' (recommended)' : ''}</option>)}
          </select>
        </label>
        <button type="button" disabled={busy || draft === (savedSize ?? '')} onClick={() => save(draft)} className="min-h-9 rounded-lg bg-[#0B1957] px-3 font-semibold text-white disabled:opacity-40">{busy ? 'Saving…' : 'Save size'}</button>
        {previewSize && options.includes(previewSize) && previewSize !== savedSize && <button type="button" disabled={busy} onClick={() => { setDraft(previewSize); save(previewSize); }} className="min-h-9 rounded-lg border border-[#0B1957] bg-white px-3 font-semibold disabled:opacity-40">Save {previewSize} as my size</button>}
      </div>
      {(message || syncError) && <p role="status">{message || syncError}</p>}
    </div>
  );
}
