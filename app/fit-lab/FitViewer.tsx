// app/fit-lab/FitViewer.tsx
// The Fit Lab 3D scene as a component (used by /fit-lab-profile): simulated body + shirt (+ jeans) blended from
// the size grid by the body sliders, the fit map, the catwalk replay, and colourway / pants photo textures.
// The scene code is the same as in app/fit-lab/page.tsx.
'use client';

import { ModelSkeleton } from '@/components/ui/Skeleton';
import React, { useEffect, useRef, useState } from 'react';
import { applyStaticLayers, elasticBandColor, blendFitAttribute, selectWalk, fitColor, applyColourway, applyPantsSkin, VARIANTS, makeTrack, applyFrame, refreshWalkNormals, rootPath, solveBody, jeansVarWeights,
  pushOutside, cpuMorphed, loadPacked, fetchBin, layerShirtOverPants, joinParts, type Size, type ViewMode, type GridMeta, type ProductWalk, type WalkTrack, type ShirtProduct } from './engine';
import type { Result } from './colourway';

const C = { cream: '#F8F3EA', navy: '#0B1957', red: '#ef4444' };
import { xinWalkAssets } from './xinAssets';
import { BODY_GRID_DIR, BODY_WALK_DIR, GON, XIN } from './paths';
import { applySkinTone, realisticSkin, type SkinToneId } from './skinTone';
import { hideCoveredFeet } from './bodyCover';
import { applyTopColour } from './ColourSwatches';


export interface FitViewerProps {
  meta: GridMeta;
  height: number; chest: number;              // cm (full chest girth)
  shoulder: number | null; waist: number | null;   // cm target, null = natural for this body
  size: Size; mode: ViewMode; walking: boolean;
  photos: { front: Result; back: Result } | null;  // aligned colourway photos, null = original Gon Tee
  showShirt?: boolean;                        // false: body only (nothing being tried on)
  belly?: number;                             // -1 flat .. 0 natural .. +1 round
  // jeans being worn: glb of the chosen simulation (drop / belt), size for the catwalk, hidden = cannot be worn or
  // not simulated for this body (the basic pants are shown instead), skin = pants photo swap textures
  // walk: false = no walking simulation of these pants (the catwalk then shows the basic pants)
  jeans?: { url: string; size: string; hidden: boolean; walk?: boolean; productWalk?: ProductWalk; builtinXin?: boolean; belt?: boolean; elastic?: { extension: number; limit: number }; skin?: { front: HTMLCanvasElement; back: HTMLCanvasElement } | null } | null;
  onWalking: (on: boolean) => void; onWalkStatus: (msg: string | null) => void;
  background?: string; className?: string; style?: React.CSSProperties;
  skinTone?: SkinToneId | null;               // Monk Skin Tone Scale id; null = the model's own skin
  shirtDir?: string;                          // a shirt product's grid folder (default: the TNT Gon tee)
  shirtColour?: { product: ShirtProduct; hex: string | null } | null;   // a shirt product's chosen colour
}

