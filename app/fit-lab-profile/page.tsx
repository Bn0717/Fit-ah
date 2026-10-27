// app/fit-lab-profile/page.tsx
// "My fitting room": your body, your wardrobe and the Fit Lab physics try-on on one screen.
//   left   My body: measurements (around the body, like a tailor), a body scan from one front photo + height,
//          sliders that move the 3D body, and an explicit Save (unsaved changes are always visible)
//   centre the 3D try-on (app/fit-lab/FitViewer.tsx): what you are wearing, the fit verdict in plain words,
//          Fabric / Fit map, Catwalk
//   right  Wardrobe: Tops and Bottoms as expandable sections; tapping an item puts it on in the size that fits you
//          best, then size chips show how every size fits
// Honesty rule: anything that cannot be worn on this body, or was not simulated for it, is not drawn; the page
// says why instead. The navbar Profile tab (/profile) shows this page; the previous profile is at /profile-classic.
// Storage: the profile keeps chest and waist as half widths (other pages read them that way); this page shows and
// edits them around the body and converts when loading / saving.
'use client';

import { ModelSkeleton } from '@/components/ui/Skeleton';
import { FittingRoomSkeleton } from '@/components/ui/PageSkeletons';
import { useSizePreferences } from '../fit-lab/useSizePreferences';
import { SavedSizeControl } from '../fit-lab/SavedSizeControl';
import { initialSize, recommendedTop, recommendedBottom } from '../fit-lab/sizePreferences';
import { matchChart, type SizeChartData } from '../fit-lab/WardrobeExtras';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import FitViewer from '../fit-lab/FitViewer';
import { XIN_GRID_DIR } from '../fit-lab/xinAssets';
import { GRID_META_URL, PRODUCTS_INDEX_URL, TOPS_INDEX_URL, GON, XIN } from '../fit-lab/paths';
import { useTopColours, currentHex, ColourSwatches, pantsSwatches, pantsColourFiles, pantsTint, type PantsColours } from '../fit-lab/ColourSwatches';
import { SIZES, solveBody, shirtShapeOk, fitNumbers, clamp, fitTier, gridRange, withShirt, FIT_LEGEND, type Size, type ViewMode, type GridMeta, type ShirtProduct } from '../fit-lab/engine';
import { loadRef, makeTexture, type Ref, type Result } from '../fit-lab/colourway';
import { makePantsTexture, loadPantsRef, type PantsOutline } from '../fit-lab/pantsSwap';
import { jeansState, wornBody, type PantsData, type JeansState } from '../fit-lab/jeansFit';
import { syncWardrobe } from '../fit-lab/wardrobeCloud';
import { useAuth } from '@/lib/contexts/AuthContext';
import { getAvatar, saveAvatar, saveSkinTone } from '@/lib/firebase/firestore';
import { SKIN_TONES, isSkinTone, type SkinToneId } from '../fit-lab/skinTone';
import { useStored, type Outfit } from '../fit-lab/WardrobeExtras';
import { uploadUserPhoto } from '@/lib/firebase/storage';
import { scanBody, type ScanResult } from '@/lib/mediapipe/bodyScan';

const C = { cream: '#F8F3EA', navy: '#0B1957', peach: '#FFDBD1', pink: '#FA9EBC', ink: '#1f2a52', mute: '#6b7280',
  line: '#EDE4D8', green: '#10b981', amber: '#d97706', red: '#dc2626', blue: '#2563eb' };
const TONE = { red: C.red, amber: C.amber, green: C.green, blue: C.blue };
const CW_DIR = GON.colourway;
const PANTS_REF = XIN.outline;
const JEANS_SIZES = ['M', 'L', 'XL', '2XL'];

type Body = { height: number; chest: number; waist: number; shoulder: number; belly: number };   // cm around; belly -1..1
type Photos = { front: Result; back: Result };
type WItem = {
  id: string; name: string; brand: string; img: string; back?: string; group: 'tops' | 'bottoms';
  kind: 'gon' | 'shirt' | 'xin' | 'swap' | 'product' | 'unsim' | 'top';   // top = a shirt product (brands/tops.json)
  file?: { front: Blob; back: Blob };     // pants photo swap source photos
  dir?: string;                           // product folder
  chart?: SizeChartData;
  wearing?: string | null;                // size the user owns (from the wardrobe)
};
type Worn = { id: string; size: string } | null;

const toneOfTier = (tier: string) => tier === 'Regular' ? C.green : tier === 'Slim' || tier === 'Compression' ? C.amber : C.blue;

