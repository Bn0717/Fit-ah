// app/fit-lab/page.tsx
// Fit Lab: TNT CO Gon Tee in S/M/L/XL on an adjustable body.
// Every (body, size) combination on a 3x3 grid (height x chest) was draped with cloth physics in
// Blender (blender/run_grid_drapes.sh). The sliders blend between those simulated results using
// morph targets, so the browser never runs physics but always shows simulated shapes.
// Shoulder and waist: narrow/wide variants of the centre body (and every size draped on them) are
// extra morph targets added on top of the grid blend; blender/calibrate_shape.py measured how many cm
// each one really adds on every grid body, so the sliders hit the cm asked for.
// Catwalk: a baked walking cloth simulation (blender/export_walk.py) replayed frame by frame, exactly as
// Blender computed it. Only the 175 cm / chest 101 cm body was walked (each walk is a ~1 h simulation).
'use client';

import { ModelSkeleton } from '@/components/ui/Skeleton';
import { WardrobeSkeleton } from '@/components/ui/PageSkeletons';
import { getAvatar } from '@/lib/firebase/firestore';
import { SavedSizeControl } from './SavedSizeControl';
import { useSizePreferences } from './useSizePreferences';
import { initialSize, recommendedTop, recommendedBottom } from './sizePreferences';
import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveWardrobeItem, saveWardrobeUvMap, syncWardrobe, deleteWardrobeItem } from './wardrobeCloud';
import type { StoredItem, StoredUvMap } from './wardrobeStorage';
import { useAuth } from '@/lib/contexts/AuthContext';
import { loadImage, loadRef, makeTexture, type Ref, type Result } from './colourway';
import { makePantsTexture, loadPantsRef, type PantsResult, type PantsOutline } from './pantsSwap';
import { applyStaticLayers, elasticBandColor, blendFitAttribute, selectWalk, loadPacked, fetchBin, cpuMorphed, pushOutside, layerShirtOverPants, joinParts, shirtShapeOk, fitColor, fitTier, FIT_LEGEND, applyColourway, applyPantsSkin, SIZES, VARIANTS, gridWeights, blend, clamp, makeTrack, applyFrame, refreshWalkNormals, rootPath, solveBody,
  type Size, type ViewMode, type GridMeta, withShirt, type ShirtProduct, type Tape, type ShirtNums, type Variant, type ProductWalk, type WalkTrack, type JeansSim, type JeansBody, jeansVarWeights } from './engine';
import { WardrobeGrid, AddItemModal, ItemModal, PantsModal, type PantsChart, type PantsSizeFit, loadStored, storeItem, unstoreItem, type LabItem, type SizeFit } from './Wardrobe';
import { XIN_GRID_DIR, xinWalkAssets } from './xinAssets';
import { BODY_GRID_DIR, BODY_WALK_DIR, GRID_META_URL, PRODUCTS_INDEX_URL, TOPS_INDEX_URL, GON as GON_FILES, XIN } from './paths';
import { applySkinTone, isSkinTone, hexToLinear } from './skinTone';
import { fabricFor } from './displayColour';
import { hideCoveredFeet } from './bodyCover';
import { jeansState, wornBody, type PantsData } from './jeansFit';
import { useStored, matchChart, notSimText, OutfitCard, UserGuideModal, type Outfit, type SizeChartData, type SizeMatch } from './WardrobeExtras';
// a pants product made by blender/new_pants.sh (public/models/fitlab/brands/<brand>/<id>/product.json, listed in brands/index.json)
// a pants photo swap: new photos on the simulated Xin jeans (pantsSwap.ts)
type PantsItem = { id: string; brand: string; name: string; frontUrl: string; backUrl: string; tex?: { front: PantsResult; back: PantsResult }; chart?: SizeChartData };
const PANTS_REF = XIN.outline;
// OFF for now (user wants to see any pants on the Xin pattern); set true to refuse a different cut again
const CHECK_SAME_CUT = false;
const SAME_CUT_MAX = 0.05;   // mean proportion difference allowed vs the Xin outline (pantsSwap.ts compare): Xin's own photos 0.7-1.6 %, Stallion (another cut) 6.6-7.5 %
type PantsProduct = { walk?: ProductWalk; id: string; name: string; brand: string; fabric: string; dir: string; belt: Record<string, JeansSim>; drop: Record<string, JeansSim>; waist_type?: string; elastic_stretch?: number | null };

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  cream: '#F8F3EA', navy: '#0B1957', peach: '#FFDBD1', pink: '#FA9EBC',
  red: '#ef4444', green: '#10b981', blue: '#3b82f6', amber: '#f59e0b',
};

// developer panels ("My exact fit", chart vs. draped table, walking videos): hidden from shoppers; set true for demos / checks
const DEV_PANELS = false;
const CW_DIR = GON_FILES.colourway;

// defined outside the page so React keeps the same input element while dragging
function Slider({ label, value, min, max, step = 1, note, disabled, onChange }: { label: string; value: number; min: number; max: number; step?: number; note?: string; disabled?: boolean; onChange: (v: number) => void }) {
  return (
    <label className="block text-sm" style={disabled ? { opacity: 0.45 } : undefined}>
      <div className="flex justify-between"><span>{label}{note && <span style={{ opacity: 0.55 }}> · {note}</span>}</span><span className="font-semibold">{value} cm</span></div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={e => onChange(Number(e.target.value))}
        className="mt-1 w-full" style={{ accentColor: C.navy }} />
    </label>
  );
}

// the wardrobe needs a login (same as the previous wardrobe): signed-out visitors go to /login
export default function FitLabPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => { if (!loading && !user) router.push('/login'); }, [user, loading, router]);
  if (loading || !user) {
    return <WardrobeSkeleton />;
  }
  return <FitLab key={user.uid} />;
}

