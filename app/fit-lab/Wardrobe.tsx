// app/fit-lab/Wardrobe.tsx
// Fit Lab wardrobe, in the style of /items (ItemDetailsModal): item cards, an item window with a 2D photo
// view and a 3D view of the simulated shirt, the size chart, "Try it on" (opens the fitting room wearing it)
// and the weather-based AI style suggestions (StyleOverlay from the wardrobe's fit window).
// Items are colourways of the same cut (see colourway.ts); added ones are kept in this browser (IndexedDB).
'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { Result } from './colourway';
import type { ClothingItem } from '@/lib/types/clothing';
import type { ParametricAvatar } from '@/lib/types/avatar';
import { StyleOverlay } from '@/components/items/FitRecommendationModal';
import { SizeChartEditor, notSimText, type SizeChartData, type SizeMatch } from './WardrobeExtras';
import { loadPacked } from './engine';

const C = { cream: '#F8F3EA', navy: '#0B1957', peach: '#FFDBD1', pink: '#FA9EBC', red: '#ef4444' };
export const SIZES = ['S', 'M', 'L', 'XL'] as const;
export type Size = typeof SIZES[number];
export type Chart = Record<Size, { chest: number; shoulder: number; length: number; sleeve: number }>;

export interface LabItem {
  id: string; brand: string; name: string; frontUrl: string; backUrl: string; builtin?: boolean;
  tex?: { front: Result; back: Result };            // aligned photos (not set for the original Gon Tee)
  pantsTex?: { front: HTMLCanvasElement; back: HTMLCanvasElement };   // pants photo swap, drawn into the Xin texture frame
  chart?: SizeChartData;                            // its own size chart (added items; none = the simulated chart)
}
export type SizeFit = Record<Size, { verdict: string; color: string; ease: number } | null>;

