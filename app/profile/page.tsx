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

const BODY_BASE = { height: 150, chest: 30, shoulder: 43, waist: 29, hip: 40, armLen: 56, bodyLen: 60 };
const BODY_MAX  = { height: 198, chest: 57, shoulder: 55, waist: 54, hip: 62, armLen: 84, bodyLen: 75 };
type Measurements = { height: number; chest: number; waist: number; shoulder: number };

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const norm = (v: number, b: number, m: number) => clamp01((v - b) / (m - b));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const HEIGHT_SCALE_MAX = BODY_MAX.height / BODY_BASE.height;

const SIZE_DATA: Record<string, { chest: number; shoulder: number; length: number; sleeve: number }> = {
  S:     { chest: 54.5, shoulder: 43, length: 71, sleeve: 22   },
  '4XL': { chest: 69.5, shoulder: 55, length: 79, sleeve: 29.5 },
};
const BASE = SIZE_DATA['S'];
const MAX  = SIZE_DATA['4XL'];
const cmToMorph = (v: number, b: number, m: number) => Math.max(0, Math.min(1, (v - b) / (m - b)));

// ─── Profile User Guide Modal ─────────────────────────────────────────────────
function ProfileUserGuideModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const steps = [
    {
      num: '1',
      title: 'Customise Your 3D Model',
      desc: 'Use this page to adjust your 3D model with your real body measurements.',
      note: 'Drag the sliders on the left to update the 3D body live.',
      color: '#EFF6FF',
      border: '#BFDBFE',
    },
    {
      num: '2',
      title: 'Virtual Try-On',
      desc: 'Tap any clothing card from your Wardrobe to try it on your 3D body and check fit.',
      note: null,
      color: '#F0FDF4',
      border: '#BBF7D0',
    },
    {
      num: '3',
      title: 'Add Items First!',
      desc: 'If the Items tab is empty, head to the Wardrobe page to upload shirts first.',
      note: 'Go to Wardrobe → Add Items → come back here!',
      color: '#FDF4FF',
      border: '#E9D5FF',
    },
  ];

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
        style={{ backgroundColor: 'white' }}
      >
        <div className="px-6 py-5" style={{ background: `linear-gradient(135deg, ${C.navy} 0%, #1a2f7a 100%)` }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-white/50 mb-1">How to use</p>
              <h2 className="text-xl font-black text-white">Profile Page Guide 📖</h2>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all font-bold text-lg"
            >×</button>
          </div>
        </div>

        <div className="p-5 space-y-3">
          {steps.map((step) => (
            <div
              key={step.num}
              className="rounded-xl p-4 border-2"
              style={{ backgroundColor: step.color, borderColor: step.border }}
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-black text-sm text-white"
                  style={{ backgroundColor: C.navy }}>
                  {step.num}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-black text-sm" style={{ color: C.navy }}>{step.title}</p>
                  </div>
                  <p className="text-xs leading-relaxed text-gray-600">{step.desc}</p>
                  {step.note && (
                    <p className="text-[10px] mt-1.5 font-semibold text-gray-400 italic">⚠️ {step.note}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 pb-5">
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl font-black text-sm text-white hover:opacity-90 transition-all shadow-md active:scale-95"
            style={{ backgroundColor: C.navy }}
          >
            Got it! 👍
          </button>
        </div>
      </div>
    </div>
  );
}

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
  const [showProfileGuide, setShowProfileGuide] = useState(false);

  // ── Body measurements ─────────────────────────────────────────
  const [saved,       setSaved]       = useState<Measurements>({ height: 170, chest: 45, waist: 35, shoulder: 48 });
  const [draft,       setDraft]       = useState<Measurements>({ height: 170, chest: 45, waist: 35, shoulder: 48 });
  const [savingBody,  setSavingBody]  = useState(false);
  const [bodySuccess, setBodySuccess] = useState(false);

  // ── Wardrobe ──────────────────────────────────────────────────
  const [items,          setItems]          = useState<ClothingItem[]>([]);
  const [outfits,        setOutfits]        = useState<OutfitCombination[]>([]);
  const [activeTab,      setActiveTab]      = useState<'items' | 'outfits'>('items');
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [selectedItem,   setSelectedItem]   = useState<ClothingItem | null>(null);
  const [selectedShirtSize, setSelectedShirtSize] = useState<string>('');
  const [sidebarView,    setSidebarView]    = useState<'2d' | '3d'>('2d');
  const [loadingData,    setLoadingData]    = useState(true);
  const [showSizeDetails, setShowSizeDetails] = useState(false);
  const [activePreviewId, setActivePreviewId] = useState<string | null>(null);

  // ── Mobile Responsive State ─────────────────────────────────────
  const [mobileTab, setMobileTab] = useState<'3d' | 'profile'>('3d');
  const [isWardrobeExpanded, setIsWardrobeExpanded] = useState(false);
  const [showMobileBodySize, setShowMobileBodySize] = useState(false);
  const [touchStartY, setTouchStartY] = useState<number | null>(null);

  // ── 3D body canvas (center) ────────────────────────────────────
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef  = useRef<{
    animId: ReturnType<typeof requestAnimationFrame>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderer: any;
    ro: ResizeObserver;
    updateBody: (m: Measurements) => void;
    tryOnShirt: (frontUrl: string | null, backUrl?: string | null) => void;
    applySize: (size: string, itemData: ClothingItem | null) => void;
  } | null>(null);
  const [bodyReady, setBodyReady] = useState(false);

  useEffect(() => { if (!authLoading && !user) router.push('/login'); }, [user, authLoading, router]);

  useEffect(() => {
    if (!user) return;
    setLoadingData(true);
    Promise.all([getAvatar(user.uid), getUserClothingItems(user.uid), getUserOutfits(user.uid)])
      .then(([profile, clothingItems, userOutfits]) => {
        if (profile) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const p = profile as any;
          const m: Measurements = {
            height: p.height ?? 170,
            chest: p.chest ?? 45,
            shoulder: p.shoulder ?? 48,
            waist: p.waist ?? 35,
          };
          setSaved(m); 
          setDraft(m);
          setDisplayName(p.displayName || ''); 
          setAge(p.age ? String(p.age) : ''); 
          setGender(p.gender || '');
          if (p.photoUrl) setPhotoPreview(p.photoUrl);
        }
        setItems(clothingItems); 
        setOutfits(userOutfits);
        setLoadingData(false);
      });
  }, [user]);

  // ── Body 3D scene ──────────────────────────────────────────────────────────────
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let heightBone: any = null;
      let shirtBaseY: number | null = null;
      let shirtBaseZ: number | null = null; 
      let unitsPerCm: number | null = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let mixer: any = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let activeAction: any = null;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function forceOpaqueMaterial(obj: any, THREE: any) {
        if (!obj?.isMesh) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mats.forEach((m: any) => {
          if (!m) return;
          m.transparent = false; m.opacity = 1; m.alphaTest = 0; m.depthWrite = true; m.depthTest = true;
          m.side = THREE.FrontSide;
          m.needsUpdate = true;
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function getBoneByNameLike(skinned: any, nameLike: string) {
        const key = nameLike.toLowerCase();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return skinned?.skeleton?.bones?.find((bn: any) => (bn.name || '').toLowerCase().includes(key)) ?? null;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function initShirtFollow(THREE: any) {
        if (!bodyMesh || !shirtMesh) return;
        if (shirtBaseY == null) shirtBaseY = shirtMesh.position.y;
        if (shirtBaseZ == null) shirtBaseZ = shirtMesh.position.z;
        const box = new THREE.Box3().setFromObject(bodyMesh);
        unitsPerCm = ((box.max.y - box.min.y) / BODY_BASE.height) * 0.85;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function setBodyMorph(prefix: string, value: number, mesh: any) {
        if (!mesh?.morphTargetDictionary) return;
        const k = (Object.keys(mesh.morphTargetDictionary) as string[]).find(k => k === prefix || k.toLowerCase().startsWith(prefix.toLowerCase()));
        if (k) mesh.morphTargetInfluences[mesh.morphTargetDictionary[k]] = value;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function setShirtMorph(prefix: string, value: number, mesh: any) {
        if (!mesh?.morphTargetDictionary) return;
        const k = Object.keys(mesh.morphTargetDictionary).find(k => k.toLowerCase().startsWith(prefix.toLowerCase()));
        if (k) mesh.morphTargetInfluences[mesh.morphTargetDictionary[k]] = value;
      }

      function updateBody(b: Measurements) {
        if (!bodyMesh) return;

        const tH = norm(b.height,   BODY_BASE.height,   BODY_MAX.height);
        const tC = norm(b.chest,    BODY_BASE.chest,    BODY_MAX.chest);
        const tS = norm(b.shoulder, BODY_BASE.shoulder, BODY_MAX.shoulder);
        const tW = norm(b.waist,    BODY_BASE.waist,    BODY_MAX.waist);

        if (heightBone) {
          const sY = 1 + tH * (HEIGHT_SCALE_MAX - 1);
          heightBone.scale.set(sY, sY, sY);
          heightBone.updateMatrixWorld(true);
          if (bodyMesh?.skeleton) bodyMesh.skeleton.update();
        }

        if (shirtMesh && shirtBaseY != null && shirtBaseZ != null && unitsPerCm != null) {
          shirtMesh.position.y = shirtBaseY + (b.height - BODY_BASE.height) * unitsPerCm;
          const puffStrength = Math.max(tC * 1.1, tW * 1.4);
          const zScale = 1.2 + (1.9 - 1.2) * clamp01(puffStrength);
          const forwardPush = (zScale - 1.2) * 0.22; 
          shirtMesh.position.z = shirtBaseZ + forwardPush;
          shirtMesh.scale.set(1, 1, zScale);
        }
        
        const armLenCm  = lerp(BODY_BASE.armLen,  BODY_MAX.armLen,  tH);
        const hipT      = clamp01(0.6 * tW + 0.4 * tC);
        const hipCm     = lerp(BODY_BASE.hip, BODY_MAX.hip, hipT);

        setBodyMorph('SHOULDER_WIDE', tS * 0.5,  bodyMesh);
        setBodyMorph('CHEST_WIDE',    tC * 3.0,  bodyMesh);
        setBodyMorph('WAIST_WIDE',    tW * 10.0, bodyMesh);
        setBodyMorph('HIP_WIDE',      norm(hipCm, BODY_BASE.hip, BODY_MAX.hip) * 2.0, bodyMesh);
        setBodyMorph('ARM_LENGTH',    norm(armLenCm, BODY_BASE.armLen, BODY_MAX.armLen) * 3.0, bodyMesh);

        const upperArmT = clamp01(0.7 * tC + 0.3 * tS), lowerArmT = clamp01(0.5 * tC + 0.5 * tS), upperLegT = clamp01(0.7 * tW + 0.3 * tC);
        setBodyMorph('LEFT_UPPERARM_BIG',  upperArmT * 3.0, bodyMesh); setBodyMorph('RIGHT_UPPERARM_BIG', upperArmT * 3.0, bodyMesh);
        setBodyMorph('LEFT_LOWERARM_BIG',  lowerArmT * 2.0, bodyMesh); setBodyMorph('RIGHT_LOWERARM_BIG', lowerArmT * 2.0, bodyMesh);
        setBodyMorph('LEFT_UPPERLEG_BIG',  upperLegT * 2.0, bodyMesh); setBodyMorph('RIGHT_UPPERLEG_BIG', upperLegT * 2.0, bodyMesh);
        setBodyMorph('BODY_LENGTH', 1.5, bodyMesh);
      }

      function applySize(size: string, itemData: ClothingItem | null) {
        if (!shirtMesh || !itemData) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d = itemData.sizeChart.find((s: any) => s.size === size);
        if (!d) return;
        setShirtMorph('CHEST_WIDE', cmToMorph(d.chest, BASE.chest, MAX.chest), shirtMesh);
        setShirtMorph('SHOULDER_WIDE', cmToMorph(d.shoulder, BASE.shoulder, MAX.shoulder), shirtMesh);
        setShirtMorph('LEN_LONG', cmToMorph(d.length, BASE.length, MAX.length), shirtMesh);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setShirtMorph('SLEEVE_LONG', cmToMorph((d as any).sleeve || 25, BASE.sleeve, MAX.sleeve), shirtMesh);
      }

      const ATLAS_SIZE    = 2048;
      const FRONT_RECT    = { x: 0,    y: 0,    w: 1024, h: 1536 };
      const BACK_RECT     = { x: 1024, y: 0,    w: 1024, h: 1536 };
      const L_SLEEVE_RECT = { x: 0,    y: 1536, w: 1024, h: 512  };
      const R_SLEEVE_RECT = { x: 1024, y: 1536, w: 1024, h: 512  };

      const atlasCanvas = document.createElement('canvas');
      atlasCanvas.width = atlasCanvas.height = ATLAS_SIZE;
      const atlasCtx = atlasCanvas.getContext('2d', { willReadFrequently: true })!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let atlasTexture: any = null;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function processShirtTexture(ctx: CanvasRenderingContext2D, img: HTMLImageElement, rect: any, isFront: boolean) {
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
        const ss = Math.min(sw * 0.25, 200);
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

      function tryOnShirt(frontUrl: string | null, backUrl?: string | null) {
        if (!shirtMesh) return;
        if (!frontUrl) { shirtMesh.visible = false; return; }
        shirtMesh.visible = true;
        atlasCtx.fillStyle = '#ffffff';
        atlasCtx.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
        let loaded = 0;
        const totalToLoad = backUrl ? 2 : 1;

        function onAllLoaded() {
          if (!atlasTexture) {
            atlasTexture = new THREE.CanvasTexture(atlasCanvas);
            atlasTexture.flipY = false;
            atlasTexture.colorSpace = THREE.SRGBColorSpace;
          } else {
            atlasTexture.needsUpdate = true;
          }
          shirtMesh.material = new THREE.MeshStandardMaterial({
            map: atlasTexture, roughness: 0.8, side: THREE.DoubleSide, transparent: false, depthWrite: true
          });
          shirtMesh.material.needsUpdate = true;
        }

        const frontImg = new Image(); frontImg.crossOrigin = 'anonymous';
        frontImg.onload = () => { processShirtTexture(atlasCtx, frontImg, FRONT_RECT, true); loaded++; if(loaded>=totalToLoad) onAllLoaded(); };
        frontImg.onerror = () => { loaded++; if(loaded>=totalToLoad) onAllLoaded(); };
        frontImg.src = frontUrl;

        if (backUrl) {
          const backImg = new Image(); backImg.crossOrigin = 'anonymous';
          backImg.onload = () => { processShirtTexture(atlasCtx, backImg, BACK_RECT, false); loaded++; if(loaded>=totalToLoad) onAllLoaded(); };
          backImg.onerror = () => { loaded++; if(loaded>=totalToLoad) onAllLoaded(); };
          backImg.src = backUrl;
        }
      }

      const loader = new GLTFLoader();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      loader.load('/models/humanlatestwithshirt2.glb?v=1.0', (gltf: any) => {
        if (cancelled) return;
        const model = gltf.scene;
        model.position.sub(new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3()));
        scene.add(model);

        if (gltf.animations && gltf.animations.length > 0) {
          mixer = new THREE.AnimationMixer(model);
          activeAction = mixer.clipAction(gltf.animations[0]);
          activeAction.reset(); activeAction.play(); activeAction.paused = true; activeAction.time = 0; mixer.update(0);
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        model.traverse((obj: any) => {
          if (!obj.isMesh) return;
          forceOpaqueMaterial(obj, THREE);
          const lk = Object.keys(obj.morphTargetDictionary || {}).map((k: string) => k.toLowerCase());
          
          if (!shirtMesh && lk.some((k: string) => k.includes('len_long') || k.includes('chest_wide'))) {
            shirtMesh = obj;
            shirtMesh.material.side = THREE.DoubleSide;
            shirtMesh.visible = false;
          }
          else if (!bodyMesh && obj.isSkinnedMesh && obj !== shirtMesh) {
            bodyMesh = obj;
            bodyMesh.material.side = THREE.FrontSide;
            heightBone = getBoneByNameLike(bodyMesh, 'height_ctrl');
          }
        });

        if (bodyMesh) {
          initShirtFollow(THREE); 
          bodyMesh.updateMatrixWorld(true); 
          updateBody(draft); 
          if (sceneRef.current) {
            sceneRef.current.updateBody = updateBody;
            sceneRef.current.tryOnShirt = tryOnShirt;
          }
        }
        setBodyReady(true);
      });

      let animId: ReturnType<typeof requestAnimationFrame> = 0;
      const animate = () => {
        animId = requestAnimationFrame(animate);
        controls.update();
        if (mixer) mixer.update(0);
        if (bodyMesh) setBodyMorph('BODY_LENGTH', 1.5, bodyMesh);
        renderer.render(scene, camera);
      };
      animate();

      const ro = new ResizeObserver(() => {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (!w || !h) return;
        camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false);
        
        // If height is small (wardrobe open), focus higher on the body to "push" it up
        if (h < 450) {
          controls.target.set(0, 1.1, 0); // Focus on neck/head
        } else {
          controls.target.set(0, 0.75, 0); // Focus on torso
        }
      });
      ro.observe(canvas);

      sceneRef.current = { animId, renderer, ro, updateBody, tryOnShirt, applySize };
    });

    return () => {
      cancelled = true;
      if (sceneRef.current) {
        cancelAnimationFrame(sceneRef.current.animId); sceneRef.current.renderer.dispose(); sceneRef.current.ro.disconnect(); sceneRef.current = null;
      }
      setBodyReady(false);
    };
  }, []);

  useEffect(() => { sceneRef.current?.updateBody(draft); }, [draft]);

  useEffect(() => {
    const itemToShow = selectedItem || items.find(i => i.id === activePreviewId);
    if (!itemToShow) {
      sceneRef.current?.tryOnShirt(null);
    } else {
      const frontUrl = itemToShow.frontImageUrl || itemToShow.imageUrl || null;
      const backUrl  = itemToShow.backImageUrl || null;
      sceneRef.current?.tryOnShirt(frontUrl, backUrl);
      const targetSize = itemToShow.userWearingSize ||
        (itemToShow.sizeChart.length > 0 ? itemToShow.sizeChart[Math.floor((itemToShow.sizeChart.length - 1) / 2)].size : 'M');
      setSelectedShirtSize(targetSize);
      if (sceneRef.current?.applySize) sceneRef.current.applySize(targetSize, itemToShow);
    }
  }, [selectedItem, activePreviewId, items]);

  useEffect(() => {
    if (selectedItem && selectedShirtSize) sceneRef.current?.applySize(selectedShirtSize, selectedItem);
  }, [selectedShirtSize, selectedItem]);

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
        const m: Measurements = { height: result.height, chest: result.chest, shoulder: result.shoulder, waist: draft.waist };
        setDraft(m); setDetectMsg('✅ Updated!');
      } else { setDetectMsg('⚠️ Could not detect. Adjust manually.'); }
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
      await saveAvatar({ 
        userId: user.uid, 
        ...draft, 
        displayName, 
        age: parseInt(age) || 0, 
        gender, 
        photoUrl 
      } as any);
      setSaved({ ...draft }); setEditingInfo(false);
    } finally { setSavingInfo(false); }
  };

  const handleSaveBody = async () => {
    if (!user) return;
    setSavingBody(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await saveAvatar({ 
      userId: user.uid, 
      ...draft, 
      displayName, 
      age: parseInt(age) || 0, 
      gender,
      photoUrl: photoPreview 
    } as any);
    setBodySuccess(true); setTimeout(() => setBodySuccess(false), 2500);
    setSavingBody(false);
  };

  // ── Mobile Bottom Sheet Touch ─────────────────────────────────
  const onSheetTouchStart = (e: React.TouchEvent) => setTouchStartY(e.touches[0].clientY);
  const onSheetTouchEnd = (e: React.TouchEvent) => {
    if (touchStartY === null) return;
    const touchEndY = e.changedTouches[0].clientY;
    const delta = touchStartY - touchEndY;
    if (delta > 40) setIsWardrobeExpanded(true);
    if (delta < -40) setIsWardrobeExpanded(false);
    setTouchStartY(null);
  };

  const categories    = ['All', ...Array.from(new Set(items.map(i => i.category).filter(Boolean)))];
  const filteredItems = activeCategory === 'All' ? items : items.filter(i => i.category === activeCategory);

  // ── Render Helpers for Wardrobe Content (Shared between Desktop/Mobile) ──
  const renderWardrobeInner = () => {
    if (loadingData) return (
      <div className="flex justify-center pt-8 pb-8">
        <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: C.navy, borderTopColor: 'transparent' }} />
      </div>
    );

    if (activeTab === 'items') {
      if (filteredItems.length === 0) {
        return (
          <div className="flex flex-col items-center justify-center pt-12 pb-8 px-4 gap-4">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl" style={{ backgroundColor: C.peach }}>👕</div>
            <div className="text-center">
              <p className="text-xs font-black mb-1" style={{ color: C.navy }}>No items yet</p>
              <p className="text-[10px] text-gray-400 leading-relaxed">
                Go to the Wardrobe page to upload clothing items, then come back here to try them on!
              </p>
            </div>
            <button
              onClick={() => setShowProfileGuide(true)}
              className="px-4 py-2 rounded-xl text-[10px] font-black mt-2"
              style={{ backgroundColor: C.pink, color: C.navy }}>
              📖 How does this work?
            </button>
          </div>
        );
      }

      if (selectedItem) {
        const item = selectedItem;
        const sizeRow = item.sizeChart.find(s => s.size === selectedShirtSize) ?? item.sizeChart[0];
        const fitRatio = sizeRow && saved.chest > 0 ? sizeRow.chest / saved.chest : null;
        const fitLabel = fitRatio == null ? null : fitRatio < 0.96 ? 'Tight' : fitRatio > 1.15 ? 'Loose' : 'Just Right';
        const fitColor = fitLabel === 'Tight' ? '#ef4444' : fitLabel === 'Loose' ? '#f59e0b' : '#10b981';

        return (
          <div className="animate-in fade-in zoom-in-95 duration-200 pb-2">
            <button onClick={() => setSelectedItem(null)} className="text-[9px] font-black mb-2 flex items-center gap-1 uppercase tracking-widest text-navy">← Back to List</button>
            <div className="rounded-xl border-2 bg-white overflow-hidden" style={{ borderColor: C.pink }}>
              <div className="px-3 py-1.5 flex items-center justify-between border-b bg-peach/20" style={{ borderColor: C.peach }}>
                <h3 className="text-[11px] font-black text-navy truncate max-w-[150px]">{item.name}</h3>
                <div className="w-4 h-4 rounded-full bg-navy text-white text-[8px] flex items-center justify-center">✓</div>
              </div>

              <div className="p-2 space-y-2">
                <div className="flex flex-wrap gap-1">
                  {item.sizeChart.map(sc => (
                    <button key={sc.size} onClick={() => setSelectedShirtSize(sc.size)}
                      className="px-2 py-1 rounded-md font-black text-[10px] border-2 transition-all"
                      style={{ backgroundColor: selectedShirtSize === sc.size ? C.navy : 'white', color: selectedShirtSize === sc.size ? 'white' : C.navy, borderColor: selectedShirtSize === sc.size ? C.navy : C.peach }}>
                      {sc.size}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-3 gap-1">
                  {[{l:'Chest',v:sizeRow.chest},{l:'Len',v:sizeRow.length},{l:'Sh',v:sizeRow.shoulder}].map(m => (
                    <div key={m.l} className="rounded-lg p-1 text-center border bg-cream/30">
                      <p className="text-[7px] font-bold text-gray-400 uppercase">{m.l}</p>
                      <p className="text-[10px] font-black text-navy">{m.v}cm</p>
                    </div>
                  ))}
                </div>
                
                <div className="grid grid-cols-4 gap-2">
                  {([
                    { label: 'Chest',  val: sizeRow.chest    },
                    { label: 'Length', val: sizeRow.length   },
                    { label: 'Shldr',  val: sizeRow.shoulder },
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    ...((sizeRow as any).sleeve ? [{ label: 'Sleeve', val: (sizeRow as any).sleeve }] : []),
                  ]).map(({ label, val }) => (
                    <div key={label} className="rounded-xl p-2 text-center border-2 bg-white" style={{ borderColor: C.peach }}>
                      <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest mb-0.5">{label}</p>
                      <p className="text-xs font-black" style={{ color: C.navy }}>{val}<span className="text-[9px] opacity-50 ml-0.5">cm</span></p>
                    </div>
                  ))}
                </div>

                {fitLabel && (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border mt-2"
                    style={{ backgroundColor: fitColor + '10', borderColor: fitColor + '30' }}>
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: fitColor }} />
                    <p className="text-[11px] font-bold" style={{ color: fitColor }}>
                      {fitLabel} — {((sizeRow.chest - saved.chest)).toFixed(1)}cm ease
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      }

      return (
        <div className="grid grid-cols-2 gap-3 pb-6">
          {filteredItems.map(item => {
            const isDrawerOpen = activePreviewId === item.id;
            return (
              <div key={item.id} className="flex flex-col">
                <button
                  onClick={() => { setActivePreviewId(isDrawerOpen ? null : item.id); setShowSizeDetails(false); }}
                  className="w-full rounded-2xl overflow-hidden border-2 transition-all text-left bg-white hover:shadow-md"
                  style={{ borderColor: isDrawerOpen ? C.navy : C.peach, transform: isDrawerOpen ? 'scale(1.02)' : 'scale(1)' }}>
                  <div className="aspect-square bg-white relative overflow-hidden flex items-center justify-center p-2">
                    {sidebarView === '2d' ? (
                      <img src={item.frontImageUrl || item.imageUrl} alt={item.name} className="w-[90%] h-[90%] object-contain" crossOrigin="anonymous" />
                    ) : (
                      <ShirtMiniCanvas itemId={item.id} imageUrl={item.frontImageUrl || item.imageUrl || null} />
                    )}
                    {isDrawerOpen && (
                      <div className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shadow-sm"
                            style={{ backgroundColor: C.navy, color: 'white' }}>✓</div>
                    )}
                  </div>
                  <div className="px-3 py-2 border-t" style={{ backgroundColor: isDrawerOpen ? C.peach : C.cream, borderColor: C.peach }}>
                    <p className="text-[11px] font-black truncate" style={{ color: C.navy }}>
                        {item.name} {item.userWearingSize ? `(${item.userWearingSize})` : ''}
                    </p>
                    <p className="text-[9px] opacity-60 truncate uppercase tracking-wider font-bold" style={{ color: C.navy }}>{item.brand}</p>
                  </div>
                </button>

                {isDrawerOpen && (
                  <div className="mt-1 rounded-xl border-2 bg-white overflow-hidden animate-in slide-in-from-top-2 duration-200"
                    style={{ borderColor: C.navy }}>
                    <button
                      onClick={() => { setSelectedItem(item); setActivePreviewId(null); setIsWardrobeExpanded(false); }}
                      className="w-full py-2.5 px-2 flex items-center justify-between group/btn hover:bg-gray-50 transition-colors">
                      <span className="text-[9px] font-black uppercase tracking-tighter text-left leading-tight" style={{ color: C.navy }}>
                        Change size or<br/>see details?
                      </span>
                      <span className="text-sm font-bold" style={{ color: C.navy }}>→</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    } else {
      if (outfits.length === 0) return <p className="text-[10px] text-center text-gray-400 pt-8">No outfits yet.</p>;
      return (
        <div className="space-y-2 pb-6">
          {outfits.map(outfit => {
            const oi = items.filter(i => outfit.itemIds.includes(i.id));
            return (
              <button key={outfit.id}
                onClick={() => { if (oi[0]) { setSelectedItem(prev => prev?.id === oi[0].id ? null : oi[0]); setIsWardrobeExpanded(false); } }}
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
      );
    }
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: C.cream }}>
        <div className="w-10 h-10 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: C.navy, borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <div className="flex md:flex-row flex-col relative w-full" style={{ height: 'calc(100vh - 64px)', backgroundColor: C.cream, overflow: 'hidden' }}>

      {/* ══ DESKTOP LEFT: Profile info & photo ══ */}
      <div className="hidden md:flex w-60 flex-shrink-0 bg-white border-r flex-col overflow-y-auto" style={{ borderColor: C.peach }}>
        <div className="p-4 border-b" style={{ borderColor: C.peach }}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-black uppercase tracking-widest" style={{ color: C.navy }}>Profile</h2>
            <button onClick={() => setEditingInfo(e => !e)}
              className="text-[10px] font-bold px-2.5 py-1 rounded-full transition-all"
              style={{ backgroundColor: editingInfo ? C.navy : C.peach, color: editingInfo ? 'white' : C.navy }}>
              {editingInfo ? 'Cancel' : '✏️ Edit'}
            </button>
          </div>

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
                    {([
                      ['Height', saved.height], 
                      ['Chest', saved.chest], 
                      ['Waist', saved.waist], 
                      ['Shldr', saved.shoulder]
                    ] as const).map(([k, v]) => (
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

      {/* ══ CENTER: 3D body canvas + controls ══ */}
      <div className="flex-1 relative w-full h-full bg-[#f8f3ea]">
        <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-[calc(100%-260px)] md:h-full block" />
        
        {!bodyReady && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10" style={{ backgroundColor: C.cream }}>
            <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: C.navy, borderTopColor: 'transparent' }} />
            <p className="text-xs font-bold" style={{ color: C.navy }}>Loading 3D body...</p>
          </div>
        )}

        {/* Desktop Controls */}
        <button onClick={() => setShowProfileGuide(true)} className="hidden md:flex absolute top-3 right-3 z-30 px-4 py-2 rounded-xl font-black items-center gap-2 border-2 shadow-sm hover:shadow-md transition-all bg-white" style={{ borderColor: C.peach, color: C.navy }}>
          <span className="text-lg">📖</span>
          <span className="text-[11px] uppercase tracking-wider">User Guide</span>
        </button>

        {/* Mobile Controls */}
        <button onClick={() => setShowProfileGuide(true)} className="md:hidden absolute top-3 right-3 z-30 w-10 h-10 rounded-full bg-white/90 backdrop-blur-md flex items-center justify-center text-xl shadow-sm border border-[#FFDBD1]">
          📖
        </button>
        <button onClick={() => setShowMobileBodySize(p => !p)} className="md:hidden absolute top-3 left-3 z-30 px-3 py-2 rounded-xl font-black flex items-center gap-1.5 shadow-sm border bg-white/90 backdrop-blur-md" style={{ borderColor: C.peach, color: C.navy }}>
          <span className="text-lg">📐</span>
          <span className="text-[11px] uppercase tracking-wider">Body Size</span>
        </button>

        {/* Desktop Body Size Slider Panel */}
        <div className="hidden md:block absolute top-3 left-3 z-20 rounded-2xl shadow-xl border bg-white/95 backdrop-blur-md" style={{ width: '240px', borderColor: C.peach }}>
          <div className="px-3 pt-2.5 pb-1.5 border-b" style={{ borderColor: C.peach }}>
            <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: C.navy }}>📐 Body Size</p>
            <p className="text-[9px] text-gray-400">Drag sliders — updates model live</p>
          </div>
          <div className="px-3 py-2.5 space-y-3">
            {([
              { key: 'height',     label: 'Height',      min: 150, max: 198 },
              { key: 'chest',      label: 'Chest',       min: 30,  max: 57  },
              { key: 'waist',      label: 'Waist',       min: 29,  max: 54  },
              { key: 'shoulder',   label: 'Shoulder',    min: 43,  max: 55  },
            ] as const).map(({ key, label, min, max }) => (
              <div key={key}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</span>
                  <span className="text-[11px] font-black tabular-nums px-2 py-0.5 rounded-md text-center min-w-[52px]" style={{ backgroundColor: C.peach, color: C.navy }}>
                    {draft[key]}<span className="text-[9px] font-normal opacity-60"> cm</span>
                  </span>
                </div>
                <input type="range" min={min} max={max} step={0.5} value={draft[key]} onChange={e => setDraft(p => ({ ...p, [key]: Number(e.target.value) }))} className="w-full cursor-pointer h-1" style={{ accentColor: C.navy }} />
              </div>
            ))}
          </div>
          <div className="px-3 pb-3">
            <button onClick={handleSaveBody} disabled={savingBody} className="w-full py-2 rounded-xl font-bold text-xs text-white disabled:opacity-50 hover:opacity-90 transition-all" style={{ backgroundColor: C.navy }}>
              {savingBody ? 'Saving...' : '💾 Save Permanently'}
            </button>
            {bodySuccess && <p className="text-center text-[9px] font-bold text-green-600 mt-1.5">✅ Saved!</p>}
          </div>
        </div>

        {/* Mobile Body Size Dropdown */}
        {showMobileBodySize && (
          <div className="md:hidden absolute top-14 left-3 z-30 w-[260px] rounded-2xl shadow-xl border p-3 bg-white/95 backdrop-blur-md" style={{ borderColor: C.peach }}>
            <div className="flex justify-between items-center mb-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Live Adjust</p>
              <button onClick={() => setShowMobileBodySize(false)} className="text-gray-400 text-lg font-bold">×</button>
            </div>
            <div className="space-y-4 mb-4">
              {([
                { key: 'height',     label: 'Height',      min: 150, max: 198 },
                { key: 'chest',      label: 'Chest',       min: 30,  max: 57  },
                { key: 'waist',      label: 'Waist',       min: 29,  max: 54  },
                { key: 'shoulder',   label: 'Shoulder',    min: 43,  max: 55  },
              ] as const).map(({ key, label, min, max }) => (
                <div key={key}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</span>
                    <span className="text-[11px] font-black px-2 py-0.5 rounded-md" style={{ backgroundColor: C.peach, color: C.navy }}>
                      {draft[key]}<span className="opacity-60 font-normal text-[9px]"> cm</span>
                    </span>
                  </div>
                  <input type="range" min={min} max={max} step={0.5} value={draft[key]} onChange={e => setDraft(p => ({ ...p, [key]: Number(e.target.value) }))} className="w-full h-1 cursor-pointer" style={{ accentColor: C.navy }} />
                </div>
              ))}
            </div>
            <button onClick={handleSaveBody} disabled={savingBody} className="w-full py-2.5 rounded-xl font-bold text-xs text-white shadow-md active:scale-95 transition-transform" style={{ backgroundColor: C.navy }}>
              {savingBody ? 'Saving...' : '💾 Save Permanently'}
            </button>
            {bodySuccess && <p className="text-center text-[10px] font-bold text-green-600 mt-2">✅ Saved successfully!</p>}
          </div>
        )}

        {bodyReady && (
          <div className="absolute top-16 md:top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-lg text-[11px] font-medium pointer-events-none md:ml-[60px]"
            style={{ backgroundColor: 'rgba(255,255,255,0.75)', color: C.navy }}>
            🖱 Drag to rotate
          </div>
        )}

        {selectedItem && (
          <div className={`absolute left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-xl shadow-lg z-30 transition-all duration-300
               md:bottom-3 md:top-auto
               ${mobileTab === '3d' ? (isWardrobeExpanded ? 'bottom-[calc(72%+16px)]' : 'bottom-[216px]') : '-bottom-20'}`}
               style={{ backgroundColor: C.navy, color: 'white' }}>
            <span className="text-xs font-bold">👕 Trying on:</span>
            <span className="text-xs font-black truncate max-w-[120px]">{selectedItem.name}</span>
            <button onClick={() => setSelectedItem(null)}
              className="ml-1 w-4 h-4 rounded-full flex items-center justify-center text-[10px]"
              style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>✕</button>
          </div>
        )}
      </div>

      {/* ══ DESKTOP RIGHT: Wardrobe sidebar ══ */}
      <div className="hidden md:flex w-96 flex-shrink-0 bg-white border-l flex-col overflow-hidden" style={{ borderColor: C.peach }}>
        <div className="px-3 pt-3 pb-2 border-b flex-shrink-0" style={{ borderColor: C.peach }}>
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5 flex-1">
              {(['items', 'outfits'] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className="flex-1 py-2 rounded-xl font-bold text-[11px] transition-all"
                  style={{ backgroundColor: activeTab === tab ? C.navy : C.cream, color: activeTab === tab ? 'white' : C.navy }}>
                  {tab === 'items' ? `Items` : `Outfits`}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end mt-2">
            <div className="flex gap-0.5 p-0.5 rounded-lg" style={{ backgroundColor: C.peach }}>
              {(['2d', '3d'] as const).map(v => (
                <button key={v} onClick={() => setSidebarView(v)}
                  className="px-3 py-1 rounded-md font-black text-[9px] uppercase tracking-widest transition-all"
                  style={{ backgroundColor: sidebarView === v ? C.navy : 'transparent', color: sidebarView === v ? 'white' : C.navy, letterSpacing: '0.08em' }}>
                  {v === '2d' ? '🖼 2D' : '📦 3D'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {activeTab === 'items' && !selectedItem && (
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
        
        <div className="flex-1 overflow-y-auto p-2.5">
          {renderWardrobeInner()}
        </div>
      </div>

      {/* ══ MOBILE WARDROBE BOTTOM SHEET ══ */}
      {mobileTab === '3d' && isWardrobeExpanded && (
        <div className="md:hidden absolute inset-0 z-[35] bg-black/20 backdrop-blur-sm transition-opacity duration-300" onClick={() => setIsWardrobeExpanded(false)} />
      )}
      
      <div
        className="md:hidden absolute bottom-[60px] left-0 right-0 bg-white rounded-t-3xl shadow-[0_-8px_30px_rgba(0,0,0,0.12)] transition-all duration-300 z-40 flex flex-col overflow-hidden border-t"
        style={{
           height: isWardrobeExpanded ? '58%' : '200px',
           borderColor: C.peach,
           transform: mobileTab === '3d' ? 'translateY(0)' : 'translateY(100%)',
           visibility: mobileTab === '3d' ? 'visible' : 'hidden'
        }}
      >
        <div className="px-4 pt-3 pb-3 flex-shrink-0 bg-white z-10 cursor-pointer" onTouchStart={onSheetTouchStart} onTouchEnd={onSheetTouchEnd} onClick={() => setIsWardrobeExpanded(!isWardrobeExpanded)}>
          <div className="w-12 h-1.5 bg-gray-300 rounded-full mx-auto mb-3" />
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-black uppercase tracking-widest" style={{ color: C.navy }}>
              My Wardrobe <span className="text-gray-400">({items.length})</span>
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{isWardrobeExpanded ? 'Collapse ▼' : 'Expand ▲'}</span>
            </div>
          </div>
        </div>

        {activeTab === 'items' && !selectedItem && (
          <div className="px-3 pb-3 flex overflow-x-auto gap-2 flex-shrink-0 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            {categories.map(cat => (
              <button key={cat} onClick={() => setActiveCategory(cat)}
                className="px-3 py-1 rounded-full text-[10px] font-bold whitespace-nowrap transition-all"
                style={{ backgroundColor: activeCategory === cat ? C.pink : C.peach, color: C.navy }}>
                {cat}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {renderWardrobeInner()}
        </div>
      </div>

      {/* ══ MOBILE PROFILE OVERLAY ══ */}
      <div
        className="md:hidden absolute top-0 left-0 w-full bg-[#F8F3EA] z-[50] transition-transform duration-300 overflow-y-auto"
        style={{ height: 'calc(100% - 60px)', transform: mobileTab === 'profile' ? 'translateX(0)' : 'translateX(-100%)' }}
      >
        <div className="p-5 flex flex-col min-h-full">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-sm font-black uppercase tracking-widest" style={{ color: C.navy }}>My Profile</h2>
            <button onClick={() => setEditingInfo(!editingInfo)}
              className="text-[10px] font-bold px-3 py-1.5 rounded-full transition-all shadow-sm"
              style={{ backgroundColor: editingInfo ? C.navy : 'white', color: editingInfo ? 'white' : C.navy }}>
              {editingInfo ? 'Cancel' : '✏️ Edit Profile'}
            </button>
          </div>

          <div className="flex items-start gap-4 mb-6">
             <div className="relative w-24 h-24 rounded-2xl flex-shrink-0 border-2 shadow-sm overflow-hidden" style={{ borderColor: C.peach, backgroundColor: 'white' }}>
                {photoPreview
                  ? <img src={photoPreview} alt="profile" className="w-full h-full object-cover" crossOrigin="anonymous" />
                  : <div className="w-full h-full flex flex-col items-center justify-center text-4xl">🧍</div>
                }
                <label className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full flex items-center justify-center cursor-pointer shadow-md text-sm bg-[#0B1957] text-white">
                  📷<input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
                </label>
             </div>
             
             {editingInfo ? (
               <div className="flex-1 space-y-2">
                 <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Name" className="w-full px-3 py-2 rounded-xl text-xs font-bold border outline-none" style={{ borderColor: C.peach, color: C.navy }} />
                 <div className="flex gap-2">
                   <input type="number" value={age} onChange={e => setAge(e.target.value)} placeholder="Age" className="w-1/3 px-3 py-2 rounded-xl text-xs font-bold border outline-none" style={{ borderColor: C.peach, color: C.navy }} />
                   <select value={gender} onChange={e => setGender(e.target.value)} className="w-2/3 px-2 py-2 rounded-xl text-xs font-bold border outline-none" style={{ borderColor: C.peach, color: C.navy }}>
                     <option value="">Gender...</option>
                     <option value="male">Male</option>
                     <option value="female">Female</option>
                     <option value="other">Other</option>
                   </select>
                 </div>
               </div>
             ) : (
               <div className="flex-1 flex flex-col justify-center h-24 gap-1.5 overflow-hidden">
                 <p className="text-[22px] font-black leading-tight truncate" style={{ color: C.navy }}>{displayName || '—'}</p>
                 <div className="flex items-center gap-2">
                   <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest bg-white px-2 py-1 rounded border shadow-sm">{age || '—'} yrs</span>
                   <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest bg-white px-2 py-1 rounded border shadow-sm">{gender || '—'}</span>
                 </div>
               </div>
             )}
          </div>

          {photoPreview && !editingInfo && (
             <div className="mb-6">
               <button onClick={handleAutoDetect} disabled={detecting} className="w-full py-3.5 rounded-xl font-black text-xs flex items-center justify-center gap-2 shadow-sm transition-all active:scale-95 disabled:opacity-50" style={{ backgroundColor: C.pink, color: C.navy }}>
                 {detecting ? <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: C.navy, borderTopColor: 'transparent' }} /> : '🎯'}
                 {detecting ? 'Scanning...' : 'Re-scan body measurements'}
               </button>
               {detectMsg && <p className="text-[10px] text-center font-bold mt-2" style={{ color: C.navy }}>{detectMsg}</p>}
             </div>
          )}

          {!editingInfo && (
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#FFDBD1] mb-auto">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">Saved Measurements</h3>
              <div className="grid grid-cols-4 gap-2">
                 {([['Height', saved.height], ['Chest', saved.chest], ['Waist', saved.waist], ['Shldr', saved.shoulder]] as const).map(([k,v]) => (
                   <div key={k} className="rounded-xl p-2 text-center" style={{ backgroundColor: '#F8F3EA' }}>
                      <p className="text-[9px] font-black text-gray-400 uppercase">{k}</p>
                      <p className="text-[13px] font-black mt-1" style={{ color: C.navy }}>{v}<span className="text-[9px] font-medium opacity-60 ml-0.5">cm</span></p>
                   </div>
                 ))}
              </div>
            </div>
          )}

          {!editingInfo ? (
            <button onClick={() => setShowProfileGuide(true)} className="mt-8 w-full py-3.5 rounded-xl text-[11px] uppercase tracking-widest font-black shadow-sm bg-white border" style={{ borderColor: C.peach, color: C.navy }}>
              📖 How does this work?
            </button>
          ) : (
            <button onClick={handleSaveProfile} disabled={savingInfo} className="mt-auto w-full py-3.5 rounded-xl text-sm font-black text-white shadow-md active:scale-95 transition-transform" style={{ backgroundColor: C.navy }}>
              {savingInfo ? 'Saving...' : '💾 Save Profile'}
            </button>
          )}
        </div>
      </div>

      {/* ══ MOBILE BOTTOM TAB BAR ══ */}
      <div className="md:hidden absolute bottom-0 left-0 w-full h-[60px] bg-white border-t flex z-[60] shadow-[0_-4px_20px_rgba(0,0,0,0.05)]" style={{ borderColor: C.peach }}>
        <button
          onClick={() => setMobileTab('profile')}
          className="flex-1 flex flex-col items-center justify-center gap-1 transition-all"
          style={{ borderTop: `2.5px solid ${mobileTab === 'profile' ? C.navy : 'transparent'}`, color: mobileTab === 'profile' ? C.navy : '#9CA3AF' }}
        >
          <span className="text-[22px] leading-none mb-0.5">👤</span>
          <span className="text-[10px] font-black uppercase tracking-widest">Profile</span>
        </button>
        <button
          onClick={() => { setMobileTab('3d'); setIsWardrobeExpanded(false); }}
          className="flex-1 flex flex-col items-center justify-center gap-1 transition-all"
          style={{ borderTop: `2.5px solid ${mobileTab === '3d' ? C.navy : 'transparent'}`, color: mobileTab === '3d' ? C.navy : '#9CA3AF' }}
        >
          <span className="text-[22px] leading-none mb-0.5">🧍</span>
          <span className="text-[10px] font-black uppercase tracking-widest">3D View</span>
        </button>
      </div>

      {/* ══ Profile User Guide Modal ══ */}
      {showProfileGuide && <ProfileUserGuideModal onClose={() => setShowProfileGuide(false)} />}
    </div>
  );
}

// ── Atlas constants ──────────────────────────────────────────────────────────
const MINI_ATLAS_SIZE    = 2048;
const MINI_FRONT_RECT    = { x: 0,    y: 0,    w: 1024, h: 1536 };
const MINI_BACK_RECT     = { x: 1024, y: 0,    w: 1024, h: 1536 };
const MINI_L_SLEEVE_RECT = { x: 0,    y: 1536, w: 1024, h: 512  };
const MINI_R_SLEEVE_RECT = { x: 1024, y: 1536, w: 1024, h: 512  };

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
      scene.background = new THREE.Color(0xffffff);
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
        const ss = Math.min(sw * 0.25, 200);
        const pat = document.createElement('canvas'); pat.width = pat.height = ss;
        const pCtx = pat.getContext('2d')!;
        pCtx.drawImage(img, minX + sw*0.5 - ss/2, minY + sh*0.6 - ss/2, ss, ss, 0, 0, ss, ss);
        atlasCtx.fillStyle = atlasCtx.createPattern(pat, 'repeat')!;
        atlasCtx.fillRect(MINI_FRONT_RECT.x, MINI_FRONT_RECT.y, MINI_FRONT_RECT.w, MINI_FRONT_RECT.h);
        atlasCtx.fillRect(MINI_L_SLEEVE_RECT.x, MINI_L_SLEEVE_RECT.y, MINI_L_SLEEVE_RECT.w, MINI_L_SLEEVE_RECT.h);
        atlasCtx.fillRect(MINI_R_SLEEVE_RECT.x, MINI_R_SLEEVE_RECT.y, MINI_R_SLEEVE_RECT.w, MINI_R_SLEEVE_RECT.h);
        const tw = sw * 0.8;
        atlasCtx.drawImage(img, minX + (sw-tw)/2, minY, tw, sh, MINI_FRONT_RECT.x, MINI_FRONT_RECT.y, MINI_FRONT_RECT.w, MINI_FRONT_RECT.h);
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
        if (morphMesh) { morphMesh.material.map = atlasTexture; morphMesh.material.needsUpdate = true; }
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          model.traverse((obj: any) => {
            if (!obj.isMesh || morphMesh) return;
            morphMesh = obj;
            obj.material = new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide, color: new THREE.Color(0xffffff) });
            if (atlasTexture) { obj.material.map = atlasTexture; obj.material.needsUpdate = true; }
          });
        },
        undefined,
        () => {}
      );

      if (imageUrl) {
        const img = new Image(); img.crossOrigin = 'anonymous';
        img.onload = () => { if (!cancelled) processAndApply(img); };
        img.onerror = () => {};
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
        camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false);
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

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />;
}