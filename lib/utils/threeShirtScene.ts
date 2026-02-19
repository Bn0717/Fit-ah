// lib/utils/threeShirtScene.ts
// Shared Three.js logic extracted from main.js
// Used by both FitRecommendationModal (body+shirt GLB) and ItemDetailsModal (shirt-only GLB)

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const SIZE_DATA: Record<string, { chest: number; shoulder: number; length: number; sleeve: number }> = {
  S:   { chest: 54.5, shoulder: 43, length: 71, sleeve: 22 },
  M:   { chest: 57,   shoulder: 45, length: 73, sleeve: 23.5 },
  L:   { chest: 59.5, shoulder: 47, length: 75, sleeve: 25 },
  XL:  { chest: 62,   shoulder: 49, length: 77, sleeve: 26.5 },
  '2XL': { chest: 64.5, shoulder: 51, length: 79, sleeve: 28 },
  '3XL': { chest: 67,   shoulder: 53, length: 79, sleeve: 29.5 },
  '4XL': { chest: 69.5, shoulder: 55, length: 79, sleeve: 29.5 },
};

const BASE = SIZE_DATA['S'];
const MAX  = SIZE_DATA['4XL'];

function cmToMorph(v: number, base: number, max: number): number {
  return Math.max(0, Math.min(1, (v - base) / (max - base)));
}

// ─── Atlas config (matches Blender 75/25 grid) ────────────────────────────
const ATLAS_SIZE = 2048;
const FRONT_RECT    = { x: 0,    y: 0,    w: 1024, h: 1536 };
const BACK_RECT     = { x: 1024, y: 0,    w: 1024, h: 1536 };
const L_SLEEVE_RECT = { x: 0,    y: 1536, w: 1024, h: 512  };
const R_SLEEVE_RECT = { x: 1024, y: 1536, w: 1024, h: 512  };

function processShirtTexture(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  targetRect: { x: number; y: number; w: number; h: number },
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

  const sw = maxX - minX;
  const sh = maxY - minY;
  const sampleSize = Math.min(sw * 0.25, 200);
  const sx = minX + sw * 0.5 - sampleSize / 2;
  const sy = minY + sh * 0.6 - sampleSize / 2;

  const pat = document.createElement('canvas');
  pat.width = sampleSize; pat.height = sampleSize;
  const pCtx = pat.getContext('2d')!;
  pCtx.drawImage(img, sx, sy, sampleSize, sampleSize, 0, 0, sampleSize, sampleSize);
  const fabricPattern = ctx.createPattern(pat, 'repeat')!;

  ctx.fillStyle = fabricPattern;
  ctx.fillRect(targetRect.x, targetRect.y, targetRect.w, targetRect.h);
  if (isFront) {
    ctx.fillRect(L_SLEEVE_RECT.x, L_SLEEVE_RECT.y, L_SLEEVE_RECT.w, L_SLEEVE_RECT.h);
    ctx.fillRect(R_SLEEVE_RECT.x, R_SLEEVE_RECT.y, R_SLEEVE_RECT.w, R_SLEEVE_RECT.h);
  }

  const torsoW = sw * 0.8;
  const torsoX = minX + (sw - torsoW) / 2;
  ctx.drawImage(img, torsoX, minY, torsoW, sh, targetRect.x, targetRect.y, targetRect.w, targetRect.h);
}

// ─── Main scene class ─────────────────────────────────────────────────────
export class ShirtScene {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private morphMesh: THREE.Mesh | null = null;
  private animId: number | null = null;

  private atlasCanvas: HTMLCanvasElement;
  private atlasCtx: CanvasRenderingContext2D;
  private atlasTexture: THREE.CanvasTexture | null = null;
  private frontImg: HTMLImageElement | null = null;
  private backImg:  HTMLImageElement | null = null;

  constructor(canvas: HTMLCanvasElement, glbPath: string, bgColor = 0x1a1a2e) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(bgColor);

    const w = canvas.clientWidth  || canvas.width;
    const h = canvas.clientHeight || canvas.height;

    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    this.camera.position.set(0, 1.2, 2.5);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(3, 4, 2);
    this.scene.add(key);

    this.atlasCanvas = document.createElement('canvas');
    this.atlasCanvas.width  = ATLAS_SIZE;
    this.atlasCanvas.height = ATLAS_SIZE;
    this.atlasCtx = this.atlasCanvas.getContext('2d', { willReadFrequently: true })!;