export default function MyFittingRoom() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const sizeRecords = useSizePreferences(user?.uid);
  useEffect(() => { if (!authLoading && !user) router.push('/login'); }, [user, authLoading, router]);

  // ── profile + body ─────────────────────────────────────────────────────────────
  const [profile, setProfile] = useState({ name: '', age: '', gender: '', photo: null as string | null });
  const [saved, setSaved] = useState<Body | null>(null);
  const [skinTone, setSkinTone] = useState<SkinToneId | null>(null);   // saved on its own, right away
  const [body, setBody] = useState<Body>({ height: 175, chest: 101, waist: 78, shoulder: 45, belly: 0 });
  const [fromScan, setFromScan] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // the wardrobe and outfits are the Wardrobe page's (/items = Fit Lab): same pieces, same hidden ones, same outfits
  const [outfits] = useStored<Outfit[]>('fitlab_outfits', []);
  const [loadingData, setLoadingData] = useState(true);
  useEffect(() => {
    if (!user) return;
    getAvatar(user.uid).then(p => {
      if (p) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const a = p as any;
        // stored as half widths; older test data can be junk (e.g. 30 cm "chest"): fall back to the 175 cm body
        const chest = a.chest > 35 && a.chest < 80 ? a.chest * 2 : 101, waist = a.waist > 25 && a.waist < 80 ? a.waist * 2 : 78;
        const b: Body = { height: a.height > 120 && a.height < 230 ? a.height : 175, chest, waist, shoulder: a.shoulder > 30 && a.shoulder < 65 ? a.shoulder : 45, belly: 0 };
        setSaved(b); setBody(b);
        setSkinTone(isSkinTone(a.skinTone) ? a.skinTone : null);
        setProfile({ name: a.displayName || '', age: a.age ? String(a.age) : '', gender: a.gender || '', photo: a.photoUrl || null });
      }
      setLoadingData(false);
    });
  }, [user]);
  const dirty = !!saved && (['height', 'chest', 'waist', 'shoulder', 'belly'] as const).some(k => Math.abs(saved[k] - body[k]) > 0.01);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2600); };
  const saveBody = async (b: Body = body) => {
    if (!user) return;
    setSaving(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await saveAvatar({ userId: user.uid, height: b.height, chest: b.chest / 2, waist: b.waist / 2, shoulder: b.shoulder, belly: 0,
        displayName: profile.name, age: parseInt(profile.age) || 0, gender: profile.gender, photoUrl: profile.photo } as any);
      setSaved(b); setBody(b); flash('Measurements saved');
    } finally { setSaving(false); }
  };

  // ── Fit Lab data ───────────────────────────────────────────────────────────────
  const [baseMeta, setMeta] = useState<GridMeta | null>(null);      // the body grid (+ the TNT Gon tee's numbers)
  const RANGE = gridRange(baseMeta);     // the simulated bodies (grows when grid bodies are added)
  // shirt products (brands/tops.json): their own sizes and simulated numbers, put over the body grid when worn
  const [topProducts, setTopProducts] = useState<Record<string, ShirtProduct>>({});
  const { chosen: topColour, pick: pickTopColour } = useTopColours();   // shared with the Wardrobe fitting room
  const [stored, setStored] = useState<{ id: string; name: string; brand: string; front: Blob; back: Blob; kind: 'shirt' | 'pants'; chart?: SizeChartData }[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string; brand: string; dir: string }[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    fetch(GRID_META_URL).then(r => r.json()).then(setMeta);
    fetch(PRODUCTS_INDEX_URL).then(r => r.json())
      .then(l => setProducts(l.filter((p: { hidden?: boolean }) => !p.hidden))).catch(() => setProducts([]));   // "hidden": not ready for shoppers yet
    fetch(TOPS_INDEX_URL).then(r => r.ok ? r.json() : []).then(async (l: { id: string; dir: string; hidden?: boolean }[]) => {
      const loaded = await Promise.all(l.filter(p => !p.hidden).map(p => fetch(`${p.dir}/product.json`).then(r => r.ok ? r.json() as Promise<ShirtProduct> : null).catch(() => null)));
      setTopProducts(Object.fromEntries(loaded.filter((p): p is ShirtProduct => !!p).map(p => [p.id, p])));
    }).catch(() => {});
    try { setHidden(JSON.parse(localStorage.getItem('fitlab_hidden') || '[]')); } catch { /* storage blocked */ }
  }, []);
  useEffect(() => {
    setStored([]);
    if (!user) return;
    let cancelled = false;
    syncWardrobe(user.uid, message => { if (!cancelled) setToast(message); }).then(rs => {
      if (!cancelled) setStored(rs.sort((a, b) => a.created - b.created).map(r => ({ id: r.id, name: r.name, brand: r.brand, front: r.front, back: r.back, kind: r.kind ?? 'shirt', chart: r.chart })));
    });
    return () => { cancelled = true; };
  }, [user?.uid]);
  const urls = useMemo(() => Object.fromEntries(stored.map(s => [s.id, { front: URL.createObjectURL(s.front), back: URL.createObjectURL(s.back) }])), [stored]);

  // ── wardrobe: Tops / Bottoms ───────────────────────────────────────────────────
  const wardrobe = useMemo<WItem[]>(() => {
    const list: WItem[] = [
      { id: 'gon', name: 'Gon Tee (green)', brand: 'TNT CO', img: GON.front, back: GON.back, group: 'tops', kind: 'gon' },
      { id: 'xin', name: '"Xin" Denim Biker Pants (grey)', brand: 'TNT CO', img: XIN.front, back: XIN.back, group: 'bottoms', kind: 'xin' },
      ...stored.map(s => ({ id: s.id, name: s.name, brand: s.brand, img: urls[s.id]?.front, back: urls[s.id]?.back, group: (s.kind === 'pants' ? 'bottoms' : 'tops') as WItem['group'],
        kind: (s.kind === 'pants' ? 'swap' : 'shirt') as WItem['kind'], chart: s.chart, file: { front: s.front, back: s.back } })),
      ...products.filter(p => p.id !== 'xin_check').map(p => ({ id: p.id, name: p.name, brand: p.brand, img: `${p.dir}/front.png`, back: `${p.dir}/back.png`, group: 'bottoms' as const, kind: 'product' as const, dir: p.dir })),
      ...Object.values(topProducts).map(p => ({ id: p.id, name: p.name, brand: p.brand, img: `${p.dir}/front.png`, back: `${p.dir}/back.png`, group: 'tops' as const, kind: 'top' as const, dir: p.dir })),
    ];
    return list.filter(i => !hidden.includes(i.id) && i.img);
  }, [stored, urls, products, hidden, topProducts]);
  const byId = useCallback((id: string | undefined) => wardrobe.find(w => w.id === id) ?? null, [wardrobe]);

  // ── what is being worn ─────────────────────────────────────────────────────────
  const [top, setTop] = useState<Worn>(null);
  const [bottom, setBottom] = useState<Worn>(null);
  const [belt, setBelt] = useState(false);
  const [mode, setMode] = useState<ViewMode>('fabric');
  const [walking, setWalking] = useState(false);
  const [walkStatus, setWalkStatus] = useState<string | null>(null);
  const preWalkBody = useRef<Body | null>(null);
  const topItem = byId(top?.id), bottomItem = byId(bottom?.id);
  const topProductOf = (it: WItem | null | undefined) => (it?.kind === 'top' && topProducts[it.id]) || null;
  const sizesOf = (it: WItem | null | undefined) => (topProductOf(it)?.sizes ?? SIZES) as Size[];
  // the body grid with the worn shirt's numbers (a shirt product's, or the Gon tee's): every fit below reads `meta`
  const meta = useMemo(() => baseMeta && withShirt(baseMeta, topProductOf(topItem)), [baseMeta, topItem, topProducts]);

  // shirt photos lined up with the 3D pattern (once per item)
  const cwRefs = useRef<Record<'front' | 'back', Ref> | null>(null);
  const [aligned, setAligned] = useState<Record<string, Photos | null | 'busy'>>({});
  useEffect(() => {
    const it = topItem;
    if (!it || it.kind === 'gon' || it.id in aligned) return;
    setAligned(a => ({ ...a, [it.id]: 'busy' }));
    (async () => {
      if (!cwRefs.current) {
        const info = await fetch(`${CW_DIR}/ref.json`).then(r => r.json());
        cwRefs.current = { front: await loadRef(`${CW_DIR}/ref_front_mask.png`, info.px_per_cm.front), back: await loadRef(`${CW_DIR}/ref_back_mask.png`, info.px_per_cm.back) };
      }
      const blob = (u: string) => fetch(u).then(r => r.blob());
      const f = await makeTexture(await blob(it.img), cwRefs.current.front);
      const b = await makeTexture(await blob(it.back || it.img), cwRefs.current.back);
      return { front: f, back: b };
    })().catch(() => null).then(p => setAligned(a => ({ ...a, [it.id]: p })));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topItem?.id]);
  const topPhotos = topItem && topItem.kind !== 'gon' ? aligned[topItem.id] : null;
  const photos = topPhotos && topPhotos !== 'busy' ? topPhotos : null;
  const outlineMatch = photos ? Math.min(photos.front.iou, photos.back.iou) : 1;

  // pants photo swaps: the photos drawn into the Xin texture frame
  const pantsRef = useRef<{ front: PantsOutline; back: PantsOutline } | null>(null);
  const [skins, setSkins] = useState<Record<string, { front: HTMLCanvasElement; back: HTMLCanvasElement } | null>>({});
  useEffect(() => {
    const it = bottomItem;
    if (!it || it.kind !== 'swap' || !it.file || it.id in skins) return;
    (async () => {
      pantsRef.current ||= await loadPantsRef(PANTS_REF);
      const f = await makePantsTexture(it.file!.front, pantsRef.current.front), b = await makePantsTexture(it.file!.back, pantsRef.current.back);
      return { front: f.canvas, back: b.canvas };
    })().catch(() => null).then(s => setSkins(x => ({ ...x, [it.id]: s })));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bottomItem?.id]);

  // products (other pants cuts): their own simulation data
  const [productData, setProductData] = useState<Record<string, PantsData & { dir: string }>>({});
  const [pantsColours, setPantsColours] = useState<Record<string, PantsColours>>({});   // pants products' colours
  useEffect(() => {
    let alive = true;
    Promise.all(products.map(async it => {
      try {
        const response = await fetch(`${it.dir}/product.json`);
        if (!response.ok) return null;
        const p = await response.json();
        if (p.colours) setPantsColours(c => ({ ...c, [it.id]: { id: it.id, dir: it.dir, colours: p.colours, base_colour: p.base_colour } }));
        return [it.id, { name: `${p.brand} ${p.name}`, sizes: p.belt, drop: p.drop, belt: p.belt, dir: it.dir, elasticStretch: p.elastic_stretch, walk: p.walk }] as const;
      } catch { return null; }
    })).then(entries => { if (alive) setProductData(Object.fromEntries(entries.filter((entry): entry is NonNullable<typeof entry> => !!entry))); });
    return () => { alive = false; };
  }, [products]);
  const pantsOf = (it: WItem | null): (PantsData & { dir: string }) | null =>
    !it || !meta ? null : it.kind === 'xin' || it.kind === 'swap' ? (meta.jeans ? { ...meta.jeans, dir: it.kind === 'xin' ? XIN_GRID_DIR : XIN.grid } : null) : it.kind === 'product' ? productData[it.id] ?? null : null;

  // ── the body on screen ─────────────────────────────────────────────────────────
  const simH = clamp(body.height, RANGE.height[0], RANGE.height[1]), simC = clamp(body.chest, RANGE.chest[0], RANGE.chest[1]);
  // shoulder / waist can only move within what was simulated for this height and chest (beyond it the 3D would be
  // stretched past the simulations): the 3D uses the nearest simulated value and the panel says so
  const sb0 = meta ? solveBody(meta, simH, simC, null, null, 0) : null;
  const wRange = sb0?.ok ? [Math.ceil(sb0.range.waist[0]), Math.floor(sb0.range.waist[1])] : [70, 90];
  const shRange = sb0?.ok ? [Math.ceil(sb0.range.shoulder[0] * 2) / 2, Math.floor(sb0.range.shoulder[1] * 2) / 2] : [42, 50];
  // Pants use the natural waist; keep the saved waist for shirt-only fitting.
  const natW = sb0?.ok ? sb0.natural.waist : null;
  const wornPants = bottom && bottomItem && bottomItem.kind !== 'unsim' ? pantsOf(bottomItem) : null;
  // a shirt simulated with shoulder / waist / belly changes only on some bodies: natural shape elsewhere (no guesses)
  const shirtLock = !!(top && meta && !shirtShapeOk(meta, simH, simC));
  const simS = shirtLock ? null : clamp(body.shoulder, shRange[0], shRange[1]);
  const wb = meta ? wornBody(meta, wornPants, bottom?.size ?? null, simH, simC, simS,
      shirtLock ? null : clamp(body.waist, wRange[0], wRange[1]), 0)
    : { waist: body.waist, belly: 0, lock: false, snap: false };
  const simW = wb.waist, simB = 0; // Natural belly only; simW null means natural waist.
  const walkCentre = meta?.body[meta.centre];
  const walkAvailable = !!meta?.walk && !!walkCentre && topItem?.kind !== 'top';   // shirt products: no catwalk simulated yet
  useEffect(() => { if (walking && !walkAvailable) setWalking(false); }, [walking, walkAvailable]);
  const toggleCatwalk = () => {
    if (walking) {
      setWalking(false);
      setBody(saved ?? preWalkBody.current ?? body);
      preWalkBody.current = null;
      setWalkStatus(null);
      return;
    }
    if (!meta || !walkCentre) return;
    preWalkBody.current = { ...body };
    const natural = solveBody(meta, walkCentre.height, walkCentre.chest, null, null, 0);
    setBody({ ...body, height: walkCentre.height, chest: walkCentre.chest,
      shoulder: walkCentre.shoulder ?? (natural.ok ? natural.natural.shoulder : body.shoulder),
      waist: natural.ok ? natural.natural.waist : body.waist, belly: 0 });
    setWalkStatus(null);
    setWalking(true);
  };
  const sb = meta ? solveBody(meta, simH, simC, simS, simW, simB) : null;
  const outside = [
    body.height < RANGE.height[0] || body.height > RANGE.height[1] ? `height (${RANGE.height[0]}–${RANGE.height[1]} cm)` : null,
    body.chest < RANGE.chest[0] || body.chest > RANGE.chest[1] ? `chest (${RANGE.chest[0]}–${RANGE.chest[1]} cm)` : null,
    sb0?.ok && (body.waist < wRange[0] - 0.5 || body.waist > wRange[1] + 0.5) ? `waist (${wRange[0]}–${wRange[1]} cm for this body)` : null,
    sb0?.ok && (body.shoulder < shRange[0] - 0.5 || body.shoulder > shRange[1] + 0.5) ? `shoulder (${shRange[0]}–${shRange[1]} cm for this body)` : null,
  ].filter(Boolean) as string[];

  // ── fit of every size ──────────────────────────────────────────────────────────
  // fitsFor: every size of a top on this body (a shirt product with its own numbers, or the Gon tee's)
  const fitsFor = (it: WItem | null | undefined) => {
    const m = baseMeta && withShirt(baseMeta, topProductOf(it));
    if (!m || !sb) return {} as Record<string, { label: string; tier: string; ease: number; color: string } | null>;
    return Object.fromEntries(sizesOf(it).map(sz => {
      const f = fitNumbers(m, sb, sz);
      if (!f.shirt) return [sz, null];
      const e = f.shirt.chest - f.body.chest, t = fitTier(e, f.body.chest);
      return [sz, { label: t.label, tier: t.tier, ease: e, color: toneOfTier(t.tier) }];
    })) as Record<string, { label: string; tier: string; ease: number; color: string } | null>;
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const topFits = useMemo(() => fitsFor(topItem), [meta, sb, topItem]);
  const topMatch = (it: WItem | null) => it?.chart && baseMeta ? matchChart('shirt', it.chart, baseMeta.chart) : null;   // colourway uploads reuse the Gon tee's cut
  const topSupported = (it: WItem | null, size: string) => { const match = topMatch(it); return !match || !!match[size]?.ok; };
  // a shirt designed oversized is recommended in the size that gives that look, not its smallest wearable size
  const topBest = (it: WItem | null) => {
    if (!saved || outside.length) return null;
    const fits = fitsFor(it), want = topProductOf(it)?.intended_fit;
    if (want) { const z = sizesOf(it).find(s => fits[s]?.label === want && topSupported(it, s)); if (z) return z; }
    return recommendedTop(sizesOf(it), size => fits[size], size => topSupported(it, size));
  };
  const jeansAt = useCallback((it: WItem | null, sz: string, withBelt: boolean): JeansState | null => {
    const P = pantsOf(it);
    return meta && P ? jeansState(meta, P, sz, withBelt, simH, simC, simS, null, 0) : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, productData, simH, simC, simS]);
  const bottomSizes = (it: WItem | null) => it?.kind === 'product' ? Object.keys(productData[it.id]?.sizes ?? {}) : JEANS_SIZES;
  // the smallest size whose waistband closes and that was simulated for this body (null: none fits / none simulated)
  const bottomSupported = (it: WItem | null, size: string) => {
    if (!it?.chart || !meta?.jeans) return true;
    const ref = Object.fromEntries(Object.entries(meta.jeans.sizes).map(([z, j]) => [z, { ...j.chart, waist: j.chart.elastic_waist ?? j.chart.waist }]));
    return !!matchChart('pants', it.chart, ref)[size]?.ok;
  };
  const bottomBest = (it: WItem | null) => !saved || outside.length || it?.kind === 'unsim' ? null : recommendedBottom(bottomSizes(it), size => jeansAt(it, size, false), size => bottomSupported(it, size));
  const recordSizes = (it: WItem) => it.chart ? Object.keys(it.chart) : it.group === 'tops' ? [...sizesOf(it)] : bottomSizes(it);
  const sizeRecord = (it: WItem, previewSize?: string) => ({ itemId: it.id, name: it.name, sizes: recordSizes(it), savedSize: sizeRecords.sizes[it.id], recommended: it.group === 'tops' ? topBest(it) : bottomBest(it), previewSize, onSave: sizeRecords.saveSize, syncError: sizeRecords.error });
  const js = bottom ? jeansAt(bottomItem, bottom.size, belt) : null;
  const P = pantsOf(bottomItem);
  const jeansUrl = bottom && js && P && bottomSupported(bottomItem, bottom.size) ? (js.variant === 'held' ? `${P.dir}/jeans_${bottom.size}.glb` : `${P.dir}/${js.variant}/jeans_${bottom.size}.glb`) : null;
  const topFit = top ? topFits[top.size] : null;
  const shirtNow = meta && sb && top && sizesOf(topItem).includes(top.size as Size) ? fitNumbers(meta, sb, top.size as Size) : null;

  // ── actions ────────────────────────────────────────────────────────────────────
  // tapping what you already wear takes it off (toggle); outfits only put things on
  const wear = (it: WItem, toggle = true) => {
    if (it.group === 'tops') {
      if (top?.id === it.id) { if (toggle) { setTop(null); setWalking(false); } return; }
      const supported = sizesOf(it).filter(size => topSupported(it, size));
      if (!supported.length) { flash('This item’s chart has no simulated sizes yet.'); setTop({ id: it.id, size: '' }); return; }
      setTop({ id: it.id, size: initialSize(sizeRecords.sizes[it.id], topBest(it), supported) });
    } else {
      if (bottom?.id === it.id) { if (toggle) { setBottom(null); setWalking(false); } return; }
      if (it.kind === 'unsim') { setBottom({ id: it.id, size: '' }); return; }
      const sizes = bottomSizes(it).filter(size => bottomSupported(it, size));
      setBottom({ id: it.id, size: initialSize(sizeRecords.sizes[it.id], bottomBest(it), sizes) }); setBelt(false);
    }
    setWalking(false);
  };
  // product sizes arrive after the item is chosen: pick its best size then
  useEffect(() => {
    if (bottomItem?.kind === 'product' && productData[bottomItem.id] && bottom && !productData[bottomItem.id].sizes[bottom.size]) setBottom({ id: bottomItem.id, size: initialSize(sizeRecords.sizes[bottomItem.id], bottomBest(bottomItem), bottomSizes(bottomItem).filter(size => bottomSupported(bottomItem, size))) });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productData, bottomItem?.id]);

  // ── body scan ──────────────────────────────────────────────────────────────────
  const [scan, setScan] = useState<{ photo: string | null; file?: File } | null>(null);
  const onProfilePhoto = (file: File) => {
    const r = new FileReader();
    r.onloadend = () => setScan({ photo: r.result as string, file });
    r.readAsDataURL(file);
  };
  const applyScan = async (res: Extract<ScanResult, { ok: true }>, edited: Partial<Body>, photoFile?: File, photoData?: string | null) => {
    const b: Body = { ...body, height: res.height, shoulder: res.shoulder, chest: res.chest, waist: res.waist, ...edited };
    let photo = profile.photo;
    if (photoFile && user) {
      const up = await uploadUserPhoto(user.uid, photoFile, 'profile').catch(() => null);
      photo = up?.url || photoData || photo;
      setProfile(p => ({ ...p, photo }));
    }
    setFromScan(true); setScan(null);
    if (!user) { setBody(b); return; }
    setSaving(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await saveAvatar({ userId: user.uid, height: b.height, chest: b.chest / 2, waist: b.waist / 2, shoulder: b.shoulder, belly: 0,
        displayName: profile.name, age: parseInt(profile.age) || 0, gender: profile.gender, photoUrl: photo } as any);
      setSaved(b); setBody(b); flash('Scan saved: your 3D body and measurements are updated');
    } finally { setSaving(false); }
  };

  // ── layout state ───────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<'tops' | 'bottoms' | 'outfits'>('tops');
  const [drawer, setDrawer] = useState(false);                // "My body"
  const [sheet, setSheet] = useState(false);                  // mobile wardrobe
  const [editProfile, setEditProfile] = useState(false);
  const [dismissedStart, setDismissedStart] = useState(false);
  // one layout at a time (each holds the 3D view; two would mean two 3D scenes):
  //   three  big screens: My body docked on the left, 3D in the middle, what you wear + wardrobe on the right
  //   two    laptops, landscape tablets and phones on their side: 3D + wardrobe panel, My body in a drawer
  //   phone  portrait phones and tablets: 3D on top, what you wear, then My body / Tops / Bottoms buttons
  const [layout, setLayout] = useState<'three' | 'two' | 'phone'>('two');
  const [navH, setNavH] = useState(61);                    // the page sits right under the navbar
  const [short, setShort] = useState(false);               // little height (phones on their side)
  useEffect(() => {
    const pick = () => {
      const w = window.innerWidth, h = window.innerHeight;
      setLayout(w >= 1280 && h >= 640 ? 'three' : w >= 1024 || (w > h && w >= 640) ? 'two' : 'phone');
      setShort(h < 560);
    };
    pick(); window.addEventListener('resize', pick);
    const nav = document.querySelector('nav'), ro = nav ? new ResizeObserver(() => setNavH(nav.getBoundingClientRect().height)) : null;
    if (nav && ro) { ro.observe(nav); setNavH(nav.getBoundingClientRect().height); }
    return () => { window.removeEventListener('resize', pick); ro?.disconnect(); };
  }, []);
  const wide = layout !== 'phone';
  const phone = layout === 'phone';
  const compact = phone || short;                          // what you wear: one line per piece
  const [drag, setDrag] = useState(0);                       // px the open wardrobe sheet is pulled down
  const dragFrom = useRef<number | null>(null);
  const dragNow = useRef(0);                                 // the same distance, readable the moment the finger lifts

  // opened from the dashboard's "Try it on": ?wear=<item id>&size=<size> puts that piece on in that size
  const wearLink = useRef<{ id: string; size: string } | null | undefined>(undefined);
  useEffect(() => {
    if (wearLink.current === undefined) {
      const q = new URLSearchParams(window.location.search), id = q.get('wear'), size = q.get('size');
      wearLink.current = id && size ? { id, size } : null;
    }
    const want = wearLink.current, it = want && wardrobe.find(w => w.id === want.id);
    if (!want || !it || !meta) return;                     // wait until the wardrobe and the simulations are loaded
    wearLink.current = null;
    if (it.group === 'tops') { setTop({ id: it.id, size: want.size }); setTab('tops'); }
    else { setBottom({ id: it.id, size: want.size }); setBelt(false); setTab('bottoms'); }
    setWalking(false);
    window.history.replaceState(null, '', window.location.pathname);   // a reload starts clean
  }, [wardrobe, meta]);

  if (authLoading || !user || loadingData) {
    return <FittingRoomSkeleton layout={layout} navHeight={navH} />;
  }

  // the body has never been set (or the saved numbers are outside the simulated bodies): invite to set it first
  const needsBody = !loadingData && (!saved || outside.length > 0);

  // ── "Now wearing": one compact row per item ─────────────────────────────────────
  const nowWearing = (top || bottom) ? (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {top && topItem && (
        <WornRow sizeRecord={sizeRecord(topItem, top.size)} compact={compact} title={topItem.name} img={topItem.img} onRemove={() => { setTop(null); setWalking(false); }}
          sizes={sizesOf(topItem).filter(sz => topSupported(topItem, sz)).map(sz => ({ size: sz, color: topFits[sz]?.color ?? '#d1d5db', hint: topFits[sz]?.label ?? 'not simulated', best: sz === topBest(topItem) }))}
          size={top.size} onSize={sz => setTop({ ...top, size: sz })}
          verdict={topFit ? { text: `${topFit.label} · ${topFit.ease >= 0 ? '+' : ''}${topFit.ease.toFixed(0)} cm room at the chest`, color: topFit.color }
            : topProductOf(topItem) ? { text: 'Not simulated for a body like yours yet, so it is not shown', color: C.mute } : null}
          note={topItem.kind === 'shirt' && topPhotos === 'busy' ? 'Lining the photos up with the 3D pattern…'
            : topItem.kind === 'shirt' && outlineMatch < 0.8 ? 'This looks like a different cut from the Gon Tee, so the 3D shape and sizes are the Gon Tee\'s.' : null}
          extra={topProductOf(topItem) ? <div className="mt-2"><ColourSwatches product={topProductOf(topItem)!} chosen={topColour} onPick={pickTopColour} size={24} /></div> : undefined} />
      )}
      {bottom && bottomItem && (bottomItem.kind === 'unsim' ? (
        <WornRow sizeRecord={sizeRecord(bottomItem, bottom.size)} compact={compact} title={bottomItem.name} img={bottomItem.img} onRemove={() => setBottom(null)} sizes={[]} size="" onSize={() => {}} verdict={null}
          note="Not simulated yet, so it is not shown on the body." alert />
      ) : (
        <WornRow sizeRecord={sizeRecord(bottomItem, bottom.size)} compact={compact} title={bottomItem.name} img={bottomItem.img} onRemove={() => { setBottom(null); setWalking(false); }}
          sizes={bottomSizes(bottomItem).filter(sz => bottomSupported(bottomItem, sz)).map(sz => { const s = jeansAt(bottomItem, sz, false); return {
            size: sz, color: !s || (s.noSim && !s.tooSmall && !s.cantPullOn) ? '#d1d5db' : s.hide ? C.red : TONE[s.now?.tone ?? 'green'], hint: s?.now?.label ?? 'not simulated', best: sz === bottomBest(bottomItem) }; })}
          size={bottom.size} onSize={sz => setBottom({ ...bottom, size: sz })}
          verdict={js?.now && !js.hide ? { text: js.now.label, color: TONE[js.now.tone] } : null}
          note={js?.hide ? js.reason : js?.now && js.now.lengthFit === 'pooling' ? `About ${js.now.extra.toFixed(0)} cm too long (piles up on the shoes).`
            : js?.now && js.now.lengthFit === 'short' ? `Too short: the hem ends ${js.now.hem.toFixed(0)} cm above the floor (the ankle shows).` : null}
          alert={!!js?.hide}
          extra={<>{pantsSwatches(pantsColours[bottomItem.id] ?? { id: '', dir: '' }) && !js?.hide && (
            <div className="mt-2"><ColourSwatches product={pantsSwatches(pantsColours[bottomItem.id])!} chosen={topColour} onPick={pickTopColour} size={24} /></div>)}
          {js?.hide && js.noSim && !js.elastic && !js.tooSmall && !js.cantPullOn && js.now && natW !== null ? (
            <button onClick={() => setBody({ ...body, waist: Math.round(natW), belly: 0 })} className="rounded-full border px-2.5 py-0.5 text-[11px] font-semibold"
              style={{ borderColor: C.navy, color: C.navy }}>See them with a natural waist</button>
          ) : js && !js.hide && !js.elastic && js.variant !== 'held' ? (
            <button onClick={() => setBelt(b => !b)} className="rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition"
              style={belt ? { background: C.navy, color: '#fff', borderColor: C.navy } : { borderColor: C.line, color: C.navy }}>
              {belt ? '✓ Belt' : '+ Belt'}
            </button>
          ) : null}</>} />
      ))}
      {/* compact rows show the colours as a line under each size; the key is only on roomy screens */}
      {!compact && <p className="flex w-full flex-nowrap gap-x-3 overflow-x-auto whitespace-nowrap text-[10px]" style={{ color: C.mute }}>
        {([[C.green, 'good fit'], [C.amber, 'snug / tight'], [C.blue, 'loose'], [C.red, 'tight / unavailable'], ['#d1d5db', 'not available yet']] as const).map(([c, l]) => <span key={l} className="flex shrink-0 items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: c }} />{l}</span>)}
      </p>}
    </div>
  ) : null;

  // ── wardrobe: Tops | Bottoms | Outfits ───────────────────────────────────────────
  const list = wardrobe.filter(w => w.group === tab);
  const wardrobeList = loadingData ? <div className="flex justify-center py-10"><Spinner /></div> : tab === 'outfits' ? (
    outfits.length === 0 ? <Empty icon="🧥" title="No outfits yet" text="Outfits you save on the Wardrobe page (♡ Save outfit) show up here." /> : (
      <div className="space-y-2">
        {outfits.map(o => {
          const t = o.top ? byId(o.top) : null, b = o.bottom ? byId(o.bottom) : null;
          const gone = (o.top && !t) || (o.bottom && !b);
          return (
            <button key={o.id} onClick={() => {
              setTop(t && o.topSize ? { id: t.id, size: o.topSize } : null);
              setBottom(b && o.bottomSize ? { id: b.id, size: o.bottomSize } : null);
              setBelt(!!o.belt); setWalking(false); setSheet(false);
              if (gone) flash('Part of this outfit was removed from the wardrobe');
            }} className="flex w-full items-center gap-3 rounded-xl border p-2 text-left transition hover:shadow-sm" style={{ borderColor: C.line, background: '#fff' }}>
              <div className="flex -space-x-3">{[t, b].filter(Boolean).map(i => <img key={i!.id} src={i!.img} alt="" className="h-12 w-12 rounded-lg border bg-white object-contain" style={{ borderColor: C.line }} crossOrigin="anonymous" />)}</div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold" style={{ color: C.navy }}>{o.name}</p>
                <p className="truncate text-xs" style={{ color: C.mute }}>{[t && o.topSize ? `Top ${o.topSize}` : null, b && o.bottomSize ? `Bottom ${o.bottomSize}${o.belt ? ' + belt' : ''}` : null].filter(Boolean).join(' · ') || 'Pieces removed'} · tap to try on</p>
              </div>
            </button>
          );
        })}
      </div>
    )
  ) : list.length === 0 ? (
    <Empty icon={tab === 'tops' ? '👕' : '👖'} title={tab === 'tops' ? 'No tops yet' : 'No bottoms yet'} text={tab === 'tops' ? 'Add tops on the Wardrobe page.' : 'Add bottoms on the Wardrobe page.'} />
  ) : (
    <div className={`grid gap-2 ${phone ? 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5' : 'grid-cols-3'}`}>
      {(() => { const off = !(tab === 'tops' ? top : bottom); return (
        <button onClick={() => { if (tab === 'tops') setTop(null); else setBottom(null); setWalking(false); setSheet(false); }} aria-pressed={off}
          title={tab === 'tops' ? 'No top' : 'No bottom'}
          className="relative flex aspect-[4/5] flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed bg-white transition hover:shadow-md" style={{ borderColor: off ? C.navy : C.line, color: off ? C.navy : C.mute }}>
          <span className="text-2xl">⦸</span><span className="text-[11px] font-semibold">{tab === 'tops' ? 'No top' : 'No bottom'}</span>
          {off && <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: C.navy }}>✓</span>}
        </button>); })()}
      {list.map(it => {
        const on = (tab === 'tops' ? top : bottom)?.id === it.id;
        return (
          <button key={it.id} onClick={() => { wear(it); setSheet(false); }} title={`${it.name} · ${it.brand}`} aria-pressed={on}
            className="group relative aspect-[4/5] overflow-hidden rounded-xl border-2 bg-white p-1.5 transition hover:shadow-md" style={{ borderColor: on ? C.navy : C.line }}>
            <img src={it.img} alt={it.name} className="h-full w-full object-contain transition group-hover:scale-105" crossOrigin="anonymous" />
            {on && <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: C.navy }}>✓</span>}
            <span className="absolute inset-x-1 bottom-1 rounded-md bg-white/95 px-1 py-0.5 text-[9px] leading-snug" style={{ color: C.navy }}>Recommended: {(it.group === 'tops' ? topBest(it) : bottomBest(it)) ?? 'Unavailable'} · Yours: {sizeRecords.sizes[it.id] ?? 'Not set'}</span>

          </button>
        );
      })}
    </div>
  );
  const rightPanel = (
    <div className={`flex h-full flex-col ${short ? 'overflow-y-auto' : ''}`}>
      {nowWearing && (
        <div className={`border-b px-4 ${short ? 'py-3' : 'py-4'}`} style={{ borderColor: C.line }}>
          <p className={`${short ? 'mb-2' : 'mb-3'} text-xs font-bold uppercase tracking-wide`} style={{ color: C.mute }}>Now wearing</p>
          {nowWearing}
        </div>
      )}
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <h2 className="text-base font-bold" style={{ color: C.navy }}>Wardrobe</h2>
      </div>
      <div className="px-4 pb-3">
        <Segmented value={tab} onChange={setTab} options={[['tops', `Tops ${wardrobe.filter(w => w.group === 'tops').length}`], ['bottoms', `Bottoms ${wardrobe.filter(w => w.group === 'bottoms').length}`], ['outfits', 'Outfits']]} full />
      </div>
      <div className={`px-4 pb-4 ${short ? '' : 'flex-1 overflow-y-auto'}`}>{wardrobeList}</div>
    </div>
  );

  // ── the 3D stage: only the body, plus small controls in the corners ──────────────
  const stage = (
    <div className="relative flex h-full w-full flex-col" style={{ background: C.cream }}>
      {meta ? (
        <FitViewer skinTone={skinTone} shirtColour={topProductOf(topItem) ? { product: topProductOf(topItem)!, hex: currentHex(topProductOf(topItem)!, topColour) } : null} shirtDir={topItem?.kind === 'top' && topItem.dir ? `${topItem.dir}/grid` : undefined} meta={meta} height={simH} chest={simC} shoulder={simS} waist={simW} belly={simB}
          size={(top?.size as Size) || 'M'} mode={mode} walking={walking} photos={photos} showShirt={!!top?.size && topSupported(topItem, top.size)}
          jeans={jeansUrl && bottom ? { url: jeansUrl, size: bottom.size, hidden: !!js?.hide, belt, elastic: js?.now?.elasticExtension != null && js.now.elasticLimit != null ? { extension: js.now.elasticExtension, limit: js.now.elasticLimit } : undefined, productWalk: P?.walk, builtinXin: bottomItem?.kind === 'xin', walk: bottomItem?.kind === 'xin' || bottomItem?.kind === 'swap',
            skin: bottomItem?.kind === 'swap' ? skins[bottomItem.id] ?? null : null,
            colour: bottomItem?.kind === 'product' && pantsColours[bottomItem.id] ? { files: pantsColourFiles(pantsColours[bottomItem.id], topColour), tint: pantsTint(pantsColours[bottomItem.id], topColour) } : null } : null}
          onWalking={w => { if (!w && walking) toggleCatwalk(); else if (w && !walking) toggleCatwalk(); }} onWalkStatus={setWalkStatus} className="min-h-0 w-full flex-1" />
      ) : <div className="min-h-0 flex-1"><ModelSkeleton /></div>}
      {/* top left: my body (the big-screen layout shows it docked on the left instead) */}
      {layout !== 'three' && <button onClick={() => setDrawer(true)} className="absolute left-3 top-3 flex max-w-[calc(100%-9.5rem)] items-center gap-2 rounded-full bg-white/95 py-1.5 pl-1.5 pr-3 text-xs shadow transition hover:shadow-md" style={{ color: C.navy }}>
        <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full" style={{ background: C.peach }}>
          {profile.photo ? <img src={profile.photo} alt="" className="h-full w-full object-cover" crossOrigin="anonymous" /> : '🧍'}
        </span>
        <span className="truncate font-semibold">{body.height} cm · chest {body.chest}</span>
        <span className="hidden sm:inline" style={{ color: C.mute }}>Edit</span>
        {dirty && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: C.amber }} title="Unsaved changes" />}
      </button>}
      {/* top right: views */}
      {(top || bottom) && meta && (
        <div className="absolute right-3 top-3 flex flex-col items-end gap-2">
          <ViewControls walkAvailable={walkAvailable} mode={mode} setMode={setMode} walking={walking} setWalking={toggleCatwalk} compact={!wide} />
          {mode === 'fit' && wide && <Legend />}
        </div>
      )}
      {/* first visit: set your body first */}
      {needsBody && !dismissedStart && !drawer && (
        <div className="absolute inset-x-3 bottom-3 mx-auto max-w-sm rounded-2xl bg-white p-4 shadow-xl">
          <p className="text-sm font-bold" style={{ color: C.navy }}>First, let&apos;s get your size</p>
          <p className="mt-0.5 text-xs" style={{ color: C.mute }}>{saved ? 'Your saved measurements are outside the bodies we have simulated.' : 'It takes a minute and every fit check uses it.'}</p>
          <div className="mt-3 flex gap-2">
            <button onClick={() => setScan({ photo: profile.photo })} className="flex-1 rounded-xl py-2 text-xs font-bold text-white" style={{ background: C.navy }}>📸 Scan my body</button>
            <button onClick={() => setDrawer(true)} className="flex-1 rounded-xl border py-2 text-xs font-semibold" style={{ borderColor: C.line, color: C.navy }}>Type measurements</button>
          </div>
          <button onClick={() => setDismissedStart(true)} className="mt-2 w-full text-center text-[11px]" style={{ color: C.mute }}>Later</button>
        </div>
      )}
      {!needsBody && !top && !bottom && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
          <span className="rounded-full bg-white/90 px-4 py-2 text-xs font-medium shadow" style={{ color: C.navy }}>{wide ? 'Pick something from your wardrobe →' : 'Tap Tops or Bottoms (or pull up) to try something on'}</span>
        </div>
      )}
      {walking && <p className={`absolute left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-3 py-1 text-[11px] shadow ${!wide && mode === 'fit' ? 'bottom-14' : 'bottom-3'}`} style={{ color: C.mute }}>{walkStatus || (bottom && P?.walk?.sizes.includes(bottom.size)
        ? `Walking in shorts ${bottom.size} on the 175 cm / chest 101 cm body${top && P.walk.layered[top.size as Size] === bottom.size ? ' · shirt simulated over the shorts' : ' · shirt uses its separate walk'}`
        : bottom && bottomItem && bottomItem.kind !== 'xin' && bottomItem.kind !== 'swap'
        ? `Catwalk replayed on the 175 cm body · ${bottomItem.name} not walked yet: basic pants shown`   // only the Xin jeans were walked
        : 'Catwalk replayed on the 175 cm body')}</p>}
      {mode === 'fit' && !wide && <div className="relative z-10 shrink-0 border-t bg-white px-2 py-1.5" style={{ borderColor: C.line }}><Legend below /></div>}
      {toast && <div className="absolute left-1/2 top-14 -translate-x-1/2 rounded-full px-4 py-2 text-xs font-semibold text-white shadow-lg" style={{ background: C.green }}>{toast}</div>}
    </div>
  );

  const bodyPanel = (docked: boolean) => (
    <BodyPanel body={body} setBody={b => { setBody(b); setFromScan(false); }} saved={saved} dirty={dirty} saving={saving} fromScan={fromScan}
      waistLocked={wb.lock || shirtLock} waistDisplay={wb.lock || shirtLock ? Math.round((sb?.natural.waist ?? body.waist) * 10) / 10 : body.waist}
      wRange={wRange} shRange={shRange} profile={profile} onClose={() => setDrawer(false)} docked={docked}
      wornNote={shirtLock ? `Shoulder and waist are shown natural for this height and chest: ${topItem?.name ?? 'this shirt'} has not been simulated with a different shape here yet. Your numbers are kept.`
        : wb.lock ? `Waist is shown natural while you wear ${bottomItem?.name ?? 'these pants'}. Your waist adjustment is available again when you take the pants off.` : null}
      onSave={() => saveBody()} onReset={() => saved && setBody(saved)} onScan={() => setScan({ photo: profile.photo })}
      onPhoto={onProfilePhoto} onEditProfile={() => setEditProfile(true)}
      range={RANGE} skinTone={skinTone} onSkinTone={async id => {
        setSkinTone(id);
        if (!user) return;
        const r = await saveSkinTone(user.uid, id);
        flash(r.success ? 'Skin tone saved' : 'Could not save the skin tone. Please try again.');
      }} />
  );
  const openSheet = (t: 'tops' | 'bottoms') => { setTab(t); setSheet(true); };
  // pull up the handle to open the wardrobe, pull the open sheet down to close it (the finger moves it as you drag)
  const pullUp = {
    onPointerDown: (e: React.PointerEvent) => { dragFrom.current = e.clientY; try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* keep dragging without capture */ } },
    onPointerMove: (e: React.PointerEvent) => { if (dragFrom.current !== null && dragFrom.current - e.clientY > 30) { dragFrom.current = null; setSheet(true); } },
    onPointerUp: () => { dragFrom.current = null; },
  };
  const pullDown = {
    onPointerDown: (e: React.PointerEvent) => { dragFrom.current = e.clientY; try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* keep dragging without capture */ } },
    onPointerMove: (e: React.PointerEvent) => { if (dragFrom.current !== null) { dragNow.current = Math.max(0, e.clientY - dragFrom.current); setDrag(dragNow.current); } },
    onPointerUp: () => { if (dragNow.current > 80) setSheet(false); dragFrom.current = null; dragNow.current = 0; setDrag(0); },
    onPointerCancel: () => { dragFrom.current = null; dragNow.current = 0; setDrag(0); },
  };

  return (
    // fixed under the navbar down to the bottom edge: phone browsers move a fixed bottom edge with their toolbars,
    // so the buttons at the bottom are never hidden behind them
    <div className="fixed inset-x-0 bottom-0 overflow-hidden" style={{ top: navH, background: C.cream }}>
      {layout === 'three' ? (
        <div className="grid h-full" style={{ gridTemplateColumns: 'clamp(280px, 22vw, 340px) minmax(0, 1fr) clamp(320px, 26vw, 400px)', gridTemplateRows: 'minmax(0, 1fr)' }}>
          <aside className="h-full overflow-y-auto border-r bg-white" style={{ borderColor: C.line }}>{bodyPanel(true)}</aside>
          <main className="relative h-full min-h-0 min-w-0 overflow-hidden">{stage}</main>
          <aside className="h-full overflow-hidden border-l bg-white" style={{ borderColor: C.line }}>{rightPanel}</aside>
        </div>
      ) : layout === 'two' ? (
        <div className="grid h-full" style={{ gridTemplateColumns: 'minmax(0, 1fr) clamp(280px, 36vw, 380px)', gridTemplateRows: 'minmax(0, 1fr)' }}>
          <main className="relative h-full min-h-0 min-w-0 overflow-hidden">{stage}</main>
          <aside className="h-full overflow-hidden border-l bg-white" style={{ borderColor: C.line }}>{rightPanel}</aside>
        </div>
      ) : (
        <div className="flex h-full flex-col">
          <div className="relative min-h-0 flex-1 overflow-hidden">{stage}</div>
          {/* phone: what you wear, then one tap to your body, tops or bottoms */}
          <div className="border-t bg-white px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))]" style={{ borderColor: C.line }}>
            <button {...pullUp} onClick={() => setSheet(true)} className="flex w-full touch-none flex-col items-center gap-0.5 pb-1.5 pt-1.5" aria-label="Open wardrobe (tap or pull up)">
              <span className="h-1.5 w-10 rounded-full bg-gray-300" />
              <span className="text-[10px] font-medium" style={{ color: C.mute }}>Pull up for wardrobe</span>
            </button>
            {nowWearing && <div className="mb-2 max-h-[28vh] overflow-y-auto">{nowWearing}</div>}
            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => setDrawer(true)} className="rounded-xl border-2 py-2.5 text-[13px] font-bold" style={{ borderColor: C.navy, color: C.navy }}>
                My body{dirty && <span className="ml-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: C.amber }} />}
              </button>
              <button onClick={() => openSheet('tops')} className="rounded-xl py-2.5 text-[13px] font-bold text-white" style={{ background: C.navy }}>Tops</button>
              <button onClick={() => openSheet('bottoms')} className="rounded-xl py-2.5 text-[13px] font-bold text-white" style={{ background: C.navy }}>Bottoms</button>
            </div>
          </div>
          {sheet && (
            <>
              <div className="absolute inset-0 z-30 bg-black/25" onClick={() => setSheet(false)} />
              <div className="absolute inset-x-0 bottom-0 z-40 mx-auto flex h-[75%] max-w-3xl flex-col rounded-t-3xl bg-white shadow-2xl" role="dialog" aria-label="Wardrobe"
                style={{ transform: `translateY(${drag}px)`, transition: drag ? 'none' : 'transform .2s ease-out' }}>
                <div className="flex items-center justify-between px-4 pb-1 pt-2">
                  <span className="w-8" /><span {...pullDown} className="flex h-6 flex-1 touch-none cursor-grab items-center justify-center" aria-hidden="true"><span className="h-1.5 w-10 rounded-full bg-gray-300" /></span>
                  <button onClick={() => setSheet(false)} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-gray-100" aria-label="Close wardrobe">✕</button>
                </div>
                <div className="px-4 pb-3"><Segmented value={tab} onChange={setTab} options={[['tops', 'Tops'], ['bottoms', 'Bottoms'], ['outfits', 'Outfits']]} full /></div>
                <div className="flex-1 overflow-y-auto px-4 pb-4">{wardrobeList}</div>
              </div>
            </>
          )}
        </div>
      )}
      {/* My body: a drawer, opened when needed (most people set it once) */}
      {drawer && layout !== 'three' && (
        <>
          <div className="absolute inset-0 z-[60] bg-black/25" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 z-[70] w-full max-w-[360px] overflow-y-auto bg-white shadow-2xl" role="dialog" aria-label="My body">
            {bodyPanel(false)}
          </div>
        </>
      )}
      {scan && <ScanDialog photo={scan.photo} file={scan.file} height={saved?.height ?? body.height} onClose={() => setScan(null)} onApply={async (...a) => { await applyScan(...a); setDrawer(false); }} />}
      {editProfile && <ProfileDialog profile={profile} onClose={() => setEditProfile(false)} onSave={async p => {
        if (!user) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await saveAvatar({ userId: user.uid, height: (saved ?? body).height, chest: (saved ?? body).chest / 2, waist: (saved ?? body).waist / 2, shoulder: (saved ?? body).shoulder, belly: 0,
          displayName: p.name, age: parseInt(p.age) || 0, gender: p.gender, photoUrl: profile.photo } as any);
        setProfile(x => ({ ...x, ...p })); setEditProfile(false); flash('Profile saved');
      }} />}
    </div>
  );
}

