// app/onboarding/page.tsx
// First-time user setup: 3 steps - info, photo+scan (height first), 3D preview+confirm
'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/contexts/AuthContext';
import { getAvatar, saveAvatar } from '@/lib/firebase/firestore';
import { uploadUserPhoto } from '@/lib/firebase/storage';
import { processImage } from '@/lib/mediapipe/poseDetection';

const C = { cream: '#F8F3EA', navy: '#0B1957', peach: '#FFDBD1', pink: '#FA9EBC' };
const BODY_BASE = { height: 150, chest: 30, shoulder: 43, waist: 29 };
const BODY_MAX  = { height: 198, chest: 57, shoulder: 55, waist: 54 };
type Measurements = { height: number; chest: number; waist: number; shoulder: number };
const clamp  = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const norm01 = (cm: number, base: number, max: number) => clamp((cm - base) / (max - base), 0, 1);

const STEPS = ['Your Info', 'Body Scan', '3D Preview'];

export default function OnboardingPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<0 | 1 | 2>(0);

  // Step 0 – basic info
  const [name,   setName]   = useState('');
  const [age,    setAge]    = useState('');
  const [gender, setGender] = useState('');

  // Step 1 – height first, then photo + auto-scan
  const [heightInput, setHeightInput] = useState('170');   // user gives height before scan
  const [photoFile,    setPhotoFile]    = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [detecting,    setDetecting]    = useState(false);
  const [detected,     setDetected]     = useState(false);
  const [detectMsg,    setDetectMsg]    = useState<string | null>(null);
  const [measurements, setMeasurements] = useState<Measurements>({ height: 170, chest: 90, waist: 75, shoulder: 44 });

  // Step 2 – 3D preview
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sceneRef  = useRef<{ animId: ReturnType<typeof requestAnimationFrame>; renderer: any; ro: ResizeObserver; updateBody: (m: Measurements) => void } | null>(null);
  const [modelReady, setModelReady] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  // Skip if already has profile
  useEffect(() => {
    if (authLoading || !user) return;
    getAvatar(user.uid).then(p => { if (p) router.replace('/items'); });
  }, [user, authLoading, router]);

  // Sync height input → measurements.height
  useEffect(() => {
    const h = parseInt(heightInput);
    if (h >= 100 && h <= 220) setMeasurements(p => ({ ...p, height: h }));
  }, [heightInput]);

  // Build 3D scene when entering step 2
  useEffect(() => {
    if (step !== 2 || !canvasRef.current) return;
    let cancelled = false;

    Promise.all([
      import('three'),
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/controls/OrbitControls.js'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ]).then(([THREE, { GLTFLoader }, { OrbitControls }]: any[]) => {
      if (cancelled || !canvasRef.current) return;
      const canvas = canvasRef.current;
      const W = canvas.clientWidth || 400, H = canvas.clientHeight || 480;
      const scene    = new THREE.Scene(); scene.background = new THREE.Color(0xf8f3ea);
      const camera   = new THREE.PerspectiveCamera(36, W / H, 0.1, 100);
      camera.position.set(0, 0.9, 4.2);
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
      renderer.setSize(W, H, false); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true; controls.minDistance = 1.5; controls.maxDistance = 6;
      controls.target.set(0, 0.6, 0);
      scene.add(new THREE.AmbientLight(0xffffff, 1.1));
      const key = new THREE.DirectionalLight(0xffffff, 1.3); key.position.set(3, 5, 3); scene.add(key);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let bodyMesh: any = null;
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
      const loader = new GLTFLoader();
      function forceOpaque(obj: any) {
        if (!obj?.isMesh) return;

        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (!m) continue;

          // Make it SOLID
          m.transparent = false;
          m.opacity = 1;
          m.alphaTest = 0;
          m.depthWrite = true;
          m.depthTest = true;

          // Optional: avoid “inside showing through”
          // If your mesh needs to be double sided, change this to THREE.DoubleSide
          m.side = THREE.FrontSide;

          // Some glTF materials still keep an alpha mode flag
          if ('alphaMode' in m) (m as any).alphaMode = 'OPAQUE';

          m.needsUpdate = true;
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      loader.load('/models/humanlatest.glb?v=' + Date.now(), (gltf: any) => {
        if (cancelled) return;
        const model = gltf.scene;
        model.position.sub(new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3()));
        scene.add(model);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        model.traverse((obj: any) => {
          forceOpaque(obj);
          if (!obj.isMesh || !obj.morphTargetDictionary || bodyMesh) return;
          const lk = Object.keys(obj.morphTargetDictionary).map((k: string) => k.toLowerCase());
          if (lk.some((k: string) => k.includes('chest') || k.includes('height') || k.includes('body_length'))) {
            bodyMesh = obj; updateBody(measurements);
            if (sceneRef.current) sceneRef.current.updateBody = updateBody;
          }
        });
        setModelReady(true);
      }, undefined, () => setModelReady(true));

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
      setModelReady(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Live 3D update on step 2 when user tweaks measurements
  useEffect(() => { if (step === 2) sceneRef.current?.updateBody(measurements); }, [measurements, step]);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setPhotoFile(file); setDetected(false); setDetectMsg(null);
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
      // Pass the user's stated height so MediaPipe can calculate real cm values
      const result = await processImage(img, measurements.height);
      if (result && result.confidence >= 0.5) {
        setMeasurements({ height: measurements.height, chest: result.chest, waist: result.waist, shoulder: result.shoulder });
        setDetected(true);
        setDetectMsg(`✅ Detected! Chest: ${result.chest}cm · Waist: ${result.waist}cm · Shoulder: ${result.shoulder}cm`);
      } else {
        setDetectMsg('⚠️ Could not detect clearly. Please adjust sliders manually below.');
      }
    } catch { setDetectMsg('❌ Detection failed. Please enter values manually.'); }
    finally { setDetecting(false); }
  };

  const handleFinish = async () => {
    if (!user) return;
    setSaving(true); setError(null);
    try {
      let photoUrl: string | undefined;
      if (photoFile) {
        const r = await uploadUserPhoto(user.uid, photoFile, 'profile');
        photoUrl = r?.url || undefined;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await saveAvatar({ userId: user.uid, displayName: name.trim(), age: parseInt(age) || 0, gender, photoUrl, ...measurements } as any);
      router.push('/profile');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) { setError(e.message || 'Save failed. Please try again.'); }
    finally { setSaving(false); }
  };

  if (authLoading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: C.cream }}>
      <div className="w-10 h-10 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: C.navy, borderTopColor: 'transparent' }} />
    </div>
  );

  return (
    <div className="min-h-screen" style={{ backgroundColor: C.cream }}>
      {/* Header + progress */}
      <div className="px-8 py-4 bg-white border-b" style={{ borderColor: C.peach }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-black" style={{ color: C.navy }}>FitCheck — Setup</h1>
          <div className="flex items-center gap-2">
            {STEPS.map((label, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-black transition-all"
                    style={{ backgroundColor: step >= i ? C.navy : C.peach, color: step >= i ? 'white' : C.navy }}>
                    {step > i ? '✓' : i + 1}
                  </div>
                  <span className="text-xs font-bold hidden sm:block" style={{ color: step >= i ? C.navy : '#999' }}>{label}</span>
                </div>
                {i < STEPS.length - 1 && <div className="w-8 h-0.5 rounded" style={{ backgroundColor: step > i ? C.navy : C.peach }} />}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-10">

        {/* ════ STEP 0: Basic Info ════ */}
        {step === 0 && (
          <div className="max-w-md mx-auto">
            <p className="text-xs font-black uppercase tracking-widest mb-2" style={{ color: C.pink }}>Step 1 of 3</p>
            <h2 className="text-3xl font-black mb-1" style={{ color: C.navy }}>Welcome to FitCheck 👋</h2>
            <p className="text-sm text-gray-500 mb-8">Tell us a bit about yourself to personalise your experience.</p>

            <div className="space-y-5">
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-gray-400 block mb-2">Your Name *</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Alex"
                  className="w-full px-4 py-3.5 rounded-xl border-2 font-medium focus:outline-none"
                  style={{ borderColor: name ? C.navy : C.peach, backgroundColor: C.cream, color: C.navy }} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold uppercase tracking-widest text-gray-400 block mb-2">Age</label>
                  <input type="number" value={age} onChange={e => setAge(e.target.value)} placeholder="25" min="10" max="100"
                    className="w-full px-4 py-3.5 rounded-xl border-2 font-medium focus:outline-none"
                    style={{ borderColor: C.peach, backgroundColor: C.cream, color: C.navy }} />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase tracking-widest text-gray-400 block mb-2">Gender</label>
                  <select value={gender} onChange={e => setGender(e.target.value)}
                    className="w-full px-4 py-3.5 rounded-xl border-2 font-medium focus:outline-none"
                    style={{ borderColor: C.peach, backgroundColor: C.cream, color: C.navy }}>
                    <option value="">Select...</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                    <option value="prefer_not">Prefer not to say</option>
                  </select>
                </div>
              </div>
            </div>

            {error && <p className="text-xs text-red-500 mt-4">{error}</p>}
            <button onClick={() => { if (!name.trim()) { setError('Please enter your name.'); return; } setError(null); setStep(1); }}
              className="w-full mt-8 py-4 rounded-xl font-black text-white hover:opacity-90 shadow-lg"
              style={{ backgroundColor: C.navy }}>
              Next — Upload Body Photo →
            </button>
          </div>
        )}

        {/* ════ STEP 1: Height + Photo + Scan ════ */}
        {step === 1 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
            {/* Left: height + photo */}
            <div>
              <p className="text-xs font-black uppercase tracking-widest mb-2" style={{ color: C.pink }}>Step 2 of 3</p>
              <h2 className="text-2xl font-black mb-1" style={{ color: C.navy }}>Body Scan 📸</h2>
              <p className="text-sm text-gray-500 mb-5">
                First enter your height — MediaPipe uses this to calculate real-world measurements from your photo.
              </p>

              {/* Height input — FIRST, important for scan accuracy */}
              <div className="p-4 rounded-2xl border-2 mb-5" style={{ borderColor: C.navy, backgroundColor: 'white' }}>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">📏</span>
                  <div>
                    <p className="text-sm font-black" style={{ color: C.navy }}>Your Height (cm)</p>
                    <p className="text-xs text-gray-400">Enter this before scanning for accurate results</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="range" min="140" max="210" step="1"
                    value={heightInput}
                    onChange={e => setHeightInput(e.target.value)}
                    className="flex-1" style={{ accentColor: C.navy }} />
                  <div className="relative">
                    <input type="number" min="140" max="210"
                      value={heightInput}
                      onChange={e => setHeightInput(e.target.value)}
                      className="w-20 px-3 py-2 rounded-xl border-2 font-black text-lg text-center focus:outline-none"
                      style={{ borderColor: C.navy, backgroundColor: C.cream, color: C.navy }} />
                    <span className="absolute -bottom-4 left-0 right-0 text-center text-[10px] text-gray-400">cm</span>
                  </div>
                </div>
              </div>

              {/* Photo upload + Reference side by side */}
              <div className="flex gap-4 items-start mb-4">
                {/* Upload box */}
                <div className="flex-1">
                  <div className="border-2 border-dashed rounded-2xl overflow-hidden" style={{ borderColor: C.peach, backgroundColor: 'white' }}>
                    {photoPreview ? (
                      <div className="relative">
                        <img src={photoPreview} className="w-full h-64 object-contain bg-white" alt="body" />
                        <button onClick={() => { setPhotoFile(null); setPhotoPreview(null); setDetected(false); setDetectMsg(null); }}
                          className="absolute top-3 right-3 w-7 h-7 bg-white rounded-full shadow flex items-center justify-center text-sm font-bold"
                          style={{ color: C.navy }}>✕</button>
                      </div>
                    ) : (
                      <label className="flex flex-col items-center justify-center h-52 cursor-pointer hover:opacity-80">
                        <span className="text-5xl mb-3">🧍</span>
                        <p className="text-sm font-bold mb-1" style={{ color: C.navy }}>Upload full body photo</p>
                        <p className="text-xs opacity-40" style={{ color: C.navy }}>Stand facing camera, arms slightly out</p>
                        <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
                      </label>
                    )}
                  </div>
                </div>

                {/* Reference photo */}
                <div className="w-32 flex-shrink-0">
                  <p className="text-xs font-bold mb-1.5 text-center" style={{ color: C.navy }}>Reference</p>
                  <div className="rounded-2xl overflow-hidden border-2 bg-white" style={{ borderColor: C.peach }}>
                    <img
                      src="/reference/body-scan-reference.png"
                      alt="Body scan reference pose"
                      className="w-full h-52 object-contain p-2"
                      crossOrigin="anonymous"
                    />
                  </div>
                  <p className="text-[9px] mt-1 text-center leading-tight text-gray-400 italic">
                    Stand straight, face camera, arms slightly apart
                  </p>
                </div>
              </div>

              {photoPreview && (
                <button onClick={handleAutoDetect} disabled={detecting}
                  className="w-full py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-60 hover:opacity-90 transition-all"
                  style={{ backgroundColor: C.pink, color: C.navy }}>
                  {detecting
                    ? <><div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: C.navy, borderTopColor: 'transparent' }} />Scanning with MediaPipe...</>
                    : detected ? '✅ Re-scan with MediaPipe' : '🎯 Scan body with MediaPipe'}
                </button>
              )}
              {detectMsg && (
                <div className="mt-3 p-3 rounded-xl text-xs font-medium" style={{ backgroundColor: detectMsg.startsWith('✅') ? C.peach : '#fee2e2', color: C.navy }}>
                  {detectMsg}
                </div>
              )}
            </div>

            {/* Right: fine-tune measurements */}
            <div>
              <h3 className="text-lg font-black mb-1" style={{ color: C.navy }}>
                {detected ? '🎯 Detected measurements' : '✏️ Enter manually'}
              </h3>
              <p className="text-xs text-gray-400 mb-4">
                {detected ? 'Scan complete. Review and fine-tune if needed.' : 'Or fill these in yourself — you can update later.'}
              </p>
              <div className="space-y-3">
                {([
                  { key: 'chest',    label: 'Chest',    unit: 'cm', min: 50,  max: 150, emoji: '💪' },
                  { key: 'waist',    label: 'Waist',    unit: 'cm', min: 40,  max: 140, emoji: '⬤'  },
                  { key: 'shoulder', label: 'Shoulder', unit: 'cm', min: 30,  max: 70,  emoji: '↔️' },
                ] as const).map(({ key, label, unit, min, max, emoji }) => (
                  <div key={key} className="p-4 rounded-xl border-2 bg-white" style={{ borderColor: C.peach }}>
                    <div className="flex justify-between items-center mb-2">
                      <div className="flex items-center gap-1.5">
                        <span>{emoji}</span>
                        <label className="text-xs font-black uppercase tracking-widest text-gray-400">{label}</label>
                      </div>
                      <span className="text-lg font-black" style={{ color: C.navy }}>{measurements[key]} {unit}</span>
                    </div>
                    <input type="range" min={min} max={max} step={0.5}
                      value={measurements[key]}
                      onChange={e => setMeasurements(p => ({ ...p, [key]: Number(e.target.value) }))}
                      className="w-full" style={{ accentColor: C.navy }} />
                    <input type="number" min={min} max={max}
                      value={measurements[key]}
                      onChange={e => setMeasurements(p => ({ ...p, [key]: Number(e.target.value) }))}
                      className="mt-2 w-24 px-3 py-1.5 rounded-lg border text-sm font-bold focus:outline-none"
                      style={{ borderColor: C.peach, backgroundColor: C.cream, color: C.navy }} />
                  </div>
                ))}
              </div>
              <div className="flex gap-3 mt-5">
                <button onClick={() => setStep(0)} className="flex-1 py-3 rounded-xl font-bold border-2 text-sm" style={{ borderColor: C.peach, color: C.navy }}>← Back</button>
                <button onClick={() => { setError(null); setStep(2); }} className="flex-1 py-3 rounded-xl font-bold text-white hover:opacity-90 shadow-lg" style={{ backgroundColor: C.navy }}>
                  Preview 3D Model →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ════ STEP 2: 3D Preview + Confirm ════ */}
        {step === 2 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
            {/* 3D canvas */}
            <div>
              <p className="text-xs font-black uppercase tracking-widest mb-2" style={{ color: C.pink }}>Step 3 of 3</p>
              <h2 className="text-2xl font-black mb-1" style={{ color: C.navy }}>Your 3D body 🧍</h2>
              <p className="text-sm text-gray-500 mb-4">This is how your model looks. Drag to rotate.</p>
              <div className="rounded-2xl overflow-hidden border-2 relative" style={{ borderColor: C.peach, height: '440px' }}>
                {!modelReady && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10" style={{ backgroundColor: C.cream }}>
                    <div className="w-10 h-10 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: C.navy, borderTopColor: 'transparent' }} />
                    <p className="text-sm font-bold" style={{ color: C.navy }}>Loading 3D model...</p>
                  </div>
                )}
                <canvas ref={canvasRef} className="w-full h-full" style={{ display: 'block' }} />
              </div>
              <p className="text-xs text-center mt-2 text-gray-400">Update anytime from your Profile page.</p>
            </div>

            {/* Summary + fine-tune */}
            <div className="flex flex-col">
              <h3 className="text-lg font-black mb-4" style={{ color: C.navy }}>Review & fine-tune</h3>
              <div className="p-4 rounded-xl border-2 mb-4 bg-white" style={{ borderColor: C.peach }}>
                <div className="grid grid-cols-3 gap-3">
                  {[['Name', name || '—'], ['Age', age || '—'], ['Gender', gender || '—']].map(([k, v]) => (
                    <div key={k}>
                      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{k}</p>
                      <p className="text-sm font-black capitalize mt-0.5" style={{ color: C.navy }}>{v}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex-1 space-y-4">
                {([
                  { key: 'height',   label: 'Height',   unit: 'cm', min: 100, max: 220, emoji: '📏' },
                  { key: 'chest',    label: 'Chest',    unit: 'cm', min: 50,  max: 150, emoji: '💪' },
                  { key: 'waist',    label: 'Waist',    unit: 'cm', min: 40,  max: 140, emoji: '⬤'  },
                  { key: 'shoulder', label: 'Shoulder', unit: 'cm', min: 30,  max: 70,  emoji: '↔️' },
                ] as const).map(({ key, label, unit, min, max, emoji }) => (
                  <div key={key} className="flex items-center gap-3">
                    <span className="text-base w-6 text-center">{emoji}</span>
                    <span className="text-xs font-black text-gray-400 uppercase w-14 flex-shrink-0">{label}</span>
                    <input type="range" min={min} max={max} step={0.5}
                      value={measurements[key]}
                      onChange={e => setMeasurements(p => ({ ...p, [key]: Number(e.target.value) }))}
                      className="flex-1" style={{ accentColor: C.navy }} />
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <input type="number" min={min} max={max}
                        value={measurements[key]}
                        onChange={e => setMeasurements(p => ({ ...p, [key]: Number(e.target.value) }))}
                        className="w-16 px-2 py-1 rounded-lg border text-sm font-bold focus:outline-none text-center"
                        style={{ borderColor: C.peach, backgroundColor: C.cream, color: C.navy }} />
                      <span className="text-xs text-gray-400 w-5">{unit}</span>
                    </div>
                  </div>
                ))}
              </div>

              {error && <p className="text-xs text-red-500 mt-4">{error}</p>}
              <div className="flex gap-3 mt-6">
                <button onClick={() => setStep(1)} className="flex-1 py-3 rounded-xl font-bold border-2 text-sm" style={{ borderColor: C.peach, color: C.navy }}>← Back</button>
                <button onClick={handleFinish} disabled={saving}
                  className="flex-1 py-4 rounded-xl font-black text-white hover:opacity-90 disabled:opacity-50 shadow-lg"
                  style={{ backgroundColor: C.navy }}>
                  {saving ? 'Saving...' : '✅ Save & View My Profile'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}