    this.loadGLB(glbPath);
    this.animate();
  }

  private loadGLB(path: string) {
    const loader = new GLTFLoader();
    loader.load(
      path + '?v=' + Date.now(),
      (gltf) => {
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const center = new THREE.Vector3();
        box.getCenter(center);
        model.position.sub(center);
        this.scene.add(model);

        model.traverse((obj) => {
          if (!(obj as THREE.Mesh).isMesh) return;
          const mesh = obj as THREE.Mesh;
          if (!mesh.morphTargetDictionary) return;

          const keys = Object.keys(mesh.morphTargetDictionary).map(k => k.toLowerCase());
          const isShirt =
            keys.some(k => k.includes('len_long') || k.includes('sleeve_long') || k.includes('chest_wide'));

          if (isShirt && !this.morphMesh) {
            this.morphMesh = mesh;
            mesh.material = new THREE.MeshStandardMaterial({
              map: this.atlasTexture,
              roughness: 0.8,
              side: THREE.DoubleSide,
            });
            this.rebuildAtlas();
          }
        });
      },
      undefined,
      (err) => console.error('GLB load error:', err)
    );
  }

  private rebuildAtlas() {
    this.atlasCtx.fillStyle = '#ffffff';
    this.atlasCtx.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);

    if (this.frontImg) processShirtTexture(this.atlasCtx, this.frontImg, FRONT_RECT, true);
    if (this.backImg)  processShirtTexture(this.atlasCtx, this.backImg,  BACK_RECT,  false);

    if (!this.atlasTexture) {
      this.atlasTexture = new THREE.CanvasTexture(this.atlasCanvas);
      this.atlasTexture.flipY = false;
      this.atlasTexture.colorSpace = THREE.SRGBColorSpace;
    } else {
      this.atlasTexture.needsUpdate = true;
    }

    if (this.morphMesh) {
      const mat = this.morphMesh.material as THREE.MeshStandardMaterial;
      mat.map = this.atlasTexture;
      mat.needsUpdate = true;
    }
  }

  /** Load shirt textures from URLs (Firebase download URLs) */
  setTextures(frontUrl: string | null | undefined, backUrl: string | null | undefined) {
    const load = (url: string, cb: (img: HTMLImageElement) => void) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { cb(img); this.rebuildAtlas(); };
      img.src = url;
    };
    if (frontUrl) load(frontUrl, (img) => (this.frontImg = img));
    if (backUrl)  load(backUrl,  (img) => (this.backImg  = img));
  }

  /** Map a size string to morph targets */
  setSize(size: string) {
    const d = SIZE_DATA[size];
    if (!d || !this.morphMesh) return;
    this.setMorph('CHEST_WIDE',    cmToMorph(d.chest,    BASE.chest,    MAX.chest));
    this.setMorph('SHOULDER_WIDE', cmToMorph(d.shoulder, BASE.shoulder, MAX.shoulder));
    this.setMorph('LEN_LONG',      cmToMorph(d.length,   BASE.length,   MAX.length));
    this.setMorph('SLEEVE_LONG',   cmToMorph(d.sleeve,   BASE.sleeve,   MAX.sleeve));
  }

  private setMorph(prefix: string, value: number) {
    if (!this.morphMesh?.morphTargetDictionary) return;
    const keys = Object.keys(this.morphMesh.morphTargetDictionary);
    const key  = keys.find(k => k === prefix || k.startsWith(prefix));
    if (key) {
      const idx = this.morphMesh.morphTargetDictionary[key];
      this.morphMesh.morphTargetInfluences![idx] = value;
    }
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  private animate = () => {
    this.animId = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  destroy() {
    if (this.animId !== null) cancelAnimationFrame(this.animId);
    this.renderer.dispose();
  }
}

// ─── Body+Shirt combined scene (for FitRecommendationModal) ──────────────
export class BodyShirtScene extends ShirtScene {
  private bodyMesh: THREE.Mesh | null = null;

  // Same GLB contains both body and shirt meshes
  // Body morph keys: BODY_LENGTH, HEIGHT, CHEST_WIDE (body), SHOULDER_WIDE (body), etc.
  // This class adds nothing extra right now — body shaping goes to Profile page later.
  // The base ShirtScene already handles shirt morph targets correctly.
}