export default function FitViewer({ meta, height, chest, shoulder, waist, size, mode, walking, photos, showShirt = true,
  belly = 0, jeans = null, onWalking, onWalkStatus, background = C.cream, className, style, skinTone = null, shirtDir = GON.grid, shirtColour = null }: FitViewerProps) {
  const jOn = !!jeans && !jeans.hidden;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sceneRef = useRef<any>({});
  const [loading, setLoading] = useState(true);
  // a shirt size still downloading: say so (a bare body would look like "this size can't be worn")
  const [shirtProg, setShirtProg] = useState<{ size: string; pct: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(0);
  const setWalking = (on: boolean) => onWalking(on);
  const setWalkStatus = (m: string | null) => onWalkStatus(m);

  // skin tone: kept on the scene so bodies loaded later (the walking body) get it too
  useEffect(() => {
    const S = sceneRef.current;
    S.skinTone = skinTone;
    applySkinTone(S.bodyRoot, skinTone);
    applySkinTone(S.walk?.group, skinTone);
  }, [skinTone, loading]);

  // a shirt product's colour on the loaded shirt (ColourSwatches.tsx)
  useEffect(() => {
    const grp = sceneRef.current.shirts?.[`${shirtDir}:${size}`];
    if (grp && typeof grp !== 'string') applyTopColour(grp.userData.parts, shirtColour?.product, shirtColour?.hex ?? null);
  }, [shirtColour?.product, shirtColour?.hex, shirtDir, size, ready]);

  // ── scene setup + body ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current || !meta) return;
    let cancelled = false, frame = 0;
    let cleanup: () => void = () => {};
    Promise.all([
      import('three'),
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/controls/OrbitControls.js'),
      import('three/addons/environments/RoomEnvironment.js'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ]).then(([THREE, { GLTFLoader }, { OrbitControls }, { RoomEnvironment }]: any[]) => {
      if (cancelled || !canvasRef.current) return;
      const canvas = canvasRef.current;
      const W = canvas.clientWidth || 600, H = canvas.clientHeight || 700;
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setSize(W, H, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.9;
      renderer.shadowMap.enabled = true;
      const scene = new THREE.Scene(); scene.background = new THREE.Color(background);
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      const camera = new THREE.PerspectiveCamera(30, W / H, 0.05, 50);
      camera.position.set(1.45, 1.15, 3.7);
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
      const S = sceneRef.current;
      // gen: which scene this is; a shirt / jeans download that finishes for an older scene is dropped (it would
      // otherwise land in this scene untracked: never recoloured, shaped or hidden)
      Object.assign(S, { THREE, scene, loader, gen: (S.gen ?? 0) + 1, bodyMeshes: [], shirts: {} as Record<string, unknown>, jeans: {} as Record<string, unknown> });
      loader.load(`${BODY_GRID_DIR}/body.glb`,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (g: any) => {
          if (cancelled) return;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          g.scene.traverse((o: any) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; if (o.morphTargetDictionary) S.bodyMeshes.push(o); } });
          realisticSkin(g.scene, S.THREE); applySkinTone(g.scene, S.skinTone); hideCoveredFeet(g.scene);   // no skin poking through the shoes
          scene.add(g.scene); S.bodyRoot = g.scene; setLoading(false); setReady(r => r + 1);
        }, undefined, () => !cancelled && setError('Could not load the body model.'));

      const onResize = () => {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (!w || !h) return;
        // narrow (phone) views: zoom out so the arms and feet stay in the picture
        renderer.setSize(w, h, false); camera.aspect = w / h; camera.zoom = Math.min(1, (w / h) / 0.8); camera.updateProjectionMatrix();
      };
      window.addEventListener('resize', onResize);
      // the canvas also changes size without a window resize (layout switch, panels opening)
      const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
      ro?.observe(canvas);
      const clock = new THREE.Clock();
      const tick = () => {
        frame = requestAnimationFrame(tick);
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
            const J = W.jeansSize && W.jeans?.[W.jeansSize];
            if (J) for (const t of J.tracks) applyFrame(t, f, W.mode === 'fit', 'denim');
            const jp = J ? joinParts(J.tracks.map((t: WalkTrack) => t.mesh.geometry.attributes.position.array as Float32Array)) : null;   // all panels: one garment
            const layered = W.size.includes('_j');      // shirt walked over these jeans in the simulation
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta?.body]);   // the body grid only: switching shirts (withShirt gives a new meta) must not rebuild the scene

  // ── load the selected size's shirt on demand ───────────────────────────────────
  useEffect(() => {
    const S = sceneRef.current;
    if (!S.loader || !meta) return;
    const key = `${shirtDir}:${size}`;          // loaded shirt files: one per shirt and size
    S.shirtWant = key;                          // read by downloads that finish later (the shirt + size wanted NOW)
    for (const [sz, grp] of Object.entries(S.shirts)) (grp as { visible: boolean }).visible = sz === key && showShirt;
    if (S.shirts[key]) { setReady(r => r + 1); return; }
    S.shirts[key] = 'loading';
    setShirtProg({ size, pct: 0 });
    const gen = S.gen;
    loadPacked(S.THREE, S.loader, `${shirtDir}/shirt_${size}.glb.gz`,
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
        for (const [sz, grp] of Object.entries(S.shirts)) if (typeof grp !== 'string') (grp as { visible: boolean }).visible = sz === S.shirtWant && showShirt && S.shirtSimulated !== false && !S.walkOn;
        setReady(r => r + 1); setShirtProg(p => p?.size === size ? null : p);
      }, e => { if (e.total) setShirtProg(p => p?.size === size ? { size, pct: Math.round(100 * e.loaded / e.total) } : p); },
      () => { setShirtProg(null); setError(`Could not load size ${size}.`); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, meta, loading, shirtDir]);

  // ── catwalk: load the baked walk (body once, shirt per size) and switch the scene over ───
  useEffect(() => {
    const S = sceneRef.current;
    if (!S.THREE || !meta) return;
    const THREE = S.THREE;
    S.walkOn = walking;
    const W = S.walk || (S.walk = { group: new THREE.Group(), shirts: {}, jeans: {}, loading: {} });
    if (!W.added) { S.scene.add(W.group); W.added = true; }
    // walking jeans for this size; with the belt on, the walk held at the waist when the plain one has slid down
    const jz = jOn && !jeans?.productWalk && jeans!.belt && meta.walk?.jeans?.[jeans!.size + 'belt'] ? jeans!.size + 'belt' : jeans?.size;
    const originalWalk = selectWalk(meta, size, jOn ? jz : null, jeans?.walk !== false, jeans?.productWalk, { shirt: GON.walk, pants: XIN.walk });
    const selected = xinWalkAssets(originalWalk, !!jeans?.builtinXin);
    const { js, sk } = selected;
    W.size = sk; W.mode = mode; W.last = -1; W.jeansSize = js; W.productPants = originalWalk.packedPants;
    const has = !!meta.walk?.sizes[size];
    const show = (on: boolean) => {
      W.active = on; W.group.visible = on;
      if (S.bodyRoot) S.bodyRoot.visible = !on;
      for (const [sz, grp] of Object.entries(S.shirts)) if (typeof grp !== 'string') (grp as { visible: boolean }).visible = !on && sz === `${shirtDir}:${size}` && showShirt;
      if (on) for (const g of Object.values(S.jeans || {})) if (g && typeof g !== 'string') (g as { visible: boolean }).visible = false;
      for (const [sz, sh] of Object.entries(W.shirts)) (sh as { root: { visible: boolean } }).root.visible = on && sz === sk && showShirt;
      for (const [sz, jj] of Object.entries(W.jeans)) (jj as { root: { visible: boolean } }).root.visible = on && sz === js;
      for (const t of W.body || []) if (/pants/i.test(t.mesh.name) || /pants/i.test(t.mesh.parent?.name || '')) t.mesh.visible = !js;
    };
    if (!walking) { show(false); W.t0 = undefined; setReady(r => r + 1); return; }
    if (!has) { setWalking(false); setWalkStatus(`The ${size} catwalk is still being simulated.`); return; }
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
          realisticSkin(g.scene, S.THREE); applySkinTone(g.scene, S.skinTone); hideCoveredFeet(g.scene);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walking, size, mode, meta, loading, jOn, jeans?.size, jeans?.walk, jeans?.belt, jeans?.productWalk, jeans?.builtinXin, showShirt]);

  // ── jeans: load the chosen simulation on demand; the basic pants are swapped for them ───────────
  useEffect(() => {
    const S = sceneRef.current;
    if (!S.loader || !meta) return;
    const url = jeans?.url ?? null;
    // the wanted state lives on S: a size that finishes loading later must follow what is wanted THEN (the body may
    // have changed meanwhile and these jeans be hidden now), not what was wanted when its download started
    S.jeansWant = { url, on: jOn };
    const show = () => {
      const { url: wu, on } = S.jeansWant;
      // S.walkOn: this also runs when a size finishes loading, possibly after the catwalk started
      for (const [u, g] of Object.entries(S.jeans)) if (typeof g !== 'string') (g as { visible: boolean }).visible = !S.walkOn && on && u === wu;
      S.bodyRoot?.traverse((o: { name: string; visible: boolean; isMesh?: boolean }) => { if (o.isMesh && /pants/i.test(o.name)) o.visible = !on; });
    };
    if (!url || S.jeans[url]) { show(); setReady(r => r + 1); return; }
    S.jeans[url] = 'loading';
    const gen = S.gen;
    loadPacked(S.THREE, S.loader, url + '.gz',   // packed copy (blender/pack_web.sh), else the plain .glb
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
        S.scene.add(g.scene); S.jeans[url] = g.scene; applyPantsSkin(S); show(); setReady(r => r + 1);
      }, undefined, () => setError('Could not load the jeans.'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jeans?.url, jOn, meta, loading, walking]);

  // ── pants photo swap textures ───────────────────────────────────────────────────
  useEffect(() => {
    const S = sceneRef.current;
    if (!S.THREE) return;
    const THREE = S.THREE;
    S.pantsSkin?.front?.dispose(); S.pantsSkin?.back?.dispose();
    const sk = jeans?.skin;
    const tex = (c: HTMLCanvasElement) => { const t = new THREE.CanvasTexture(c); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
    S.pantsSkin = sk ? { front: tex(sk.front), back: tex(sk.back) } : null;
    applyPantsSkin(S);
  }, [jeans?.skin, ready]);

  // ── apply sliders: morph weights on body + shirt, blended fit map ───────────────
  useEffect(() => {
    const S = sceneRef.current;
    if (!meta || !S.THREE) return;
    const { w, vw } = solveBody(meta, height, chest, shoulder, waist, belly);
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
    S.bodyMeshes?.forEach((m: unknown) => setMorphs(m));
    const grp = S.shirts?.[`${shirtDir}:${size}`];
    // honesty: a shirt not simulated on the bodies this blend uses is not drawn (the page says why)
    if (grp && typeof grp !== 'string') {
      const simulatedHere = Object.keys(w).every(k => meta.shirt[size]?.[k]);
      S.shirtSimulated = simulatedHere;            // read by the visibility effect below (it must not re-show it)
      if (!simulatedHere) grp.visible = false;
      else if (showShirt && !S.walk?.active) grp.visible = true;
    }
    const jg = jOn && jeans ? S.jeans?.[jeans.url] : null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shirtParts: any[] = grp && typeof grp !== 'string' ? grp.userData.parts : [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jeansParts: any[] = jg && typeof jg !== 'string' ? jg.userData.parts : [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const p of [...shirtParts, ...jeansParts] as any[]) {
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
      const extension = jeans?.elastic?.extension, limit = jeans?.elastic?.limit;
      for (let i = 0; i < n; i++) {
        const c = p.isJeans && band?.array[i] > 0 && extension != null && limit != null
          ? elasticBandColor(extension, gap[i], limit) : fitColor(strain[i], gap[i], fab);
        col.setXYZ(i, c[0], c[1], c[2]);
      }
      col.needsUpdate = true;
    }
    applyStaticLayers(shirtParts, jeansParts, showShirt);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, height, chest, shoulder, waist, belly, size, shirtDir, mode, ready, jeans?.url, jeans?.elastic?.extension, jeans?.elastic?.limit, jOn, showShirt]);


  useEffect(() => {
    const S = sceneRef.current;
    for (const [sz, grp] of Object.entries(S.shirts || {})) if (typeof grp !== 'string') (grp as { visible: boolean }).visible = !S.walk?.active && sz === `${shirtDir}:${size}` && showShirt && S.shirtSimulated !== false;
  }, [showShirt, size, shirtDir, ready]);

  // ── colourway photos -> textures on every loaded shirt (grid sizes and catwalk) ──────────
  useEffect(() => {
    const S = sceneRef.current;
    if (!S.THREE) return;
    const THREE = S.THREE;
    S.colourway?.front?.dispose(); S.colourway?.back?.dispose();
    if (!photos) { S.colourway = null; applyColourway(S); return; }
    const tex = (c: HTMLCanvasElement) => {
      const t = new THREE.CanvasTexture(c); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
    };
    // sheen = 0.9 x fabric colour: reproduces the original material's sheen with the original photos
    const sheen = new THREE.Color().setRGB(...photos.front.fabric.map(v => 0.9 * v) as [number, number, number]);
    S.colourway = { front: tex(photos.front.canvas), back: tex(photos.back.canvas), sheen };
    applyColourway(S);
  }, [photos, ready]);

  return (
    <div className={`relative ${className ?? ''}`} style={style}>
      {/* absolute: the canvas's own pixel size must never feed back into the layout (it grew on every resize) */}
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
      {(loading || error) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-xs font-bold" style={{ color: error ? C.red : C.navy, background }}>
          {error || <ModelSkeleton />}
        </div>
      )}
      {!loading && showShirt && !walking && shirtProg?.size === size && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-xs font-semibold shadow" style={{ background: '#fff', color: C.navy }}>
          <span className="h-4 w-4 animate-spin rounded-full border-2" style={{ borderColor: C.navy, borderTopColor: 'transparent' }} />
          Putting on size {shirtProg.size}…{shirtProg.pct > 0 && ` ${shirtProg.pct} %`}
        </div>
      )}
    </div>
  );
}