// ─── left panel: my body ────────────────────────────────────────────────────────────
function BodyPanel({ body, setBody, saved, dirty, saving, fromScan, wRange, shRange, profile, wornNote, waistLocked, waistDisplay, onSave, onReset, onScan, onPhoto, onEditProfile, onClose, docked, skinTone, onSkinTone, range: RANGE }: {
  body: Body; setBody: (b: Body) => void; saved: Body | null; dirty: boolean; saving: boolean; fromScan: boolean; wornNote?: string | null;
  wRange: number[]; shRange: number[]; waistLocked: boolean; waistDisplay: number;
  profile: { name: string; age: string; gender: string; photo: string | null };
  onSave: () => void; onReset: () => void; onScan: () => void; onPhoto: (f: File) => void; onEditProfile: () => void; onClose: () => void;
  docked?: boolean;    // always on screen (big screens): no close button
  skinTone: SkinToneId | null; onSkinTone: (id: SkinToneId | null) => void;
  range: { height: [number, number]; chest: [number, number] };
}) {
  const set = (k: keyof Body) => (v: number) => setBody({ ...body, [k]: v });
  const pm = (v: number) => fromScan ? v : undefined;
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-4" style={{ borderColor: C.line }}>
        <label className="relative h-12 w-12 flex-shrink-0 cursor-pointer overflow-hidden rounded-full border-2" style={{ borderColor: C.peach, background: C.cream }} title="Change photo (we will offer to scan your body from it)">
          {profile.photo ? <img src={profile.photo} alt="" className="h-full w-full object-cover" crossOrigin="anonymous" /> : <span className="flex h-full items-center justify-center text-xl">🧍</span>}
          <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onPhoto(f); e.target.value = ''; }} />
        </label>
        <button onClick={onEditProfile} className="min-w-0 flex-1 text-left">
          <p className="truncate text-sm font-bold" style={{ color: C.navy }}>{profile.name || 'My body'}</p>
          <p className="truncate text-xs" style={{ color: C.mute }}>{profile.name ? 'Edit details' : 'Add your name'}</p>
        </button>
        {!docked && <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-gray-100" aria-label="Close">✕</button>}
      </div>
      <div className="px-4 pt-4">
        <button onClick={onScan} className="flex w-full items-center gap-3 rounded-2xl p-3 text-left text-white shadow-md transition hover:opacity-95" style={{ background: C.navy }}>
          <span className="text-xl">📸</span>
          <span><span className="block text-sm font-bold">Scan my body</span><span className="block text-[11px] opacity-80">Your height + one full-body photo</span></span>
        </button>
        <p className="mt-3 text-center text-[11px]" style={{ color: C.mute }}>or adjust by hand (cm, around the body)</p>
      </div>
      <div className="flex-1 space-y-5 px-4 py-4">
        <Measure label="Height" value={body.height} min={RANGE.height[0]} max={RANGE.height[1]} typeMin={140} typeMax={210} onChange={set('height')} />
        <Measure label="Chest" value={body.chest} min={RANGE.chest[0]} max={RANGE.chest[1]} typeMin={70} typeMax={150} onChange={set('chest')} pm={pm(7)} />
        <Measure label="Waist" disabled={waistLocked} value={waistDisplay} min={wRange[0]} max={wRange[1]} typeMin={55} typeMax={150} onChange={set('waist')} pm={pm(7)} />
        {wornNote && <p className="rounded-lg px-3 py-2 text-[11px]" style={{ background: C.cream, color: C.mute }}>{wornNote}</p>}
        <Measure label="Shoulder" value={body.shoulder} min={shRange[0]} max={shRange[1]} typeMin={35} typeMax={60} onChange={set('shoulder')} pm={pm(2.5)} />
        <SkinTonePicker value={skinTone} onChange={onSkinTone} />
      </div>
      <div className="sticky bottom-0 border-t bg-white px-4 py-3" style={{ borderColor: C.line }}>
        {dirty ? (
          <div className="flex items-center gap-2">
            <span className="flex-1 text-[11px] font-medium" style={{ color: C.amber }}>● Not saved yet</span>
            <button onClick={onReset} className="rounded-xl px-3 py-2 text-xs font-semibold" style={{ color: C.navy }}>Undo</button>
            <button onClick={onSave} disabled={saving} className="rounded-xl px-5 py-2 text-xs font-bold text-white disabled:opacity-60" style={{ background: C.navy }}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        ) : <p className="text-center text-[11px]" style={{ color: C.mute }}>{saved ? '✓ Saved' : 'Not set yet'}</p>}
      </div>
    </div>
  );
}

