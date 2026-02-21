// app/profile/page.tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/contexts/AuthContext';
import { getAvatar, saveAvatar, getUserClothingItems, getUserOutfits } from '@/lib/firebase/firestore';
import { uploadUserPhoto } from '@/lib/firebase/storage';
import { processImage } from '@/lib/mediapipe/poseDetection';
import type { ClothingItem, OutfitCombination } from '@/lib/types/clothing';

const C = { cream: '#F8F3EA', navy: '#0B1957', peach: '#FFDBD1', pink: '#FA9EBC' };
const BODY_BASE = { height: 150, chest: 30, shoulder: 43, waist: 29 };
const BODY_MAX  = { height: 198, chest: 57, shoulder: 55, waist: 54 };
type Measurements = { height: number; chest: number; waist: number; shoulder: number };
const clamp  = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const norm01 = (cm: number, base: number, max: number) => clamp((cm - base) / (max - base), 0, 1);

export default function ProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  // ── Profile info ──────────────────────────────────────────────
  const [displayName, setDisplayName] = useState('');
  const [age,         setAge]         = useState('');
  const [gender,      setGender]      = useState('');
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile,    setPhotoFile]    = useState<File | null>(null);
  const [editingInfo,  setEditingInfo]  = useState(false);
  const [detecting,    setDetecting]    = useState(false);
  const [detectMsg,    setDetectMsg]    = useState<string | null>(null);
  const [savingInfo,   setSavingInfo]   = useState(false);

  // ── Body measurements ─────────────────────────────────────────
  const [saved,       setSaved]       = useState<Measurements>({ height: 170, chest: 90, waist: 75, shoulder: 44 });
  const [draft,       setDraft]       = useState<Measurements>({ height: 170, chest: 90, waist: 75, shoulder: 44 });
  const [savingBody,  setSavingBody]  = useState(false);
  const [bodySuccess, setBodySuccess] = useState(false);
  // slider is always visible — no toggle state needed

  // ── Wardrobe ──────────────────────────────────────────────────
  const [items,          setItems]          = useState<ClothingItem[]>([]);
  const [outfits,        setOutfits]        = useState<OutfitCombination[]>([]);
  const [activeTab,      setActiveTab]      = useState<'items' | 'outfits'>('items');
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [selectedItem,   setSelectedItem]   = useState<ClothingItem | null>(null);
  const [sidebarView,    setSidebarView]    = useState<'2d' | '3d'>('2d');
  const [loadingData,    setLoadingData]    = useState(true);

  // ── 3D body canvas (center) ────────────────────────────────────
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef  = useRef<{
    animId: ReturnType<typeof requestAnimationFrame>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderer: any;
    ro: ResizeObserver;
    updateBody: (m: Measurements) => void;
    tryOnShirt: (url: string | null) => void;
  } | null>(null);
  const [bodyReady, setBodyReady] = useState(false);

  // Auth guard
  useEffect(() => { if (!authLoading && !user) router.push('/login'); }, [user, authLoading, router]);

  // Load profile + wardrobe
  useEffect(() => {
    if (!user) return;
    setLoadingData(true);
    Promise.all([getAvatar(user.uid), getUserClothingItems(user.uid), getUserOutfits(user.uid)])
      .then(([profile, clothingItems, userOutfits]) => {
        if (profile) {
          const m: Measurements = { height: profile.height, chest: profile.chest, waist: profile.waist, shoulder: profile.shoulder };
          setSaved(m); setDraft(m);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const p = profile as any;
          setDisplayName(p.displayName || ''); setAge(p.age ? String(p.age) : ''); setGender(p.gender || '');
          if (p.photoUrl) setPhotoPreview(p.photoUrl);
        }
        setItems(clothingItems); setOutfits(userOutfits);
        setLoadingData(false);
      });
  }, [user]);

  // ── Body 3D scene (loads fitcheck_human3d_shirt3dnew.glb — has both body + shirt meshes) ──
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
      const W = canvas.clientWidth || 500, H = canvas.clientHeight || 600;

      const scene    = new THREE.Scene();
      scene.background = new THREE.Color(0xf8f3ea);
      const camera   = new THREE.PerspectiveCamera(36, W / H, 0.1, 100);
      camera.position.set(0, 0.9, 4.2);
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setSize(W, H, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.minDistance   = 1.5;
      controls.maxDistance   = 7;
      controls.target.set(0, 0.6, 0);

      scene.add(new THREE.AmbientLight(0xffffff, 1.0));
      const key  = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(3, 5, 2);  scene.add(key);
      const fill = new THREE.DirectionalLight(0xfff4e0, 0.4); fill.position.set(-3, 1, -2); scene.add(fill);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let bodyMesh: any  = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let shirtMesh: any = null;

      function setMorph(prefix: string, value: number) {
        if (!bodyMesh?.morphTargetDictionary) return;
        const k = (Object.keys(bodyMesh.morphTargetDictionary) as string[])
          .find(k => k === prefix || k.toLowerCase().startsWith(prefix.toLowerCase()));
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

      function tryOnShirt(url: string | null) {
        if (!shirtMesh) return;
        if (!url) {
          // Hide shirt by making it transparent
          shirtMesh.visible = false;
          return;
        }
        shirtMesh.visible = true;
        const tex = new THREE.TextureLoader().load(url);
        tex.flipY = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        shirtMesh.material = new THREE.MeshStandardMaterial({
          map: tex, roughness: 0.8, side: THREE.DoubleSide,
        });
        shirtMesh.material.needsUpdate = true;
      }

      // Load the combined body+shirt model
      const loader = new GLTFLoader();
      loader.load(
        '/models/fitcheck_human3d_shirt3dnew.glb?v=' + Date.now(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gltf: any) => {
          if (cancelled) return;
          const model = gltf.scene;
          model.position.sub(new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3()));
          scene.add(model);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          model.traverse((obj: any) => {
            if (!obj.isMesh) return;
            const lk = obj.morphTargetDictionary
              ? Object.keys(obj.morphTargetDictionary).map((k: string) => k.toLowerCase())
              : [];

            // Body mesh — has body morph targets
            if (!bodyMesh && lk.some((k: string) =>
              k.includes('chest') || k.includes('height') || k.includes('body_length'))) {
              bodyMesh = obj;
              updateBody(saved);
              if (sceneRef.current) sceneRef.current.updateBody = updateBody;
            }

            // Shirt mesh — has shirt morph targets (len_long, chest_wide) or is named shirt
            if (!shirtMesh && (
              lk.some((k: string) => k.includes('len_long') || k.includes('sleeve_long')) ||
              obj.name?.toLowerCase().includes('shirt') ||
              obj.name?.toLowerCase().includes('tshirt')
            )) {
              shirtMesh = obj;
              shirtMesh.visible = false; // Hidden until user selects an item
              if (sceneRef.current) sceneRef.current.tryOnShirt = tryOnShirt;
            }
          });
          setBodyReady(true);
        },
        undefined,
        // Fallback: try human.glb (body only, no shirt try-on)
        () => {
          loader.load('/models/human.glb?v=' + Date.now(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (gltf: any) => {
              if (cancelled) return;
              const model = gltf.scene;
              model.position.sub(new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3()));
              scene.add(model);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              model.traverse((obj: any) => {
                if (!obj.isMesh || !obj.morphTargetDictionary || bodyMesh) return;
                const lk = Object.keys(obj.morphTargetDictionary).map((k: string) => k.toLowerCase());
                if (lk.some((k: string) => k.includes('chest') || k.includes('height') || k.includes('body_length'))) {
                  bodyMesh = obj; updateBody(saved);
                  if (sceneRef.current) sceneRef.current.updateBody = updateBody;
                }
              });
              setBodyReady(true);
            },
            undefined,
            () => setBodyReady(true)
          );
        }
      );

      let animId: ReturnType<typeof requestAnimationFrame> = 0;
      const animate = () => {
        animId = requestAnimationFrame(animate);
        controls.update();
        setMorph('BODY_LENGTH', 1.5);
        renderer.render(scene, camera);
      };
      animate();

      const ro = new ResizeObserver(() => {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false);
      });
      ro.observe(canvas);

      sceneRef.current = { animId, renderer, ro, updateBody, tryOnShirt };
    });

    return () => {
      cancelled = true;
      if (sceneRef.current) {
        cancelAnimationFrame(sceneRef.current.animId);
        sceneRef.current.renderer.dispose();
        sceneRef.current.ro.disconnect();
        sceneRef.current = null;
      }
      setBodyReady(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live body update when draft changes
  useEffect(() => { sceneRef.current?.updateBody(draft); }, [draft]);

  // Try shirt on body when selectedItem changes
  useEffect(() => {
    if (!selectedItem) {
      sceneRef.current?.tryOnShirt(null);
    } else {
      const url = selectedItem.frontImageUrl || selectedItem.imageUrl || null;
      sceneRef.current?.tryOnShirt(url);
    }
  }, [selectedItem]);

  // ── Handlers ──────────────────────────────────────────────────
  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setPhotoFile(file); setDetectMsg(null);
    const reader = new FileReader();
    reader.onloadend = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleAutoDetect = async () => {
    if (!photoPreview) return;
    setDetecting(true); setDetectMsg(null);
    try {
      const img = new Image(); img.crossOrigin = 'anonymous';
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; img.src = photoPreview; });
      const result = await processImage(img, draft.height);
      if (result && result.confidence >= 0.5) {
        const m: Measurements = { height: result.height, chest: result.chest, waist: result.waist, shoulder: result.shoulder };
        setDraft(m); setDetectMsg('✅ Updated!');
      } else {
        setDetectMsg('⚠️ Could not detect. Adjust manually.');
      }
    } catch { setDetectMsg('❌ Detection failed.'); }
    finally { setDetecting(false); }
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    setSavingInfo(true);
    try {
      let photoUrl = photoPreview;
      if (photoFile) {
        const r = await uploadUserPhoto(user.uid, photoFile, 'profile');
        photoUrl = r?.url || photoUrl;
        if (r?.url) setPhotoPreview(r.url);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await saveAvatar({ userId: user.uid, ...draft, displayName, age: parseInt(age) || 0, gender, photoUrl } as any);
      setSaved({ ...draft }); setEditingInfo(false);
    } finally { setSavingInfo(false); }
  };

  const handleSaveBody = async () => {
    if (!user) return;
    setSavingBody(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await saveAvatar({ userId: user.uid, ...draft, displayName, age: parseInt(age) || 0, gender } as any);
    setSaved({ ...draft });
    setBodySuccess(true); setTimeout(() => setBodySuccess(false), 2500);
    setSavingBody(false);
  };

  // Derived
  const categories    = ['All', ...Array.from(new Set(items.map(i => i.category).filter(Boolean)))];
  const filteredItems = activeCategory === 'All' ? items : items.filter(i => i.category === activeCategory);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: C.cream }}>
        <div className="w-10 h-10 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: C.navy, borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <div className="flex" style={{ height: 'calc(100vh - 64px)', backgroundColor: C.cream }}>

      {/* ═══════════════════════════════════════════════════════
          3-COLUMN LAYOUT — fills full viewport height
      ═══════════════════════════════════════════════════════ */}

        {/* ══ LEFT: Profile info & photo ══ */}
        <div className="w-60 flex-shrink-0 bg-white border-r flex flex-col overflow-y-auto" style={{ borderColor: C.peach }}>
          <div className="p-4 border-b" style={{ borderColor: C.peach }}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-black uppercase tracking-widest" style={{ color: C.navy }}>Profile</h2>
              <button onClick={() => setEditingInfo(e => !e)}
                className="text-[10px] font-bold px-2.5 py-1 rounded-full transition-all"
                style={{ backgroundColor: editingInfo ? C.navy : C.peach, color: editingInfo ? 'white' : C.navy }}>
                {editingInfo ? 'Cancel' : '✏️ Edit'}
              </button>
            </div>

            {/* Photo */}
            <div className="relative mb-3">
              <div className="w-full aspect-square rounded-xl overflow-hidden border-2" style={{ borderColor: C.peach, backgroundColor: C.cream }}>
                {photoPreview
                  ? <img src={photoPreview} alt="profile" className="w-full h-full object-cover" crossOrigin="anonymous" />
                  : <div className="w-full h-full flex flex-col items-center justify-center">
                      <span className="text-4xl">🧍</span>
                      <p className="text-[10px] mt-1 font-medium" style={{ color: C.navy, opacity: 0.4 }}>No photo</p>
                    </div>
                }
              </div>
              <label className="absolute bottom-1.5 right-1.5 w-7 h-7 rounded-full flex items-center justify-center cursor-pointer shadow-lg text-sm hover:scale-110 transition-transform"
                style={{ backgroundColor: C.navy }}>
                📷
                <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
              </label>
            </div>

            {photoPreview && (
              <button onClick={handleAutoDetect} disabled={detecting}
                className="w-full py-2 rounded-lg font-bold text-[11px] flex items-center justify-center gap-1.5 disabled:opacity-60 transition-all hover:opacity-90 mb-2"
                style={{ backgroundColor: C.pink, color: C.navy }}>
                {detecting
                  ? <><div className="w-3 h-3 border-2 rounded-full animate-spin" style={{ borderColor: C.navy, borderTopColor: 'transparent' }} />Scanning...</>
                  : '🎯 Re-scan body'}
              </button>
            )}
            {detectMsg && (
              <p className="text-[10px] text-center py-1 px-2 rounded-lg mb-1" style={{ backgroundColor: C.peach, color: C.navy }}>
                {detectMsg}
              </p>
            )}
          </div>

          {/* Profile fields */}
          <div className="p-4 flex-1 space-y-3">
            {editingInfo ? (
              <>
                {[
                  { label: 'Name', value: displayName, set: setDisplayName, type: 'text',   placeholder: 'Your name' },
                  { label: 'Age',  value: age,         set: setAge,         type: 'number', placeholder: '25'        },
                ].map(({ label, value, set, type, placeholder }) => (
                  <div key={label}>
                    <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 block mb-1">{label}</label>
                    <input type={type} value={value} onChange={e => set(e.target.value)} placeholder={placeholder}
                      className="w-full px-2.5 py-1.5 rounded-lg border text-xs font-medium focus:outline-none"
                      style={{ borderColor: C.peach, backgroundColor: C.cream, color: C.navy }} />
                  </div>
                ))}
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 block mb-1">Gender</label>
                  <select value={gender} onChange={e => setGender(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border text-xs font-medium focus:outline-none"
                    style={{ borderColor: C.peach, backgroundColor: C.cream, color: C.navy }}>
                    <option value="">Select...</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                    <option value="prefer_not">Prefer not to say</option>
                  </select>
                </div>
                <button onClick={handleSaveProfile} disabled={savingInfo}
                  className="w-full py-2 rounded-lg font-bold text-xs text-white disabled:opacity-50 hover:opacity-90 transition-all"
                  style={{ backgroundColor: C.navy }}>
                  {savingInfo ? 'Saving...' : '💾 Save Profile'}
                </button>
              </>
            ) : (
              <>
                {[
                  { label: 'Name',   value: displayName || '—' },
                  { label: 'Age',    value: age         || '—' },
                  { label: 'Gender', value: gender      || '—' },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">{label}</p>
                    <p className="text-xs font-bold capitalize mt-0.5" style={{ color: C.navy }}>{value}</p>
                  </div>
                ))}
                <div className="pt-2 border-t" style={{ borderColor: C.peach }}>
                  <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">Saved Measurements</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {([['Height', saved.height], ['Chest', saved.chest], ['Waist', saved.waist], ['Shldr', saved.shoulder]] as const).map(([k, v]) => (
                      <div key={k} className="rounded-lg px-2 py-1 text-center" style={{ backgroundColor: C.peach }}>
                        <p className="text-[8px] font-black text-gray-400 uppercase">{k}</p>
                        <p className="text-sm font-black" style={{ color: C.navy }}>{v}<span className="text-[8px] font-medium opacity-60">cm</span></p>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ══ CENTER: 3D body canvas + always-visible slider ══ */}
        <div className="flex-1 relative overflow-hidden" style={{ backgroundColor: '#f8f3ea' }}>
          <canvas ref={canvasRef} className="w-full h-full" style={{ display: 'block' }} />

          {!bodyReady && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10" style={{ backgroundColor: C.cream }}>
              <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: C.navy, borderTopColor: 'transparent' }} />
              <p className="text-xs font-bold" style={{ color: C.navy }}>Loading 3D body...</p>
            </div>
          )}

          {/* ── Always-visible body size panel — top-left ── */}
          <div
            className="absolute top-3 left-3 z-20 rounded-2xl shadow-xl border"
            style={{
              width: '240px',
              backgroundColor: 'rgba(255,255,255,0.97)',
              backdropFilter: 'blur(12px)',
              borderColor: C.peach,
            }}>
            <div className="px-3 pt-2.5 pb-1.5 border-b" style={{ borderColor: C.peach }}>
              <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: C.navy }}>📐 Body Size</p>
              <p className="text-[9px] text-gray-400">Drag sliders — updates model live</p>
            </div>
            <div className="px-3 py-2.5 space-y-3">
              {([
                { key: 'height',   label: 'Height',   min: 150, max: 198 },
                { key: 'chest',    label: 'Chest',    min: 50,  max: 150 },
                { key: 'waist',    label: 'Waist',    min: 40,  max: 140 },
                { key: 'shoulder', label: 'Shoulder', min: 30,  max: 70  },
              ] as const).map(({ key, label, min, max }) => (
                <div key={key}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</span>
                    <span
                      className="text-[11px] font-black tabular-nums px-2 py-0.5 rounded-md"
                      style={{ backgroundColor: C.peach, color: C.navy, minWidth: '52px', textAlign: 'center' }}>
                      {draft[key]}<span className="text-[9px] font-normal opacity-60"> cm</span>
                    </span>
                  </div>
                  <input
                    type="range" min={min} max={max} step={0.5}
                    value={draft[key]}
                    onChange={e => setDraft(p => ({ ...p, [key]: Number(e.target.value) }))}
                    className="w-full cursor-pointer"
                    style={{ accentColor: C.navy, height: '4px' }}
                  />
                </div>
              ))}
            </div>
            <div className="px-3 pb-3">
              <button onClick={handleSaveBody} disabled={savingBody}
                className="w-full py-2 rounded-xl font-bold text-xs text-white disabled:opacity-50 hover:opacity-90 transition-all"
                style={{ backgroundColor: C.navy }}>
                {savingBody ? 'Saving...' : '💾 Save Permanently'}
              </button>
              {bodySuccess && <p className="text-center text-[9px] font-bold text-green-600 mt-1.5">✅ Saved!</p>}
            </div>
          </div>

          {/* Drag hint — centered top, right of slider panel */}
          {bodyReady && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-lg text-[11px] font-medium pointer-events-none"
              style={{ backgroundColor: 'rgba(255,255,255,0.75)', color: C.navy, marginLeft: '60px' }}>
              🖱 Drag to rotate
            </div>
          )}

          {/* Selected item try-on badge */}
          {selectedItem && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-xl shadow-lg"
                 style={{ backgroundColor: C.navy, color: 'white' }}>
              <span className="text-xs font-bold">👕 Trying on:</span>
              <span className="text-xs font-black">{selectedItem.name}</span>
              <button onClick={() => setSelectedItem(null)}
                className="ml-1 w-4 h-4 rounded-full flex items-center justify-center text-[10px]"
                style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>✕</button>
            </div>
          )}
        </div>

        {/* ══ RIGHT: Wardrobe sidebar ══ */}
        <div className="w-96 flex-shrink-0 bg-white border-l flex flex-col overflow-hidden" style={{ borderColor: C.peach }}>

          {/* Header: tabs */}
          <div className="px-3 pt-3 pb-2 border-b flex-shrink-0" style={{ borderColor: C.peach }}>
            {/* Items / Outfits tabs — full width */}
            <div className="flex gap-1.5">
              {(['items', 'outfits'] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className="flex-1 py-2 rounded-xl font-bold text-[11px] transition-all"
                  style={{ backgroundColor: activeTab === tab ? C.navy : C.cream, color: activeTab === tab ? 'white' : C.navy }}>
                  {tab === 'items' ? `👕 Items (${items.length})` : `✨ Outfits (${outfits.length})`}
                </button>
              ))}
            </div>
            {/* 2D / 3D toggle — small pill pair, right-aligned below tabs */}
            <div className="flex justify-end mt-2">
              <div className="flex gap-0.5 p-0.5 rounded-lg" style={{ backgroundColor: C.peach }}>
                {(['2d', '3d'] as const).map(v => (
                  <button key={v} onClick={() => setSidebarView(v)}
                    className="px-3 py-1 rounded-md font-black text-[9px] uppercase tracking-widest transition-all"
                    style={{
                      backgroundColor: sidebarView === v ? C.navy : 'transparent',
                      color:           sidebarView === v ? 'white' : C.navy,
                      letterSpacing:   '0.08em',
                    }}>
                    {v === '2d' ? '🖼 2D' : '📦 3D'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Category pills */}
          {activeTab === 'items' && (
            <div className="px-2.5 py-2 flex flex-wrap gap-1 border-b flex-shrink-0" style={{ borderColor: C.peach }}>
              {categories.map(cat => (
                <button key={cat} onClick={() => setActiveCategory(cat)}
                  className="px-2 py-0.5 rounded-full text-[9px] font-bold transition-all"
                  style={{ backgroundColor: activeCategory === cat ? C.pink : C.peach, color: C.navy }}>
                  {cat}
                </button>
              ))}
            </div>
          )}

          {/* Scrollable grid */}
          <div className="flex-1 overflow-y-auto p-2.5">
            {loadingData ? (
              <div className="flex justify-center pt-8">
                <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: C.navy, borderTopColor: 'transparent' }} />
              </div>
            ) : activeTab === 'items' ? (
              filteredItems.length === 0
                ? <p className="text-[10px] text-center text-gray-400 pt-8">No items yet. Add from Wardrobe.</p>
                : <div className="grid grid-cols-2 gap-2">
                    {filteredItems.map(item => (
                      <button
                        key={item.id}
                        onClick={() => setSelectedItem(prev => prev?.id === item.id ? null : item)}
                        className="rounded-xl overflow-hidden border-2 transition-all hover:scale-[1.03] hover:shadow-md text-left"
                        style={{
                          borderColor: selectedItem?.id === item.id ? C.navy : C.peach,
                          boxShadow:   selectedItem?.id === item.id ? `0 0 0 2.5px ${C.pink}` : 'none',
                        }}>
                        <div className="aspect-square bg-white relative overflow-hidden">
                          {sidebarView === '2d' ? (
                            (item.frontImageUrl || item.imageUrl)
                              ? <img src={item.frontImageUrl || item.imageUrl} alt={item.name}
                                  className="w-full h-full object-cover" crossOrigin="anonymous" />
                              : <div className="w-full h-full flex items-center justify-center"><span className="text-2xl">👕</span></div>
                          ) : (
                            <ShirtMiniCanvas itemId={item.id} imageUrl={item.frontImageUrl || item.imageUrl || null} />
                          )}
                          {selectedItem?.id === item.id && (
                            <div className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black shadow"
                                 style={{ backgroundColor: C.navy, color: 'white' }}>✓</div>
                          )}
                        </div>
                        <div className="px-1.5 py-1" style={{ backgroundColor: selectedItem?.id === item.id ? C.peach : C.cream }}>
                          <p className="text-[9px] font-bold truncate" style={{ color: C.navy }}>{item.name}</p>
                          <p className="text-[8px] opacity-50 truncate" style={{ color: C.navy }}>{item.brand}</p>
                        </div>
                      </button>
                    ))}
                  </div>
            ) : (
              outfits.length === 0
                ? <p className="text-[10px] text-center text-gray-400 pt-8">No outfits yet.</p>
                : <div className="space-y-2">
                    {outfits.map(outfit => {
                      const oi = items.filter(i => outfit.itemIds.includes(i.id));
                      return (
                        <button key={outfit.id}
                          onClick={() => oi[0] && setSelectedItem(prev => prev?.id === oi[0].id ? null : oi[0])}
                          className="w-full rounded-xl overflow-hidden border-2 text-left hover:scale-[1.02] transition-all"
                          style={{ borderColor: C.peach }}>
                          <div className="grid grid-cols-4 gap-0.5 p-1.5" style={{ backgroundColor: C.cream }}>
                            {oi.slice(0, 4).map((oi2, idx) => (
                              <div key={idx} className="aspect-square rounded overflow-hidden bg-white flex items-center justify-center">
                                {(oi2.frontImageUrl || oi2.imageUrl)
                                  ? <img src={oi2.frontImageUrl || oi2.imageUrl} alt="" className="w-full h-full object-cover" crossOrigin="anonymous" />
                                  : <span className="text-xs">👕</span>}
                              </div>
                            ))}
                          </div>
                          <div className="px-2 py-1.5" style={{ backgroundColor: C.cream }}>
                            <p className="text-[9px] font-bold truncate" style={{ color: C.navy }}>{outfit.name}</p>
                            <p className="text-[8px] opacity-50" style={{ color: C.navy }}>{oi.length} items</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
            )}
          </div>

        </div>

    </div>
  );
}

// ── Atlas constants — must match FitRecommendationModal exactly ──────────────
const MINI_ATLAS_SIZE    = 2048;
const MINI_FRONT_RECT    = { x: 0,    y: 0,    w: 1024, h: 1536 };
const MINI_BACK_RECT     = { x: 1024, y: 0,    w: 1024, h: 1536 };
const MINI_L_SLEEVE_RECT = { x: 0,    y: 1536, w: 1024, h: 512  };
const MINI_R_SLEEVE_RECT = { x: 1024, y: 1536, w: 1024, h: 512  };

// ── Mini 3D shirt canvas — atlas-based texture so 3D matches 2D pattern ──────
function ShirtMiniCanvas({ itemId, imageUrl }: { itemId: string; imageUrl: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sceneRef  = useRef<{ animId: number; renderer: any; ro: ResizeObserver } | null>(null);

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
      const W = canvas.clientWidth  || 130;
      const H = canvas.clientHeight || 130;

      const scene    = new THREE.Scene();
      scene.background = new THREE.Color(0xfaf7f2);
      const camera   = new THREE.PerspectiveCamera(45, W / H, 0.1, 50);
      camera.position.set(0, 0.15, 1.9);

      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setSize(W, H, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping   = true;
      controls.autoRotate      = true;
      controls.autoRotateSpeed = 3.5;
      controls.enableZoom      = false;
      controls.enablePan       = false;

      scene.add(new THREE.AmbientLight(0xffffff, 1.0));
      const key = new THREE.DirectionalLight(0xffffff, 1.5);
      key.position.set(2, 3, 2);
      scene.add(key);

      // ── Build atlas canvas (same technique as FitRecommendationModal) ──
      const atlasCanvas = document.createElement('canvas');
      atlasCanvas.width = atlasCanvas.height = MINI_ATLAS_SIZE;
      const atlasCtx = atlasCanvas.getContext('2d', { willReadFrequently: true })!;
      atlasCtx.fillStyle = '#ffffff';
      atlasCtx.fillRect(0, 0, MINI_ATLAS_SIZE, MINI_ATLAS_SIZE);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let atlasTexture: any = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let morphMesh: any    = null;

      function processAndApply(img: HTMLImageElement) {
        // Crop to shirt content using pixel scan
        const tmp = document.createElement('canvas'); tmp.width = img.width; tmp.height = img.height;
        const tCtx = tmp.getContext('2d')!; tCtx.drawImage(img, 0, 0);
        const data = tCtx.getImageData(0, 0, tmp.width, tmp.height).data;
        let minX = img.width, minY = img.height, maxX = 0, maxY = 0, found = false;
        for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
          const i = (y * img.width + x) * 4;
          if (data[i+3] > 20 && (data[i] < 250 || data[i+1] < 250 || data[i+2] < 250)) {
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y; found = true;
          }
        }
        if (!found) return;
        const sw = maxX - minX, sh = maxY - minY;

        // Pattern tile for sleeves
        const ss = Math.min(sw * 0.25, 200);
        const pat = document.createElement('canvas'); pat.width = pat.height = ss;
        const pCtx = pat.getContext('2d')!;
        pCtx.drawImage(img, minX + sw*0.5 - ss/2, minY + sh*0.6 - ss/2, ss, ss, 0, 0, ss, ss);

        // Front panel
        atlasCtx.fillStyle = atlasCtx.createPattern(pat, 'repeat')!;
        atlasCtx.fillRect(MINI_FRONT_RECT.x, MINI_FRONT_RECT.y, MINI_FRONT_RECT.w, MINI_FRONT_RECT.h);
        atlasCtx.fillRect(MINI_L_SLEEVE_RECT.x, MINI_L_SLEEVE_RECT.y, MINI_L_SLEEVE_RECT.w, MINI_L_SLEEVE_RECT.h);
        atlasCtx.fillRect(MINI_R_SLEEVE_RECT.x, MINI_R_SLEEVE_RECT.y, MINI_R_SLEEVE_RECT.w, MINI_R_SLEEVE_RECT.h);
        const tw = sw * 0.8;
        atlasCtx.drawImage(img, minX + (sw-tw)/2, minY, tw, sh, MINI_FRONT_RECT.x, MINI_FRONT_RECT.y, MINI_FRONT_RECT.w, MINI_FRONT_RECT.h);

        // Back panel (mirrored)
        atlasCtx.save();
        atlasCtx.translate(MINI_BACK_RECT.x + MINI_BACK_RECT.w, MINI_BACK_RECT.y);
        atlasCtx.scale(-1, 1);
        atlasCtx.fillStyle = atlasCtx.createPattern(pat, 'repeat')!;
        atlasCtx.fillRect(0, 0, MINI_BACK_RECT.w, MINI_BACK_RECT.h);
        atlasCtx.drawImage(img, minX + (sw-tw)/2, minY, tw, sh, 0, 0, MINI_BACK_RECT.w, MINI_BACK_RECT.h);
        atlasCtx.restore();

        if (!atlasTexture) {
          atlasTexture = new THREE.CanvasTexture(atlasCanvas);
          atlasTexture.flipY = false;
          atlasTexture.colorSpace = THREE.SRGBColorSpace;
        } else { atlasTexture.needsUpdate = true; }

        if (morphMesh) {
          morphMesh.material.map = atlasTexture;
          morphMesh.material.needsUpdate = true;
        }
      }

      const loader = new GLTFLoader();
      loader.load(
        '/models/newtntshirt1.glb',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gltf: any) => {
          if (cancelled) return;
          const model = gltf.scene;
          model.position.sub(new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3()));
          scene.add(model);

          // Find the shirt mesh
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          model.traverse((obj: any) => {
            if (!obj.isMesh || morphMesh) return;
            morphMesh = obj;
            obj.material = new THREE.MeshStandardMaterial({
              roughness: 0.8, side: THREE.DoubleSide,
              // white base until texture loads
              color: new THREE.Color(0xffffff),
            });
            // If image already loaded, apply now
            if (atlasTexture) { obj.material.map = atlasTexture; obj.material.needsUpdate = true; }
          });
        },
        undefined,
        () => { /* silently ignore load errors for mini canvases */ }
      );

      // Load the shirt image and build atlas
      if (imageUrl) {
        const img = new Image(); img.crossOrigin = 'anonymous';
        img.onload = () => { if (!cancelled) processAndApply(img); };
        img.onerror = () => {}; // ignore
        img.src = imageUrl;
      }

      let animId = 0;
      const animate = () => {
        animId = requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
      };
      animate();

      const ro = new ResizeObserver(() => {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (!w || !h) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
      });
      ro.observe(canvas);
      sceneRef.current = { animId, renderer, ro };
    });

    return () => {
      cancelled = true;
      if (sceneRef.current) {
        cancelAnimationFrame(sceneRef.current.animId);
        sceneRef.current.renderer.dispose();
        sceneRef.current.ro.disconnect();
        sceneRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  return <canvas ref={canvasRef} className="w-full h-full" style={{ display: 'block' }} />;
}