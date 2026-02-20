// components/items/FitRecommendationModal.tsx
'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { ClothingItem } from '@/lib/types/clothing';
import type { ParametricAvatar } from '@/lib/types/avatar';
import { saveAvatar } from '@/lib/firebase/firestore';
import { useAuth } from '@/lib/contexts/AuthContext';

const colors = {
  cream: '#F8F3EA', navy: '#0B1957', peach: '#FFDBD1', pink: '#FA9EBC',
  red: '#ef4444',   green: '#10b981', orange: '#f59e0b',
};

const SIZE_DATA: Record<string, { chest: number; shoulder: number; length: number; sleeve: number }> = {
  S:     { chest: 54.5, shoulder: 43, length: 71, sleeve: 22   },
  M:     { chest: 57,   shoulder: 45, length: 73, sleeve: 23.5 },
  L:     { chest: 59.5, shoulder: 47, length: 75, sleeve: 25   },
  XL:    { chest: 62,   shoulder: 49, length: 77, sleeve: 26.5 },
  '2XL': { chest: 64.5, shoulder: 51, length: 79, sleeve: 28   },
  '3XL': { chest: 67,   shoulder: 53, length: 79, sleeve: 29.5 },
  '4XL': { chest: 69.5, shoulder: 55, length: 79, sleeve: 29.5 },
};
const BASE = SIZE_DATA['S'];
const MAX  = SIZE_DATA['4XL'];
const cmToMorph = (v: number, b: number, m: number) => Math.max(0, Math.min(1, (v - b) / (m - b)));

// Body morph helpers (for human body mesh if present)
const BODY_BASE = { height: 150, chest: 30, shoulder: 43, waist: 29 };
const BODY_MAX  = { height: 198, chest: 57, shoulder: 55, waist: 54 };
const bodyNorm  = (v: number, b: number, m: number) => Math.max(0, Math.min(1, (v - b) / (m - b)));

const ATLAS_SIZE    = 2048;
const FRONT_RECT    = { x: 0,    y: 0,    w: 1024, h: 1536 };
const BACK_RECT     = { x: 1024, y: 0,    w: 1024, h: 1536 };
const L_SLEEVE_RECT = { x: 0,    y: 1536, w: 1024, h: 512  };
const R_SLEEVE_RECT = { x: 1024, y: 1536, w: 1024, h: 512  };

interface OutfitSuggestion { choice: string; title: string; description: string; emoji: string; }

interface Props {
  isOpen: boolean;
  onClose: () => void;
  item: ClothingItem;
  userProfile: ParametricAvatar | null;
}

type BodyDraft = { height: number; chest: number; waist: number; shoulder: number };