// Skin tone of the 3D body: the Monk Skin Tone Scale (10 tones) or the model's own skin. Saved as soon as it is tapped.
function SkinTonePicker({ value, onChange }: { value: SkinToneId | null; onChange: (id: SkinToneId | null) => void }) {
  return (
    <div role="radiogroup" aria-label="Skin tone of your 3D body">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs font-semibold" style={{ color: C.ink }}>Skin tone</span>
        <button role="radio" aria-checked={value === null} onClick={() => onChange(null)} className="rounded-md px-1 text-[11px] font-semibold"
          style={{ color: value === null ? C.navy : C.mute, textDecoration: value === null ? 'underline' : 'none' }}>Original</button>
      </div>
      <div className="grid grid-cols-10 gap-1">
        {SKIN_TONES.map((t, i) => (
          <button key={t.id} role="radio" aria-checked={value === t.id} aria-label={`Skin tone ${i + 1} of ${SKIN_TONES.length}`} title={`Tone ${i + 1}`}
            onClick={() => onChange(t.id)} className="aspect-square w-full rounded-full transition"
            style={{ background: t.hex, boxShadow: value === t.id ? `0 0 0 2px #fff, 0 0 0 4px ${C.navy}` : 'inset 0 0 0 1px rgba(0,0,0,0.12)' }} />
        ))}
      </div>
      <p className="mt-1 text-[10px]" style={{ color: C.mute }}>Monk Skin Tone Scale. Only changes how your 3D body looks, not the fit.</p>
    </div>
  );
}