// ─── browser storage for added items (photos are re-aligned on load) ───────────────
interface StoredItem { id: string; brand: string; name: string; front: Blob; back: Blob; created: number; kind?: 'shirt' | 'pants'; chart?: SizeChartData; chartMode?: string }
const openDb = () => new Promise<IDBDatabase>((res, rej) => {
  const r = indexedDB.open('fitlab', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('items', { keyPath: 'id' });
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const tx = async <T,>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) => {
  const db = await openDb();
  return new Promise<T>((res, rej) => { const q = f(db.transaction('items', mode).objectStore('items')); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
};
export const storeItem = (it: StoredItem) => tx('readwrite', s => s.put(it)).catch(() => undefined);
export const unstoreItem = (id: string) => tx('readwrite', s => s.delete(id)).catch(() => undefined);
export const loadStored = () => tx<StoredItem[]>('readonly', s => s.getAll() as IDBRequest<StoredItem[]>).catch(() => [] as StoredItem[]);

// ─── item cards ──────────────────────────────────────────────────────────────────
// one wardrobe section (Tops, Bottoms): its own cards and its own add button. Touch first: the ☆ and ✕ buttons are
// always visible (no hover on a phone) and 36 px+ to tap; 2 cards a row on a phone, up to 5 on a wide screen.
export function WardrobeGrid({ items, activeId, onOpen, onAdd, onDelete, loadingIds, title = 'TOPS', subtitle = 'Same cut as the TNT CO Gon Tee · every size cloth-simulated',
  addLabel = 'Add Top', info = () => 'Short Sleeve Shirt · 4 sizes', badge = 'Wearing', hiddenCount = 0, onRestore, favs = [], onFav, warn = () => null, empty }: {
  items: LabItem[]; activeId: string; onOpen: (it: LabItem) => void; onAdd?: () => void; onDelete: (it: LabItem) => void; loadingIds: string[];
  title?: string; subtitle?: string; addLabel?: string; info?: (it: LabItem) => string; badge?: string;
  hiddenCount?: number; onRestore?: () => void; favs?: string[]; onFav?: (it: LabItem) => void;
  warn?: (it: LabItem) => string | null;   // e.g. "Not simulated" for an item with a different size chart
  empty?: string;
}) {
  if (!items.length && !loadingIds.length && !onAdd && !hiddenCount) return null;
  return (
    <section className="mt-6">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-bold tracking-wide" style={{ color: C.navy }}>{title} <span className="text-xs font-normal" style={{ opacity: 0.5 }}>{items.length}</span></h3>
          {subtitle && <p className="text-xs" style={{ color: C.navy, opacity: 0.6 }}>{subtitle}
            {hiddenCount > 0 && onRestore && <button onClick={onRestore} className="ml-2 font-semibold underline">Restore {hiddenCount} removed</button>}</p>}
        </div>
        {onAdd && <button onClick={onAdd} className="flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-white hover:opacity-90 sm:px-4" style={{ backgroundColor: C.navy }}>
          <span className="text-lg leading-none">+</span> {addLabel}
        </button>}
      </div>
      {!items.length && !loadingIds.length && empty && <p className="rounded-xl border-2 border-dashed p-6 text-center text-sm" style={{ borderColor: C.peach, color: C.navy, opacity: 0.7 }}>{empty}</p>}
      <div className="grid grid-cols-3 gap-2 min-[480px]:grid-cols-4 md:grid-cols-3 md:gap-4 lg:grid-cols-4 xl:grid-cols-5">
        {items.map(it => {
          const fav = favs.includes(it.id), w = warn(it);
          return (
            <div key={it.id} onClick={() => onOpen(it)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onOpen(it); }}
              className="group relative cursor-pointer overflow-hidden rounded-xl border-2 bg-white transition-all hover:shadow-md focus:outline-none focus-visible:ring-2"
              style={{ borderColor: it.id === activeId ? C.navy : C.peach }}>
              {/* ☆ top left, ✕ top right: small to look at, but each has a 36 px tap area */}
              {onFav && <button onClick={e => { e.stopPropagation(); onFav(it); }} aria-label={fav ? 'Remove from favourites' : 'Add to favourites'} title="Favourite"
                className="absolute left-0 top-0 z-10 flex h-9 w-9 items-center justify-center md:left-1 md:top-1 md:h-11 md:w-11">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-xs shadow md:h-9 md:w-9 md:text-base" style={{ color: C.navy }}>{fav ? '⭐' : '☆'}</span>
              </button>}
              <button onClick={e => { e.stopPropagation(); onDelete(it); }} aria-label="Delete item" title="Delete"
                className="absolute right-0 top-0 z-10 flex h-9 w-9 items-center justify-center opacity-80 transition-opacity hover:opacity-100 md:right-1 md:top-1 md:h-11 md:w-11">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-[10px] text-white shadow md:h-9 md:w-9 md:text-sm">✕</span>
              </button>
              <div className="relative aspect-square overflow-hidden bg-white md:aspect-[3/4]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={it.frontUrl} alt={it.name} loading="lazy" className="h-full w-full object-contain p-1.5 [transform:scale(1.3)] md:p-2 md:[transform:scale(1.45)]" />
                <div className="absolute inset-0 hidden items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 md:flex" style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>
                  <span className="rounded-full bg-white/80 px-3 py-1.5 text-xs font-bold" style={{ color: C.navy }}>View Details</span>
                </div>
                {w && <span className={`absolute inset-x-1 rounded bg-amber-50/95 px-1 py-0.5 text-center text-[9px] font-semibold leading-tight ${it.id === activeId ? 'bottom-5' : 'bottom-1'}`} style={{ color: '#b45309' }}>{w}</span>}
                {it.id === activeId && (
                  <span className="absolute inset-x-0 bottom-0 py-0.5 text-center text-[9px] font-bold tracking-wide text-white md:py-1 md:text-[10px]" style={{ backgroundColor: C.navy }}>{badge.toUpperCase()}</span>
                )}
              </div>
              <div className="border-t bg-white px-2 py-1.5 md:border-t-0 md:p-3" style={{ borderColor: C.peach + '80' }}>
                <p className="truncate text-[10px] font-bold uppercase tracking-wide md:hidden" style={{ color: C.navy, opacity: 0.55 }}>{it.brand}</p>
                <span className="mb-1 hidden max-w-full truncate rounded-full px-3 py-0.5 text-xs font-bold md:inline-block" style={{ backgroundColor: C.pink, color: C.navy }}>{it.brand}</span>
                <h3 className="truncate text-xs font-semibold leading-snug md:text-sm" style={{ color: C.navy }}>{it.name}</h3>
                <p className="hidden truncate text-xs md:block" style={{ color: C.navy, opacity: 0.5 }}>{info(it)}</p>
              </div>
            </div>
          );
        })}
        {loadingIds.map(id => (
          <div key={id} className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-blue-200 bg-white">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">Lining up…</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── add item ────────────────────────────────────────────────────────────────────
export function AddItemModal({ open, onClose, onSubmit, kind, refChart, refName }: {
  open: boolean; onClose: () => void; kind: 'shirt' | 'pants'; refChart: SizeChartData; refName: string;
  onSubmit: (d: { brand: string; name: string; front: File; back: File; kind: 'shirt' | 'pants'; chart?: SizeChartData; chartMode: string }) => Promise<string | null>;
}) {
  const [brand, setBrand] = useState('TNT CO');
  const [name, setName] = useState('');
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [chart, setChart] = useState<{ mode: 'default' | 'scan' | 'manual'; chart: SizeChartData }>({ mode: 'default', chart: refChart });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) setChart({ mode: 'default', chart: refChart }); }, [open, kind]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  const chartOk = chart.mode === 'default' || Object.keys(chart.chart).length > 0;
  const ok = brand.trim() && name.trim() && front && back && chartOk && !busy;
  const submit = async () => {
    if (!front || !back) return;
    setBusy(true); setErr(null);
    const e = await onSubmit({ brand: brand.trim(), name: name.trim(), front, back, kind,
      chart: chart.mode === 'default' ? undefined : chart.chart, chartMode: chart.mode });
    setBusy(false);
    if (e) setErr(e); else { setName(''); setFront(null); setBack(null); onClose(); }
  };
  const photo = (label: string, f: File | null, set: (f: File | null) => void, side: string) => (
    <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-3 text-xs"
      style={{ borderColor: C.peach, backgroundColor: C.cream, color: C.navy }}>
      {f
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={URL.createObjectURL(f)} alt={label} className="h-24 w-full object-contain sm:h-28" />
        : <span className="flex h-24 items-center text-3xl opacity-30 sm:h-28">{kind === 'pants' ? '👖' : '👕'}</span>}
      <span className="font-semibold">{label}</span>
      <input type="file" accept="image/*" data-side={side} className="hidden" onChange={e => set(e.target.files?.[0] ?? null)} />
    </label>
  );
  const field = 'min-h-[44px] w-full rounded-lg border-2 px-3 text-base sm:text-sm';
  return (
    // a bottom sheet on a phone, a centred window on bigger screens; the body scrolls, the buttons stay in view
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-label={kind === 'pants' ? 'Add Bottom' : 'Add Top'} className="flex max-h-[94dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: C.peach }}>
          <h2 className="text-lg font-bold" style={{ color: C.navy }}>{kind === 'pants' ? 'Add Bottom' : 'Add Top'}</h2>
          <button onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: C.cream, color: C.navy }}>✕</button>
        </div>
        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <p className="text-xs" style={{ color: C.navy, opacity: 0.65 }}>
            {kind === 'shirt'
              ? 'A new colour or print of the Gon Tee cut. Flat-lay photos, front and back, on a plain background (or a transparent PNG). The photos are wrapped on the cloth-simulated pattern.'
              : 'Pants of the Xin jeans cut (wide straight leg, rigid denim). Flat-lay photos, front and back, whole pants with the legs slightly apart, on a plain background. Each leg is wrapped on the cloth-simulated pattern.'}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input value={brand} onChange={e => setBrand(e.target.value)} placeholder="Brand" aria-label="Brand" className={field}
              style={{ borderColor: C.peach, backgroundColor: C.cream, color: C.navy }} />
            <input value={name} onChange={e => setName(e.target.value)} placeholder={kind === 'pants' ? 'Name (e.g. Xin Black)' : 'Name (e.g. Gon Tee Black)'} aria-label="Name" className={field}
              style={{ borderColor: C.peach, backgroundColor: C.cream, color: C.navy }} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {photo('Front photo', front, setFront, 'front')}
            {photo('Back photo', back, setBack, 'back')}
          </div>
          <SizeChartEditor kind={kind} refChart={refChart} refName={refName} value={chart} onChange={setChart} />
          {err && <p className="text-xs" style={{ color: C.red }}>{err}</p>}
        </div>
        <div className="flex gap-3 border-t px-5 py-3" style={{ borderColor: C.peach, paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
          <button onClick={onClose} className="min-h-[44px] flex-1 rounded-lg text-sm font-medium" style={{ backgroundColor: C.cream, color: C.navy }}>Cancel</button>
          <button onClick={submit} disabled={!ok} className="min-h-[44px] flex-1 rounded-lg text-sm font-semibold text-white"
            style={{ backgroundColor: C.navy, opacity: ok ? 1 : 0.4 }}>{busy ? 'Lining up the photos…' : 'Add to wardrobe'}</button>
        </div>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GLB_CACHE: Record<string, Promise<any>> = {};

// ─── 3D view of the simulated shirt on its own (as draped on the 175 cm / chest 101 cm body) ───────────
export function Shirt3D({ item, size, gridDir, compact = false, url: fileUrl, label }: { item: LabItem; size: string; gridDir: string; compact?: boolean; url?: string; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    let cancelled = false, frame = 0;
    let cleanup = () => {};
    setReady(false);
    Promise.all([
      import('three'), import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/controls/OrbitControls.js'), import('three/addons/environments/RoomEnvironment.js'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ]).then(([THREE, { GLTFLoader }, { OrbitControls }, { RoomEnvironment }]: any[]) => {
      if (cancelled || !ref.current) return;
      const canvas = ref.current, W = canvas.clientWidth || 400, H = canvas.clientHeight || 500;
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setSize(W, H, false); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.9;
      const scene = new THREE.Scene(); scene.background = new THREE.Color(compact ? 0xffffff : 0xfaf7f2);
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(-2, 3, 3); scene.add(key);
      scene.add(new THREE.HemisphereLight(0xffffff, 0xd8cfc0, 0.5));
      const camera = new THREE.PerspectiveCamera(32, W / H, 0.05, 20);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true; controls.autoRotate = true; controls.autoRotateSpeed = 1.5;
      const texs: unknown[] = [];
      // one download + parse per shirt file, shared by every 3D view on the page (cards, item window)
      const url = fileUrl ?? `${gridDir}/shirt_${size}.glb.gz`;
      GLB_CACHE[url] ||= new Promise((res, rej) => loadPacked(THREE, new GLTFLoader(), url, res, undefined, rej));
      GLB_CACHE[url].then(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gl: any) => {
          if (cancelled) return;
          const g = { scene: gl.scene.clone(true) };      // own transforms / materials, shared geometry
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          g.scene.traverse((o: any) => {
            if (!o.isMesh) return;
            o.morphTargetInfluences?.fill(0);           // the file's default weights are 1: show the plain 175 / 101 drape
            const m = o.material.clone(); m.side = THREE.DoubleSide; m.roughness = 0.95; m.metalness = 0;
            const side = /front/.test(m.name) ? 'front' : /back/.test(m.name) ? 'back' : null;
            if (side && item.pantsTex) {
              const t = new THREE.CanvasTexture(item.pantsTex[side]); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
              m.map = t; texs.push(t);
            } else if (side && item.tex) {
              const t = new THREE.CanvasTexture(item.tex[side].canvas); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
              m.map = t; texs.push(t);
              if (m.sheenColor) m.sheenColor.setRGB(...item.tex.front.fabric.map(v => 0.9 * v));
            }
            o.material = m;
          });
          const box = new THREE.Box3().setFromObject(g.scene), c = new THREE.Vector3(), sz = new THREE.Vector3();
          box.getCenter(c); box.getSize(sz);
          controls.target.copy(c);
          camera.position.set(c.x, c.y + sz.y * 0.1, c.z + Math.max(sz.x, sz.y) * 2.1);
          scene.add(g.scene); setReady(true);
        });
      const tick = () => { frame = requestAnimationFrame(tick); controls.update(); renderer.render(scene, camera); };
      tick();
      const ro = new ResizeObserver(() => {
        const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
        camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false);
      });
      ro.observe(canvas);
      cleanup = () => {
        cancelAnimationFrame(frame); ro.disconnect(); controls.dispose(); pmrem.dispose();
        texs.forEach(t => (t as { dispose: () => void }).dispose()); renderer.dispose();
      };
    });
    return () => { cancelled = true; cleanup(); };
  }, [item, size, gridDir, compact, fileUrl]);
  return (
    <div className={`relative overflow-hidden ${compact ? 'h-full w-full' : 'aspect-[3/4] rounded-xl'}`} style={{ backgroundColor: compact ? '#fff' : C.cream }}>
      <canvas ref={ref} className="block h-full w-full" />
      {!ready && !compact && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: C.navy, borderTopColor: 'transparent' }} />
          <p className="text-xs font-semibold" style={{ color: C.navy }}>Loading 3D model…</p>
        </div>
      )}
      {ready && !compact && <div className="absolute bottom-2 left-0 right-0 flex justify-center"><span className="rounded-full bg-black/30 px-2 py-1 text-[10px] text-white/80">{label ?? `Size ${size} as simulated on the 175 cm body · drag to rotate`}</span></div>}
    </div>
  );
}

// ─── item window ─────────────────────────────────────────────────────────────────
export function ItemModal({ item, onClose, chart, sizeFit, size, gridDir, body, onCheckFit, fav, onFav, match }: {
  item: LabItem | null; onClose: () => void; chart: Partial<Chart>; sizeFit: SizeFit; size: Size; gridDir: string;
  fav?: boolean; onFav?: () => void; match?: Record<string, SizeMatch> | null;   // sizes of its own chart that match the simulation
  body: { height: number; chest: number; waist: number; shoulder: number | null };
  onCheckFit: (it: LabItem, size: Size) => void;
}) {
  const [view, setView] = useState<'2d' | '3d'>('2d');
  const [side, setSide] = useState<'front' | 'back'>('front');
  const [viewSize, setViewSize] = useState<Size>(size);
  const [style, setStyle] = useState(false);
  useEffect(() => { setViewSize(size); setStyle(false); }, [item, size]);
  if (!item) return null;
  const clothing: ClothingItem = {
    id: item.id, userId: 'fitlab', brand: item.brand, name: item.name, category: 'Short Sleeve Shirt',
    imageUrl: item.frontUrl, frontImageUrl: item.frontUrl, backImageUrl: item.backUrl, isFavorite: false,
    sizeChart: SIZES.filter(s => chart[s]).map(s => ({ size: s, ...chart[s]! })),
  };
  // the wardrobe's profile stores chest and waist as half (flat) widths, like the brand size chart
  const profile: ParametricAvatar = {
    userId: 'fitlab', height: body.height, chest: body.chest / 2, waist: body.waist / 2, shoulder: body.shoulder ?? 45,
  };
  return (
    // a full-width sheet on a phone, a centred window on bigger screens
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-label={item.name} className="relative flex max-h-[94dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-2xl" onClick={e => e.stopPropagation()} style={{ minHeight: style ? '80vh' : undefined }}>
        <div className="overflow-y-auto px-5 pt-5 md:p-8">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex-1">
              <div className="mb-2 flex items-center gap-3">
                <span className="rounded-full px-3 py-1 text-xs font-bold" style={{ backgroundColor: C.pink, color: C.navy }}>{item.brand}</span>
                <span className="rounded-full px-3 py-1 text-xs font-bold" style={{ backgroundColor: C.peach, color: C.navy }}>Short Sleeve Shirt</span>
              </div>
              <h2 className="text-xl font-bold md:text-2xl" style={{ color: C.navy }}>{item.name}</h2>
            </div>
            <div className="flex shrink-0 gap-2">
              {onFav && <button onClick={onFav} aria-label={fav ? 'Remove from favourites' : 'Add to favourites'} className="flex h-10 w-10 items-center justify-center rounded-full text-lg hover:opacity-70" style={{ backgroundColor: C.cream, color: C.navy }}>{fav ? '⭐' : '☆'}</button>}
              <button onClick={onClose} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-full hover:opacity-70" style={{ backgroundColor: C.cream, color: C.navy }}>✕</button>
            </div>
          </div>

          <div className="mb-5 flex gap-2">
            {(['2d', '3d'] as const).map(m => (
              <button key={m} onClick={() => setView(m)} className="rounded-lg px-5 py-2 text-sm font-semibold transition-all"
                style={{ backgroundColor: view === m ? C.navy : C.cream, color: view === m ? 'white' : C.navy }}>
                {m === '2d' ? '🖼 2D View' : '📦 3D View'}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
            <div>
              {view === '2d' ? (
                <>
                  <div className="mb-3 flex gap-2">
                    {(['front', 'back'] as const).map(s => (
                      <button key={s} onClick={() => setSide(s)} className="flex-1 rounded-lg py-2 text-xs font-bold transition-all"
                        style={{ backgroundColor: side === s ? C.peach : C.cream, color: C.navy, border: `2px solid ${side === s ? C.navy : C.peach}` }}>
                        {s === 'front' ? '👕 Front' : '🔄 Back'}
                      </button>
                    ))}
                  </div>
                  <div className="flex h-[40dvh] items-center justify-center overflow-hidden rounded-xl sm:h-auto sm:aspect-[3/4]" style={{ backgroundColor: 'white', border: `2px solid ${C.peach}` }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={side === 'front' ? item.frontUrl : item.backUrl} alt={`${item.name} ${side}`} className="h-full w-full object-contain" />
                  </div>
                </>
              ) : (
                <>
                  <div className="mb-3 grid grid-cols-4 gap-2">
                    {SIZES.map(s => (
                      <button key={s} onClick={() => setViewSize(s)} className="rounded-lg py-2 text-xs font-bold"
                        style={{ backgroundColor: viewSize === s ? C.navy : C.cream, color: viewSize === s ? 'white' : C.navy }}>{s}</button>
                    ))}
                  </div>
                  <Shirt3D item={item} size={viewSize} gridDir={gridDir} />
                </>
              )}
            </div>

            <div>
              <h3 className="mb-4 text-lg font-bold" style={{ color: C.navy }}>Size Chart</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ backgroundColor: C.cream }}>
                      {['Size', 'Chest (width)', 'Length', 'Shoulder', 'Sleeve', 'On your body'].map(h => (
                        <th key={h} className="px-2 py-3 text-left text-xs font-bold" style={{ color: C.navy }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {SIZES.map(s => {
                      const f = sizeFit[s];
                      return (
                        <tr key={s} onClick={() => setViewSize(s)} className="cursor-pointer border-b" style={{ borderColor: C.peach, backgroundColor: s === viewSize ? C.pink + '30' : 'transparent' }}>
                          <td className="px-2 py-3 font-bold" style={{ color: C.navy }}>{s}</td>
                          <td className="whitespace-nowrap px-2 py-3" style={{ color: C.navy }}>{chart[s] ? `${chart[s]!.chest} cm` : '—'}</td>
                          <td className="whitespace-nowrap px-2 py-3" style={{ color: C.navy }}>{chart[s] ? `${chart[s]!.length} cm` : '—'}</td>
                          <td className="whitespace-nowrap px-2 py-3" style={{ color: C.navy }}>{chart[s] ? `${chart[s]!.shoulder} cm` : '—'}</td>
                          <td className="whitespace-nowrap px-2 py-3" style={{ color: C.navy }}>{chart[s] ? `${chart[s]!.sleeve} cm` : '—'}</td>
                          <td className="px-2 py-3 text-xs font-semibold" style={{ color: match?.[s] && !match[s].ok ? '#b45309' : f?.color ?? C.navy }}>
                            {match?.[s] && !match[s].ok ? 'Not simulated' : f ? `${f.verdict} (${f.ease >= 0 ? '+' : ''}${f.ease.toFixed(0)} cm)` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs" style={{ color: C.navy, opacity: 0.6 }}>
                Tap a size to pick it. &quot;On your body&quot; = room at the chest between the simulated shirt and your body in the fitting room
                ({body.height} cm, chest {body.chest.toFixed(0)} cm).
              </p>

              <div className="mt-6 space-y-3">
                <div className="hidden md:block">
                  <TryOn can={!match?.[viewSize] || match[viewSize].ok} size={viewSize} why={notSimText('shirt', match?.[viewSize], 'Gon Tee')} onClick={() => onCheckFit(item, viewSize)} />
                </div>
                <button onClick={() => setStyle(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg px-6 py-3 font-semibold hover:opacity-90" style={{ backgroundColor: C.pink, color: C.navy }}>
                  <span className="text-lg">✨</span> AI Style Suggestion (weather)
                </button>
                <div className="rounded-lg p-4" style={{ backgroundColor: C.cream }}>
                  <p className="text-xs" style={{ color: C.navy, opacity: 0.7 }}>
                    💡 Chart from the brand. Every size was cloth-simulated on real body shapes, so &quot;Try it on&quot; shows how it
                    actually hangs, loose or tight, on your body.
                  </p>
                </div>
              </div>
            </div>
          </div>
          <div className="sticky bottom-0 z-10 -mx-5 mt-5 border-t bg-white px-5 pt-3 md:hidden" style={{ borderColor: C.peach, paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
            <TryOn can={!match?.[viewSize] || match[viewSize].ok} size={viewSize} why={notSimText('shirt', match?.[viewSize], 'Gon Tee')} onClick={() => onCheckFit(item, viewSize)} />
          </div>
        </div>
        {style && <StyleOverlay item={clothing} userProfile={profile} selectedSize={viewSize} onBack={() => setStyle(false)} />}
      </div>
    </div>
  );
}

// the item window's main button: opens the fitting room wearing this item in this size (or says why it can't)
function TryOn({ can, size, why, onClick }: { can: boolean; size: string; why: string; onClick: () => void }) {
  return (
    <div>
      <button onClick={onClick} disabled={!can}
        className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg px-6 font-semibold text-white hover:opacity-90" style={{ backgroundColor: C.navy, opacity: can ? 1 : 0.4 }}>
        <span className="text-lg">🪞</span> Try it on (size {size})
      </button>
      {!can && <p className="mt-2 text-xs" style={{ color: '#b45309' }}>{why}</p>}
    </div>
  );
}

// ─── pants window: 2D photos, 3D of each simulated size, size chart with the fit on your body, Try it on ───
export type PantsChart = { waist: number; hip: number; length: number; opening: number; rise?: number };
export type PantsSizeFit = { verdict: string; color: string; ease: number } | null;
export function PantsModal({ item, onClose, sizes, chart, fits, glb, size, body, note, onCheckFit, fav, onFav, match }: {
  item: LabItem | null; onClose: () => void; sizes: string[]; chart: Record<string, PantsChart>; fits: Record<string, PantsSizeFit>;
  fav?: boolean; onFav?: () => void; match?: Record<string, SizeMatch> | null;
  glb: (size: string) => string; size: string; body: { height: number; chest: number; waist: number }; note: string;
  onCheckFit: (it: LabItem, size: string) => void;
}) {
  const [view, setView] = useState<'2d' | '3d'>('2d');
  const [side, setSide] = useState<'front' | 'back'>('front');
  const [viewSize, setViewSize] = useState(size);
  useEffect(() => { setViewSize(sizes.includes(size) ? size : sizes[Math.min(1, sizes.length - 1)]); }, [item, size, sizes]);
  if (!item) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-label={item.name} className="relative flex max-h-[94dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <div className="overflow-y-auto px-5 pt-5 md:p-8">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex-1">
              <div className="mb-2 flex items-center gap-3">
                <span className="rounded-full px-3 py-1 text-xs font-bold" style={{ backgroundColor: C.pink, color: C.navy }}>{item.brand}</span>
                <span className="rounded-full px-3 py-1 text-xs font-bold" style={{ backgroundColor: C.peach, color: C.navy }}>Pants</span>
              </div>
              <h2 className="text-xl font-bold md:text-2xl" style={{ color: C.navy }}>{item.name}</h2>
            </div>
            <div className="flex shrink-0 gap-2">
              {onFav && <button onClick={onFav} aria-label={fav ? 'Remove from favourites' : 'Add to favourites'} className="flex h-10 w-10 items-center justify-center rounded-full text-lg hover:opacity-70" style={{ backgroundColor: C.cream, color: C.navy }}>{fav ? '⭐' : '☆'}</button>}
              <button onClick={onClose} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-full hover:opacity-70" style={{ backgroundColor: C.cream, color: C.navy }}>✕</button>
            </div>
          </div>

          <div className="mb-5 flex gap-2">
            {(['2d', '3d'] as const).map(m => (
              <button key={m} onClick={() => setView(m)} className="rounded-lg px-5 py-2 text-sm font-semibold transition-all"
                style={{ backgroundColor: view === m ? C.navy : C.cream, color: view === m ? 'white' : C.navy }}>
                {m === '2d' ? '🖼 2D View' : '📦 3D View'}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
            <div>
              {view === '2d' ? (
                <>
                  <div className="mb-3 flex gap-2">
                    {(['front', 'back'] as const).map(s => (
                      <button key={s} onClick={() => setSide(s)} className="flex-1 rounded-lg py-2 text-xs font-bold transition-all"
                        style={{ backgroundColor: side === s ? C.peach : C.cream, color: C.navy, border: `2px solid ${side === s ? C.navy : C.peach}` }}>
                        {s === 'front' ? '👖 Front' : '🔄 Back'}
                      </button>
                    ))}
                  </div>
                  <div className="flex h-[40dvh] items-center justify-center overflow-hidden rounded-xl sm:h-auto sm:aspect-[3/4]" style={{ backgroundColor: 'white', border: `2px solid ${C.peach}` }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={side === 'front' ? item.frontUrl : item.backUrl} alt={`${item.name} ${side}`} className="h-full w-full object-contain" />
                  </div>
                </>
              ) : (
                <>
                  <div className="mb-3 grid gap-2" style={{ gridTemplateColumns: `repeat(${sizes.length}, minmax(0, 1fr))` }}>
                    {sizes.map(s => (
                      <button key={s} onClick={() => setViewSize(s)} className="rounded-lg py-2 text-xs font-bold"
                        style={{ backgroundColor: viewSize === s ? C.navy : C.cream, color: viewSize === s ? 'white' : C.navy }}>{s}</button>
                    ))}
                  </div>
                  <Shirt3D item={item} size={viewSize} gridDir="" url={glb(viewSize)} label={`Size ${viewSize} as simulated on the 175 cm body · drag to rotate`} />
                </>
              )}
            </div>

            <div>
              <h3 className="mb-4 text-lg font-bold" style={{ color: C.navy }}>Size Chart</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ backgroundColor: C.cream }}>
                      {['Size', 'Waist (flat)', 'Hip (flat)', 'Length', 'Leg opening', 'On your body'].map(h => (
                        <th key={h} className="px-2 py-3 text-left text-xs font-bold" style={{ color: C.navy }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sizes.map(s => {
                      const f = fits[s], c = chart[s];
                      return (
                        <tr key={s} onClick={() => setViewSize(s)} className="cursor-pointer border-b" style={{ borderColor: C.peach, backgroundColor: s === viewSize ? C.pink + '30' : 'transparent' }}>
                          <td className="px-2 py-3 font-bold" style={{ color: C.navy }}>{s}</td>
                          <td className="whitespace-nowrap px-2 py-3" style={{ color: C.navy }}>{c?.waist} cm</td>
                          <td className="whitespace-nowrap px-2 py-3" style={{ color: C.navy }}>{c?.hip} cm</td>
                          <td className="whitespace-nowrap px-2 py-3" style={{ color: C.navy }}>{c?.length} cm</td>
                          <td className="whitespace-nowrap px-2 py-3" style={{ color: C.navy }}>{c?.opening} cm</td>
                          <td className="px-2 py-3 text-xs font-semibold" style={{ color: match?.[s] && !match[s].ok ? '#b45309' : f?.color ?? C.navy }}>
                            {match?.[s] && !match[s].ok ? 'Not simulated' : f ? `${f.verdict} (${f.ease >= 0 ? '+' : ''}${f.ease.toFixed(0)} cm)` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs" style={{ color: C.navy, opacity: 0.6 }}>
                Tap a size to pick it. &quot;On your body&quot; = waistband (2 × flat waist) minus your waist in the fitting room ({body.height} cm, waist {body.waist.toFixed(0)} cm).
              </p>
              <div className="mt-6 space-y-3">
                <div className="hidden md:block">
                  <TryOn can={!match?.[viewSize] || match[viewSize].ok} size={viewSize} why={notSimText('pants', match?.[viewSize], 'Xin jeans')} onClick={() => onCheckFit(item, viewSize)} />
                </div>
                <div className="rounded-lg p-4" style={{ backgroundColor: C.cream }}>
                  <p className="text-xs" style={{ color: C.navy, opacity: 0.7 }}>💡 {note}</p>
                </div>
              </div>
            </div>
          </div>
          <div className="sticky bottom-0 z-10 -mx-5 mt-5 border-t bg-white px-5 pt-3 md:hidden" style={{ borderColor: C.peach, paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
            <TryOn can={!match?.[viewSize] || match[viewSize].ok} size={viewSize} why={notSimText('pants', match?.[viewSize], 'Xin jeans')} onClick={() => onCheckFit(item, viewSize)} />
          </div>
        </div>
      </div>
    </div>
  );
}