export default function FitRecommendationModal({ isOpen, onClose, item, userProfile }: Props) {
  const { user } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<{
    renderer: { dispose: () => void };
    animId: ReturnType<typeof requestAnimationFrame>;
    applySize: (s: string) => void;
    updateBody: (b: BodyDraft) => void;
    ro: ResizeObserver;
  } | null>(null);

  const [selectedSize,  setSelectedSize]  = useState<string>('M');
  const [fitStatus,     setFitStatus]     = useState<{ text: string; color: string } | null>(null);
  const [modelLoading,  setModelLoading]  = useState(true);
  const [sceneReady,    setSceneReady]    = useState(false);
  const [aiLoading,     setAiLoading]     = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<OutfitSuggestion[]>([]);
  const [aiError,       setAiError]       = useState<string | null>(null);
  const [showAi,        setShowAi]        = useState(false);

  // ── Body slider state ─────────────────────────────────────────
  const [showBodyPanel, setShowBodyPanel] = useState(false);
  const [bodyDraft, setBodyDraft] = useState<BodyDraft>({
    height:   userProfile?.height   ?? 170,
    chest:    userProfile?.chest    ?? 90,
    waist:    userProfile?.waist    ?? 75,
    shoulder: userProfile?.shoulder ?? 44,
  });
  const [savedBody,   setSavedBody]   = useState<BodyDraft>({ ...bodyDraft });
  const [savingBody,  setSavingBody]  = useState(false);
  const [bodySavedOk, setBodySavedOk] = useState(false);

  // Sync initial body from profile
  useEffect(() => {
    if (!userProfile) return;
    const b: BodyDraft = {
      height:   userProfile.height,
      chest:    userProfile.chest,
      waist:    userProfile.waist,
      shoulder: userProfile.shoulder,
    };
    setBodyDraft(b); setSavedBody(b);
  }, [userProfile]);

  // Live body update on draft change
  useEffect(() => { sceneRef.current?.updateBody(bodyDraft); }, [bodyDraft]);

  // Fit status
  useEffect(() => {
    if (!userProfile || !selectedSize) return;
    const sd = item.sizeChart.find(s => s.size === selectedSize);
    if (!sd) return;
    const r = sd.chest / userProfile.chest;
    setFitStatus(r < 0.96 ? { text: 'Tight', color: colors.red }
      : r > 1.15            ? { text: 'Loose', color: colors.orange }
      :                       { text: 'Just Right', color: colors.green });
  }, [selectedSize, userProfile, item]);

  // Three.js scene
  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;
    let cancelled = false;
    setModelLoading(true);
    setSceneReady(false);

    Promise.all([
      import('three'),
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/controls/OrbitControls.js'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ]).then(([THREE, { GLTFLoader }, { OrbitControls }]: any[]) => {
      if (cancelled || !canvasRef.current) return;
      const canvas = canvasRef.current;
      const W = canvas.clientWidth || 560, H = canvas.clientHeight || 560;

      const scene    = new THREE.Scene();
      scene.background = new THREE.Color(0x0d0d1a);
      const camera   = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
      camera.position.set(0, 1.0, 3.2);
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setSize(W, H, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping   = true;
      controls.autoRotate      = true;
      controls.autoRotateSpeed = 3.5;
      controls.minDistance     = 1.5;
      controls.maxDistance     = 6;

      scene.add(new THREE.AmbientLight(0xffffff, 0.9));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(3, 4, 2); scene.add(key);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fill = new THREE.DirectionalLight(0xaaccff, 0.4); fill.position.set(-3, 0, -2); scene.add(fill);

      // Atlas
      const atlasCanvas = document.createElement('canvas');
      atlasCanvas.width = atlasCanvas.height = ATLAS_SIZE;
      const atlasCtx = atlasCanvas.getContext('2d', { willReadFrequently: true })!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let atlasTexture: any = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let morphMesh: any = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let bodyMesh: any = null;
      let frontImg: HTMLImageElement | null = null;
      let backImg:  HTMLImageElement | null = null;

      function processShirtTexture(ctx: CanvasRenderingContext2D, img: HTMLImageElement, rect: typeof FRONT_RECT, isFront: boolean) {
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
        const sw = maxX - minX, sh = maxY - minY, ss = Math.min(sw * 0.25, 200);
        const pat = document.createElement('canvas'); pat.width = pat.height = ss;
        const pCtx = pat.getContext('2d')!;
        pCtx.drawImage(img, minX + sw*0.5 - ss/2, minY + sh*0.6 - ss/2, ss, ss, 0, 0, ss, ss);
        ctx.fillStyle = ctx.createPattern(pat, 'repeat')!;
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        if (isFront) {
          ctx.fillRect(L_SLEEVE_RECT.x, L_SLEEVE_RECT.y, L_SLEEVE_RECT.w, L_SLEEVE_RECT.h);
          ctx.fillRect(R_SLEEVE_RECT.x, R_SLEEVE_RECT.y, R_SLEEVE_RECT.w, R_SLEEVE_RECT.h);
        }
        const tw = sw * 0.8;
        ctx.drawImage(img, minX + (sw-tw)/2, minY, tw, sh, rect.x, rect.y, rect.w, rect.h);
      }

      function rebuildAtlas() {
        atlasCtx.fillStyle = '#ffffff'; atlasCtx.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
        if (frontImg) processShirtTexture(atlasCtx, frontImg, FRONT_RECT, true);
        if (backImg)  processShirtTexture(atlasCtx, backImg,  BACK_RECT,  false);
        if (!atlasTexture) {
          atlasTexture = new THREE.CanvasTexture(atlasCanvas);
          atlasTexture.flipY = false;
          atlasTexture.colorSpace = THREE.SRGBColorSpace;
        } else {
          atlasTexture.needsUpdate = true;
        }
        if (morphMesh) {
          morphMesh.material.map = atlasTexture;
          morphMesh.material.needsUpdate = true;
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function setShirtMorph(prefix: string, value: number, mesh: any) {
        if (!mesh?.morphTargetDictionary) return;
        const keys = Object.keys(mesh.morphTargetDictionary);
        const k  = keys.find((k: string) => k === prefix || k.startsWith(prefix));
        if (k) mesh.morphTargetInfluences[mesh.morphTargetDictionary[k]] = value;
      }

      function applySize(size: string) {
        const d = SIZE_DATA[size]; if (!d) return;
        setShirtMorph('CHEST_WIDE',    cmToMorph(d.chest,    BASE.chest,    MAX.chest),    morphMesh);
        setShirtMorph('SHOULDER_WIDE', cmToMorph(d.shoulder, BASE.shoulder, MAX.shoulder), morphMesh);
        setShirtMorph('LEN_LONG',      cmToMorph(d.length,   BASE.length,   MAX.length),   morphMesh);
        setShirtMorph('SLEEVE_LONG',   cmToMorph(d.sleeve,   BASE.sleeve,   MAX.sleeve),   morphMesh);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function setBodyMorph(prefix: string, value: number, mesh: any) {
        if (!mesh?.morphTargetDictionary) return;
        const k = (Object.keys(mesh.morphTargetDictionary) as string[])
          .find(k => k === prefix || k.toLowerCase().startsWith(prefix.toLowerCase()));
        if (k) mesh.morphTargetInfluences[mesh.morphTargetDictionary[k]] = value;
      }

      function updateBody(b: BodyDraft) {
        if (!bodyMesh) return;
        setBodyMorph('CHEST_WIDE',    bodyNorm(b.chest,    BODY_BASE.chest,    BODY_MAX.chest)    * 3.0,  bodyMesh);
        setBodyMorph('SHOULDER_WIDE', bodyNorm(b.shoulder, BODY_BASE.shoulder, BODY_MAX.shoulder) * 0.5,  bodyMesh);
        setBodyMorph('HEIGHT',        bodyNorm(b.height,   BODY_BASE.height,   BODY_MAX.height)   * 0.8,  bodyMesh);
        setBodyMorph('WAIST_WIDE',    bodyNorm(b.waist,    BODY_BASE.waist,    BODY_MAX.waist)    * 10.0, bodyMesh);
        setBodyMorph('HIP_WIDE',      Math.min(bodyNorm(b.chest, BODY_BASE.chest, BODY_MAX.chest) * 0.4, 1) * 2.0, bodyMesh);
        setBodyMorph('BODY_LENGTH',   1.5, bodyMesh);
      }

      const loader = new GLTFLoader();
      // Try loading combined human+shirt model first, fall back to shirt-only
      loader.load(
        '/models/fitcheck_human3d_shirt3dnew.glb?v=' + Date.now(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gltf: any) => {
          if (cancelled) return;
          const model = gltf.scene;
          const box = new THREE.Box3().setFromObject(model);
          model.position.sub(box.getCenter(new THREE.Vector3()));
          scene.add(model);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          model.traverse((obj: any) => {
            if (!obj.isMesh || !obj.morphTargetDictionary) return;
            const lkeys = Object.keys(obj.morphTargetDictionary).map((k: string) => k.toLowerCase());
            if (!morphMesh && lkeys.some((k: string) => k.includes('len_long') || k.includes('chest_wide'))) {
              morphMesh = obj;
              obj.material = new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide });
              rebuildAtlas(); applySize(selectedSize);
              if (sceneRef.current) sceneRef.current.applySize = applySize;
              setSceneReady(true);
            }
            if (!bodyMesh && lkeys.some((k: string) => k.includes('body_length') || (k.includes('height') && k.includes('body')))) {
              bodyMesh = obj;
              if (sceneRef.current) sceneRef.current.updateBody = updateBody;
            }
          });
          setModelLoading(false);
        },
        undefined,
        () => setModelLoading(false)
      );

      const loadImg = (url: string, cb: (img: HTMLImageElement) => void) => {
        const img = new Image(); img.crossOrigin = 'anonymous';
        img.onload = () => { cb(img); rebuildAtlas(); }; img.src = url;
      };
      if (item.frontImageUrl) loadImg(item.frontImageUrl, img => { frontImg = img; });
      if (item.backImageUrl)  loadImg(item.backImageUrl,  img => { backImg  = img; });
      else if (item.imageUrl) loadImg(item.imageUrl,      img => { frontImg = img; });

      let animId: ReturnType<typeof requestAnimationFrame> = 0;
      const animate = () => {
        animId = requestAnimationFrame(animate);
        controls.update();
        // Force body length every frame to prevent distortion
        if (bodyMesh) setBodyMorph('BODY_LENGTH', 1.5, bodyMesh);
        renderer.render(scene, camera);
      };
      animate();

      const ro = new ResizeObserver(() => {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false);
      });
      ro.observe(canvas);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sceneRef.current = { renderer, animId, applySize, updateBody: (b: BodyDraft) => updateBody(b), ro };
    });

    return () => {
      cancelled = true;
      if (sceneRef.current) {
        cancelAnimationFrame(sceneRef.current.animId);
        sceneRef.current.renderer.dispose();
        sceneRef.current.ro.disconnect();
        sceneRef.current = null;
      }
      setSceneReady(false); setModelLoading(true);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => { sceneRef.current?.applySize(selectedSize); }, [selectedSize]);

  // Save body handlers
  const handleSaveBodyPermanently = async () => {
    if (!user) return;
    setSavingBody(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await saveAvatar({ userId: user.uid, ...bodyDraft } as any);
      setSavedBody({ ...bodyDraft });
      setBodySavedOk(true); setTimeout(() => setBodySavedOk(false), 2500);
    } finally { setSavingBody(false); }
  };
  const handleApplySession = () => { setBodySavedOk(true); setTimeout(() => setBodySavedOk(false), 1500); setShowBodyPanel(false); };
  const handleResetBody = () => { setBodyDraft({ ...savedBody }); };

  // Gemini AI
  const handleAiSuggest = useCallback(async () => {
    setAiLoading(true); setAiError(null); setShowAi(true); setAiSuggestions([]);
    try {
      const imgUrl = item.frontImageUrl || item.imageUrl;
      if (!imgUrl) throw new Error('No shirt image');
      const blob   = await fetch(imgUrl).then(r => r.blob());
      const base64 = await new Promise<string>((res, rej) => {
        const reader = new FileReader();
        reader.onloadend = () => res((reader.result as string).split(',')[1]);
        reader.onerror = rej; reader.readAsDataURL(blob);
      });
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.NEXT_PUBLIC_GEMINI_API_KEY}`,
        {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [
              { text: `You are a fashion stylist. Suggest exactly 3 outfit combinations for this shirt. Respond ONLY in this JSON array format (no markdown):\n[{"choice":"Choice 1","title":"Short title","description":"2-3 sentences about bottom wear color material style.","emoji":"emoji"}]` },
              { inlineData: { mimeType: blob.type || 'image/jpeg', data: base64 } }
            ]}],
            generationConfig: { temperature: 0.8, maxOutputTokens: 1024 }
          })
        }
      );
      const gData = await geminiRes.json();
      const text  = gData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      setAiSuggestions(JSON.parse(text.replace(/```json|```/g, '').trim()));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setAiError('Could not get suggestions. Check NEXT_PUBLIC_GEMINI_API_KEY in .env.local');
    } finally { setAiLoading(false); }
  }, [item]);

  if (!isOpen) return null;

  const sizeButtons = item.sizeChart.length > 0 ? item.sizeChart.map(s => s.size) : Object.keys(SIZE_DATA);
  const hasSleve    = item.sizeChart.some(s => (s as any).sleeve !== undefined);

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-50 p-3">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[90vh] flex overflow-hidden">

        {/* ══ LEFT: 3D canvas area ══ */}
        <div className="flex-1 bg-[#0d0d1a] relative flex flex-col min-w-0">
          {modelLoading && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-[#0d0d1a]">
              <div className="w-12 h-12 border-4 border-t-transparent border-blue-400 rounded-full animate-spin" />
              <p className="text-blue-300 text-sm font-bold tracking-widest uppercase animate-pulse">Loading 3D Model...</p>
            </div>
          )}

          {/* Canvas fills full area */}
          <canvas ref={canvasRef} className="w-full flex-1" style={{ display: 'block', minHeight: 0 }} />

          {/* ── Body Size dropdown panel — anchored to bottom-left, above the size bar ── */}
          {showBodyPanel && (
            <div
              className="absolute bottom-[88px] left-3 z-30 rounded-2xl border border-white/15 shadow-2xl"
              style={{
                backgroundColor: 'rgba(10,10,26,0.96)',
                backdropFilter: 'blur(12px)',
                width: '260px',
              }}>
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10">
                <p className="text-[11px] font-black text-white uppercase tracking-widest">⚙️ Body Size</p>
                <button onClick={() => setShowBodyPanel(false)} className="text-white/40 hover:text-white text-xl leading-none transition-colors">×</button>
              </div>
              <div className="p-3 space-y-3">
                {([
                  { key: 'height',   label: 'Height',   min: 150, max: 198, unit: 'cm' },
                  { key: 'chest',    label: 'Chest',    min: 50,  max: 150, unit: 'cm' },
                  { key: 'waist',    label: 'Waist',    min: 40,  max: 140, unit: 'cm' },
                  { key: 'shoulder', label: 'Shoulder', min: 30,  max: 70,  unit: 'cm' },
                ] as const).map(({ key, label, min, max, unit }) => (
                  <div key={key}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[10px] font-bold text-white/50 uppercase tracking-widest">{label}</span>
                      <span className="text-xs font-black text-white tabular-nums">
                        {bodyDraft[key]}<span className="text-[9px] text-white/40 ml-0.5">{unit}</span>
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="range" min={min} max={max} step={0.5}
                        value={bodyDraft[key]}
                        onChange={e => setBodyDraft(p => ({ ...p, [key]: Number(e.target.value) }))}
                        className="flex-1 h-1 rounded-full appearance-none cursor-pointer"
                        style={{ accentColor: colors.pink }}
                      />
                      <input
                        type="number" min={min} max={max}
                        value={bodyDraft[key]}
                        onChange={e => setBodyDraft(p => ({ ...p, [key]: Number(e.target.value) }))}
                        className="w-14 px-1.5 py-1 rounded-lg text-xs font-bold text-center focus:outline-none"
                        style={{ backgroundColor: 'rgba(255,255,255,0.08)', color: 'white', border: '1px solid rgba(255,255,255,0.15)' }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-3 pb-3 pt-1 space-y-1.5">
                <button onClick={handleSaveBodyPermanently} disabled={savingBody}
                  className="w-full py-2 rounded-xl font-bold text-xs text-white disabled:opacity-50 hover:opacity-90 transition-all"
                  style={{ backgroundColor: colors.navy }}>
                  {savingBody ? 'Saving...' : 'Save Permanently'}
                </button>
                <div className="flex gap-1.5">
                  <button onClick={handleApplySession}
                    className="flex-1 py-1.5 rounded-lg font-bold text-xs border border-white/20 text-white/70 hover:text-white hover:border-white/40 transition-all">
                    ✓ Apply session
                  </button>
                  <button onClick={handleResetBody}
                    className="flex-1 py-1.5 rounded-lg font-bold text-xs border border-white/20 text-white/50 hover:text-white/80 hover:border-white/30 transition-all">
                    ↩ Reset
                  </button>
                </div>
                {bodySavedOk && <p className="text-center text-[10px] font-bold text-green-400">✅ Applied!</p>}
              </div>
            </div>
          )}

          {/* ── Bottom bar: size selector + body size button ── */}
          <div className="absolute bottom-0 left-0 right-0 px-3 pb-3">
            <div className="bg-black/60 backdrop-blur-md rounded-xl p-2.5 border border-white/10">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold text-white/50 uppercase tracking-widest">Select Size to Preview</p>
                {/* Body Size toggle button */}
                <button
                  onClick={() => setShowBodyPanel(p => !p)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all"
                  style={{
                    backgroundColor: showBodyPanel ? colors.pink : 'rgba(255,255,255,0.1)',
                    color:           showBodyPanel ? colors.navy : 'rgba(255,255,255,0.8)',
                    border:          `1px solid ${showBodyPanel ? colors.pink : 'rgba(255,255,255,0.2)'}`,
                  }}>
                  ⚙️ Body Size
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {sizeButtons.map(size => (
                  <button key={size} onClick={() => setSelectedSize(size)}
                    className="px-4 py-2 rounded-lg font-bold text-sm transition-all"
                    style={{
                      backgroundColor: selectedSize === size ? colors.pink : 'rgba(255,255,255,0.1)',
                      color:           selectedSize === size ? colors.navy : 'white',
                      border:          `1px solid ${selectedSize === size ? colors.pink : 'rgba(255,255,255,0.2)'}`,
                      transform:       selectedSize === size ? 'scale(1.08)' : 'scale(1)',
                    }}>{size}</button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ══ RIGHT: Info panel ══ */}
        <div className="w-[310px] bg-white flex flex-col overflow-hidden flex-shrink-0">
          <div className="p-4 border-b border-gray-100">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{item.brand}</p>
                <h2 className="text-lg font-black leading-tight" style={{ color: colors.navy }}>{item.name}</h2>
                <p className="text-xs text-gray-400">{item.category}</p>
              </div>
              <button onClick={onClose} className="text-gray-300 hover:text-gray-600 mt-1">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {/* Fit status */}
            {fitStatus && userProfile && (
              <div className="rounded-xl p-3 border-2" style={{ backgroundColor: colors.cream, borderColor: colors.peach }}>
                <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-1">Fit Analysis</p>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: fitStatus.color }} />
                  <span className="text-lg font-black" style={{ color: colors.navy }}>{fitStatus.text}</span>
                  <span className="text-xs font-bold text-gray-400">— {selectedSize}</span>
                </div>
                <p className="text-xs text-gray-600 leading-relaxed">
                  {fitStatus.text === 'Tight' ? 'Restrictive around chest. Consider sizing up.'
                   : fitStatus.text === 'Loose' ? 'Oversized look. Size down for regular fit.'
                   : 'Perfect alignment with your body profile.'}
                </p>
              </div>
            )}

            {/* Size chart */}
            <div>
              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Size Chart</p>
              <div className="overflow-x-auto rounded-xl border" style={{ borderColor: colors.peach }}>
                <table className="w-full" style={{ fontSize: '11px' }}>
                  <thead>
                    <tr style={{ backgroundColor: colors.cream }}>
                      {['Sz', 'Chest', 'Len', 'Shldr', ...(hasSleve ? ['Slv'] : [])].map(h => (
                        <th key={h} className="px-2 py-1.5 text-left font-bold" style={{ color: colors.navy }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {item.sizeChart.map((s, i) => (
                      <tr key={i} className="border-t cursor-pointer"
                        style={{ borderColor: colors.peach, backgroundColor: selectedSize === s.size ? colors.peach : 'white' }}
                        onClick={() => setSelectedSize(s.size)}>
                        <td className="px-2 py-1.5 font-black" style={{ color: colors.navy }}>{s.size}</td>
                        <td className="px-2 py-1.5" style={{ color: colors.navy }}>{s.chest}</td>
                        <td className="px-2 py-1.5" style={{ color: colors.navy }}>{s.length}</td>
                        <td className="px-2 py-1.5" style={{ color: colors.navy }}>{s.shoulder}</td>
                        {hasSleve && <td className="px-2 py-1.5" style={{ color: colors.navy }}>{(s as any).sleeve ?? '—'}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* AI suggestions */}
            {showAi && (
              <div className="space-y-2">
                {aiLoading && (
                  <div className="flex items-center justify-center gap-2 py-3">
                    <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: colors.navy, borderTopColor: 'transparent' }} />
                    <span className="text-xs font-bold text-gray-500">Analysing outfit...</span>
                  </div>
                )}
                {aiError && <p className="text-xs text-red-500 text-center">{aiError}</p>}
                {aiSuggestions.map((s, i) => (
                  <div key={i} className="rounded-xl p-3 border-2"
                    style={{ borderColor: colors.peach, backgroundColor: i === 0 ? colors.cream : 'white' }}>
                    <div className="flex items-start gap-2">
                      <span className="text-lg">{s.emoji}</span>
                      <div>
                        <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full" style={{ backgroundColor: colors.pink, color: colors.navy }}>{s.choice}</span>
                          <span className="text-xs font-black" style={{ color: colors.navy }}>{s.title}</span>
                        </div>
                        <p className="text-[11px] leading-relaxed text-gray-600">{s.description}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-gray-100 bg-gray-50 space-y-2">
            <button onClick={onClose}
              className="w-full py-3 rounded-xl font-bold text-white shadow hover:shadow-lg transition-all"
              style={{ backgroundColor: colors.navy }}>
              Done
            </button>
            <button onClick={handleAiSuggest} disabled={aiLoading}
              className="w-full py-2.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ backgroundColor: colors.pink, color: colors.navy }}>
              {aiLoading
                ? <><div className="w-3.5 h-3.5 border-2 rounded-full animate-spin" style={{ borderColor: colors.navy, borderTopColor: 'transparent' }} />Analysing...</>
                : '✨ Get AI Outfit Suggestions'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}