function Measure({ label, value, min, max, typeMin, typeMax, onChange, pm, disabled = false }: {
  label: string; value: number; min: number; max: number; typeMin: number; typeMax: number; onChange: (v: number) => void; pm?: number; disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  useEffect(() => { if (disabled) setEditing(false); }, [disabled]);
  const out = value < min - 0.25 || value > max + 0.25;
  return (
    <fieldset disabled={disabled} className="min-w-0 disabled:opacity-50">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-semibold" style={{ color: C.ink }}>{label}</span>
        {editing ? (
          <input autoFocus value={text} onChange={e => setText(e.target.value)} inputMode="decimal"
            onBlur={() => { const v = parseFloat(text); if (v >= typeMin && v <= typeMax) onChange(Math.round(v * 2) / 2); setEditing(false); }}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(false); }}
            className="w-20 rounded-md border px-2 py-0.5 text-right text-sm font-bold" style={{ borderColor: C.navy, color: C.navy }} />
        ) : (
          <button onClick={() => { setText(String(value)); setEditing(true); }} className="rounded-md px-1 text-sm font-bold tabular-nums hover:bg-gray-50" style={{ color: C.navy }} title="Tap to type">
            {value}{pm !== undefined && <span className="text-[11px] font-normal" style={{ color: C.mute }}> ±{pm}</span>} <span className="text-[11px] font-normal" style={{ color: C.mute }}>cm</span>
          </button>
        )}
      </div>
      <input type="range" min={min} max={max} step={0.5} value={clamp(value, min, max)} onChange={e => onChange(Number(e.target.value))} className="w-full" style={{ accentColor: C.navy }} aria-label={label} />
      {out && <p className="mt-0.5 text-[10px]" style={{ color: C.amber }}>Outside our simulated bodies — the 3D uses {clamp(value, min, max)} cm.</p>}
    </fieldset>
  );
}

