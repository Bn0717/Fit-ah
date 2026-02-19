// app/onboarding/page.tsx
// NEW USER SETUP — runs once, then redirects to /profile
'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/contexts/AuthContext';
import { getAvatar, saveAvatar } from '@/lib/firebase/firestore';
import { processImage } from '@/lib/mediapipe/poseDetection';

const C = { cream: '#F8F3EA', navy: '#0B1957', peach: '#FFDBD1', pink: '#FA9EBC' };
type Step = 'info' | 'photo' | 'measurements' | 'preview';
type Measurements = { height: number; chest: number; waist: number; shoulder: number };

function norm01(v: number, b: number, m: number) { return Math.max(0, Math.min(1, (v - b) / (m - b))); }

export default function OnboardingPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<Step>('info');
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectMsg, setDetectMsg] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [measurements, setMeasurements] = useState<Measurements>({ height: 170, chest: 90, waist: 75, shoulder: 44 });
  const [saving, setSaving] = useState(false);
  const [step1Err, setStep1Err] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef  = useRef<{ animId: ReturnType<typeof requestAnimationFrame>; renderer: { dispose: () => void }; ro: ResizeObserver; applyBody: (m: Measurements) => void } | null>(null);

  useEffect(() => {
    if (!authLoading && !user) { router.push('/login'); return; }
    if (!authLoading && user) {
      getAvatar(user.uid).then(p => {
        if (p && (p as any).displayName) router.push('/profile');
      });
    }
  }, [user, authLoading, router]);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
    setDetectMsg(null);
  };

  const handleScan = async () => {
    if (!photoPreview) return;
    setDetecting(true); setDetectMsg(null);
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; img.src = photoPreview; });
      const result = await processImage(img, measurements.height);
      if (result) {
        setMeasurements({ height: result.height, chest: result.chest, waist: result.waist, shoulder: result.shoulder });
        setConfidence(result.confidence);
        if (result.confidence < 0.6) setDetectMsg('Low confidence — please check and adjust values below.');
        else setDetectMsg(`Detected at ${Math.round(result.confidence * 100)}% confidence!`);
      } else {
        setDetectMsg('Could not detect body — ensure your full body is visible. Enter manually below.');
      }
    } catch { setDetectMsg('Detection failed — enter measurements manually.'); }
    finally { setDetecting(false); setStep('measurements'); }
  };

  useEffect(() => {
    if (step !== 'preview' || !canvasRef.current) return;
    let cancelled = false;
    Promise.all([
      import('three'),
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/controls/OrbitControls.js'),
    ]).then(([THREE, { GLTFLoader }, { OrbitControls }]) => {
      if (cancelled || !canvasRef.current) return;
      const canvas = canvasRef.current;
      const scene = new THREE.Scene(); scene.background = new THREE.Color(0xfaf7f2);
      const camera = new THREE.PerspectiveCamera(40, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
      camera.position.set(0, 0.8, 3.5);
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true; controls.autoRotate = true; controls.autoRotateSpeed = 1.5;
      scene.add(new THREE.AmbientLight(0xffffff, 1.0));
      const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(3, 5, 2); scene.add(key);
      let bodyMesh: any = null;
      function setKey(prefix: string, val: number) {
        if (!bodyMesh?.morphTargetDictionary) return;
        const k = Object.keys(bodyMesh.morphTargetDictionary).find((k: string) => k === prefix || k.toLowerCase().startsWith(prefix.toLowerCase()));
        if (k) bodyMesh.morphTargetInfluences[bodyMesh.morphTargetDictionary[k]] = val;
      }
      function applyBody(m: Measurements) {
        if (!bodyMesh) return;
        setKey('CHEST_WIDE',    norm01(m.chest,    30, 57)   * 3.0);
        setKey('SHOULDER_WIDE', norm01(m.shoulder, 43, 55)   * 0.5);
        setKey('HEIGHT',        norm01(m.height,   150, 198) * 0.8);
        setKey('WAIST_WIDE',    norm01(m.waist,    29, 54)   * 10.0);
        setKey('BODY_LENGTH',   1.5);
      }
      new GLTFLoader().load('/models/human.glb?v=' + Date.now(), (gltf: any) => {
        if (cancelled) return;
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        model.position.sub(box.getCenter(new THREE.Vector3()));
        scene.add(model);
        model.traverse((obj: any) => {
          if (!obj.isMesh || !obj.morphTargetDictionary || bodyMesh) return;
          const lk = Object.keys(obj.morphTargetDictionary).map((k: string) => k.toLowerCase());
          if (lk.some((k: string) => k.includes('body_length') || k.includes('height') || k.includes('chest'))) {
            bodyMesh = obj; if (sceneRef.current) sceneRef.current.applyBody = applyBody; applyBody(measurements);
          }
        });
      }, undefined, (e: any) => console.error(e));
      let animId: ReturnType<typeof requestAnimationFrame> = 0;
      const animate = () => { animId = requestAnimationFrame(animate); controls.update(); if (bodyMesh) setKey('BODY_LENGTH', 1.5); renderer.render(scene, camera); };
      animate();
      const ro = new ResizeObserver(() => {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false);
      });
      ro.observe(canvas);
      sceneRef.current = { animId, renderer, ro, applyBody };
    });
    return () => {
      cancelled = true;
      if (sceneRef.current) { cancelAnimationFrame(sceneRef.current.animId); sceneRef.current.renderer.dispose(); sceneRef.current.ro.disconnect(); sceneRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => { sceneRef.current?.applyBody(measurements); }, [measurements]);

  const handleFinish = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await saveAvatar({ userId: user.uid, displayName: name.trim(), age: parseInt(age) || 0, gender, ...measurements } as any);
      router.push('/profile');
    } catch (e: any) { alert(e.message || 'Save failed'); setSaving(false); }
  };

  const steps: Step[] = ['info', 'photo', 'measurements', 'preview'];
  const stepLabels = ['About You', 'Body Photo', 'Measurements', '3D Preview'];
  const stepIdx = steps.indexOf(step);

  if (authLoading) return <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: C.cream }}><div className="w-10 h-10 border-4 rounded-full animate-spin" style={{ borderColor: C.navy, borderTopColor: 'transparent' }} /></div>;

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: C.cream }}>
      {/* Header with progress */}
      <div className="bg-white border-b-2 px-8 py-5" style={{ borderColor: C.peach }}>
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-2 mb-4">
            <span className="font-black text-lg" style={{ color: C.navy }}>FitCheck</span>
            <span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ backgroundColor: C.peach, color: C.navy }}>Profile Setup</span>
          </div>
          <div className="flex items-center gap-1">
            {steps.map((s, i) => (
              <div key={s} className="flex items-center gap-1 flex-1">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 transition-all"
                  style={{ backgroundColor: i <= stepIdx ? C.navy : C.peach, color: i <= stepIdx ? 'white' : C.navy }}>
                  {i < stepIdx ? '✓' : i + 1}
                </div>
                <div className="flex-1">
                  <div className="text-[9px] font-black whitespace-nowrap mb-0.5" style={{ color: i === stepIdx ? C.navy : 'gray' }}>{stepLabels[i]}</div>
                  {i < steps.length - 1 && <div className="h-0.5 transition-all" style={{ backgroundColor: i < stepIdx ? C.navy : C.peach }} />}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-start justify-center p-8">
        <div className="w-full max-w-2xl">

          {step === 'info' && (
            <div className="bg-white rounded-3xl shadow-sm border-2 p-8" style={{ borderColor: C.peach }}>
              <h2 className="text-2xl font-black mb-1" style={{ color: C.navy }}>Welcome to FitCheck! 👋</h2>
              <p className="text-sm text-gray-500 mb-8">Tell us about yourself to personalise your experience.</p>
              <div className="space-y-5">
                <div>
                  <label className="block text-xs font-black uppercase tracking-widest mb-2" style={{ color: C.navy }}>Your Name *</label>
                  <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Alex"
                    className="w-full px-4 py-3 rounded-xl border-2 font-medium text-base focus:outline-none"
                    style={{ borderColor: C.peach, backgroundColor: C.cream, color: C.navy }} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-black uppercase tracking-widest mb-2" style={{ color: C.navy }}>Age</label>
                    <input type="number" value={age} onChange={e => setAge(e.target.value)} placeholder="25" min="10" max="100"
                      className="w-full px-4 py-3 rounded-xl border-2 font-medium text-base focus:outline-none"
                      style={{ borderColor: C.peach, backgroundColor: C.cream, color: C.navy }} />
                  </div>
                  <div>
                    <label className="block text-xs font-black uppercase tracking-widest mb-2" style={{ color: C.navy }}>Gender</label>
                    <select value={gender} onChange={e => setGender(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border-2 font-medium text-base focus:outline-none"
                      style={{ borderColor: C.peach, backgroundColor: C.cream, color: C.navy }}>
                      <option value="">Select...</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other</option>
                      <option value="prefer_not">Prefer not to say</option>
                    </select>
                  </div>
                </div>
                {step1Err && <p className="text-xs font-semibold text-red-500">{step1Err}</p>}
              </div>
              <button onClick={() => { if (!name.trim()) { setStep1Err('Please enter your name.'); return; } setStep1Err(null); setStep('photo'); }}
                className="w-full mt-8 py-4 rounded-xl font-black text-white transition-all hover:opacity-90"
                style={{ backgroundColor: C.navy }}>Continue →</button>
            </div>
          )}

          {step === 'photo' && (
            <div className="bg-white rounded-3xl shadow-sm border-2 p-8" style={{ borderColor: C.peach }}>
              <h2 className="text-2xl font-black mb-1" style={{ color: C.navy }}>Upload Body Photo 📸</h2>
              <p className="text-sm text-gray-500 mb-2">MediaPipe will scan your body to estimate measurements automatically.</p>
              <div className="flex items-start gap-2 mb-6 p-3 rounded-xl text-xs text-gray-600" style={{ backgroundColor: C.cream }}>
                💡 Stand facing the camera in good lighting. Arms slightly away from body, wear fitted clothes.
              </div>
              <label className="block cursor-pointer">
                <div className="border-2 border-dashed rounded-2xl overflow-hidden" style={{ borderColor: C.peach, backgroundColor: C.cream }}>
                  {photoPreview
                    ? <img src={photoPreview} alt="body" className="w-full max-h-72 object-contain" />
                    : <div className="flex flex-col items-center justify-center py-14 gap-3">
                        <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl" style={{ backgroundColor: C.peach }}>🧍</div>
                        <p className="font-bold text-base" style={{ color: C.navy }}>Upload full-body photo</p>
                        <p className="text-xs text-gray-400">JPG, PNG or WEBP</p>
                      </div>}
                </div>
                <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
              </label>
              <div className="flex gap-3 mt-6">
                <button onClick={() => setStep('info')} className="px-6 py-3 rounded-xl font-bold border-2" style={{ borderColor: C.peach, color: C.navy }}>← Back</button>
                {photoPreview
                  ? <button onClick={handleScan} disabled={detecting}
                      className="flex-1 py-3 rounded-xl font-black text-white disabled:opacity-60 flex items-center justify-center gap-2"
                      style={{ backgroundColor: C.navy }}>
                      {detecting ? <><div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'white', borderTopColor: 'transparent' }} />Scanning...</> : '🎯 Scan with MediaPipe →'}
                    </button>
                  : <button onClick={() => setStep('measurements')} className="flex-1 py-3 rounded-xl font-bold border-2" style={{ borderColor: C.navy, color: C.navy }}>Skip — Enter manually →</button>}
              </div>
            </div>
          )}

          {step === 'measurements' && (
            <div className="bg-white rounded-3xl shadow-sm border-2 p-8" style={{ borderColor: C.peach }}>
              <h2 className="text-2xl font-black mb-1" style={{ color: C.navy }}>Your Measurements 📏</h2>
              {confidence !== null
                ? <div className="flex items-center gap-2 mb-5 p-3 rounded-xl" style={{ backgroundColor: C.peach }}>
                    <span>{confidence >= 0.7 ? '✅' : '⚠️'}</span>
                    <p className="text-xs font-black" style={{ color: C.navy }}>Detected at {Math.round(confidence * 100)}% confidence — review and adjust if needed.</p>
                  </div>
                : detectMsg
                ? <div className="mb-5 p-3 rounded-xl bg-orange-50 border border-orange-200"><p className="text-xs font-semibold text-orange-700">{detectMsg}</p></div>
                : <p className="text-sm text-gray-500 mb-5">Enter your measurements in centimetres.</p>}
              <div className="grid grid-cols-2 gap-4">
                {([
                  { key: 'height',   label: 'Height',   min: 100, max: 220 },
                  { key: 'chest',    label: 'Chest',    min: 50,  max: 150 },
                  { key: 'waist',    label: 'Waist',    min: 40,  max: 140 },
                  { key: 'shoulder', label: 'Shoulder', min: 30,  max: 80  },
                ] as { key: keyof Measurements; label: string; min: number; max: number }[]).map(({ key, label, min, max }) => (
                  <div key={key}>
                    <label className="block text-xs font-black uppercase tracking-widest mb-1" style={{ color: C.navy }}>{label} <span className="font-normal opacity-40">(cm)</span></label>
                    <div className="relative">
                      <input type="number" min={min} max={max} step={0.5} value={measurements[key]}
                        onChange={e => setMeasurements(prev => ({ ...prev, [key]: Number(e.target.value) }))}
                        className="w-full px-4 py-3 pr-12 rounded-xl border-2 font-black text-xl focus:outline-none"
                        style={{ borderColor: C.peach, backgroundColor: C.cream, color: C.navy }} />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs opacity-40" style={{ color: C.navy }}>cm</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-3 mt-8">
                <button onClick={() => setStep('photo')} className="px-6 py-3 rounded-xl font-bold border-2" style={{ borderColor: C.peach, color: C.navy }}>← Back</button>
                <button onClick={() => setStep('preview')} className="flex-1 py-3 rounded-xl font-black text-white hover:opacity-90" style={{ backgroundColor: C.navy }}>Preview 3D Body →</button>
              </div>
            </div>
          )}

          {step === 'preview' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white rounded-3xl border-2 overflow-hidden" style={{ borderColor: C.peach }}>
                <div className="p-4 border-b" style={{ borderColor: C.peach }}>
                  <p className="text-xs font-black uppercase tracking-widest" style={{ color: C.navy }}>3D Body Preview</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Drag to rotate · Built from your measurements</p>
                </div>
                <canvas ref={canvasRef} className="w-full" style={{ height: '380px', display: 'block' }} />
              </div>
              <div className="flex flex-col gap-4">
                <div className="bg-white rounded-3xl border-2 p-6 flex-1" style={{ borderColor: C.peach }}>
                  <h3 className="text-lg font-black mb-4" style={{ color: C.navy }}>Profile Summary</h3>
                  <div className="space-y-2 mb-5">
                    {[['Name', name], ['Age', age], ['Gender', gender.replace('_', ' ')]].filter(([, v]) => v).map(([l, v]) => (
                      <div key={l} className="flex justify-between py-2 border-b" style={{ borderColor: C.peach }}>
                        <span className="text-xs font-bold text-gray-400 uppercase tracking-wide">{l}</span>
                        <span className="font-black text-sm capitalize" style={{ color: C.navy }}>{v}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">Measurements</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.entries(measurements) as [string, number][]).map(([k, v]) => (
                      <div key={k} className="rounded-xl p-3 border" style={{ backgroundColor: C.cream, borderColor: C.peach }}>
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">{k}</p>
                        <p className="text-xl font-black" style={{ color: C.navy }}>{v}<span className="text-xs ml-0.5 opacity-40">cm</span></p>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setStep('measurements')} className="w-full mt-4 py-2 rounded-xl font-bold text-sm border-2" style={{ borderColor: C.peach, color: C.navy }}>✏️ Adjust Measurements</button>
                </div>
                <button onClick={handleFinish} disabled={saving}
                  className="w-full py-4 rounded-2xl font-black text-white text-base hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: C.navy }}>
                  {saving ? 'Saving...' : '✅ Save & Enter Wardrobe'}
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}