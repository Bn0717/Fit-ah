// components/items/ItemDetailsModal.tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import type { ClothingItem } from '@/lib/types/clothing';

const colors = {
  cream: '#F8F3EA',
  navy: '#0B1957',
  peach: '#FFDBD1',
  pink: '#FA9EBC',
};

const ATLAS_SIZE    = 2048;
const FRONT_RECT    = { x: 0,    y: 0,    w: 1024, h: 1536 };
const BACK_RECT     = { x: 1024, y: 0,    w: 1024, h: 1536 };
const L_SLEEVE_RECT = { x: 0,    y: 1536, w: 1024, h: 512  };
const R_SLEEVE_RECT = { x: 1024, y: 1536, w: 1024, h: 512  };

type ViewMode  = '2d' | '3d';
type PhotoSide = 'front' | 'back';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  item: ClothingItem;
  onCheckFit: () => void;
}

export default function ItemDetailsModal({ isOpen, onClose, item, onCheckFit }: Props) {
  const [viewMode,   setViewMode]   = useState<ViewMode>('2d');
  const [photoSide,  setPhotoSide]  = useState<PhotoSide>('front');
  const [threeReady, setThreeReady] = useState(false);

  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const sceneRef   = useRef<{ animId: ReturnType<typeof requestAnimationFrame>; renderer: any; ro: ResizeObserver } | null>(null);

  // Resolve images
  const frontSrc     = item.frontImageUrl || item.imageUrl || null;
  const backSrc      = item.backImageUrl  || null;
  const hasBothSides = !!(item.frontImageUrl && item.backImageUrl);
  const currentSrc   = photoSide === 'front' ? frontSrc : backSrc;

  // ── 3D scene (only when 3D tab is active) ───────────────────────────────
  useEffect(() => {
    if (!isOpen || viewMode !== '3d' || !canvasRef.current) return;

    let cancelled = false;

    Promise.all([
      import('three'),
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/controls/OrbitControls.js'),
    ]).then(([THREE, { GLTFLoader }, { OrbitControls }]) => {
      if (cancelled || !canvasRef.current) return;

      const canvas = canvasRef.current;
      const W = canvas.clientWidth  || 400;
      const H = canvas.clientHeight || 500;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xfaf7f2);

      const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 50);
      camera.position.set(0, 0.5, 2.2);

      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setSize(W, H, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 1.5;

      scene.add(new THREE.AmbientLight(0xffffff, 1.0));
      const key = new THREE.DirectionalLight(0xffffff, 1.5);
      key.position.set(2, 3, 2);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xffeedd, 0.4);
      fill.position.set(-2, 0, -1);
      scene.add(fill);

      // Atlas
      const atlasCanvas = document.createElement('canvas');
      atlasCanvas.width = atlasCanvas.height = ATLAS_SIZE;
      const atlasCtx = atlasCanvas.getContext('2d', { willReadFrequently: true })!;
      let atlasTexture: any = null;
      let shirtMesh: any = null;
      let frontImg: HTMLImageElement | null = null;
      let backImg:  HTMLImageElement | null = null;

      function processShirtTexture(
        ctx: CanvasRenderingContext2D,
        img: HTMLImageElement,
        rect: { x: number; y: number; w: number; h: number },
        isFront: boolean
      ) {
        const tmp = document.createElement('canvas');
        tmp.width = img.width; tmp.height = img.height;
        const tCtx = tmp.getContext('2d')!;
        tCtx.drawImage(img, 0, 0);
        const data = tCtx.getImageData(0, 0, tmp.width, tmp.height).data;
        let minX = img.width, minY = img.height, maxX = 0, maxY = 0, found = false;
        for (let y = 0; y < img.height; y++) {
          for (let x = 0; x < img.width; x++) {
            const i = (y * img.width + x) * 4;
            if (data[i + 3] > 20 && (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250)) {
              if (x < minX) minX = x; if (x > maxX) maxX = x;
              if (y < minY) minY = y; if (y > maxY) maxY = y;
              found = true;
            }
          }
        }
        if (!found) return;
        const sw = maxX - minX, sh = maxY - minY;
        const ss = Math.min(sw * 0.25, 200);
        const pat = document.createElement('canvas');
        pat.width = pat.height = ss;
        const pCtx = pat.getContext('2d')!;
        pCtx.drawImage(img, minX + sw * 0.5 - ss / 2, minY + sh * 0.6 - ss / 2, ss, ss, 0, 0, ss, ss);
        ctx.fillStyle = ctx.createPattern(pat, 'repeat')!;
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        if (isFront) {
          ctx.fillRect(L_SLEEVE_RECT.x, L_SLEEVE_RECT.y, L_SLEEVE_RECT.w, L_SLEEVE_RECT.h);
          ctx.fillRect(R_SLEEVE_RECT.x, R_SLEEVE_RECT.y, R_SLEEVE_RECT.w, R_SLEEVE_RECT.h);
        }
        const tw = sw * 0.8;
        ctx.drawImage(img, minX + (sw - tw) / 2, minY, tw, sh, rect.x, rect.y, rect.w, rect.h);
      }

      function rebuildAtlas() {
        atlasCtx.fillStyle = '#f8f3ea';
        atlasCtx.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
        if (frontImg) processShirtTexture(atlasCtx, frontImg, FRONT_RECT, true);
        if (backImg)  processShirtTexture(atlasCtx, backImg,  BACK_RECT,  false);
        if (!atlasTexture) {
          atlasTexture = new THREE.CanvasTexture(atlasCanvas);
          atlasTexture.flipY = false;
          atlasTexture.colorSpace = THREE.SRGBColorSpace;
        } else {
          atlasTexture.needsUpdate = true;
        }
        if (shirtMesh) {
          shirtMesh.material.map = atlasTexture;
          shirtMesh.material.needsUpdate = true;
        }
      }

      // Load shirt-only GLB (newtntshirt1.glb)
      const loader = new GLTFLoader();
      loader.load(
        '/models/newtntshirt1.glb?v=' + Date.now(),
        (gltf: any) => {
          if (cancelled) return;
          const model = gltf.scene;
          const box = new THREE.Box3().setFromObject(model);
          const center = new THREE.Vector3();
          box.getCenter(center);
          model.position.sub(center);
          scene.add(model);

          model.traverse((obj: any) => {
            if (!obj.isMesh) return;
            if (!shirtMesh) {
              shirtMesh = obj;
              obj.material = new THREE.MeshStandardMaterial({
                map: atlasTexture,
                roughness: 0.75,
                side: THREE.DoubleSide,
              });
              rebuildAtlas();
              setThreeReady(true);
            }
          });
        },
        undefined,
        (err: any) => console.error('Shirt GLB error:', err)
      );

      // Load textures from Firebase URLs
      const loadImg = (url: string, cb: (img: HTMLImageElement) => void) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => { cb(img); rebuildAtlas(); };
        img.src = url;
      };

      if (item.frontImageUrl) loadImg(item.frontImageUrl, (img) => { frontImg = img; });
      if (item.backImageUrl)  loadImg(item.backImageUrl,  (img) => { backImg  = img; });
      else if (item.imageUrl) loadImg(item.imageUrl,      (img) => { frontImg = img; });

      // Animate
      let animId: ReturnType<typeof requestAnimationFrame> = 0;
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
        sceneRef.current.renderer?.dispose();
        sceneRef.current.ro?.disconnect();
        sceneRef.current = null;
      }
      setThreeReady(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, viewMode]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full my-8">
        <div className="p-8 max-h-[90vh] overflow-y-auto">

          {/* ── HEADER ── */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <span className="inline-block px-3 py-1 rounded-full text-xs font-bold" style={{ backgroundColor: colors.pink, color: colors.navy }}>
                  {item.brand}
                </span>
                <span className="inline-block px-3 py-1 rounded-full text-xs font-bold" style={{ backgroundColor: colors.peach, color: colors.navy }}>
                  {item.category}
                </span>
              </div>
              <h2 className="text-2xl font-bold" style={{ color: colors.navy }}>{item.name}</h2>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center hover:opacity-70" style={{ backgroundColor: colors.cream }}>
              <svg className="w-5 h-5" style={{ color: colors.navy }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* ── 2D / 3D TOGGLE ── */}
          <div className="flex gap-2 mb-5">
            {(['2d', '3d'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className="px-5 py-2 rounded-lg font-semibold text-sm transition-all"
                style={{
                  backgroundColor: viewMode === mode ? colors.navy : colors.cream,
                  color: viewMode === mode ? 'white' : colors.navy,
                }}
              >
                {mode === '2d' ? '🖼 2D View' : '📦 3D View'}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

            {/* ── LEFT: IMAGE / 3D PANEL ── */}
            <div>
              {viewMode === '2d' ? (
                <div>
                  {/* Front / Back toggle */}
                  {hasBothSides && (
                    <div className="flex gap-2 mb-3">
                      {(['front', 'back'] as PhotoSide[]).map((side) => (
                        <button
                          key={side}
                          onClick={() => setPhotoSide(side)}
                          className="flex-1 py-2 rounded-lg text-xs font-bold transition-all"
                          style={{
                            backgroundColor: photoSide === side ? colors.peach : colors.cream,
                            color: colors.navy,
                            border: `2px solid ${photoSide === side ? colors.navy : colors.peach}`,
                          }}
                        >
                          {side === 'front' ? '👕 Front' : '🔄 Back'}
                        </button>
                      ))}
                    </div>
                  )}

                  <div
                    className="aspect-[3/4] rounded-xl overflow-hidden flex items-center justify-center"
                    style={{ backgroundColor: 'white', border: `2px solid ${colors.peach}` }}
                  >
                    {currentSrc ? (
                      <img
                        src={currentSrc}
                        alt={`${item.name} ${photoSide}`}
                        className="w-full h-full object-contain"
                        crossOrigin="anonymous"
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        <svg className="w-20 h-20" style={{ color: colors.navy, opacity: 0.15 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                        </svg>
                        <p className="text-xs" style={{ color: colors.navy, opacity: 0.4 }}>No image</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* ── 3D VIEW ── */
                <div className="relative aspect-[3/4] rounded-xl overflow-hidden" style={{ backgroundColor: colors.cream }}>
                  <canvas
                    ref={canvasRef}
                    className="w-full h-full"
                    style={{ display: 'block' }}
                  />
                  {!threeReady && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                      <div
                        className="w-10 h-10 border-4 border-t-transparent rounded-full animate-spin"
                        style={{ borderColor: colors.navy, borderTopColor: 'transparent' }}
                      />
                      <p className="text-xs font-semibold" style={{ color: colors.navy }}>Loading 3D model...</p>
                    </div>
                  )}
                  {threeReady && (
                    <div className="absolute bottom-2 left-0 right-0 flex justify-center">
                      <span className="text-[10px] text-white/60 bg-black/30 px-2 py-1 rounded-full">
                        Drag to rotate
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── RIGHT: SIZE CHART + ACTIONS ── */}
            <div>
              <h3 className="font-bold mb-4 text-lg" style={{ color: colors.navy }}>Size Chart</h3>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ backgroundColor: colors.cream }}>
                      {[
                        'Size', 'Chest', 'Length', 'Shoulder',
                        ...(item.sizeChart[0]?.sleeve !== undefined ? ['Sleeve'] : []),
                        ...(item.sizeChart[0]?.waist  !== undefined ? ['Waist']  : []),
                      ].map((h) => (
                        <th key={h} className="px-3 py-3 text-left text-xs font-bold" style={{ color: colors.navy }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {item.sizeChart.map((size, idx) => {
                      const isMySize = size.size === item.userWearingSize;
                      return (
                        <tr key={idx} className="border-b transition-colors" 
                            style={{ 
                              borderColor: colors.peach, 
                              backgroundColor: isMySize ? colors.pink + '30' : 'transparent' 
                            }}>
                          <td className="px-3 py-3 font-bold flex items-center gap-2" style={{ color: colors.navy }}>
                            {size.size}
                          </td>
                          <td className="px-3 py-3" style={{ color: colors.navy }}>{size.chest} cm</td>
                          <td className="px-3 py-3" style={{ color: colors.navy }}>{size.length} cm</td>
                          <td className="px-3 py-3" style={{ color: colors.navy }}>{size.shoulder} cm</td>
                          {size.sleeve !== undefined && <td className="px-3 py-3" style={{ color: colors.navy }}>{size.sleeve} cm</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-6 space-y-3">
                <button
                  onClick={() => { onCheckFit(); onClose(); }}
                  className="w-full px-6 py-3 rounded-lg font-semibold text-white hover:opacity-90 flex items-center justify-center gap-2"
                  style={{ backgroundColor: colors.navy }}
                >
                  <span className="text-lg">📏</span>
                  Check My Fit
                </button>

                <div className="p-4 rounded-lg" style={{ backgroundColor: colors.cream }}>
                  <p className="text-xs" style={{ color: colors.navy, opacity: 0.7 }}>
                    💡 All measurements in centimeters. Click "Check My Fit" to see size recommendations.
                  </p>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}