// ─── what you are wearing: one row per item ─────────────────────────────────────────
function WornRow({ title, img, sizes, size, onSize, verdict, note, onRemove, extra, alert, compact, sizeRecord }: {
  title: string; img: string; sizes: { size: string; color: string; hint: string; best: boolean }[]; size: string; onSize: (s: string) => void;
  verdict: { text: string; color: string } | null; note: string | null; onRemove: () => void; extra?: React.ReactNode; alert?: boolean;
  sizeRecord?: React.ComponentProps<typeof SavedSizeControl>;
  compact?: boolean;   // phones: picture, name and sizes on one line, the verdict (or a warning) on one line below
}) {
  if (compact) return (
    <div>
      <div className="flex items-center gap-2">
        <img src={img} alt="" className="h-8 w-8 shrink-0 rounded-lg border bg-white object-contain" style={{ borderColor: C.line }} crossOrigin="anonymous" />
        <p className="min-w-0 flex-1 truncate text-xs font-semibold" style={{ color: C.navy }}>{title}</p>
        {sizes.length > 0 && (
          <div className="flex shrink-0 gap-1" role="group" aria-label={`Sizes of ${title}`}>
            {sizes.map(s => (
              <button key={s.size} onClick={() => onSize(s.size)} title={`${s.hint}${sizeRecord?.savedSize === s.size ? ' · Your saved size' : ''}`} aria-pressed={size === s.size}
                className="relative flex h-7 min-w-[30px] items-center justify-center rounded-md border px-1 text-[11px] font-bold"
                style={size === s.size ? { background: C.navy, borderColor: C.navy, color: '#fff' } : { borderColor: C.line, color: C.navy, background: '#fff', boxShadow: `inset 0 -2px 0 ${s.color}` }}>
                {s.size}
                {sizeRecord?.savedSize === s.size && <span className="absolute -bottom-1 -right-1 h-2 w-2 rounded-full border border-white" style={{ background: C.pink }} title="Your saved size" />}
                {s.best && <span className="absolute -top-1.5 right-[-3px] h-2.5 w-2.5 rounded-full border-2 border-white" style={{ background: C.green }} title="Best size" />}
              </button>
            ))}
          </div>
        )}
        <button onClick={onRemove} className="flex h-7 w-6 shrink-0 items-center justify-center rounded-full text-xs hover:bg-gray-100" style={{ color: C.mute }} aria-label={`Take off ${title}`}>✕</button>
      </div>
      {(verdict || note || extra) && (
        <div className="mt-1 flex items-center gap-2 pl-10">
          <p className={`min-w-0 flex-1 truncate text-[11px] ${alert ? 'font-semibold' : ''}`} style={{ color: alert ? '#991b1b' : verdict?.color ?? C.mute }} title={note ?? undefined}>
            {alert && note ? note : verdict?.text ?? note}
          </p>
        </div>
      )}
      {extra && <div className="mt-1 min-w-0 pl-10">{extra}</div>}{/* own full-width line: colour swatches / buttons wrap instead of running off a phone screen */}
      {sizeRecord && <details className="mt-2 pl-10 text-[10px]" style={{ color: C.navy }}><summary className="cursor-pointer py-1">Recommended: {sizeRecord.recommended ?? 'Unavailable'} · Your size: {sizeRecord.savedSize ?? 'Not set'} · Edit</summary><SavedSizeControl {...sizeRecord} /></details>}
    </div>
  );
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <img src={img} alt="" className="h-9 w-9 rounded-lg border bg-white object-contain" style={{ borderColor: C.line }} crossOrigin="anonymous" />
        <p className="min-w-0 flex-1 truncate text-xs font-semibold" style={{ color: C.navy }}>{title}</p>
        <button onClick={onRemove} className="flex h-6 w-6 items-center justify-center rounded-full text-xs hover:bg-gray-100" style={{ color: C.mute }} aria-label={`Take off ${title}`}>✕</button>
      </div>
      {extra && <div className="min-w-0">{extra}</div>}{/* own line: the name keeps its room, swatches / buttons wrap */}
      {sizes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {sizes.map(s => (
            <button key={s.size} onClick={() => onSize(s.size)} title={`${s.hint}${sizeRecord?.savedSize === s.size ? ' · Your saved size' : ''}`}
              className="relative flex min-w-[46px] items-center justify-center gap-1 rounded-lg border-2 px-2 py-1 text-xs font-bold transition"
              style={size === s.size ? { background: C.navy, borderColor: C.navy, color: '#fff' } : { borderColor: C.line, color: C.navy, background: '#fff' }}>
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.size}
              {sizeRecord?.savedSize === s.size && <span className="absolute -bottom-1 -right-1 h-2 w-2 rounded-full border border-white" style={{ background: C.pink }} title="Your saved size" />}
                {s.best && <span className="absolute -top-2 right-[-4px] rounded-full px-1 text-[8px] font-bold text-white" style={{ background: C.green }}>BEST</span>}
            </button>
          ))}
        </div>
      )}
      {verdict && <p className="text-xs font-semibold" style={{ color: verdict.color }}>{verdict.text}</p>}
      {note && <p className={`text-[11px] leading-snug ${alert ? 'rounded-lg px-2 py-1.5' : ''}`} style={alert ? { background: '#fef2f2', color: '#991b1b' } : { color: C.mute }}>{note}</p>}
      {sizeRecord && <SavedSizeControl {...sizeRecord} />}
    </div>
  );
}