function FitLab() {
  const { user } = useAuth();
  const userId = user!.uid;
  const sizeRecords = useSizePreferences(userId);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sceneRef = useRef<any>({});
  const [baseMeta, setMeta] = useState<GridMeta | null>(null);       // the body grid (+ the TNT Gon tee's numbers)
  const [size, setSize] = useState<Size>('M');
  const [mode, setMode] = useState<ViewMode>('fabric');
  const [shirtOn, setShirtOn] = useState(true);                       // false = shirt taken off (bare body)
  const [jeansSize, setJeansSize] = useState<string | null>(null);   // null = basic pants
  const [belt, setBelt] = useState(false);                            // jeans held up by a belt
  // which pants: the Xin jeans (grid data in meta) or a product made by blender/new_pants.sh (size chart + photos)
  const [pantsId, setPantsId] = useState('xin');
  const [pantsItems, setPantsItems] = useState<PantsItem[]>([]);
  const [pantsLoading, setPantsLoading] = useState<string[]>([]);
  const [openPants, setOpenPants] = useState<LabItem | null>(null);     // bottoms item window
  const [openProduct, setOpenProduct] = useState<PantsProduct | null>(null);
  const [pantsSkin, setPantsSkin] = useState<string | null>(null);  // id of the worn pants photo swap (null = the Xin photos)
  const xinOn = !!jeansSize && pantsId === 'xin' && !pantsSkin;
  const [products, setProducts] = useState<{ id: string; name: string; brand: string; dir: string }[]>([]);
  const [product, setProduct] = useState<PantsProduct | null>(null);
  const [sizeCatalog, setSizeCatalog] = useState<Record<string, PantsProduct>>({});
  useEffect(() => {
    let alive = true;
    Promise.all(products.map(async p => {
      try { const response = await fetch(`${p.dir}/product.json`); if (!response.ok) return null; return [p.id, await response.json()] as const; } catch { return null; }
    })).then(entries => { if (alive) setSizeCatalog(Object.fromEntries(entries.filter((entry): entry is NonNullable<typeof entry> => !!entry))); });
    return () => { alive = false; };
  }, [products]);
  // products flagged "hidden" in products/index.json (not ready for shoppers yet, e.g. simulated on one body only) are left out
  useEffect(() => { fetch(PRODUCTS_INDEX_URL).then(r => r.ok ? r.json() : []).then(l => setProducts(l.filter((p: { hidden?: boolean }) => !p.hidden))).catch(() => {}); }, []);
  useEffect(() => {
    const it = products.find(p => p.id === openPants?.id);
    if (!it) { setOpenProduct(null); return; }
    fetch(`${it.dir}/product.json`).then(r => r.json()).then(setOpenProduct).catch(() => setOpenProduct(null));
  }, [openPants, products]);
  useEffect(() => {
    const it = products.find(p => p.id === pantsId);
    if (!it) { setProduct(null); return; }
    fetch(`${it.dir}/product.json`).then(r => r.json()).then(setProduct).catch(() => setProduct(null));
  }, [pantsId, products]);
  const pants: { name: string; sizes: Record<string, JeansSim>; drop?: Record<string, JeansSim>; belt?: Record<string, JeansSim>; dir: string } | null =
    pantsId === 'xin' ? (baseMeta?.jeans ? { ...baseMeta.jeans, dir: xinOn ? XIN_GRID_DIR : XIN.grid } : null)
      : product && product.id === pantsId ? { name: `${product.brand} ${product.name}`, sizes: product.belt, drop: product.drop, belt: product.belt, dir: product.dir } : null;
  const belly = 0; // Belly adjustment is temporarily disabled; always use the natural shape.
  // "My exact fit": a real simulation on this exact body (blender/exact_fit.sh via /api/fitlab/exact)
  const [exact, setExact] = useState<{ id?: string; step?: string; pct?: number; msg?: string; glb?: string | null;
    body?: Record<string, number>; shirt?: Record<string, number | null>; size?: string; showing?: boolean; error?: string } | null>(null);

  const [height, setHeight] = useState(175);
  const [hasProfile, setHasProfile] = useState(false);
  const [chest, setChest] = useState(101);
  const [shoulder, setShoulder] = useState<number | null>(null);   // null = this body's natural value
  const [waist, setWaist] = useState<number | null>(null);
  const preWalkBody = useRef<{ height: number; chest: number; shoulder: number | null; waist: number | null } | null>(null);
  const savedBody = useRef<{ height: number; chest: number; shoulder: number; waist: number } | null>(null);
  const [walking, setWalking] = useState(false);
  const [walkStatus, setWalkStatus] = useState<string | null>(null);
  const GON: LabItem = { id: 'gon', brand: 'TNT CO', name: 'Gon Tee (green)', frontUrl: GON_FILES.front, backUrl: GON_FILES.back, builtin: true };
  const [items, setItems] = useState<LabItem[]>([GON]);
  // built-in wardrobe items the user removed (kept on disk, only hidden; "Restore" brings them back)
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => { try { setHidden(JSON.parse(localStorage.getItem('fitlab_hidden') || '[]')); } catch { /* storage blocked */ } }, []);
  const saveHidden = (h: string[]) => { setHidden(h); try { localStorage.setItem('fitlab_hidden', JSON.stringify(h)); } catch { /* storage blocked */ } };
  const [activeId, setActiveId] = useState('gon');
  // shirt products (brands/tops.json -> <dir>/product.json, made by blender/new_shirt.sh): loaded with the wardrobe.
  // The worn one's sizes and simulated numbers replace the Gon tee's in `meta`, so every fit calculation reads the
  // shirt that is on; topFitOf() does the same for any other top (cards, recommendations).
  const [topProducts, setTopProducts] = useState<Record<string, ShirtProduct>>({});
  const topProductOf = (it?: LabItem | null) => (it?.topDir && topProducts[it.id]) || null;
  const topProduct = topProductOf(items.find(i => i.id === activeId));
  const meta = React.useMemo(() => baseMeta && withShirt(baseMeta, topProduct), [baseMeta, topProduct]);
  const sizesOfTop = (it?: LabItem | null) => (topProductOf(it)?.sizes ?? SIZES) as Size[];
  const topSizes = sizesOfTop(items.find(i => i.id === activeId));
  const shirtKey = `${topProduct?.id ?? 'gon'}:${size}`;              // loaded shirt files: one per product and size
  // colour of a shirt product (same cut, same fit: only the fabric colour changes), remembered in this browser
  const [topColour, setTopColour] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('fitlab_top_colour') || '{}'); } catch { return {}; }
  });
  const pickTopColour = (id: string, hex: string) => setTopColour(c => {
    const n = { ...c, [id]: hex };
    try { localStorage.setItem('fitlab_top_colour', JSON.stringify(n)); } catch { /* storage blocked */ }
    return n;
  });
  // shirt products into the wardrobe (built-in tops next to the Gon tee); hidden ones stay out until checked
  useEffect(() => {
    let stop = false;
    fetch(TOPS_INDEX_URL).then(r => r.ok ? r.json() : []).then(async (list: { id: string; name: string; brand: string; dir: string; hidden?: boolean }[]) => {
      const shown = list.filter(p => !p.hidden);
      const loaded = await Promise.all(shown.map(p => fetch(`${p.dir}/product.json`).then(r => r.ok ? r.json() as Promise<ShirtProduct> : null).catch(() => null)));
      if (stop) return;
      const ok = loaded.filter((p): p is ShirtProduct => !!p);
      setTopProducts(cur => ({ ...cur, ...Object.fromEntries(ok.map(p => [p.id, p])) }));
      setItems(cur => [...cur, ...ok.filter(p => !cur.some(i => i.id === p.id)).map(p => ({ id: p.id, brand: p.brand, name: p.name,
        frontUrl: `${p.dir}/front.png`, backUrl: `${p.dir}/back.png`, builtin: true, topDir: p.dir }))]);
    }).catch(() => {});
    return () => { stop = true; };
  }, []);
  const [openItem, setOpenItem] = useState<LabItem | null>(null);
  const [addKind, setAddKind] = useState<'shirt' | 'pants' | null>(null);   // which wardrobe section the add window is for
  const [loadingIds, setLoadingIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(0);   // bumps when a model finishes loading
  // a shirt size still downloading: say so (a bare body would look like "this size can't be worn")
  const [shirtProg, setShirtProg] = useState<{ size: string; pct: number } | null>(null);
  // ── the page is the wardrobe (like /items: tabs, favourites, recent, outfits); the fitting room is a full-screen
  // layer on top of it, opened by "" (the 3D scene stays loaded underneath, paused while it is closed) ──
  const [roomOpen, setRoomOpen] = useState(false);
  const [tab, setTab] = useState<'all' | 'fav' | 'recent' | 'outfits'>('all');
  const [kindFilter, setKindFilter] = useState<'all' | 'tops' | 'bottoms'>('all');
  const [favs, setFavs] = useStored<string[]>('fitlab_favs', []);
  const [recent, setRecent] = useStored<string[]>('fitlab_recent', []);
  const [outfits, setOutfits] = useStored<Outfit[]>('fitlab_outfits', []);
  const [guide, setGuide] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4500); return () => clearTimeout(t); }, [toast]);
  // the fitting room is a page on top of the wardrobe: the phone's back gesture / browser back closes it
  // (Next's own history state is kept in the pushed entry, so its router is not disturbed)
  const openRoom = () => {
    if (roomOpen) return;
    try { history.pushState({ ...(history.state ?? {}), fitRoom: 1 }, ''); } catch { /* history blocked */ }
    setRoomOpen(true);
  };
  const closeRoom = () => { if (history.state?.fitRoom) history.back(); else setRoomOpen(false); };
  useEffect(() => {
    const onPop = (e: PopStateEvent) => setRoomOpen(!!e.state?.fitRoom);
    window.addEventListener('popstate', onPop); return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    sceneRef.current.paused = !roomOpen;          // no 3D rendering while browsing the wardrobe
    if (!roomOpen) { setWalking(false); return; }
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';   // the wardrobe does not scroll underneath
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRoom(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomOpen]);
  const seen = (id: string) => setRecent(r => [id, ...r.filter(x => x !== id)].slice(0, 30));
  useEffect(() => {
    let alive = true;
    getAvatar(userId).then(profile => {
      if (!alive || !profile) return;
      const saved = { height: profile.height, chest: profile.chest * 2, shoulder: profile.shoulder, waist: profile.waist * 2 };
      savedBody.current = saved;
      setHeight(saved.height); setChest(saved.chest); setWaist(saved.waist); setShoulder(saved.shoulder);
      setHasProfile(true);
      // skin tone (set on the Profile page): the static and the walking body, now and when they load later
      const S = sceneRef.current, tone = isSkinTone(profile.skinTone) ? profile.skinTone : null;
      S.skinTone = tone; applySkinTone(S.bodyRoot, tone); applySkinTone(S.walk?.group, tone);
    });
    return () => { alive = false; };
  }, [userId]);

  // the pants rules are shared with /fit-lab-profile (jeansFit.ts), so both pages show the same thing:
  // wornBody = the body used while these pants are worn (natural waist / belly for pants simulated only there),
  // jeansState = which simulation to show, whether they can be worn / were simulated for this body, and the label
  const pantsData: PantsData | null = pants ? { ...pants, elasticStretch: product?.elastic_stretch ?? null } : null;
  // a shirt simulated with shoulder / waist / belly changes only on some bodies: natural shape elsewhere (no guesses)
  const shirtLock = !!(shirtOn && meta && !shirtShapeOk(meta, height, chest));
  const shoulderNow = shirtLock ? null : shoulder;
  const wb = meta ? wornBody(meta, pantsData, jeansSize, height, chest, shoulderNow, shirtLock ? null : waist, shirtLock ? 0 : belly)
    : { waist, belly, lock: false, snap: false };
  const jeansLock = wb.lock, waistNow = wb.waist, bellyNow = wb.belly;
  const jst = meta ? jeansState(meta, pantsData, jeansSize, belt, height, chest, shoulderNow, waistNow, bellyNow) : null;
  const elasticW = jeansSize ? pants?.sizes[jeansSize]?.chart.elastic_waist : undefined;
  const noSim = !!jst?.noSim;
  const jeansVariant: 'held' | 'drop' | 'belt' = jst?.variant ?? 'held';
  const jeansKey = jeansSize && pants ? `${xinOn ? 'xin-smooth' : pantsId}/${jeansVariant}/${jeansSize}` : null;
  // jeans that cannot be worn on this body, or were not simulated for it, are not drawn: only the verdict
  // (an honest "can't" is better than a broken-looking simulation)
  const jeansHide = !!jst?.hide;

  useEffect(() => {
    fetch(GRID_META_URL).then(r => r.json()).then(setMeta).catch(() => setError('Could not load the size grid.'));
  }, []);

  // ── scene setup + body ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current || !baseMeta) return;
    let cancelled = false, frame = 0;
    let cleanup: () => void = () => {};
    Promise.all([
      import('three'),
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/controls/OrbitControls.js'),
      import('three/addons/environments/RoomEnvironment.js'),
      import('three/addons/loaders/DRACOLoader.js'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ]).then(([THREE, { GLTFLoader }, { OrbitControls }, { RoomEnvironment }, { DRACOLoader }]: any[]) => {
      if (cancelled || !canvasRef.current) return;
      const canvas = canvasRef.current;
      const W = canvas.clientWidth || 600, H = canvas.clientHeight || 700;
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setSize(W, H, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.9;
      renderer.shadowMap.enabled = true;
      const scene = new THREE.Scene(); scene.background = new THREE.Color(C.cream);
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      const camera = new THREE.PerspectiveCamera(30, W / H, 0.05, 50);
      camera.position.set(1.7, 1.2, 4.3);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true; controls.minDistance = 0.8; controls.maxDistance = 6;
      controls.target.set(0, 0.92, 0);
      const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-2, 4, 3); key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = -1.2; key.shadow.camera.right = 1.2;
      key.shadow.camera.top = 2.2; key.shadow.camera.bottom = -0.2; key.shadow.bias = -0.0005;
      scene.add(key); scene.add(new THREE.HemisphereLight(0xffffff, 0xd8cfc0, 0.5));
      const floor = new THREE.Mesh(new THREE.CircleGeometry(1.4, 64), new THREE.MeshStandardMaterial({ color: 0xece4d6, roughness: 1 }));
      floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

      const loader = new GLTFLoader();
      const draco = new DRACOLoader(); draco.setDecoderPath('/draco/'); loader.setDRACOLoader(draco);   // exact-fit models are Draco-compressed
      const S = sceneRef.current;
      // gen: which scene this is; a shirt / jeans download that finishes for an older scene is dropped (it would
      // otherwise land in this scene untracked: never recoloured, shaped or hidden)
      Object.assign(S, { THREE, scene, loader, gen: (S.gen ?? 0) + 1, bodyMeshes: [], shirts: {} as Record<string, unknown>, jeans: {} as Record<string, unknown> });
      // development only: lets automated checks turn the camera (front / side / back views); not in the live build
      if (process.env.NODE_ENV !== 'production') Object.assign(S, { camera, controls }), Object.assign(window, { __fitlabScene: S });
      loader.load(`${BODY_GRID_DIR}/body.glb`,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (g: any) => {
          if (cancelled) return;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          g.scene.traverse((o: any) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; if (o.morphTargetDictionary) S.bodyMeshes.push(o); } });
          applySkinTone(g.scene, S.skinTone); hideCoveredFeet(g.scene);   // no skin poking through the shoes
          scene.add(g.scene); S.bodyRoot = g.scene; setLoading(false); setReady(r => r + 1);
        }, undefined, () => !cancelled && setError('Could not load the body model.'));

      const BASE = camera.position.clone().sub(controls.target).length();
      const onResize = () => {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
        // a tall narrow 3D area (phone portrait, side panel layout) would cut the arms off: move back to fit the width
        const off = camera.position.clone().sub(controls.target);
        off.setLength(BASE * Math.max(1, 0.62 / camera.aspect)); camera.position.copy(controls.target).add(off);
      };
      window.addEventListener('resize', onResize);
      // the canvas changes size without a window resize (the fitting room opening, phone / desktop layout)
      const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
      ro?.observe(canvas);
      const clock = new THREE.Clock();
      const tick = () => {
        frame = requestAnimationFrame(tick);
        if (S.paused) return;
        const W = S.walk;
        if (W?.active && W.body && W.shirts[W.size]) {
          if (W.t0 === undefined) W.t0 = clock.getElapsedTime();
          const f = Math.floor((clock.getElapsedTime() - W.t0) * W.fps) % W.frames;
          if (f !== W.last) {
            W.last = f;
            const [rx, ry] = W.root.path[f];
            const hd = W.root.heading[f];
            const off = new THREE.Vector3(rx, 0, -ry).applyAxisAngle(new THREE.Vector3(0, 1, 0), hd);
            W.group.position.set(-off.x, 0, -off.z); W.group.rotation.y = hd;
            for (const t of W.body) applyFrame(t, f, false);
            // jeans first: the shirt (walked over thin leggings) is then pushed out over them, frame by frame
            const J = W.jeansSize && W.jeans?.[W.jeansSize];
            if (J) for (const t of J.tracks) applyFrame(t, f, W.mode === 'fit', 'denim');
            const jp = J ? joinParts(J.tracks.map((t: WalkTrack) => t.mesh.geometry.attributes.position.array as Float32Array)) : null;   // all panels: one garment
            // a shirt walked over these jeans in the simulation already rests on them; others are pushed out
            const layered = W.size.includes('_j');
            for (const t of W.shirts[W.size].tracks) applyFrame(t, f, W.mode === 'fit', 'jersey', jp && !layered && !W.productPants ? (a => { pushOutside(a, jp); }) : undefined);
            // Unpaired product walks need both steps: move the shirt out, then press residual
            // shorts folds underneath it. pushOutside alone deliberately caps its correction.
            if (J && W.productPants && !layered && W.shirts[W.size].root.visible) {
              const shirts: WalkTrack[] = W.shirts[W.size].tracks, pants: WalkTrack[] = J.tracks;
              layerShirtOverPants(shirts.map(t => t.mesh.geometry.attributes.position.array as Float32Array),
                pants.map(t => t.mesh.geometry.attributes.position.array as Float32Array));
              for (const t of [...shirts, ...pants]) refreshWalkNormals(t);
            }
          }
        }
        controls.update(); renderer.render(scene, camera);
      };
      tick();
      cleanup = () => {
        cancelAnimationFrame(frame); window.removeEventListener('resize', onResize); ro?.disconnect();
        controls.dispose(); pmrem.dispose(); renderer.dispose();
      };
    });
    return () => { cancelled = true; cleanup(); };
  }, [baseMeta]);

  // ── load the selected size's shirt on demand ───────────────────────────────────
  useEffect(() => {
    const S = sceneRef.current;
    if (!S.loader || !meta) return;
    S.shirtOn = shirtOn;
    S.shirtWant = shirtKey;                     // read by downloads that finish later (the shirt + size wanted NOW)
    for (const [sz, grp] of Object.entries(S.shirts)) if (typeof grp !== 'string') (grp as { visible: boolean }).visible = shirtOn && !S.walk?.active && sz === shirtKey;
    if (S.shirts[shirtKey]) { setReady(r => r + 1); return; }
    const key = shirtKey;
    S.shirts[key] = 'loading';
    const gen = S.gen;
    setShirtProg({ size, pct: 0 });
    loadPacked(S.THREE, S.loader, `${topProduct ? `${topProduct.dir}/grid` : GON_FILES.grid}/shirt_${size}.glb.gz`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (g: any) => {
        if (S.gen !== gen) return;               // a download that finishes after the scene was rebuilt (page reload / live edit): its scene is gone, drop it
        const THREE = S.THREE;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parts: any[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        g.scene.traverse((o: any) => {
          if (!o.isMesh) return;
          o.castShadow = o.receiveShadow = true;
          o.morphTargetInfluences?.fill(0);       // the file's default weights are 1 (every shape at once): none until set
          const fabric = o.material.clone(); fabric.side = THREE.DoubleSide; fabric.roughness = 0.95; fabric.metalness = 0;
          const n = o.geometry.attributes.position.count;
          o.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
          const fit = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
          o.material = fabric; o.userData.fabric = fabric; parts.push({ mesh: o, fabric, fit });
        });
        g.scene.userData.parts = parts;
        S.scene.add(g.scene); S.shirts[key] = g.scene; applyColourway(S);
        for (const [sz, grp] of Object.entries(S.shirts)) if (typeof grp !== 'string') (grp as { visible: boolean }).visible = S.shirtOn !== false && !S.walk?.active && !S.walkOn && sz === S.shirtWant;
        setReady(r => r + 1); setShirtProg(p => p?.size === size ? null : p);
      }, e => { if (e.total) setShirtProg(p => p?.size === size ? { size, pct: Math.round(100 * e.loaded / e.total) } : p); },
      () => { setShirtProg(null); setError(`Could not load size ${size}.`); });
  }, [shirtKey, meta, loading, shirtOn]);

  // ── catwalk: load the baked walk (body once, shirt per size) and switch the scene over ───
  useEffect(() => {
    const S = sceneRef.current;
    if (!S.THREE || !meta) return;
    const THREE = S.THREE;
    S.walkOn = walking;                         // read by loaders that finish later (static shirts / jeans stay hidden)
    const W = S.walk || (S.walk = { group: new THREE.Group(), shirts: {}, loading: {} });
    if (!W.added) { S.scene.add(W.group); W.added = true; }
    W.jeans ||= {};
    // walking jeans for this size; with the belt on, the walk held at the waist when the plain one has slid down
    const jz = pantsId === 'xin' && jeansSize && belt && meta.walk?.jeans?.[jeansSize + 'belt'] ? jeansSize + 'belt' : jeansSize;
    const originalWalk = selectWalk(meta, size, jz, pantsId === 'xin', product?.id === pantsId ? product.walk : undefined, { shirt: GON_FILES.walk, pants: XIN.walk });
    const selected = xinWalkAssets(originalWalk, xinOn);
    const { js, sk } = selected;
    W.size = sk; W.mode = mode; W.last = -1; W.jeansSize = js; W.productPants = originalWalk.packedPants;
    const has = !topProduct && !!meta.walk?.sizes[size];          // shirt products: no catwalk simulated yet
    const show = (on: boolean) => {
      W.active = on; W.group.visible = on;
      if (S.bodyRoot) S.bodyRoot.visible = !on;
      for (const [sz, grp] of Object.entries(S.shirts)) if (typeof grp !== 'string') (grp as { visible: boolean }).visible = !on && shirtOn && sz === shirtKey;
      if (on) for (const g of Object.values(S.jeans || {})) if (g && typeof g !== 'string') (g as { visible: boolean }).visible = false;
      for (const [sz, sh] of Object.entries(W.shirts)) (sh as { root: { visible: boolean } }).root.visible = on && shirtOn && sz === sk;
      for (const [sz, jj] of Object.entries(W.jeans)) (jj as { root: { visible: boolean } }).root.visible = on && sz === js;
      // the basic pants of the walking body are swapped for the jeans
      for (const t of W.body || []) if (/pants/i.test(t.mesh.name) || /pants/i.test(t.mesh.parent?.name || '')) t.mesh.visible = !js;
    };
    if (!walking) { show(false); W.t0 = undefined; setReady(r => r + 1); return; }
    if (!has) { setWalking(false); setWalkStatus(topProduct ? `The catwalk for ${topProduct.name} has not been simulated yet.` : `The ${size} catwalk is still being simulated.`); return; }
    const dir = BODY_WALK_DIR;   // the shared walking body (garment walks come from selectWalk)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loadGlb = (u: string, packed = false) => new Promise<any>((res, rej) => {
      if (packed) loadPacked(THREE, S.loader, u + '.gz', res, undefined, rej);
      else S.loader.load(u, res, undefined, rej);
    });
    const jobs: Promise<unknown>[] = [];
    if (!W.body && !W.loading.body) {
      const info = fetch(`${dir}/walk_body.json`).then(r => { if (!r.ok) throw new Error(`Catwalk metadata: ${r.status}`); return r.json(); });
      W.loading.body = Promise.all([loadGlb(`${dir}/walk_body.glb`), fetchBin(`${dir}/walk_body.bin`, info), info])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then(([g, buf, info]: any[]) => {
          const tracks: WalkTrack[] = [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          g.scene.traverse((o: any) => {
            if (!o.isMesh) return;
            let p = o; while (p && !(p.name in info.objects)) p = p.parent;
            if (!p) return;
            const m = info.objects[p.name];
            o.castShadow = o.receiveShadow = true;
            tracks.push(makeTrack(o, buf, m.offset, { n: m.n, min: m.min, scale: m.scale, frames: info.frames }));
          });
          applySkinTone(g.scene, S.skinTone); hideCoveredFeet(g.scene);
          W.group.add(g.scene); W.fps = info.fps; W.frames = info.frames;
          W.root = rootPath(tracks.find(t => /Body/.test(t.mesh.name) || /Body/.test(t.mesh.parent?.name)) || tracks[0]);
          W.body = tracks;
        });
    }
    if (W.loading.body) jobs.push(W.loading.body);
    if (!W.shirts[sk] && !W.loading[sk]) {
      const info = fetch(`${selected.shirtDir}/walk_${selected.shirtFile}.json`).then(r => { if (!r.ok) throw new Error(`Catwalk metadata: ${r.status}`); return r.json(); });
      W.loading[sk] = Promise.all([loadGlb(`${selected.shirtDir}/walk_shirt_${selected.shirtFile}.glb`, selected.packedShirt), fetchBin(`${selected.shirtDir}/walk_shirt_${selected.shirtFile}.bin`, info), info])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then(([g, buf, info]: any[]) => {
          const tracks: WalkTrack[] = [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          g.scene.traverse((o: any) => {
            if (!o.isMesh) return;
            o.castShadow = o.receiveShadow = true;
            const fabric = o.material.clone(); fabric.side = THREE.DoubleSide; fabric.roughness = 0.95; fabric.metalness = 0;
            const n = o.geometry.attributes.position.count;
            o.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
            o.userData.fabric = fabric; o.userData.fit = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
            o.material = fabric;
            tracks.push(makeTrack(o, buf, 0, info, info.strain_offset, info.gap_offset));
          });
          W.group.add(g.scene); W.shirts[sk] = { root: g.scene, tracks }; applyColourway(S);
        });
    }
    if (W.loading[sk]) jobs.push(W.loading[sk]);
    if (js && !W.jeans[js] && !W.loading['jeans_' + js]) {
      const info = fetch(`${selected.pantsDir}/walk_jeans_${selected.pantsFile}.json`).then(r => { if (!r.ok) throw new Error(`Catwalk metadata: ${r.status}`); return r.json(); });
      W.loading['jeans_' + js] = Promise.all([loadGlb(`${selected.pantsDir}/walk_jeans_${selected.pantsFile}.glb`, selected.packedPants), fetchBin(`${selected.pantsDir}/walk_jeans_${selected.pantsFile}.bin`, info), info])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then(([g, buf, info]: any[]) => {
          const tracks: WalkTrack[] = [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          g.scene.traverse((o: any) => {
            if (!o.isMesh) return;
            o.castShadow = o.receiveShadow = true;
            const fabric = o.material.clone(); fabric.side = THREE.DoubleSide; fabric.roughness = 0.92; fabric.metalness = 0;
            const n = o.geometry.attributes.position.count;
            o.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
            o.userData.fabric = fabric; o.userData.fit = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
            o.material = fabric;
            tracks.push(makeTrack(o, buf, 0, info, info.strain_offset, info.gap_offset));
          });
          W.group.add(g.scene); W.jeans[js] = { root: g.scene, tracks }; applyPantsSkin(S);
        });
    }
    if (js && W.loading['jeans_' + js]) jobs.push(W.loading['jeans_' + js]);
    setWalkStatus('Loading the catwalk…');
    let stale = false;
    Promise.all(jobs).then(() => {
      if (stale) return;
      for (const t of [...W.shirts[sk].tracks, ...(js ? W.jeans[js].tracks : [])]) t.mesh.material = mode === 'fit' ? t.mesh.userData.fit : t.mesh.userData.fabric;
      W.last = -1; show(true); setWalkStatus(null);
    }).catch(() => { if (!stale) { setWalking(false); setWalkStatus('Could not load the catwalk.'); } });
    return () => { stale = true; };
  }, [walking, size, mode, meta, loading, jeansSize, shirtOn, belt, pantsId, xinOn, product?.walk, product?.id, topProduct]);

  // ── jeans: load the selected size on demand, swap with the basic pants ───────────────
  // drop = nothing holds the waistband (gravity + friction decide where it ends up), belt = a belt holds it at the
  // waist; older data only has the held (buttoned) simulation
  useEffect(() => {
    const S = sceneRef.current;
    if (!S.loader || !meta) return;
    S.jeans ||= {};
    // the wanted state lives on S: a size that finishes loading later must follow what is wanted THEN (the body may
    // have changed meanwhile and these jeans be hidden now), not what was wanted when its download started
    S.jeansWant = { key: jeansKey, hide: jeansHide, on: !!jeansSize };
    const show = () => {
      const { key, hide, on } = S.jeansWant;
      // S.walkOn, not `walking`: this also runs when a size finishes loading, possibly after the catwalk started
      for (const [sz, g] of Object.entries(S.jeans)) if (typeof g !== 'string') (g as { visible: boolean }).visible = !S.walkOn && !hide && sz === key;
      S.bodyRoot?.traverse((o: { name: string; visible: boolean; isMesh?: boolean }) => { if (o.isMesh && /pants/i.test(o.name)) o.visible = !on || hide; });
    };
    if (!jeansKey || S.jeans[jeansKey]) { show(); setReady(r => r + 1); return; }
    S.jeans[jeansKey] = 'loading';
    const sz = jeansSize!, key = jeansKey, gen = S.gen;
    loadPacked(S.THREE, S.loader, (jeansVariant === 'held' ? `${pants!.dir}/jeans_${sz}.glb` : `${pants!.dir}/${jeansVariant}/jeans_${sz}.glb`) + '.gz',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (g: any) => {
        if (S.gen !== gen) return;               // a download that finishes after the scene was rebuilt (page reload / live edit): its scene is gone, drop it
        const THREE = S.THREE;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parts: any[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        g.scene.traverse((o: any) => {
          if (!o.isMesh) return;
          o.castShadow = o.receiveShadow = true;
          const fabric = o.material.clone(); fabric.side = THREE.DoubleSide; fabric.roughness = 0.92; fabric.metalness = 0;
          const n = o.geometry.attributes.position.count;
          o.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
          const fit = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
          o.material = fabric; o.userData.fabric = fabric; parts.push({ mesh: o, fabric, fit, isJeans: true });
        });
        g.scene.userData.parts = parts;
        S.scene.add(g.scene); S.jeans[key] = g.scene; applyPantsSkin(S); show(); setReady(r => r + 1);
      }, undefined, () => setError(`Could not load the jeans (${sz}).`));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jeansKey, baseMeta, loading, walking, jeansHide]);

  // ── pants photo swap: the worn photos become the jeans textures (static, every size, and the catwalk) ──
  useEffect(() => {
    const S = sceneRef.current;
    if (!S.THREE) return;
    const it = pantsId === 'xin' ? pantsItems.find(p => p.id === pantsSkin) : undefined;
    S.pantsTex ||= {};
    if (it?.tex && !S.pantsTex[it.id]) {
      const tex = (c: HTMLCanvasElement) => {
        const t = new S.THREE.CanvasTexture(c); t.flipY = false; t.colorSpace = S.THREE.SRGBColorSpace; t.anisotropy = 8; return t;
      };
      S.pantsTex[it.id] = { front: tex(it.tex.front.canvas), back: tex(it.tex.back.canvas) };
    }
    S.pantsSkin = it?.tex ? S.pantsTex[it.id] : null;
    applyPantsSkin(S);
  }, [pantsSkin, pantsItems, pantsId, ready, jeansKey]);

  // ── exact fit: remember the last job in this browser; poll it; when ready, show it instead of the preview ──
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('fitlab_exact') || 'null');
      if (saved?.id) setExact({ id: saved.id, size: saved.size, step: 'queued', pct: 0, msg: 'Checking your last exact fit…', showing: false });
    } catch { /* storage blocked */ }
  }, []);
  useEffect(() => {
    if (!exact?.id) return;
    try { localStorage.setItem('fitlab_exact', JSON.stringify({ id: exact.id, size: exact.size })); } catch { /* storage blocked */ }
  }, [exact?.id, exact?.size]);
  useEffect(() => {
    if (!exact?.id || exact.step === 'done' || exact.step === 'error') return;
    const poll = async () => {
      const r = await fetch(`/api/fitlab/exact?id=${exact.id}`).then(x => x.json()).catch(() => null);
      if (r && !r.error) setExact(e => e && { ...e, ...r, showing: r.step === 'done' && e.step !== 'queued' ? true : e.showing });
      else if (r?.error) setExact(null);
    };
    poll();
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, [exact?.id, exact?.step]);
  useEffect(() => {
    const S = sceneRef.current;
    if (!S.loader) return;
    const on = !!(exact?.showing && exact.glb);
    const apply = () => {
      if (S.exactRoot) S.exactRoot.visible = on;
      if (S.bodyRoot) S.bodyRoot.visible = !on && !S.walk?.active;
      for (const g of Object.values(S.shirts || {})) if (g && typeof g !== 'string') (g as { visible: boolean }).visible = !on && !S.walk?.active && shirtOn && g === S.shirts[shirtKey];
      S.exactRoot?.traverse((o: { name: string; visible: boolean; isMesh?: boolean }) => { if (o.isMesh && /shirt/i.test(o.name)) o.visible = shirtOn; });
      for (const g of Object.values(S.jeans || {})) if (g && typeof g !== 'string') (g as { visible: boolean }).visible = !on && !S.walk?.active && !jeansHide && g === S.jeans[jeansKey ?? ''];
    };
    if (on && S.exactUrl !== exact!.glb) {
      if (S.exactRoot) { S.scene.remove(S.exactRoot); S.exactRoot = null; }
      S.exactUrl = exact!.glb;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      S.loader.load(exact!.glb, (g: any) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        g.scene.traverse((o: any) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; if (/shirt/i.test(o.name)) { o.material.side = S.THREE.DoubleSide; o.material.roughness = 0.95; } } });
        S.scene.add(g.scene); S.exactRoot = g.scene; apply();
      });
    }
    apply();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exact?.showing, exact?.glb, size, jeansKey, ready, shirtOn, jeansHide]);
  const startExact = async () => {
    if (!bodyNow) return;
    setExact({ step: 'queued', pct: 0, msg: 'Starting…', size });
    const r = await fetch('/api/fitlab/exact', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ height, chest: bodyNow.chest, waist: bodyNow.waist, shoulder: bodyNow.shoulder ?? 45, belly: bellyNow, size }) })
      .then(x => x.json()).catch(() => ({ error: 'Could not start the simulation' }));
    setExact(r.error ? { error: r.error } : { id: r.id, step: 'queued', pct: 0, msg: 'Starting…', size });
  };

  // ── shirt product colour: plain fabrics are recoloured from the simulated texture's colour ───────────
  useEffect(() => {
    const grp = sceneRef.current.shirts?.[shirtKey];
    if (!grp || typeof grp === 'string' || !topProduct?.base_hex) return;
    // the chosen colour (default: the swatch closest to the built colour), turned into the fabric colour that SHOWS as
    // that swatch under the fitting room's lights and tone mapping (displayColour.ts); the texture is the built colour
    const near = (h: string) => { const x = hexToLinear(h), y = hexToLinear(topProduct.base_hex!); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
    const want = topColour[topProduct.id] ?? ([...(topProduct.colours ?? [])].sort((x, y) => near(x.hex) - near(y.hex))[0]?.hex ?? topProduct.base_hex);
    const b = hexToLinear(topProduct.base_hex), t = fabricFor(hexToLinear(want));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const p of grp.userData.parts as any[]) {
      p.fabric.color.setRGB(t[0] / b[0], t[1] / b[1], t[2] / b[2]);
      // the cotton sheen follows the fabric colour too (a white sheen washes every colour out to pastel)
      if (p.fabric.sheenColor) p.fabric.sheenColor.setRGB(0.9 * t[0], 0.9 * t[1], 0.9 * t[2]);
      p.fabric.needsUpdate = true;
    }
  }, [shirtKey, topColour, topProduct, ready]);

  // ── apply sliders: morph weights on body + shirt, blended fit map ───────────────
  useEffect(() => {
    const S = sceneRef.current;
    if (!meta || !S.THREE) return;
    const { w, vw } = solveBody(meta, height, chest, shoulderNow, waistNow, bellyNow);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const setMorphs = (mesh: any, isJeans = false) => {
      const dict = mesh.morphTargetDictionary || {};
      mesh.morphTargetInfluences?.fill(0);
      for (const [k, v] of Object.entries(w)) if (k in dict) mesh.morphTargetInfluences[dict[k]] = v;
      if (isJeans) {                                    // waist x belly versions, incl. the combined bodies
        for (const [n, x] of Object.entries(jeansVarWeights(vw, n => n in dict))) mesh.morphTargetInfluences[dict[n]] = x;
        return;
      }
      for (const v of VARIANTS) {
        // shirt: per-body variant drapes (<key>_<variant>) when they exist, else the centre body's variant
        const perGrid = Object.keys(w).every(k => `${k}_${v}` in dict);
        if (perGrid) for (const [k, x] of Object.entries(w)) mesh.morphTargetInfluences[dict[`${k}_${v}`]] = x * vw[v];
        else if (v in dict) mesh.morphTargetInfluences[dict[v]] = vw[v];
      }
    };
    S.bodyMeshes?.forEach(setMorphs);
    const grp = S.shirts?.[shirtKey];
    // honesty: a shirt not simulated on the bodies this blend uses is not drawn (the Tops panel says why)
    if (grp && typeof grp !== 'string') {
      const simulatedHere = Object.keys(w).every(k => meta.shirt[size]?.[k]);
      if (!simulatedHere) grp.visible = false;
      else if (shirtOn && !S.walk?.active && !S.walkOn) grp.visible = true;   // back on a simulated body: show it again
    }
    const jg = jeansKey && !jeansHide ? S.jeans?.[jeansKey] : null;   // hidden jeans: the shirt hangs on the body
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allParts: any[] = [...(grp && typeof grp !== 'string' ? grp.userData.parts : []), ...(jg && typeof jg !== 'string' ? jg.userData.parts : [])];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const p of allParts as any[]) {
      setMorphs(p.mesh, !!p.isJeans);
      p.mesh.material = mode === 'fit' ? p.fit : p.fabric;
      if (mode !== 'fit') continue;
      const geo = p.mesh.geometry, col = geo.attributes.color, n = col.count;
      // per-point stretch (_S_) and room to the body (_G_, cm), blended like the shapes
      const strainKind = Object.keys(geo.attributes).some(name => /^_d_/i.test(name)) ? 'D' : 'S';
      const strain = blendFitAttribute(geo.attributes, strainKind, n, w, vw, meta.centre, !!p.isJeans, p.mesh.morphTargetDictionary);
      const gap = blendFitAttribute(geo.attributes, 'G', n, w, vw, meta.centre, !!p.isJeans, p.mesh.morphTargetDictionary);
      const fab = p.isJeans ? 'denim' : 'jersey';
      const band = geo.attributes._band || geo.attributes._BAND;
      const extension = jst?.now?.elasticExtension, limit = jst?.now?.elasticLimit;
      for (let i = 0; i < n; i++) {
        const c = p.isJeans && band?.array[i] > 0 && extension != null && limit != null
          ? elasticBandColor(extension, gap[i], limit) : fitColor(strain[i], gap[i], fab);
        col.setXYZ(i, c[0], c[1], c[2]);
      }
      col.needsUpdate = true;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shirtParts: any[] = grp && typeof grp !== 'string' ? grp.userData.parts : [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jeansParts: any[] = jg && typeof jg !== 'string' ? jg.userData.parts : [];
    applyStaticLayers(shirtParts, jeansParts, shirtOn);
  }, [meta, height, chest, shoulderNow, waistNow, shirtKey, mode, ready, jeansKey, bellyNow, jeansHide, shirtOn]);

  // ── numbers for the panel (blended from the simulated grid points) ───────────────
  const sb = meta ? solveBody(meta, height, chest, shoulderNow, waistNow, bellyNow) : null;
  // jeans fit on this body (blended from the simulated grid bodies)
  const TONE = { red: C.red, amber: C.amber, green: C.green, blue: C.blue };
  // shown ease = waistband minus waist (for elastic waists too: the panel prints the numbers)
  const jeansNow = jst?.now ? { ...jst.now, color: TONE[jst.now.tone] } : null;
  const w = sb?.w ?? {};
  // tape measure on the body now = grid blend + what the applied shoulder/waist offsets add
  const tape = (m: keyof Tape) => blend(w, k => meta!.body[k][m] ?? 0)
    + (sb?.ok ? VARIANTS.reduce((s, v) => s + sb.vw[v] * blend(w, k => (meta!.shape![k][v]?.[m] ?? 0)), 0) : 0);
  const bodyNow = meta && { chest: tape('chest'), waist: tape('waist'), hip: tape('hip'), shoulder: sb?.ok ? tape('shoulder') : null,
    belly: meta && Object.keys(w).every(k => meta.body[k].belly !== undefined) ? tape('belly') : null };
  const varDelta = (v: Variant, m: keyof ShirtNums) => {
    const g = meta!.shirt_var_grid?.[size];
    return g && Object.keys(w).every(k => g[k]?.[v]) ? blend(w, k => g[k][v]![m]) : (meta!.shirt_var?.[size]?.[v]?.[m] ?? 0);
  };
  const shirtM = (m: keyof ShirtNums) => blend(w, k => meta!.shirt[size][k][m])
    + VARIANTS.reduce((s, v) => s + (sb?.vw[v] ?? 0) * varDelta(v, m), 0);
  const shirtNow = meta?.shirt[size] && Object.keys(w).every(k => meta.shirt[size][k]) ? {
    chest: shirtM('chest_cm'), length: shirtM('length_cm'), shoulder: shirtM('shoulder_cm'), hem: shirtM('hem_cm'), stretch: shirtM('stretch_p95'),
  } : null;
  const half = (x: number) => Math.round(x * 2) / 2;
  const walkBody = meta?.walk ? meta.body[meta.walk.body] : null;

  // ── wardrobe items: colourways of the same cut, lined up with the reference photo (colourway.ts) ──
  const refs = async (): Promise<Record<'front' | 'back', Ref>> => {
    const S = sceneRef.current;
    if (!S.cwRefs) {
      const info = await fetch(`${CW_DIR}/ref.json`).then(r => r.json());
      S.cwRefs = {
        front: await loadRef(`${CW_DIR}/ref_front_mask.png`, info.px_per_cm.front),
        back: await loadRef(`${CW_DIR}/ref_back_mask.png`, info.px_per_cm.back),
      };
    }
    return S.cwRefs;
  };
  const saveUvMap = async (front: import('./colourway').Result, back: import('./colourway').Result): Promise<StoredUvMap> => {
    const jpeg = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not save the prepared clothing texture.')), 'image/jpeg', 0.92));
    const [frontBlob, backBlob] = await Promise.all([jpeg(front.canvas), jpeg(back.canvas)]);
    return { front: frontBlob, back: backBlob, frontIou: front.iou, backIou: back.iou, frontFabric: front.fabric, backFabric: back.fabric };
  };
  const restoreUvMap = async (item: StoredItem) => {
    if (!item.uv) return null;
    const restore = async (blob: Blob, iou: number, fabric: [number, number, number]): Promise<Result> => {
      const image = await loadImage(blob), canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      canvas.getContext('2d')!.drawImage(image, 0, 0);
      return { canvas, iou, fabric, place: { s: 1, th: 0, tx: 0, ty: 0 }, refCentre: [0, 0], photoPxPerCm: 0 };
    };
    const [front, back] = await Promise.all([
      restore(item.uv.front, item.uv.frontIou, item.uv.frontFabric),
      restore(item.uv.back, item.uv.backIou, item.uv.backFabric),
    ]);
    return { front, back };
  };
  const buildItem = async (id: string, brand: string, name: string, front: Blob, back: Blob): Promise<LabItem | string> => {
    const R = await refs();
    const tf = await makeTexture(front, R.front), tb = await makeTexture(back, R.back);
    const worst = Math.min(tf.iou, tb.iou);
    (window as unknown as { __fitlabColourway: unknown }).__fitlabColourway = { front: tf, back: tb };   // for the self-check
    if (worst < 0.8) return `The shirt outline matches the Gon Tee cut only ${(worst * 100).toFixed(0)}%. This looks like a different cut (or the background is too close to the shirt colour), so it was not added.`;
    return { id, brand, name, frontUrl: URL.createObjectURL(front), backUrl: URL.createObjectURL(back), tex: { front: tf, back: tb } };
  };
  // pants of the Xin cut: the photos are re-drawn into the Xin texture frame; a different cut is refused
  const buildPants = async (id: string, brand: string, name: string, front: Blob, back: Blob): Promise<PantsItem | string> => {
    const S = sceneRef.current;
    S.pantsRef ||= await loadPantsRef(PANTS_REF);
    const R = S.pantsRef as { front: PantsOutline; back: PantsOutline };
    const tf = await makePantsTexture(front, R.front), tb = await makePantsTexture(back, R.back);
    (window as unknown as { __fitlabPants: unknown }).__fitlabPants = { front: tf, back: tb };   // for the self-check
    const worst = Math.max(tf.mismatch, tb.mismatch);
    if (worst > SAME_CUT_MAX) console.warn(`[pants swap] differs from the Xin cut by ${(worst * 100).toFixed(1)} %`, tf.detail, tb.detail);
    if (CHECK_SAME_CUT && worst > SAME_CUT_MAX) return `These pants differ from the Xin cut by ${(worst * 100).toFixed(0)} % in shape (leg width / crotch height), so the sizes would be wrong. They need their own simulation (a new style), not a photo swap.`;
    return { id, brand, name, frontUrl: URL.createObjectURL(front), backUrl: URL.createObjectURL(back), tex: { front: tf, back: tb } };
  };
  const addItem = async (d: { brand: string; name: string; front: File; back: File; kind?: 'shirt' | 'pants'; chart?: SizeChartData; chartMode?: string; savedSize?: string }) => {
    const id = `item_${crypto.randomUUID()}`;
    if (d.kind === 'pants') {
      try {
        const it = await buildPants(id, d.brand, d.name, d.front, d.back);
        if (typeof it === 'string') return it;
        const record = { id, ownerId: userId, brand: d.brand, name: d.name, front: d.front, back: d.back, created: Date.now(), kind: 'pants' as const, chart: d.chart, chartMode: d.chartMode };
        await saveWardrobeItem(userId, record);
        let sizeWarning = '';
        if (d.savedSize) { try { await sizeRecords.saveSize(id, d.savedSize); } catch { sizeWarning = ' Its size could not sync. Open the item to retry.'; } }
        await storeItem({ ...record, cloudSynced: true }).catch(() => undefined);
        setPantsItems(x => [...x, { ...it, chart: d.chart }]);
        setToast(`Added "${d.name}". Tap it to try it on.${sizeWarning}`);
        return null;
      } catch (e) { return (e as Error).message || 'Could not use these photos.'; }
    }
    try {
      const it = await buildItem(id, d.brand, d.name, d.front, d.back);
      if (typeof it === 'string') return it;
      if (!it.tex) return 'Could not prepare this shirt for the fitting room.';
      const record = { id, ownerId: userId, brand: d.brand, name: d.name, front: d.front, back: d.back, uv: await saveUvMap(it.tex.front, it.tex.back), created: Date.now(), kind: 'shirt' as const, chart: d.chart, chartMode: d.chartMode };
      await saveWardrobeItem(userId, record);
      let sizeWarning = '';
      if (d.savedSize) { try { await sizeRecords.saveSize(id, d.savedSize); } catch { sizeWarning = ' Its size could not sync. Open the item to retry.'; } }
      await storeItem({ ...record, cloudSynced: true }).catch(() => undefined);
      setItems(x => [...x, { ...it, chart: d.chart }]);
      setToast(`Added "${d.name}". Tap it to try it on.${sizeWarning}`);
      return null;
    } catch (e) { return (e as Error).message || 'Could not use these photos.'; }
  };
  // Restore account clothes and migrate existing browser-only copies.
  useEffect(() => {
    if (!meta) return;
    let stop = false;
    // Show the original loading tile while a saved garment's prepared UV texture is being restored.
    // A browser-cached UV map bypasses the alignment work and goes straight to the garment card.
    loadStored(userId).then(async local => {
      if (stop || !local.length) return;
      const tops = local.filter(r => r.kind !== 'pants'), bottoms = local.filter(r => r.kind === 'pants');
      setLoadingIds(current => [...new Set([...current, ...tops.map(r => r.id)])]);
      setPantsLoading(current => [...new Set([...current, ...bottoms.map(r => r.id)])]);
      for (const r of tops) if (r.uv) {
        try {
          const tex = await restoreUvMap(r);
          if (!stop && tex) {
            setItems(current => current.some(it => it.id === r.id)
              ? current.map(it => it.id === r.id ? { ...it, tex } : it)
              : [...current, { id: r.id, brand: r.brand, name: r.name, frontUrl: URL.createObjectURL(r.front), backUrl: URL.createObjectURL(r.back), tex, chart: r.chart }]);
            setLoadingIds(current => current.filter(id => id !== r.id));
          }
        } catch { /* Cloud sync below retries if this local texture cache is damaged. */ }
      }
    }).catch(() => undefined);
    syncWardrobe(userId, message => { if (!stop) setToast(message); }).then(async recs => {
      recs.sort((a, b) => a.created - b.created);
      const shirtRecords = recs.filter(r => r.kind !== 'pants');
      const pantsRecords = recs.filter(r => r.kind === 'pants');
      setLoadingIds(current => [...new Set([...current, ...shirtRecords.map(r => r.id)])]);
      setPantsLoading(current => [...new Set([...current, ...pantsRecords.map(r => r.id)])]);
      for (const r of recs) {
        try {
          if (r.kind === 'pants') {
            const it = await buildPants(r.id, r.brand, r.name, r.front, r.back);
            if (typeof it === 'string') throw new Error(it);
            if (!stop) setPantsItems(x => x.some(y => y.id === it.id)
              ? x.map(y => y.id === it.id ? { ...it, chart: r.chart } : y)
              : [...x, { ...it, chart: r.chart }]);
          } else {
            const cached = await restoreUvMap(r);
            const it = cached
              ? { id: r.id, brand: r.brand, name: r.name, frontUrl: URL.createObjectURL(r.front), backUrl: URL.createObjectURL(r.back), tex: cached }
              : await buildItem(r.id, r.brand, r.name, r.front, r.back);
            if (typeof it === 'string') throw new Error(it);
            if (!stop) setItems(x => x.some(y => y.id === it.id)
              ? x.map(y => y.id === it.id ? { ...it, chart: r.chart } : y)
              : [...x, { ...it, chart: r.chart }]);
            if (!cached && it.tex) {
              const uv = await saveUvMap(it.tex.front, it.tex.back);
              const updated = { ...r, uv };
              await storeItem(updated).catch(() => undefined);
              await saveWardrobeUvMap(userId, r.id, uv).catch(() => undefined);
            }
          }
        } catch { if (!stop) setToast(`Could not restore "${r.name}". Its saved photos have been kept; refresh to retry.`); }
        if (!stop) { setLoadingIds(x => x.filter(y => y !== r.id)); setPantsLoading(x => x.filter(y => y !== r.id)); }
      }
    });
    return () => { stop = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseMeta, userId]);
  // wear an item in the fitting room: its photos become the shirt textures of every size and the catwalk
  const wear = (it: LabItem) => {
    const S = sceneRef.current;
    if (!S.THREE) return;
    const THREE = S.THREE;
    S.itemTex ||= {};
    if (it.tex && !S.itemTex[it.id]) {
      const tex = (c: HTMLCanvasElement) => {
        const t = new THREE.CanvasTexture(c); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
      };
      // sheen = 0.9 x the fabric colour: reproduces the original material's sheen (0.25, 0.42, 0.33) when the
      // original Gon Tee photos are used (their fabric reads 0.28, 0.43, 0.38)
      const sheen = new THREE.Color().setRGB(...it.tex.front.fabric.map(v => 0.9 * v) as [number, number, number]);
      S.itemTex[it.id] = { front: tex(it.tex.front.canvas), back: tex(it.tex.back.canvas), sheen };
    }
    S.colourway = it.tex ? S.itemTex[it.id] : null;
    applyColourway(S); setActiveId(it.id);
  };
  // If a card is tapped before its background texture alignment finishes, apply that texture as soon as ready.
  useEffect(() => {
    const it = items.find(item => item.id === activeId);
    if (it?.tex) wear(it);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, activeId, ready]);
  const removeItem = async (it: LabItem) => {
    if (!confirm(`Remove "${it.name}" from the Fit Lab wardrobe?`)) return;
    try { await deleteWardrobeItem(userId, it.id); await unstoreItem(it.id); } catch { setToast('Could not remove this item. Please try again.'); return; }
    const S = sceneRef.current;
    if (activeId === it.id) wear(GON);
    S.itemTex?.[it.id]?.front.dispose(); S.itemTex?.[it.id]?.back.dispose(); if (S.itemTex) delete S.itemTex[it.id];
    setItems(x => x.filter(y => y.id !== it.id));
  };
  // wear a pants photo swap (null = the original Xin photos): always on the simulated Xin jeans
  const wearPants = (id: string | null) => {
    setPantsSkin(id);
    if (id) { setPantsId('xin'); setJeansSize(j => j ?? 'L'); }
  };
  const removePants = async (it: PantsItem) => {
    if (!confirm(`Remove "${it.name}" from the Fit Lab wardrobe?`)) return;
    try { await deleteWardrobeItem(userId, it.id); await unstoreItem(it.id); } catch { setToast('Could not remove this item. Please try again.'); return; }
    const S = sceneRef.current;
    if (pantsSkin === it.id) setPantsSkin(null);
    S.pantsTex?.[it.id]?.front.dispose(); S.pantsTex?.[it.id]?.back.dispose(); if (S.pantsTex) delete S.pantsTex[it.id];
    setPantsItems(x => x.filter(y => y.id !== it.id));
  };
  const hideBuiltin = (it: LabItem, top: boolean) => {
    if (!confirm(`Remove "${it.name}" from the Fit Lab wardrobe? (Built-in item: "Restore" brings it back.)`)) return;
    if (top && activeId === it.id) setShirtOn(false);
    if (!top && bottomOn === it.id) setJeansSize(null);
    saveHidden([...hidden, it.id]);
  };
  const checkFit = (it: LabItem, sz: Size) => {
    wear(it); setSize(sz); setShirtOn(true); setOpenItem(null); seen(it.id); openRoom();
  };
  const toggleWalk = () => {
    if (!walking && walkBody) {
      preWalkBody.current = { height, chest, shoulder, waist };
      setHeight(walkBody.height); setChest(walkBody.chest); setShoulder(null); setWaist(null);
    } else if (walking) {
      const previous = preWalkBody.current;
      if (hasProfile && savedBody.current) {
        // The catwalk body is temporary. Restore the user's saved profile values when it stops.
        const saved = savedBody.current;
        setHeight(saved.height); setChest(saved.chest); setShoulder(saved.shoulder); setWaist(saved.waist);
      } else if (previous) {
        setHeight(previous.height); setChest(previous.chest); setShoulder(previous.shoulder); setWaist(previous.waist);
      }
      preWalkBody.current = null;
    }
    setWalkStatus(null); setWalking(w => !w);
  };
  const shRange = sb?.ok ? [Math.ceil(sb.range.shoulder[0] * 2) / 2, Math.floor(sb.range.shoulder[1] * 2) / 2] : null;
  const wRange = sb?.ok ? [Math.ceil(sb.range.waist[0]), Math.floor(sb.range.waist[1])] : null;
  const ease = bodyNow && shirtNow ? shirtNow.chest - bodyNow.chest : null;
  // style tier: chest ease as % of the body chest (the Gon Tee has a dropped shoulder, so "Oversized" is allowed)
  const verdictOf = (e: number) => fitTier(e, bodyNow?.chest ?? 100).label;
  const colorOf = (e: number) => fitTier(e, bodyNow?.chest ?? 100).color;
  // a shirt product not simulated on this body is not drawn: say so instead of a blank verdict
  const verdict = ease === null ? (topProduct && meta && Object.keys(w).length ? `Not simulated for a body like yours yet, so it is not shown (simulated so far: ${(topProduct.simulated?.[size] ?? []).map(k => k.replace(/^h(\d+)_c(\d+)$/, '$1 cm / chest $2')).join(', ') || 'none'})` : '—') : verdictOf(ease);
  const verdictColor = ease === null ? C.navy : colorOf(ease);
  // room at the chest for every size on the current body (for the wardrobe's size chart)
  // fitsOf: the same for any top's data (m = the body grid with that shirt's numbers: withShirt)
  const fitsOf = (m: GridMeta | null, sizes: readonly string[]) => Object.fromEntries(sizes.map(sz => {
    const sh = m?.shirt[sz as Size];
    if (!m || !sh || !bodyNow || !Object.keys(w).every(k => sh[k])) return [sz, null];
    const g = m.shirt_var_grid?.[sz as Size];
    const vd = (v: Variant) => g && Object.keys(w).every(k => g[k]?.[v]) ? blend(w, k => g[k][v]!.chest_cm) : (m.shirt_var?.[sz as Size]?.[v]?.chest_cm ?? 0);
    const e = blend(w, k => sh[k].chest_cm) + VARIANTS.reduce((t, v) => t + (sb?.vw[v] ?? 0) * vd(v), 0) - bodyNow.chest;
    return [sz, { ease: e, verdict: verdictOf(e), color: colorOf(e) }];
  })) as SizeFit;
  const sizeFit = fitsOf(meta, topSizes);
  const topFitOf = (it: LabItem | null | undefined) => it?.topDir ? fitsOf(baseMeta && withShirt(baseMeta, topProductOf(it)), sizesOfTop(it)) : fitsOf(baseMeta, SIZES);

  // ── bottoms section of the wardrobe: Xin, its photo swaps, and pants with their own simulation (products) ──
  const bottoms: LabItem[] = [
    { id: 'xin', brand: 'TNT CO', name: '"Xin" Denim Biker Pants (grey)', frontUrl: XIN.front, backUrl: XIN.back, builtin: true },
    ...pantsItems.map(p => ({ id: p.id, brand: p.brand, name: p.name, frontUrl: p.frontUrl, backUrl: p.backUrl, pantsTex: p.tex ? { front: p.tex.front.canvas, back: p.tex.back.canvas } : undefined })),
    ...products.filter(p => p.id !== 'xin_check').map(p => ({ id: p.id, brand: p.brand, name: p.name, frontUrl: `${p.dir}/front.png`, backUrl: `${p.dir}/back.png`, builtin: true })),
  ];
  const bottomOn = !jeansSize ? '' : pantsId === 'xin' ? (pantsSkin ?? 'xin') : pantsId;
  const putOnBottom = (it: LabItem, sz: string) => {
    if (pantsItems.some(p => p.id === it.id)) { setPantsSkin(it.id); setPantsId('xin'); }
    else { setPantsSkin(null); setPantsId(it.id); }
    setJeansSize(sz);
  };
  // wear a bottom in the given size (from its window's "Try it on")
  const wearBottom = (it: LabItem, sz: string) => { putOnBottom(it, sz); setOpenPants(null); seen(it.id); openRoom(); };

  // ── size charts: an added item with its own chart reuses the simulation only for sizes that match it ──
  const shirtRef: SizeChartData = baseMeta ? Object.fromEntries(SIZES.map(z => [z, { ...baseMeta.chart[z] }])) : {};
  const pantsRef: SizeChartData = meta?.jeans ? Object.fromEntries(Object.entries(meta.jeans.sizes).map(([z, J]) =>
    [z, { waist: J.chart.elastic_waist ?? J.chart.waist, hip: J.chart.hip, length: J.chart.length, opening: J.chart.opening }])) : {};
  const topMatch = (it: LabItem | null | undefined) => it?.chart ? matchChart('shirt', it.chart, shirtRef) : null;
  const pantsMatch = (it: LabItem | null | undefined) => it?.chart ? matchChart('pants', it.chart, pantsRef) : null;
  const canWear = (m: Record<string, SizeMatch> | null, z: string | null) => !m || !z || !!m[z]?.ok;
  const anyWear = (m: Record<string, SizeMatch> | null) => !m || Object.values(m).some(x => x.ok);
  const visTops = items.filter(it => !hidden.includes(it.id)), visBots = bottoms.filter(it => !hidden.includes(it.id));
  const activeTop = shirtOn ? items.find(i => i.id === activeId) ?? null : null;
  const activeBottom = jeansSize ? bottoms.find(b => b.id === bottomOn) ?? null : null;
  const wearingLabel = [activeTop && `${activeTop.name} ${size}`, activeBottom && `${activeBottom.name} ${jeansSize}`].filter(Boolean).join(' + ');
  const wearing = [activeTop && { name: activeTop.name, size }, activeBottom && { name: activeBottom.name, size: jeansSize! }].filter(Boolean) as { name: string; size: string }[];
  const walkNote = walkStatus || `Walking ${shirtOn ? `in size ${size}` : 'without a shirt'}. Cloth physics replayed frame by frame on the ${walkBody?.height} cm / chest ${walkBody?.chest} cm body.`;
  const toggleFav = (id: string) => setFavs(f => f.includes(id) ? f.filter(x => x !== id) : [...f, id]);
  // a product's pants sizes are known once its product.json has loaded: keep the worn size one it has
  useEffect(() => {
    if (pants && jeansSize && !pants.sizes[jeansSize]) setJeansSize(Object.keys(pants.sizes).includes('L') ? 'L' : Object.keys(pants.sizes)[0] ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pantsId, product, meta, jeansSize]);

  // fitting room "Change clothes": tap to wear (in a size simulated for its chart), tap the worn one to take it off
  const tapTop = (it: LabItem) => {
    if (activeTop?.id === it.id) { setShirtOn(false); return; }
    const m = topMatch(it), z = initialSize(sizeRecords.sizes[it.id], recommendTop(it), sizesOfTop(it).filter(q => canWear(m, q))) as Size;
    if (!z) { setToast(`${it.name}: ${notSimText('shirt', m?.[size], 'Gon Tee')}`); return; }
    wear(it); setSize(z); setShirtOn(true); seen(it.id);
  };
  const tapBottom = (it: LabItem) => {
    if (activeBottom?.id === it.id) { setJeansSize(null); return; }
    const m = pantsMatch(it), want = sizeRecords.sizes[it.id] ?? recommendBottom(it) ?? '';
    const available = Object.keys(sizeCatalog[it.id]?.belt ?? pantsRef).filter(q => canWear(m, q));
    const z = initialSize(want, recommendBottom(it), available);
    if (!z) { setToast(`${it.name}: ${notSimText('pants', m?.[want], 'Xin jeans')}`); return; }
    putOnBottom(it, z); seen(it.id);
  };

  // ── random outfit: a top and bottoms from the wardrobe, each in a size that fits THIS body ──
  const productCache = useRef<Record<string, PantsProduct>>({});
  const randomOutfit = async () => {
    if (!meta) return;
    const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
    // tops: the size closest to a regular fit (12 % room at the chest), never one that is too small
    const tops = visTops.flatMap(it => {
      const m = topMatch(it), fits = topFitOf(it);
      const ok = sizesOfTop(it).filter(z => canWear(m, z) && fits[z] && fits[z]!.ease >= 0);
      if (!ok.length || !bodyNow) return [];
      // the look the shirt was designed for: oversized shirts aim at ~30 % room, others at a regular 12 %
      const aim = topProductOf(it)?.intended_fit === 'Oversized' ? 30 : 12;
      const z = ok.reduce((a, b) => Math.abs(100 * fits[b]!.ease / bodyNow.chest - aim) < Math.abs(100 * fits[a]!.ease / bodyNow.chest - aim) ? b : a);
      return [{ it, z }];
    });
    // bottoms: the size and belt the fit rules call best (comfortable > loose > snug; no belt needed beats a belt);
    // sizes that cannot be worn or were not simulated for this body are never picked
    const rank: Record<string, number> = { green: 0, blue: 1, amber: 2 };
    const bots: { it: LabItem; z: string; belt: boolean }[] = [];
    for (const it of visBots) {
      let pd: PantsData | null = null;
      if (it.id === 'xin' || pantsItems.some(p => p.id === it.id)) pd = meta.jeans ? { ...meta.jeans } : null;
      else {
        const pr = products.find(p => p.id === it.id);
        if (pr) try {
          productCache.current[pr.id] ||= await fetch(`${pr.dir}/product.json`).then(r => r.json());
          const P = productCache.current[pr.id];
          pd = { name: P.name, sizes: P.belt, drop: P.drop, belt: P.belt, elasticStretch: P.elastic_stretch ?? null };
        } catch { /* skip */ }
      }
      if (!pd) continue;
      const m = pantsMatch(it);
      let best: { z: string; belt: boolean; r: number } | null = null;
      for (const z of Object.keys(pd.sizes)) {
        if (!canWear(m, z)) continue;
        for (const bt of [false, true]) {
          const b2 = wornBody(meta, pd, z, height, chest, shoulderNow, shirtLock ? null : waist, shirtLock ? 0 : belly);
          const st = jeansState(meta, pd, z, bt, height, chest, shoulderNow, b2.waist, b2.belly);
          if (!st || st.hide || !st.now || !(st.now.tone in rank)) continue;
          const r = rank[st.now.tone] + (bt ? 0.5 : 0);
          if (!best || r < best.r) best = { z, belt: bt, r };
        }
      }
      if (best) bots.push({ it, z: best.z, belt: best.belt });
    }
    if (!tops.length && !bots.length) { setToast('Nothing in your wardrobe fits this body yet.'); return; }
    let t = tops.length ? pick(tops) : null, b = bots.length ? pick(bots) : null;
    for (let i = 0; i < 8 && tops.length * Math.max(1, bots.length) > 1 && t?.it.id === activeTop?.id && b?.it.id === activeBottom?.id; i++) { t = tops.length ? pick(tops) : null; b = bots.length ? pick(bots) : null; }
    if (t) { wear(t.it); setSize(t.z); setShirtOn(true); seen(t.it.id); } else setShirtOn(false);
    if (b) { putOnBottom(b.it, b.z); setBelt(b.belt); seen(b.it.id); } else setJeansSize(null);
    setToast(`🎲 ${t ? `${t.it.name} (${t.z})` : 'No top fits you'} + ${b ? `${b.it.name} (${b.z}${b.belt ? ', belt' : ''})` : 'no bottoms fit you'}: sizes picked for your body. Tap ♡ Save outfit to keep it.`);
    openRoom();
  };

  // ── outfits ──
  const saveOutfit = () => {
    if (!activeTop && !activeBottom) { setToast('Put something on first, then save the outfit.'); return; }
    const o: Outfit = { id: `o_${Date.now()}`, name: [activeTop?.name, activeBottom?.name].filter(Boolean).join(' + '),
      top: activeTop?.id ?? null, topSize: activeTop ? size : null, bottom: activeBottom?.id ?? null, bottomSize: activeBottom ? jeansSize : null,
      belt: activeBottom ? belt : false, created: Date.now() };
    if (outfits.some(x => x.top === o.top && x.topSize === o.topSize && x.bottom === o.bottom && x.bottomSize === o.bottomSize && !!x.belt === !!o.belt)) {
      setToast('This outfit is already in Outfits.'); return;
    }
    setOutfits(x => [o, ...x]); setToast('♡ Outfit saved. Find it in the Outfits tab.');
  };
  const wearOutfit = (o: Outfit) => {
    const t = o.top ? items.find(i => i.id === o.top) : null, b = o.bottom ? bottoms.find(i => i.id === o.bottom) : null;
    if ((o.top && !t) || (o.bottom && !b)) setToast('Part of this outfit was removed from the wardrobe.');
    if (t && o.topSize) { wear(t); setSize(o.topSize as Size); setShirtOn(true); } else setShirtOn(false);
    if (b && o.bottomSize) { putOnBottom(b, o.bottomSize); setBelt(!!o.belt); } else setJeansSize(null);
    openRoom();
  };
  // the open bottom's simulation: Xin (and its photo swaps) from the grid, other cuts from their product folder
  const pm = openPants && (openPants.id === 'xin' || pantsItems.some(p => p.id === openPants.id))
    ? (meta?.jeans ? { sims: meta.jeans.belt ?? meta.jeans.sizes, glb: (z: string) => meta.jeans?.belt ? `${openPants.id === 'xin' ? XIN_GRID_DIR : XIN.grid}/belt/jeans_${z}.glb.gz` : `${openPants.id === 'xin' ? XIN_GRID_DIR : XIN.grid}/jeans_${z}.glb.gz`,
        note: openPants.id === 'xin' ? 'Chart from the brand. Every size was cloth-simulated on real body shapes, so "Check My Fit" shows where the waistband sits, how the legs hang and where the hem lands on your body.'
          : 'Same cut as the Xin jeans: your photos are wrapped on the Xin simulation, so sizes, drape and fit are those of the Xin jeans.' } : null)
    : openProduct && openProduct.id === openPants?.id ? { sims: openProduct.belt, glb: (z: string) => `${openProduct.dir}/belt/jeans_${z}.glb.gz`,
        note: 'Its own cloth simulation, built automatically from the brand size chart and photos; so far on the 175 cm / chest 101 cm body only.' } : null;
  const pantsFits = Object.fromEntries(Object.entries(pm?.sims ?? {}).map(([z]) => {
    if (!meta || !pm) return [z, null];
    const state = jeansState(meta, { name: openPants?.name ?? 'Pants', sizes: pm.sims, belt: pm.sims,
      elasticStretch: openProduct?.id === openPants?.id ? openProduct?.elastic_stretch : null },
      z, true, height, chest, shoulderNow, null, 0);
    if (!state?.now) return [z, null];
    return [z, { verdict: state.hide ? 'Preview unavailable' : state.now.label, color: TONE[state.now.tone], ease: state.now.waistEase, detail: state.now.elasticExtension != null ? `${(state.now.elasticExtension * 100).toFixed(0)}% elastic stretch` : undefined }];
  })) as Record<string, PantsSizeFit>;

  // the size that fits this body; a shirt product designed oversized is recommended for that look, not its smallest size
  const recommendTop = (it: LabItem | null) => {
    if (!it || !hasProfile || !sb?.ok) return null;
    const fits = topFitOf(it), sizes = sizesOfTop(it), want = topProductOf(it)?.intended_fit;
    const tier = (z: string) => fits[z as Size] ? fitTier(fits[z as Size]!.ease, bodyNow?.chest ?? chest) : null;
    if (want) {
      const z = sizes.find(q => tier(q)?.label === want && canWear(topMatch(it), q));
      if (z) return z;
    }
    return recommendedTop(sizes, tier, z => canWear(topMatch(it), z));
  };
  const recommendBottom = (it: LabItem | null) => {
    if (!it || !meta || !hasProfile || !sb?.ok) return null;
    const data = sizeCatalog[it.id];
    const sims = data?.belt ?? ((it.id === 'xin' || pantsItems.some(p => p.id === it.id)) ? meta.jeans?.belt ?? meta.jeans?.sizes : null);
    if (!sims) return null;
    return recommendedBottom(Object.keys(sims), z => jeansState(meta, { name: it.name, sizes: sims, belt: sims, elasticStretch: data?.elastic_stretch }, z, false, height, chest, shoulderNow, null, 0),
      z => canWear(pantsMatch(it), z));
  };

  // wardrobe lists for the current tab: Favourite = starred, Recent = last tried on (newest first)
  const listFor = (list: LabItem[]) => tab === 'fav' ? list.filter(i => favs.includes(i.id))
    : tab === 'recent' ? recent.map(id => list.find(i => i.id === id)).filter((x): x is LabItem => !!x) : list;
  const shownTops = kindFilter === 'bottoms' ? [] : listFor(visTops), shownBots = kindFilter === 'tops' || !meta?.jeans ? [] : listFor(visBots);
  const favCount = [...visTops, ...visBots].filter(i => favs.includes(i.id)).length;
  const topWarn = (it: LabItem) => anyWear(topMatch(it)) ? null : 'Own size chart · not simulated';
  const botWarn = (it: LabItem) => anyWear(pantsMatch(it)) ? null : 'Own size chart · not simulated';
  const strip = (list: LabItem[], on: string | undefined, tap: (it: LabItem) => void, warn: (it: LabItem) => string | null) => (
    <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1">
      {[...list.filter(i => favs.includes(i.id)), ...list.filter(i => !favs.includes(i.id))].map(it => (
        <button key={it.id} onClick={() => tap(it)} aria-pressed={on === it.id} title={warn(it) ?? it.name}
          className="w-[72px] shrink-0 snap-start text-left" style={{ opacity: warn(it) ? 0.45 : 1 }}>
          <div className="relative aspect-[3/4] overflow-hidden rounded-lg border-2 bg-white" style={{ borderColor: on === it.id ? C.navy : C.peach }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={it.frontUrl} alt="" loading="lazy" className="h-full w-full object-contain p-1" style={{ transform: 'scale(1.35)' }} />
            {on === it.id && <span className="absolute inset-x-0 bottom-0 py-0.5 text-center text-[9px] font-bold text-white" style={{ background: C.navy }}>WEARING</span>}
            {favs.includes(it.id) && <span className="absolute right-0.5 top-0.5 text-[11px]">⭐</span>}
          </div>
          <div className="mt-1 truncate text-[10px] font-medium">{it.name}</div>
        </button>
      ))}
    </div>
  );
  const TABS: [typeof tab, React.ReactNode][] = [['all', <>All<span className="hidden sm:inline"> items</span> ({visTops.length + (meta?.jeans ? visBots.length : 0)})</>],
    ['fav', `Favourite (${favCount})`], ['recent', 'Recent'], ['outfits', `Outfits (${outfits.length})`]];

  return (
    <>
    <main style={{ background: C.cream, minHeight: '100dvh' }} className="px-4 pb-32 pt-5 md:px-10 md:pb-16">
      <div className="mx-auto max-w-6xl" style={{ color: C.navy }}>
        {/* actions, like /items: random outfit + user guide */}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={randomOutfit} disabled={!meta || !bodyNow} className="flex min-h-[44px] items-center gap-2 rounded-xl px-4 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
            style={{ background: C.navy, opacity: meta && bodyNow ? 1 : 0.5 }}><span className="text-lg">🎲</span> Random outfit</button>
          <button onClick={() => setGuide(true)} className="flex min-h-[44px] items-center gap-2 rounded-xl border-2 bg-white px-4 text-sm font-semibold transition hover:shadow-sm"
            style={{ borderColor: C.peach }}><span className="text-lg">📖</span> User guide</button>
        </div>

        {/* tabs (scroll sideways on a narrow phone) */}
        <div className="-mx-4 mt-4 overflow-x-auto border-b px-4 md:mx-0 md:px-0" style={{ borderColor: C.peach }} role="tablist">
          <div className="flex min-w-max gap-1">
            {TABS.map(([id, l]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                className="relative min-h-[44px] whitespace-nowrap px-2.5 text-sm font-semibold transition sm:px-5" style={{ opacity: tab === id ? 1 : 0.5 }}>
                {l}{tab === id && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded" style={{ background: C.navy }} />}
              </button>
            ))}
          </div>
        </div>

        {tab !== 'outfits' ? <>
          <div className="mt-4 flex gap-2">
            {([['all', 'All'], ['tops', '👕 Tops'], ['bottoms', '👖 Bottoms']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setKindFilter(k)} className="min-h-[36px] rounded-full px-4 text-xs font-semibold transition"
                style={kindFilter === k ? { background: C.navy, color: '#fff' } : { background: '#fff', border: `1.5px solid ${C.peach}` }}>{l}</button>
            ))}
          </div>
          {tab !== 'all' && !shownTops.length && !shownBots.length ? (
            <div className="mt-6 rounded-2xl border-2 border-dashed bg-white/60 p-8 text-center" style={{ borderColor: C.peach }}>
              <div className="text-3xl">{tab === 'fav' ? '☆' : '🕘'}</div>
              <p className="mt-2 text-sm font-semibold">{tab === 'fav' ? 'No favourites yet' : 'Nothing tried on yet'}</p>
              <p className="mt-1 text-xs" style={{ opacity: 0.65 }}>{tab === 'fav' ? 'Tap ☆ on any item to keep it here.' : 'Items you try on in the fitting room show up here.'}</p>
            </div>
          ) : <>
            {kindFilter !== 'bottoms' && (
              <WardrobeGrid sizeSummary={it => ({ recommended: recommendTop(it), saved: sizeRecords.sizes[it.id] })}
                info={it => { const z = sizesOfTop(it); return `${topProductOf(it)?.intended_fit === 'Oversized' ? 'Oversized T-shirt' : 'Short Sleeve Shirt'} · ${z.length} sizes (${z[0]}–${z[z.length - 1]})`; }} items={shownTops} activeId={shirtOn ? activeId : ''} loadingIds={tab === 'all' ? loadingIds.filter(id => !pantsLoading.includes(id)) : []} onOpen={setOpenItem}
                onAdd={tab === 'all' ? () => setAddKind('shirt') : undefined} onDelete={it => it.builtin ? hideBuiltin(it, true) : removeItem(it)}
                favs={favs} onFav={it => toggleFav(it.id)} warn={topWarn}
                subtitle=""
                hiddenCount={tab === 'all' ? items.filter(it => hidden.includes(it.id)).length : 0} onRestore={() => saveHidden(hidden.filter(id => !items.some(it => it.id === id)))} />
            )}
            {meta?.jeans && kindFilter !== 'tops' && (
              <WardrobeGrid sizeSummary={it => ({ recommended: recommendBottom(it), saved: sizeRecords.sizes[it.id] })} title="BOTTOMS" subtitle=""
                addLabel="Add Bottom" onAdd={tab === 'all' ? () => setAddKind('pants') : undefined} items={shownBots} activeId={bottomOn} loadingIds={tab === 'all' ? pantsLoading : []} onOpen={setOpenPants}
                onDelete={it => { const p = pantsItems.find(x => x.id === it.id); if (p) removePants(p); else hideBuiltin(it, false); }}
                favs={favs} onFav={it => toggleFav(it.id)} warn={botWarn}
                hiddenCount={tab === 'all' ? bottoms.filter(it => hidden.includes(it.id)).length : 0} onRestore={() => saveHidden(hidden.filter(id => !bottoms.some(it => it.id === id)))}
                info={it => it.id === 'xin' ? 'Denim pants · M–2XL' : pantsItems.some(p => p.id === it.id) ? 'Pants · Xin cut, photo swap · M–2XL' : 'Pants · own simulation'}
                badge="Wearing" />
            )}
          </>}
        </> : (
          <div className="mt-5 grid grid-cols-2 gap-2 md:gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {[...outfits.filter(o => o.fav), ...outfits.filter(o => !o.fav)].map(o => (
              <OutfitCard key={o.id} o={o} top={o.top ? items.find(i => i.id === o.top) : undefined} bottom={o.bottom ? bottoms.find(i => i.id === o.bottom) : undefined}
                onWear={() => wearOutfit(o)} onFav={() => setOutfits(x => x.map(y => y.id === o.id ? { ...y, fav: !y.fav } : y))}
                onDelete={() => { if (confirm(`Delete the outfit "${o.name}"?`)) setOutfits(x => x.filter(y => y.id !== o.id)); }} />
            ))}
            <button onClick={() => { setToast('Pick a top and bottoms under "Change clothes", then tap ♡ Save outfit.'); openRoom(); }}
              className="flex min-h-[170px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-white p-3 text-center transition hover:shadow-md md:min-h-[220px] md:gap-3 md:p-6" style={{ borderColor: C.pink }}>
              <span className="flex h-11 w-11 items-center justify-center rounded-full text-xl md:h-14 md:w-14 md:text-2xl" style={{ background: C.peach }}>+</span>
              <span className="text-sm font-semibold">Create an outfit</span>
              <span className="text-xs" style={{ opacity: 0.6 }}>Put clothes on in the fitting room and tap ♡ Save</span>
            </button>
            <button onClick={randomOutfit} disabled={!meta || !bodyNow}
              className="flex min-h-[170px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-white p-3 text-center transition hover:shadow-md md:min-h-[220px] md:gap-3 md:p-6" style={{ borderColor: C.peach }}>
              <span className="flex h-11 w-11 items-center justify-center rounded-full text-xl md:h-14 md:w-14 md:text-2xl" style={{ background: C.cream }}>🎲</span>
              <span className="text-sm font-semibold">Random outfit</span>
              <span className="text-xs" style={{ opacity: 0.6 }}>A top and bottoms in sizes that fit your body</span>
            </button>
          </div>
        )}

        {DEV_PANELS && meta?.videos?.beauty && (
          <section className="mt-6 rounded-2xl p-5 shadow-sm" style={{ background: '#fff' }}>
            <h2 className="font-semibold">Walking videos: sizes side by side{meta.walk ? ` (${SIZES.filter(z => meta.walk!.sizes[z]).join(' vs ')})` : ''}</h2>
            <p className="mt-1 text-sm" style={{ opacity: 0.75 }}>Same body (175 cm, chest 101 cm), same walk, cloth simulated separately for each size{meta.walk?.layered && Object.keys(meta.walk.layered).length ? `, the shirt walking over the jeans (${Object.entries(meta.walk.layered).map(([s, j]) => `shirt ${s} + jeans ${j}`).join(', ')}): the shirt hem rests on and swings over the denim` : ''}. The second video is the fit map of the shirt and the jeans (red = pulled tight, white = touching, blue = hanging loose; denim counts as tight sooner, as it has limited stretch).</p>
            <video src={meta.videos.beauty} controls loop muted playsInline className="mt-3 w-full rounded-xl" />
            {meta.videos.fit && <video src={meta.videos.fit} controls loop muted playsInline className="mt-3 w-full rounded-xl" />}
          </section>
        )}
      </div>

      {/* the way into the fitting room, always in reach: a full-width bar on a phone, a floating button on bigger screens */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-white/95 px-4 pt-3 backdrop-blur md:inset-x-auto md:bottom-6 md:right-6 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none"
        style={{ borderColor: C.peach, paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
        <button onClick={openRoom} className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl px-6 text-sm font-semibold text-white shadow-lg transition hover:opacity-90 md:w-auto md:rounded-full"
          style={{ background: C.navy }}>
          <span className="min-w-0 truncate">Fitting room{wearingLabel ? <span className="font-normal opacity-75"> · {wearingLabel}</span> : ''}</span>
        </button>
      </div>
    </main>

    {/* ═══ FITTING ROOM: a full-screen layer on top of the wardrobe. Always mounted (the 3D scene loads once), hidden
         and paused while closed. Phone: the 3D body on top, the controls scroll below it. Wider: side by side. ═══ */}
    <div role="dialog" aria-modal="true" aria-label="Fitting room" aria-hidden={!roomOpen}
      className={`fixed inset-0 z-[60] flex flex-col ${roomOpen ? '' : 'pointer-events-none invisible'}`} style={{ background: C.cream, color: C.navy }}>
      {/* a round back button on the left, the title and what is worn in the exact middle (same width spacer on the right) */}
      <header className="grid shrink-0 grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2 border-b bg-white px-3 pb-2 md:px-5" style={{ borderColor: C.peach, paddingTop: 'max(8px, env(safe-area-inset-top))' }}>
        <button onClick={closeRoom} aria-label="Back to the wardrobe" title="Back to the wardrobe"
          className="flex h-11 w-11 items-center justify-center rounded-full border transition hover:bg-black/5 active:scale-95" style={{ borderColor: C.peach, background: C.cream }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <div className="min-w-0 text-center">
          <div className="text-sm font-bold leading-tight sm:text-base">Fitting room</div>
          <div className="mt-0.5 flex min-w-0 items-center justify-center gap-1.5 text-[11px] leading-tight sm:text-xs" style={{ opacity: 0.75 }}>
            {wearing.length ? wearing.map((w, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="shrink-0" style={{ opacity: 0.5 }}>+</span>}
                <span className="flex min-w-0 items-center gap-1">
                  <span className="truncate">{w.name}</span>
                  <span className="shrink-0 rounded px-1 text-[10px] font-bold" style={{ background: C.navy, color: '#fff' }}>{w.size}</span>
                </span>
              </React.Fragment>
            )) : 'Nothing on yet'}
          </div>
        </div>
        <span aria-hidden="true" />
      </header>
      <div className="flex min-h-0 flex-1 flex-col landscape:sm:grid landscape:sm:grid-cols-[minmax(0,1fr)_340px] lg:grid lg:grid-cols-[minmax(0,1fr)_400px] landscape:lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="relative flex h-[46dvh] shrink-0 flex-col overflow-hidden landscape:sm:h-auto lg:h-auto" style={{ background: '#fff' }}>
          <div className="relative min-h-0 flex-1 overflow-hidden" style={{ background: '#fff' }}>
          {/* absolute: the canvas's own pixel size never feeds back into the layout */}
          <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full touch-none" />
            {(loading || error) && (
                <div className="absolute inset-0 flex items-center justify-center text-sm" style={{ color: error ? C.red : C.navy }}>
                  {error || <ModelSkeleton />}
                </div>
              )}
              <div className="absolute left-3 top-3 flex rounded-full p-1 text-sm shadow" style={{ background: '#fff' }}>
                {(['fabric', 'fit'] as ViewMode[]).map(m => (
                  <button key={m} onClick={() => setMode(m)} className="rounded-full px-4 py-1.5 font-medium transition"
                    style={mode === m ? { background: C.navy, color: '#fff' } : { color: C.navy }}>
                    {m === 'fabric' ? 'Fabric' : 'Fit map'}
                  </button>
                ))}
              </div>
              {meta?.walk && (
                <div className="absolute right-3 top-3 flex flex-col items-end gap-2">
                  <button onClick={toggleWalk} className="rounded-full px-4 py-1.5 text-sm font-semibold shadow transition"
                    style={walking ? { background: C.pink, color: C.navy } : { background: C.navy, color: '#fff' }}>
                    {walking ? '■ Stop' : '▶ Catwalk'}
                  </button>
                  {(walkStatus || walking) && (
                    <div className="hidden max-w-[240px] rounded-xl px-3 py-2 text-right text-xs shadow lg:block landscape:sm:block" style={{ background: '#fff' }}>
                      {walkNote}
                    </div>
                  )}
                </div>
              )}
              {shirtOn && !walking && shirtProg?.size === size && (
                <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-xs font-semibold shadow" style={{ background: '#fff', color: C.navy }}>
                  <span className="h-4 w-4 animate-spin rounded-full border-2" style={{ borderColor: C.navy, borderTopColor: 'transparent' }} />
                  Putting on size {shirtProg.size}…{shirtProg.pct > 0 && ` ${shirtProg.pct} %`}
                </div>
              )}
              {exact?.showing && exact.glb && (
                <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full px-4 py-1.5 text-xs font-semibold shadow" style={{ background: C.navy, color: '#fff' }}>
                  Your exact simulation: size {exact.size} on {exact.body?.height} cm / chest {exact.body?.chest} cm
                </div>
              )}
              {jeansHide && !walking && !jeansNow && jst?.reason && (
                <div className="absolute inset-x-3 top-14 mx-auto max-w-md rounded-xl px-4 py-2 text-xs font-semibold shadow" style={{ background: '#fef2f2', color: C.red }}>{jst.reason}</div>
              )}
              {jeansNow && jeansHide && !walking && (
                <div className="absolute inset-x-3 top-14 mx-auto max-w-md rounded-xl px-4 py-2 text-xs font-semibold shadow" style={{ background: '#fef2f2', color: C.red }}>
                  {jst?.reason}
                </div>
              )}
          </div>
          {mode === 'fit' && (
            <div className="shrink-0 border-t px-3 py-2 text-[11px] lg:px-4 lg:text-xs" style={{ background: '#fff', borderColor: C.peach }}>
              <div className="mb-1 text-center text-[10px] opacity-60 lg:text-left">Estimated fit</div>
              <div className="flex w-full flex-nowrap justify-between gap-x-0.5 whitespace-nowrap pb-0.5 text-[clamp(8px,2vw,12px)] lg:justify-start lg:gap-x-4 lg:text-xs">
                {FIT_LEGEND.map(([c, l]) => (
                  <span key={l} title={l} className="flex min-w-0 items-center gap-0.5 lg:gap-1"><span className="inline-block h-2 w-2 shrink-0 rounded-sm border lg:h-3 lg:w-3" style={{ background: c, borderColor: '#ddd' }} /><span className="truncate">{l}</span></span>
                ))}
              </div>
            </div>
          )}
        </div>

        <aside className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3 sm:p-4 md:space-y-5 md:p-5" style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
          {/* stacked layout (phone, tablet upright): the notes that sit on the 3D on wide screens, so nothing covers the body */}
          {(walkStatus || walking) && (
            <div className="space-y-1 rounded-xl px-3 py-2 text-xs lg:hidden landscape:sm:hidden" style={{ background: '#fff' }}>
              {(walkStatus || walking) && <p>🚶 {walkNote}</p>}
            </div>
          )}
          <section className="rounded-2xl p-4 shadow-sm md:p-5" style={{ background: '#fff' }}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">Change clothes</h2>
              <button onClick={randomOutfit} className="min-h-[36px] rounded-lg px-3 text-xs font-semibold" style={{ background: C.cream }}>🎲 Random</button>
            </div>
            <div className="mt-2 text-[11px] font-bold uppercase tracking-wider" style={{ opacity: 0.5 }}>Tops</div>
            <div className="mt-1">{strip(visTops, activeTop?.id, tapTop, topWarn)}</div>
            {meta?.jeans && <>
              <div className="mt-3 text-[11px] font-bold uppercase tracking-wider" style={{ opacity: 0.5 }}>Bottoms</div>
              <div className="mt-1">{strip(visBots, activeBottom?.id, tapBottom, botWarn)}</div>
            </>}
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-[11px]" style={{ opacity: 0.55 }}>Tap to wear · tap again to take it off</p>
              {wearing.length > 0 && <button onClick={saveOutfit} className="min-h-[36px] shrink-0 rounded-lg px-3 text-xs font-semibold" style={{ background: C.pink }}>♡ Save outfit</button>}
            </div>
          </section>
              <section className="rounded-2xl p-5 shadow-sm" style={{ background: '#fff' }}>
                <h2 className="font-semibold">Tops</h2>
                {activeTop && <SavedSizeControl itemId={activeTop.id} name={activeTop.name} sizes={topProduct && activeTop.topDir ? topSizes : Object.keys(activeTop.chart ?? shirtRef)} recommended={recommendTop(activeTop)} savedSize={sizeRecords.sizes[activeTop.id]} previewSize={size} onSave={sizeRecords.saveSize} syncError={sizeRecords.error} />}
                <div className="mt-2 grid grid-cols-5 gap-2">
                  <button onClick={() => setShirtOn(false)} className="rounded-lg py-2 text-xs font-semibold transition"
                    style={!shirtOn ? { background: C.navy, color: '#fff' } : { background: C.cream }}>None</button>
                  {topSizes.map(s => (
                    // clicking the size being worn again takes the shirt off
                    <button key={s} disabled={!canWear(topMatch(activeTop ?? items.find(i => i.id === activeId)), s)} title={canWear(topMatch(activeTop ?? items.find(i => i.id === activeId)), s) ? undefined : 'Not simulated for its size chart'}
                      onClick={() => { if (shirtOn && size === s) { setShirtOn(false); return; } setSize(s); setShirtOn(true); if (!walking) setWalkStatus(null); }} className="min-h-[40px] rounded-lg text-sm font-semibold transition disabled:opacity-30"
                      style={shirtOn && size === s ? { background: C.navy, color: '#fff' } : { background: C.cream }}>{s}</button>
                  ))}
                </div>
                {topProduct && (topProduct.colours?.length ?? 0) > 1 && topProduct.base_hex && (() => {
                  const near = (h: string) => { const a = hexToLinear(h), b = hexToLinear(topProduct.base_hex!); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); };
                  const cur = topColour[topProduct.id] ?? [...topProduct.colours!].sort((x, y) => near(x.hex) - near(y.hex))[0].hex;
                  const name = topProduct.colours!.find(c => c.hex === cur)?.name ?? '';
                  return (
                    <div className="mt-3">
                      <div className="mb-1.5 text-xs" style={{ color: C.navy }}>Colour: <span className="font-semibold">{name}</span> <span style={{ opacity: 0.6 }}>· same fit in every colour</span></div>
                      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colour">
                        {topProduct.colours!.map(c => (
                          <button key={c.hex + c.name} role="radio" aria-checked={c.hex === cur} aria-label={c.name} title={c.name}
                            onClick={() => pickTopColour(topProduct.id, c.hex)} className="h-7 w-7 rounded-full transition"
                            style={{ background: c.hex, boxShadow: c.hex === cur ? `0 0 0 2px #fff, 0 0 0 4px ${C.navy}` : 'inset 0 0 0 1px rgba(0,0,0,0.15)' }} />
                        ))}
                      </div>
                    </div>
                  );
                })()}
                {meta?.walk && <div className="mt-2 text-xs" style={{ opacity: 0.6 }}>
                  {SIZES.some(s => !meta.walk!.sizes[s]) && <> · still simulating: {SIZES.filter(s => !meta.walk!.sizes[s]).join(', ')}</>}
                </div>}
                {!shirtOn && <div className="mt-3 text-sm" style={{ opacity: 0.7 }}>Shirt off. Tap a size (or the same size again) to put it back on.</div>}
                {shirtOn && <><div className="mt-3 text-sm">Fit: <span className="font-semibold" style={{ color: verdictColor }}>{verdict}</span>
                  {ease !== null && bodyNow && <span style={{ opacity: 0.7 }}> · {ease >= 0 ? '+' : ''}{ease.toFixed(0)} cm room at the chest ({(100 * ease / bodyNow.chest).toFixed(0)} % of your chest)</span>}
                </div>
                <div className="mt-1 text-[11px]" style={{ opacity: 0.55 }}>
                  Slim 0–8 % · Regular 8–16 % · Relaxed 16–25 % · Oversized 25 %+ room, with a dropped shoulder.
                  No industry standard exists; these bands follow pattern-maker ease charts (see the fit research report).
                </div></>}
              </section>

              <section className="rounded-2xl p-5 shadow-sm space-y-3" style={{ background: '#fff' }}>
                <h2 className="font-semibold">Bottoms</h2>
                {activeBottom && <SavedSizeControl itemId={activeBottom.id} name={activeBottom.name} sizes={Object.keys(activeBottom.chart ?? sizeCatalog[activeBottom.id]?.belt ?? pantsRef)} recommended={recommendBottom(activeBottom)} savedSize={sizeRecords.sizes[activeBottom.id]} previewSize={jeansSize ?? undefined} onSave={sizeRecords.saveSize} syncError={sizeRecords.error} />}
                {products.length > 0 && (
                  <select value={pantsId} onChange={e => { setPantsId(e.target.value); setJeansSize(null); }} className="w-full rounded-lg px-2 py-2 text-xs font-semibold" style={{ background: C.cream }}>
                    <option value="xin">TNT CO &quot;Xin&quot; Denim Biker Pants</option>
                    {products.filter(p => p.id !== 'xin_check' && !hidden.includes(p.id)).map(p => <option key={p.id} value={p.id}>{p.brand} {p.name}</option>)}
                  </select>
                )}
                <div className="grid grid-cols-5 gap-2">
                  <button onClick={() => setJeansSize(null)} className="rounded-lg py-2 text-xs font-semibold"
                    style={!jeansSize ? { background: C.navy, color: '#fff' } : { background: C.cream }}>Basic</button>
                  {Object.keys(pants?.sizes ?? {}).map(s => (
                    <button key={s} disabled={!canWear(pantsMatch(bottoms.find(b => b.id === (pantsId === 'xin' ? (pantsSkin ?? 'xin') : pantsId))), s)} onClick={() => { setJeansSize(s); }} className="min-h-[40px] rounded-lg text-xs font-semibold disabled:opacity-30"
                      style={jeansSize === s ? { background: C.navy, color: '#fff' } : { background: C.cream }}>{s}</button>
                  ))}
                </div>
                {jeansSize && jeansVariant !== 'held' && !elasticW && (
                  <button onClick={() => setBelt(b => !b)} className="w-full rounded-lg py-2 text-xs font-semibold transition"
                    style={belt ? { background: C.navy, color: '#fff' } : { background: C.cream }}>
                    {belt ? 'Belt on: the belt pulls the waistband in at the waist' : 'Add a belt'}
                  </button>
                )}
                {pants && <p className="text-xs" style={{ opacity: 0.6 }}>{pants.name}, {pantsId === 'xin' ? 'rigid 100 % cotton denim' : product?.fabric.replace('_', ' ')}, estimated{pantsId === 'xin' || Object.keys(pants.drop?.[jeansSize ?? ''] ?.bodies ?? pants.sizes[jeansSize ?? '']?.bodies ?? {}).length > 1 ? ' fit preview' : ' (preview: 175 cm / chest 101 cm body only)'}{elasticW ? ', elastic waist' : jeansVariant !== 'held' && (belt ? ', held by a belt' : jeansHide ? '' : ', nothing holding them up but the body')}</p>}
                {jeansNow && (
                  <div className="text-sm space-y-1">
                    <div>Fit: <span className="font-semibold" style={{ color: jeansNow.color }}>{jeansNow.label}</span></div>
                    <div className="text-xs" style={{ opacity: 0.75 }}>
                      {elasticW ? <>Elastic waist {jeansNow.relaxedWaist.toFixed(0)} → {jeansNow.bodyWaist.toFixed(0)} cm ({((jeansNow.elasticExtension ?? 0) * 100).toFixed(0)}% stretch)</>
                        : <>Waistband {jeansNow.relaxedWaist.toFixed(0)} cm on a {jeansNow.bodyWaist.toFixed(0)} cm waist ({jeansNow.waistEase >= 0 ? '+' : ''}{jeansNow.waistEase.toFixed(1)})</>} ·
                      hip {(2 * jeansNow.chart.hip).toFixed(0)} cm on {jeansNow.bodyHip.toFixed(0)} cm ({jeansNow.hipEase >= 0 ? '+' : ''}{jeansNow.hipEase.toFixed(1)})
                      {!jeansHide && ' · '}{jeansHide ? '' : jeansNow.hem <= 0.5 ? 'hem resting on the floor / shoes' : `hem ${jeansNow.hem.toFixed(0)} cm above the floor`}
                      {jeansNow.lengthFit === 'pooling' && !jeansHide && <> · <b>too long</b>: about {jeansNow.extra.toFixed(0)} cm of leg piles up on the shoes (needs hemming)</>}
                      {jeansNow.lengthFit === 'short' && !jeansHide && <> · <b>too short</b>: the ankle shows</>}
                    </div>
                    <div className="text-xs" style={{ opacity: 0.55 }}>Rise ({jeansNow.chart.rise} cm) is not in TNT&apos;s size chart: estimated.</div>
                  </div>
                )}
                {jeansSize && walking && <p className="text-xs" style={{ opacity: 0.6 }}>{pantsId !== 'xin' && product?.id === pantsId && product.walk?.sizes.includes(jeansSize)
                  ? `Walking in shorts ${jeansSize}: the mesh fabric was cloth-simulated through the whole walk.${shirtOn && product.walk.layered[size] === jeansSize ? ` The ${size} shirt was simulated over these shorts.` : ' The shirt uses its separate walk.'}`
                  : pantsId !== 'xin'
                  ? `The catwalk shows the basic pants: ${pants?.name ?? 'these pants'} have not been walked yet (each walk is a full one-hour cloth simulation).`
                  : meta?.walk?.jeans?.[jeansSize]
                  ? `Walking in jeans ${jeansSize}: the denim was cloth-simulated through the whole walk (waistband held at the waist as if belted, legs swing freely).${shirtOn && meta.walk.layered?.[size] === jeansSize ? ` The ${size} shirt was simulated walking over these jeans, so its hem really rests on and swings over the denim.` : ''}`
                  : `The catwalk shows the basic pants: jeans ${jeansSize} is still being walked.`}</p>}
              </section>

              <section className="rounded-2xl p-5 shadow-sm space-y-4" style={{ background: '#fff' }}>
                <h2 className="font-semibold">Body</h2>
                {walking && <p className="text-xs" style={{ opacity: 0.7 }}>The catwalk uses the {walkBody?.height} cm / chest {walkBody?.chest} cm body. Stop the animation to adjust the body size.</p>}
                {meta && <>
                  <Slider label="Height" disabled={walking} value={height} min={meta.heights[0]} max={meta.heights[meta.heights.length - 1]} onChange={setHeight} />
                  <Slider label="Chest" disabled={walking} value={chest} min={meta.chests[0]} max={meta.chests[meta.chests.length - 1]} onChange={setChest} />
                  {sb?.ok && shRange && wRange && <>
                    <Slider label="Shoulder" disabled={walking || shirtLock} note={shirtLock ? 'natural (the shirt was not simulated with other shapes at this height / chest yet)' : shoulder === null ? 'natural' : 'across the back'} step={0.5}
                      value={clamp(half(shoulderNow ?? sb.natural.shoulder), shRange[0], shRange[1])} min={shRange[0]} max={shRange[1]} onChange={setShoulder} />
                    <Slider label="Waist" disabled={walking || jeansLock || shirtLock} note={shirtLock ? 'natural (shirt: see shoulder)' : jeansLock ? 'natural while pants are worn' : waist === null ? 'natural' : undefined}
                      value={clamp(Math.round(waistNow ?? sb.natural.waist), wRange[0], wRange[1])} min={wRange[0]} max={wRange[1]} onChange={setWaist} />
                    {(shoulder !== null || waist !== null) && (
                      <button onClick={() => { setShoulder(null); setWaist(null); }} className="text-xs underline" style={{ opacity: 0.7 }}>
                        Reset shoulder and waist to natural for this body
                      </button>
                    )}
                  </>}
                </>}
                {/* hidden for now (DEV_PANELS): "My exact fit" needs Blender on this computer, and the chart vs. draped
                    check is for us, not shoppers; the code and /api/fitlab/exact stay for demos */}
                {DEV_PANELS && <div className="rounded-xl p-3 text-sm" style={{ background: C.cream }}>
                  <div className="font-semibold">My exact fit</div>
                  <p className="mt-1 text-xs" style={{ opacity: 0.7 }}>
                    The sliders blend simulations of nearby bodies. This builds your own body to these exact numbers and runs a
                    new cloth simulation of size {size} on it (about 5–10 minutes on this computer).
                  </p>
                  {!exact?.id || exact.step === 'done' || exact.step === 'error' ? (
                    <button onClick={startExact} disabled={!bodyNow || walking} className="mt-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
                      style={{ background: C.navy, opacity: !bodyNow || walking ? 0.4 : 1 }}>▶ Run my exact fit (size {size})</button>
                  ) : (
                    <div className="mt-2">
                      <div className="h-2 w-full overflow-hidden rounded bg-white"><div className="h-full rounded" style={{ width: `${exact.pct ?? 0}%`, background: C.navy }} /></div>
                      <div className="mt-1 text-xs" style={{ opacity: 0.7 }}>{exact.msg}</div>
                    </div>
                  )}
                  {exact?.error && <p className="mt-1 text-xs" style={{ color: C.red }}>{exact.error}</p>}
                  {exact?.step === 'error' && <p className="mt-1 text-xs" style={{ color: C.red }}>{exact.msg}</p>}
                  {exact?.step === 'done' && exact.body && exact.shirt && (
                    <div className="mt-2 space-y-1 text-xs">
                      <div>Your body: height {exact.body.height} · chest {exact.body.chest} · waist {exact.body.waist} · hip {exact.body.hip} · shoulder {exact.body.shoulder} cm</div>
                      <div>Size {exact.size} simulated on it: chest {exact.shirt.chest} · length {exact.shirt.length} · shoulder {exact.shirt.shoulder} cm · hem {Math.round(Number(exact.shirt.hem))} cm from the floor
                        {exact.body.chest && exact.shirt.chest && <> · <b>{fitTier(Number(exact.shirt.chest) - exact.body.chest, exact.body.chest).label}</b> ({(Number(exact.shirt.chest) - exact.body.chest).toFixed(1)} cm room)</>}</div>
                      <button onClick={() => setExact(e => e && { ...e, showing: !e.showing })} className="underline">
                        {exact.showing ? 'Back to the slider preview' : 'Show my exact simulation'}
                      </button>
                    </div>
                  )}
                </div>}
                {DEV_PANELS && bodyNow && <p className="text-sm" style={{ opacity: 0.8 }}>
                  Measured on the 3D body: chest {bodyNow.chest.toFixed(1)} · waist {bodyNow.waist.toFixed(1)} · hip {bodyNow.hip.toFixed(1)}
                  {bodyNow.shoulder !== null && <> · shoulder {bodyNow.shoulder.toFixed(1)}</>} cm
                </p>}
              </section>

              {DEV_PANELS && <section className="rounded-2xl p-5 shadow-sm" style={{ background: '#fff' }}>
                <h2 className="font-semibold">Size {size}: chart vs. draped</h2>
                {meta && shirtNow ? (
                  <table className="mt-3 w-full text-sm">
                    <thead><tr className="text-left" style={{ opacity: 0.6 }}><th className="pb-2 font-medium">Measure</th><th className="pb-2 font-medium">Chart</th><th className="pb-2 font-medium">Draped</th></tr></thead>
                    <tbody>
                      {[
                        ['Chest (around)', meta.chart[size].chest * 2, shirtNow.chest],
                        ['Length', meta.chart[size].length, shirtNow.length],
                        ['Shoulder', meta.chart[size].shoulder, shirtNow.shoulder],
                      ].map(([l, c, d]) => (
                        <tr key={l as string} className="border-t" style={{ borderColor: '#eee' }}>
                          <td className="py-2 pr-2">{l}</td><td className="py-2 pr-2">{c} cm</td>
                          <td className="py-2 font-medium" style={{ color: Math.abs((d as number) - (c as number)) <= 1.5 ? C.green : C.red }}>{(d as number).toFixed(1)} cm</td>
                        </tr>
                      ))}
                      <tr className="border-t" style={{ borderColor: '#eee' }}><td className="py-2">Hem height</td><td>—</td><td className="py-2 font-medium">{shirtNow.hem.toFixed(0)} cm</td></tr>
                    </tbody>
                  </table>
                ) : <p className="mt-2 text-sm" style={{ opacity: 0.6 }}>Simulating this size…</p>}
              </section>}
        </aside>
      </div>
    </div>

      <AddItemModal recommendSize={(kind, chart) => {
        const item = { id: kind === 'shirt' ? 'gon' : 'xin', brand: '', name: '', frontUrl: '', backUrl: '', chart };
        return kind === 'shirt' ? recommendTop(item) : recommendBottom(item);
      }} open={!!addKind} kind={addKind ?? 'shirt'} onClose={() => setAddKind(null)} onSubmit={addItem}
      refChart={addKind === 'pants' ? pantsRef : shirtRef} refName={addKind === 'pants' ? 'Xin jeans' : 'Gon Tee'} />
    {meta && bodyNow && (
      <ItemModal recommended={recommendTop(openItem)} savedSize={openItem ? sizeRecords.sizes[openItem.id] : null} onSaveSize={sizeRecords.saveSize} sizeSyncError={sizeRecords.error} item={openItem} onClose={() => setOpenItem(null)} chart={(topProductOf(openItem)?.chart as unknown as Partial<typeof meta.chart>) ?? (openItem?.chart as unknown as Partial<typeof meta.chart>) ?? baseMeta!.chart} sizeFit={topFitOf(openItem)} size={size} gridDir={openItem?.topDir ? `${openItem.topDir}/grid` : GON_FILES.grid}
        fav={!!openItem && favs.includes(openItem.id)} onFav={() => openItem && toggleFav(openItem.id)} match={topMatch(openItem)}
        body={{ height, chest: bodyNow.chest, waist: bodyNow.waist, shoulder: bodyNow.shoulder }} onCheckFit={checkFit} />
    )}
    {openPants && pm && bodyNow && (
      <PantsModal recommended={recommendBottom(openPants)} savedSize={sizeRecords.sizes[openPants.id]} onSaveSize={sizeRecords.saveSize} sizeSyncError={sizeRecords.error} item={openPants} onClose={() => setOpenPants(null)} sizes={Object.keys(pm.sims)}
        chart={Object.fromEntries(Object.entries(pm.sims).map(([z, J]) => [z, ({ ...J.chart, waist: J.chart.elastic_waist ?? J.chart.waist, ...openPants.chart?.[z] }) as PantsChart]))} fits={pantsFits} glb={pm.glb}
        fav={favs.includes(openPants.id)} onFav={() => toggleFav(openPants.id)} match={pantsMatch(openPants)}
        size={jeansSize ?? 'L'} body={{ height, chest: bodyNow.chest, waist: bodyNow.waist }} note={pm.note} onCheckFit={wearBottom} />
    )}
    {guide && <UserGuideModal onClose={() => setGuide(false)} />}
    {toast && (
      <div role="status" aria-live="polite" className="fixed inset-x-4 bottom-24 z-[80] mx-auto max-w-md rounded-xl px-4 py-3 text-center text-sm font-semibold text-white shadow-xl md:bottom-24"
        style={{ background: C.navy }} onClick={() => setToast(null)}>{toast}</div>
    )}
    </>
  );
}
