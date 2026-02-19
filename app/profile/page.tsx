// app/profile/page.tsx
// All logged-in users: view 3D body, change body size with sliders, try on wardrobe shirts
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/contexts/AuthContext';
import { getAvatar, saveAvatar, getUserClothingItems, getUserOutfits } from '@/lib/firebase/firestore';
import type { ClothingItem, OutfitCombination } from '@/lib/types/clothing';

const C = { cream: '#F8F3EA', navy: '#0B1957', peach: '#FFDBD1', pink: '#FA9EBC' };
const BODY_BASE = { height: 150, chest: 30, shoulder: 43, waist: 29 };
const BODY_MAX  = { height: 198, chest: 57, shoulder: 55, waist: 54 };
type Measurements = { height: number; chest: number; waist: number; shoulder: number };
function clamp(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)); }
function norm01(cm: number, base: number, max: number) { return clamp((cm - base) / (max - base), 0, 1); }

export default function ProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [displayName,      setDisplayName]      = useState('');
  const [measurements,     setMeasurements]     = useState<Measurements>({ height: 170, chest: 90, waist: 75, shoulder: 44 });
  const [tempMeasurements, setTempMeasurements] = useState<Measurements>({ height: 170, chest: 90, waist: 75, shoulder: 44 });
  const [showSliders,      setShowSliders]      = useState(false);
  const [saving,           setSaving]           = useState(false);
  const [success,          setSuccess]          = useState<string | null>(null);
  const [items,            setItems]            = useState<ClothingItem[]>([]);
  const [outfits,          setOutfits]          = useState<OutfitCombination[]>([]);
  const [selectedItem,     setSelectedItem]     = useState<ClothingItem | null>(null);
  const [outfitTab,        setOutfitTab]        = useState<'items' | 'outfits'>('items');
  const [show2d,           setShow2d]           = useState(false);
  const [loadingData,      setLoadingData]      = useState(true);
  const [bodyReady,        setBodyReady]        = useState(false);

  // 3D body canvas
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sceneRef  = useRef<{ animId: ReturnType<typeof requestAnimationFrame>; renderer: any; ro: ResizeObserver; updateBody: (m: Measurements) => void } | null>(null);

  // 3D shirt canvas
  const shirtCanvasRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shirtSceneRef  = useRef<{ animId: ReturnType<typeof requestAnimationFrame>; renderer: any; ro: ResizeObserver } | null>(null);

  useEffect(() => { if (!authLoading && !user) router.push('/login'); }, [user, authLoading, router]);

  // Load profile + wardrobe
  useEffect(() => {
    if (!user) return;
    setLoadingData(true);
    Promise.all([getAvatar(user.uid), getUserClothingItems(user.uid), getUserOutfits(user.uid)])
      .then(([profile, clothingItems, userOutfits]) => {
        if (profile) {
          const m = { height: profile.height, chest: profile.chest, waist: profile.waist, shoulder: profile.shoulder };
          setMeasurements(m); setTempMeasurements(m);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setDisplayName((profile as any).displayName || '');
        }
        setItems(clothingItems);
        setOutfits(userOutfits);
        setLoadingData(false);
      });
  }, [user]);

  // ── Body 3D scene ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current) return;
    let cancelled = false;

    Promise.all([
      import('three'),
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/controls/OrbitControls.js'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ]).then(([THREE, { GLTFLoader }, { OrbitControls }]: any[]) => {
      if (cancelled || !canvasRef.current) return;
      const canvas = canvasRef.current;
      const W = canvas.clientWidth || 700, H = canvas.clientHeight || 600;
      const scene    = new THREE.Scene(); scene.background = new THREE.Color(0xfaf7f2);
      const camera   = new THREE.PerspectiveCamera(38, W / H, 0.1, 100);
      camera.position.set(0, 0.8, 4.0);
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setSize(W, H, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true; controls.minDistance = 1.5; controls.maxDistance = 7;
      controls.target.set(0, 0.5, 0);
      scene.add(new THREE.AmbientLight(0xffffff, 1.0));
      const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(3, 5, 2); scene.add(key);
      const fill = new THREE.DirectionalLight(0xffeedd, 0.3); fill.position.set(-3, 1, -2); scene.add(fill);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let bodyMesh: any = null;
      function setMorph(prefix: string, value: number) {
        if (!bodyMesh?.morphTargetDictionary) return;
        const keys = Object.keys(bodyMesh.morphTargetDictionary) as string[];
        const k = keys.find(k => k === prefix || k.toLowerCase().startsWith(prefix.toLowerCase()));
        if (k) bodyMesh.morphTargetInfluences[bodyMesh.morphTargetDictionary[k]] = value;
      }
      function updateBody(m: Measurements) {
        if (!bodyMesh) return;
        setMorph('CHEST_WIDE',    norm01(m.chest,    BODY_BASE.chest,    BODY_MAX.chest)    * 3.0);
        setMorph('SHOULDER_WIDE', norm01(m.shoulder, BODY_BASE.shoulder, BODY_MAX.shoulder) * 0.5);
        setMorph('HEIGHT',        norm01(m.height,   BODY_BASE.height,   BODY_MAX.height)   * 0.8);
        setMorph('WAIST_WIDE',    norm01(m.waist,    BODY_BASE.waist,    BODY_MAX.waist)    * 10.0);
        setMorph('HIP_WIDE',      clamp(norm01(m.chest, BODY_BASE.chest, BODY_MAX.chest) * 0.4, 0, 1) * 2.0);
        setMorph('BODY_LENGTH',   1.5);
      }
      const loader = new GLTFLoader();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      loader.load('/models/human.glb?v=' + Date.now(), (gltf: any) => {
        if (cancelled) return;
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        model.position.sub(box.getCenter(new THREE.Vector3()));
        scene.add(model);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        model.traverse((obj: any) => {
          if (!obj.isMesh || !obj.morphTargetDictionary || bodyMesh) return;
          const lkeys = Object.keys(obj.morphTargetDictionary).map((k: string) => k.toLowerCase());
          if (lkeys.some((k: string) => k.includes('chest') || k.includes('height') || k.includes('body_length'))) {
            bodyMesh = obj;
            updateBody(measurements);
            if (sceneRef.current) sceneRef.current.updateBody = updateBody;
          }
        });
        setBodyReady(true);
      }, undefined, () => setBodyReady(true));

      let animId: ReturnType<typeof requestAnimationFrame> = 0;
      const animate = () => { animId = requestAnimationFrame(animate); controls.update(); setMorph('BODY_LENGTH', 1.5); renderer.render(scene, camera); };
      animate();
      const ro = new ResizeObserver(() => {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false);
      });
      ro.observe(canvas);
      sceneRef.current = { animId, renderer, ro, updateBody };
    });

    return () => {
      cancelled = true;
      if (sceneRef.current) { cancelAnimationFrame(sceneRef.current.animId); sceneRef.current.renderer.dispose(); sceneRef.current.ro.disconnect(); sceneRef.current = null; }
      setBodyReady(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync body mesh with temp or saved measurements depending on slider state
  useEffect(() => {
    sceneRef.current?.updateBody(showSliders ? tempMeasurements : measurements);
  }, [tempMeasurements, measurements, showSliders]);

  // ── Shirt 3D scene ────────────────────────────────────────────────────
  useEffect(() => {
    if (shirtSceneRef.current) {
      cancelAnimationFrame(shirtSceneRef.current.animId);
      shirtSceneRef.current.renderer.dispose();
      shirtSceneRef.current.ro.disconnect();
      shirtSceneRef.current = null;
    }
    if (!selectedItem || show2d || !shirtCanvasRef.current) return;
    let cancelled = false;

    Promise.all([
      import('three'),
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/controls/OrbitControls.js'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ]).then(([THREE, { GLTFLoader }, { OrbitControls }]: any[]) => {
      if (cancelled || !shirtCanvasRef.current) return;
      const canvas = shirtCanvasRef.current;
      const W = canvas.clientWidth || 220, H = canvas.clientHeight || 280;
      const scene    = new THREE.Scene(); scene.background = new THREE.Color(0xf8f3ea);
      const camera   = new THREE.PerspectiveCamera(45, W / H, 0.1, 50);
      camera.position.set(0, 0.3, 2.2);
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setSize(W, H, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true; controls.autoRotate = true; controls.autoRotateSpeed = 2.5;
      scene.add(new THREE.AmbientLight(0xffffff, 1.0));
      const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(2, 3, 2); scene.add(key);

      const loader = new GLTFLoader();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      loader.load('/models/newtntshirt1.glb?v=' + Date.now(), (gltf: any) => {
        if (cancelled) return;
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        model.position.sub(box.getCenter(new THREE.Vector3()));
        scene.add(model);
        const frontUrl = selectedItem.frontImageUrl || selectedItem.imageUrl;
        if (frontUrl) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          model.traverse((obj: any) => {
            if (!obj.isMesh) return;
            const tex = new THREE.TextureLoader().load(frontUrl);
            tex.flipY = false;
            obj.material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide });
          });
        }
      }, undefined, console.error);

      let animId: ReturnType<typeof requestAnimationFrame> = 0;
      const animate = () => { animId = requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); };
      animate();
      const ro = new ResizeObserver(() => {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false);
      });
      ro.observe(canvas);
      shirtSceneRef.current = { animId, renderer, ro };
    });

    return () => {
      cancelled = true;
      if (shirtSceneRef.current) { cancelAnimationFrame(shirtSceneRef.current.animId); shirtSceneRef.current.renderer.dispose(); shirtSceneRef.current.ro.disconnect(); shirtSceneRef.current = null; }
    };
  }, [selectedItem, show2d]);

  // Slider handlers
  const handleOpenSliders = useCallback(() => {
    setTempMeasurements({ ...measurements }); setShowSliders(true); setSuccess(null);
  }, [measurements]);

  const handleCancelSliders = useCallback(() => {
    setShowSliders(false);
    sceneRef.current?.updateBody(measurements);
  }, [measurements]);

  const handleApplyTemp = useCallback(() => {
    sceneRef.current?.updateBody(tempMeasurements);
    setShowSliders(false);
  }, [tempMeasurements]);

  const handleSavePermanently = useCallback(async () => {
    if (!user) return;
    setSaving(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await saveAvatar({ userId: user.uid, ...tempMeasurements } as any);
      setMeasurements({ ...tempMeasurements });
      setSuccess('Measurements saved! ✅');
      setTimeout(() => setSuccess(null), 3000);
      setShowSliders(false);
    } finally { setSaving(false); }
  }, [user, tempMeasurements]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: C.cream }}>
        <div className="w-10 h-10 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: C.navy, borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ minHeight: '100vh', backgroundColor: C.cream }}>

      {/* ════ BODY CANVAS ════ */}
      <div className="relative flex-1" style={{ minHeight: '60vh', maxHeight: '68vh' }}>
        <canvas ref={canvasRef} className="w-full h-full" style={{ display: 'block' }} />

        {/* Loading overlay */}
        {!bodyReady && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10" style={{ backgroundColor: C.cream }}>
            <div className="w-10 h-10 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: C.navy, borderTopColor: 'transparent' }} />
            <p className="text-sm font-bold" style={{ color: C.navy }}>Loading 3D body...</p>
          </div>
        )}

        {/* Name tag */}
        {bodyReady && displayName && (
          <div className="absolute top-4 left-4 px-4 py-2 rounded-xl font-black text-sm shadow-lg" style={{ backgroundColor: C.navy, color: 'white' }}>
            👤 {displayName}
          </div>
        )}

        {/* Rotate hint */}
        {bodyReady && (
          <div className="absolute top-4 right-4 px-3 py-1.5 rounded-lg text-xs font-medium" style={{ backgroundColor: 'rgba(255,255,255,0.85)', color: C.navy }}>
            🖱 Drag to rotate
          </div>
        )}

        {/* Change Body Size — bottom right */}
        <button
          onClick={handleOpenSliders}
          className="absolute bottom-4 right-4 px-5 py-2.5 rounded-xl font-bold text-sm shadow-lg hover:opacity-90 transition-all flex items-center gap-2"
          style={{ backgroundColor: C.navy, color: 'white' }}
        >
          ⚙️ Change Body Size
        </button>

        {/* ── BODY SLIDERS PANEL ── */}
        {showSliders && (
          <div className="absolute inset-y-0 right-0 w-80 bg-white shadow-2xl border-l flex flex-col z-30" style={{ borderColor: C.peach }}>
            <div className="p-5 border-b" style={{ borderColor: C.peach }}>
              <h3 className="text-lg font-black" style={{ color: C.navy }}>Body Size</h3>
              <p className="text-xs text-gray-400 mt-0.5">Changes show live on the model</p>
            </div>

            {success && <div className="mx-5 mt-4 p-3 rounded-lg bg-green-50 border border-green-200 text-xs font-semibold text-green-700">{success}</div>}

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {([
                { key: 'height',   label: 'Height',   unit: 'cm', min: 150, max: 198 },
                { key: 'chest',    label: 'Chest',    unit: 'cm', min: 50,  max: 150 },
                { key: 'waist',    label: 'Waist',    unit: 'cm', min: 40,  max: 140 },
                { key: 'shoulder', label: 'Shoulder', unit: 'cm', min: 30,  max: 70  },
              ] as const).map(({ key, label, unit, min, max }) => (
                <div key={key}>
                  <div className="flex justify-between mb-1.5">
                    <span className="text-xs font-black uppercase tracking-widest text-gray-400">{label}</span>
                    <span className="text-base font-black" style={{ color: C.navy }}>{tempMeasurements[key]} {unit}</span>
                  </div>
                  <input type="range" min={min} max={max} step={0.5}
                    value={tempMeasurements[key]}
                    onChange={e => setTempMeasurements(p => ({ ...p, [key]: Number(e.target.value) }))}
                    className="w-full" style={{ accentColor: C.navy }} />
                  <input type="number" min={min} max={max}
                    value={tempMeasurements[key]}
                    onChange={e => setTempMeasurements(p => ({ ...p, [key]: Number(e.target.value) }))}
                    className="mt-1.5 w-full px-3 py-1.5 rounded-lg border text-sm font-bold focus:outline-none"
                    style={{ borderColor: C.peach, backgroundColor: C.cream, color: C.navy }} />
                </div>
              ))}
            </div>

            <div className="p-5 border-t space-y-2" style={{ borderColor: C.peach }}>
              <button onClick={handleSavePermanently} disabled={saving}
                className="w-full py-3 rounded-xl font-bold text-white disabled:opacity-50 hover:opacity-90 transition-all"
                style={{ backgroundColor: C.navy }}>
                {saving ? 'Saving...' : '💾 Save Permanently'}
              </button>
              <button onClick={handleApplyTemp}
                className="w-full py-2.5 rounded-xl font-bold text-sm border-2 hover:opacity-80 transition-all"
                style={{ borderColor: C.navy, color: C.navy }}>
                ✅ Apply (this session only)
              </button>
              <button onClick={handleCancelSliders}
                className="w-full py-2.5 rounded-xl font-bold text-sm border-2 hover:opacity-80 transition-all"
                style={{ borderColor: C.peach, color: C.navy }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ════ OUTFIT SELECTION ════ */}
      <div className="bg-white border-t-2 flex-shrink-0" style={{ borderColor: C.peach, maxHeight: '40vh', display: 'flex', flexDirection: 'column' }}>

        {/* Tab bar */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b flex-shrink-0" style={{ borderColor: C.peach }}>
          <div className="flex gap-2">
            {(['items', 'outfits'] as const).map(tab => (
              <button key={tab} onClick={() => setOutfitTab(tab)}
                className="px-4 py-2 rounded-lg font-bold text-sm transition-all"
                style={{ backgroundColor: outfitTab === tab ? C.navy : C.cream, color: outfitTab === tab ? 'white' : C.navy }}>
                {tab === 'items' ? `👕 Shirts (${items.length})` : `✨ Outfits (${outfits.length})`}
              </button>
            ))}
          </div>
          {selectedItem && (
            <button onClick={() => { setSelectedItem(null); setShow2d(false); }}
              className="text-xs font-bold px-3 py-1.5 rounded-full border hover:opacity-80"
              style={{ borderColor: C.peach, color: C.navy }}>
              ✕ Deselect
            </button>
          )}
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Card grid */}
          <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
            {loadingData && (
              <div className="flex items-center justify-center h-full">
                <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: C.navy, borderTopColor: 'transparent' }} />
              </div>
            )}

            {!loadingData && outfitTab === 'items' && (
              <div className="flex gap-3 h-full items-start pb-1">
                {items.length === 0
                  ? <p className="text-sm text-gray-400 self-center">No items yet. Add from the Wardrobe page.</p>
                  : items.map(item => (
                    <button key={item.id} onClick={() => { setSelectedItem(item); setShow2d(false); }}
                      className="flex-shrink-0 w-24 rounded-xl overflow-hidden border-2 transition-all hover:scale-105"
                      style={{
                        borderColor: selectedItem?.id === item.id ? C.navy : C.peach,
                        boxShadow:   selectedItem?.id === item.id ? `0 0 0 3px ${C.pink}` : 'none',
                      }}>
                      <div className="w-full aspect-square bg-white flex items-center justify-center overflow-hidden">
                        {(item.frontImageUrl || item.imageUrl)
                          ? <img src={item.frontImageUrl || item.imageUrl} alt={item.name} className="w-full h-full object-cover" crossOrigin="anonymous" />
                          : <span className="text-2xl">👕</span>}
                      </div>
                      <div className="p-1.5" style={{ backgroundColor: C.cream }}>
                        <p className="text-[10px] font-bold truncate" style={{ color: C.navy }}>{item.name}</p>
                        <p className="text-[9px] opacity-50 truncate" style={{ color: C.navy }}>{item.brand}</p>
                      </div>
                    </button>
                  ))
                }
              </div>
            )}

            {!loadingData && outfitTab === 'outfits' && (
              <div className="flex gap-3 h-full items-start pb-1">
                {outfits.length === 0
                  ? <p className="text-sm text-gray-400 self-center">No outfits yet. Create combos in the Wardrobe page.</p>
                  : outfits.map(outfit => {
                    const outfitItems = items.filter(i => outfit.itemIds.includes(i.id));
                    return (
                      <button key={outfit.id} onClick={() => outfitItems[0] && setSelectedItem(outfitItems[0])}
                        className="flex-shrink-0 w-32 rounded-xl overflow-hidden border-2 text-left transition-all hover:scale-105"
                        style={{ borderColor: C.peach }}>
                        <div className="grid grid-cols-2 gap-0.5 p-1" style={{ backgroundColor: C.cream }}>
                          {outfitItems.slice(0, 4).map((item, idx) => (
                            <div key={idx} className="aspect-square rounded overflow-hidden bg-white flex items-center justify-center">
                              {(item.frontImageUrl || item.imageUrl)
                                ? <img src={item.frontImageUrl || item.imageUrl} alt="" className="w-full h-full object-cover" crossOrigin="anonymous" />
                                : <span className="text-lg">👕</span>}
                            </div>
                          ))}
                        </div>
                        <div className="p-2">
                          <p className="text-[10px] font-bold truncate" style={{ color: C.navy }}>{outfit.name}</p>
                          <p className="text-[9px] opacity-50" style={{ color: C.navy }}>{outfitItems.length} items</p>
                        </div>
                      </button>
                    );
                  })
                }
              </div>
            )}
          </div>

          {/* Selected item panel (right) */}
          {selectedItem && (
            <div className="flex-shrink-0 w-60 border-l p-4 overflow-y-auto" style={{ borderColor: C.peach }}>
              <div className="flex gap-2 mb-3">
                {(['3d', '2d'] as const).map(v => (
                  <button key={v} onClick={() => setShow2d(v === '2d')}
                    className="flex-1 py-1.5 rounded-lg text-xs font-bold transition-all"
                    style={{
                      backgroundColor: (v === '2d') === show2d ? C.navy : C.peach,
                      color:           (v === '2d') === show2d ? 'white'  : C.navy,
                    }}>
                    {v === '3d' ? '📦 3D' : '🖼 2D'}
                  </button>
                ))}
              </div>

              <div className="w-full rounded-xl overflow-hidden border-2 mb-3" style={{ borderColor: C.peach, aspectRatio: '4/5' }}>
                {show2d ? (
                  <img src={selectedItem.frontImageUrl || selectedItem.imageUrl || ''}
                    alt={selectedItem.name} className="w-full h-full object-contain bg-white" crossOrigin="anonymous" />
                ) : (
                  <canvas ref={shirtCanvasRef} className="w-full h-full" style={{ display: 'block', backgroundColor: C.cream }} />
                )}
              </div>

              <span className="text-[10px] font-black px-2 py-0.5 rounded-full" style={{ backgroundColor: C.pink, color: C.navy }}>{selectedItem.brand}</span>
              <h3 className="text-sm font-black mt-1 mb-0.5" style={{ color: C.navy }}>{selectedItem.name}</h3>
              <p className="text-xs text-gray-400 mb-2">{selectedItem.category}</p>
              <div className="flex flex-wrap gap-1">
                {selectedItem.sizeChart.map(s => (
                  <span key={s.size} className="text-[10px] font-bold px-2 py-0.5 rounded-full border" style={{ borderColor: C.peach, color: C.navy }}>{s.size}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}