function ViewControls({ mode, setMode, walking, setWalking, compact, walkAvailable }: { walkAvailable: boolean; mode: ViewMode; setMode: (m: ViewMode) => void; walking: boolean; setWalking: (w: boolean) => void; compact?: boolean }) {
  return (
    <div className={`flex items-center gap-2 ${compact ? 'flex-col items-end' : ''}`}>
      <Segmented value={mode} onChange={setMode} options={[['fabric', 'Fabric'], ['fit', 'Fit map']]} />
      <button disabled={!walking && !walkAvailable} title={walkAvailable ? undefined : "Catwalk is available on the 175 cm / chest 101 cm body"} onClick={() => setWalking(!walking)} className="rounded-full px-4 py-1.5 text-xs font-bold shadow disabled:opacity-50"
        style={walking ? { background: C.pink, color: C.navy } : { background: C.navy, color: '#fff' }}>{walking ? '■ Stop' : walkAvailable ? '▶ Catwalk' : 'Catwalk · 175 cm only'}</button>
    </div>
  );
}

function Legend({ below = false }: { below?: boolean } = {}) {
  return (
    <div className={`${below ? 'w-full overflow-hidden' : 'w-56 max-w-[calc(100vw-1.5rem)] overflow-x-auto'} rounded-xl bg-white px-3 py-2 text-[10px] shadow`} style={{ color: C.navy }}>
      <span className={`${below ? 'sr-only' : 'mb-1 block'} opacity-60`}>Estimated fit</span>
      <div className={below ? 'flex w-full flex-nowrap justify-between gap-x-0.5 whitespace-nowrap text-[clamp(8px,2vw,12px)]' : 'flex w-max flex-nowrap gap-x-3 whitespace-nowrap'}>
        {FIT_LEGEND.map(([c, l]) => <span key={l} title={l} className={`flex items-center ${below ? 'min-w-0 gap-0.5' : 'shrink-0 gap-1'}`}><span className={`inline-block shrink-0 rounded-sm border ${below ? 'h-2 w-2' : 'h-2.5 w-2.5'}`} style={{ background: c, borderColor: '#ddd' }} /><span className={below ? 'truncate' : ''}>{l}</span></span>)}
      </div>
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options, full }: { value: T; onChange: (v: T) => void; options: [T, string][]; full?: boolean }) {
  return (
    <div className={`flex rounded-full p-0.5 shadow-sm ${full ? 'w-full' : ''}`} style={{ background: '#fff', border: `1px solid ${C.line}` }}>
      {options.map(([v, l]) => (
        <button key={v} onClick={() => onChange(v)} className={`rounded-full px-3 py-1 text-xs font-semibold transition ${full ? 'flex-1' : ''}`}
          style={value === v ? { background: C.navy, color: '#fff' } : { color: C.navy }}>{l}</button>
      ))}
    </div>
  );
}

function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="h-7 w-7 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: C.navy, borderTopColor: 'transparent' }} />
      {label && <p className="text-xs font-medium" style={{ color: C.navy }}>{label}</p>}
    </div>
  );
}

function Empty({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl text-2xl" style={{ background: C.peach }}>{icon}</span>
      <p className="text-sm font-semibold" style={{ color: C.navy }}>{title}</p>
      <p className="max-w-[220px] text-xs" style={{ color: C.mute }}>{text}</p>
    </div>
  );
}

// ─── body scan: height first, then one front photo, then confirm ───────────────────────
function ScanDialog({ photo, file, height, onClose, onApply }: {
  photo: string | null; file?: File; height: number; onClose: () => void;
  onApply: (r: Extract<ScanResult, { ok: true }>, edited: Partial<Body>, file?: File, photoData?: string | null) => Promise<void>;
}) {
  const [h, setH] = useState(String(height || ''));
  const [img, setImg] = useState<string | null>(photo);
  const [imgFile, setImgFile] = useState<File | undefined>(file);
  const [state, setState] = useState<'ready' | 'scanning' | 'done' | 'error'>('ready');
  const [res, setRes] = useState<ScanResult | null>(null);
  const [edit, setEdit] = useState<Partial<Body>>({});
  const [applying, setApplying] = useState(false);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const hv = parseFloat(h), hOk = hv >= 120 && hv <= 230;
  const pick = (f: File) => { const r = new FileReader(); r.onloadend = () => { setImg(r.result as string); setImgFile(f); setState('ready'); setRes(null); }; r.readAsDataURL(f); };
  const run = async () => {
    if (!img || !hOk) return;
    setState('scanning'); setRes(null); setEdit({});
    const el = new Image(); el.crossOrigin = 'anonymous';
    try {
      await new Promise<void>((ok, bad) => { el.onload = () => ok(); el.onerror = bad; el.src = img; });
      const r = await scanBody(el, hv);
      setRes(r); setState(r.ok ? 'done' : 'error');
    } catch { setRes({ ok: false, problem: 'failed', message: 'This photo could not be opened. Try another one.' }); setState('error'); }
  };
  // a new photo with a known height scans straight away
  useEffect(() => { if (img && hOk && state === 'ready' && file) run(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const ok = res && res.ok ? res : null;
  const val = (k: 'chest' | 'waist' | 'shoulder') => edit[k] ?? (ok ? ok[k] : 0);
  return (
    <div className="fixed inset-0 z-[500] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl" onClick={e => e.stopPropagation()} role="dialog" aria-label="Scan my body">
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: C.line }}>
          <div><h2 className="text-base font-bold" style={{ color: C.navy }}>Scan my body</h2><p className="text-xs" style={{ color: C.mute }}>Runs on your device — your photo is not uploaded for the scan.</p></div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-gray-100" aria-label="Close">✕</button>
        </div>
        <div className="space-y-5 px-5 py-4">
          <div>
            <p className="mb-1.5 text-xs font-bold" style={{ color: C.navy }}>1 · Your height</p>
            <div className="flex items-center gap-2">
              <input value={h} onChange={e => setH(e.target.value)} inputMode="decimal" placeholder="e.g. 175" className="w-32 rounded-xl border px-3 py-2 text-sm font-semibold outline-none focus:ring-2"
                style={{ borderColor: hOk || !h ? C.line : C.red, color: C.navy }} aria-label="Height in cm" />
              <span className="text-sm" style={{ color: C.mute }}>cm, without shoes</span>
            </div>
            <p className="mt-1 text-[11px]" style={{ color: C.mute }}>A photo has no scale, so your height is what turns the photo into centimetres.</p>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-bold" style={{ color: C.navy }}>2 · A full-body photo, facing the camera</p>
            <div className="flex gap-3">
              <label className="relative flex h-40 w-28 flex-shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed" style={{ borderColor: C.peach, background: C.cream }}>
                {img ? <img src={img} alt="" className="h-full w-full object-contain" /> : <span className="text-center text-xs" style={{ color: C.mute }}>Tap to choose<br />a photo</span>}
                <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ''; }} />
              </label>
              <ul className="space-y-1 text-[11px] leading-snug" style={{ color: C.ink }}>
                <li>✓ Whole body in the picture, head to feet</li>
                <li>✓ Fitted clothes (baggy clothes add centimetres)</li>
                <li>✓ Arms slightly away from your sides</li>
                <li>✓ Camera at waist height, 2–3 m away</li>
                <li>✓ Plain background, good light</li>
              </ul>
            </div>
          </div>
          {state === 'scanning' && <div className="flex items-center gap-3 rounded-xl px-3 py-3" style={{ background: C.cream }}><Spinner /><span className="text-xs font-medium" style={{ color: C.navy }}>Finding your body outline…</span></div>}
          {res && !res.ok && (
            <div className="rounded-xl px-3 py-3 text-xs" style={{ background: '#fef2f2', color: '#991b1b' }}>
              <p className="font-semibold">We couldn&apos;t measure this photo</p><p className="mt-0.5">{res.message}</p>
              <p className="mt-1" style={{ color: C.mute }}>You can also close this and type your measurements on the left.</p>
            </div>
          )}
          {ok && (
            <div className="space-y-2">
              <p className="text-xs font-bold" style={{ color: C.navy }}>3 · Check your results</p>
              <div className="grid grid-cols-3 gap-2">
                {(['chest', 'waist', 'shoulder'] as const).map(k => (
                  <label key={k} className="rounded-xl border p-2 text-center" style={{ borderColor: C.line }}>
                    <span className="block text-[10px] font-semibold uppercase tracking-wide" style={{ color: C.mute }}>{k}</span>
                    <input value={val(k)} onChange={e => setEdit(x => ({ ...x, [k]: parseFloat(e.target.value) || 0 }))} inputMode="decimal"
                      className="w-full bg-transparent text-center text-lg font-bold outline-none" style={{ color: C.navy }} />
                    <span className="block text-[10px]" style={{ color: C.mute }}>±{ok.plusMinus[k]} cm</span>
                  </label>
                ))}
              </div>
              <p className="text-[11px]" style={{ color: C.mute }}>Hips {ok.hip} cm (±{ok.plusMinus.hip}). Chest and waist are estimated from your width in the photo; if you know them from a tape measure, type them in.</p>
              {ok.notes.map(n => <p key={n} className="text-[11px]" style={{ color: C.amber }}>• {n}</p>)}
            </div>
          )}
        </div>
        <div className="flex gap-2 border-t px-5 py-4" style={{ borderColor: C.line }}>
          <button onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-semibold" style={{ color: C.navy }}>Cancel</button>
          {ok ? (
            <button disabled={applying} onClick={async () => { setApplying(true); try { await onApply(ok, edit, imgFile, imgFile ? img : null); } finally { setApplying(false); } }}
              className="flex-1 rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-60" style={{ background: C.navy }}>{applying ? 'Saving…' : 'Save these measurements'}</button>
          ) : (
            <button disabled={!img || !hOk || state === 'scanning'} onClick={run} className="flex-1 rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-40" style={{ background: C.navy }}>
              {!hOk ? 'Type your height first' : !img ? 'Choose a photo' : state === 'error' ? 'Try again' : 'Scan'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ProfileDialog({ profile, onClose, onSave }: { profile: { name: string; age: string; gender: string }; onClose: () => void; onSave: (p: { name: string; age: string; gender: string }) => Promise<void> }) {
  const [p, setP] = useState({ name: profile.name, age: profile.age, gender: profile.gender });
  const [busy, setBusy] = useState(false);
  const field = 'w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2';
  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm space-y-3 rounded-3xl bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()} role="dialog" aria-label="Edit profile">
        <h2 className="text-base font-bold" style={{ color: C.navy }}>Your details</h2>
        <label className="block text-xs font-semibold" style={{ color: C.ink }}>Name<input value={p.name} onChange={e => setP({ ...p, name: e.target.value })} className={field} style={{ borderColor: C.line }} /></label>
        <label className="block text-xs font-semibold" style={{ color: C.ink }}>Age<input value={p.age} onChange={e => setP({ ...p, age: e.target.value })} inputMode="numeric" className={field} style={{ borderColor: C.line }} /></label>
        <label className="block text-xs font-semibold" style={{ color: C.ink }}>Gender
          <select value={p.gender} onChange={e => setP({ ...p, gender: e.target.value })} className={field} style={{ borderColor: C.line }}>
            <option value="">Prefer not to say</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option>
          </select>
        </label>
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-semibold" style={{ color: C.navy }}>Cancel</button>
          <button disabled={busy} onClick={async () => { setBusy(true); try { await onSave(p); } finally { setBusy(false); } }} className="flex-1 rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-60" style={{ background: C.navy }}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
