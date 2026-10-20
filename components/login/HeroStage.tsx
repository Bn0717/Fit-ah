// components/login/HeroStage.tsx
// The scroll-driven 3D scene on the login page: the Fit Lab model (shirt M over jeans M, from the
// layered walk simulation) plus real simulated garments that float around it. The page passes the
// story progress (0..1); everything here is a function of that number, so scrolling back works too.
'use client';

import { useEffect, useRef } from 'react';
import { loadPantsRef, makePantsTexture } from '@/app/fit-lab/pantsSwap';

const MODEL = '/models/login/hero.glb?v=3';
const TEE = '/models/login/tee.glb?v=3';
// mpos = where it floats on a phone (the narrow view has less room: keep clear of the arms, text and table)
type Floater = { url: string; pos: [number, number, number]; mpos?: [number, number, number]; scale: number; spin: number; tex?: string; pantsPhoto?: boolean; desktopOnly?: boolean };
// Fixed promotional assets: never read the user's wardrobe, hidden items or uploads.
const FLOATERS: Floater[] = [
  // url, position (desktop), scale, spin direction; tex = another TNT CO tee's shop photos on the same tee
  // (models/login/tees/<tex>_f.jpg / _b.jpg, padded by blender/pad_tee_photo.py)
  { url: TEE, pos: [1.25, 1.42, -0.35], mpos: [0.7, 1.4, 0], scale: 0.55, spin: 1 },
  { url: '/models/login/jeans.glb.gz', pantsPhoto: true, pos: [1.5, 0.45, 0.15], mpos: [0.72, 0.35, 0], scale: 0.42, spin: -1 },
  { url: '/models/login/shorts.glb.gz', pos: [-1.35, 0.38, 0.25], mpos: [-0.72, 0.12, 0], scale: 0.5, spin: 1 },
  { url: '/models/login/jeans.glb.gz', pos: [-0.8, 0.9, -1.5], mpos: [-0.76, 0.62, 0], scale: 0.38, spin: -1 },
  { url: TEE, tex: 'maui-logo-tee-pink', pos: [-0.75, 1.98, -1.7], mpos: [-0.6, 1.72, 0], scale: 0.48, spin: -1 },
  { url: TEE, tex: 'horsehoes-tee-black', pos: [0.95, 2.05, -1.4], mpos: [0.45, 1.86, 0], scale: 0.45, spin: 1 },
  { url: TEE, tex: 'maui-logo-tee-blue', pos: [2.15, 1.05, -1.7], scale: 0.5, spin: -1, desktopOnly: true },
  { url: TEE, tex: 'flame-horse-tee-white', pos: [-1.95, 0.95, -0.7], scale: 0.48, spin: 1, desktopOnly: true },
  { url: TEE, tex: 'scribble-logo-tee-red', pos: [1.85, 1.85, -1.1], scale: 0.42, spin: 1, desktopOnly: true },
];

// camera keyframes along the story: hero (model on the right) -> fabric close-up -> full body
type V3 = [number, number, number];
type Key = { p: number; pos: V3; tgt: V3 };
function keys(offsetX: number): Key[] {
  return [
    { p: 0.0, pos: [offsetX, 1.02, 4.7], tgt: [offsetX, 0.92, 0] },
    { p: 0.09, pos: [offsetX, 1.02, 4.7], tgt: [offsetX, 0.92, 0] },
    { p: 0.2, pos: [0.12, 1.3, 0.95], tgt: [0.02, 1.26, 0] },
    { p: 0.25, pos: [0.1, 1.28, 1.05], tgt: [0.02, 1.24, 0] },
    { p: 0.34, pos: [0, 1.0, 4.4], tgt: [0, 0.9, 0] },
    { p: 1.0, pos: [0, 1.0, 4.4], tgt: [0, 0.9, 0] },
  ];
}

export const seg = (p: number, a: number, b: number) => Math.min(1, Math.max(0, (p - a) / (b - a)));
export const ease = (t: number) => t * t * (3 - 2 * t);

export const ENTER_MS = 1500;   // length of the sign-in fly-in to the shirt
export default function HeroStage({ progress, onProgress, enterAt }: {
  progress: React.MutableRefObject<number>;
  enterAt?: React.MutableRefObject<number | null>;   // performance.now() when sign-in succeeded
  onProgress?: (loaded: number) => void;     // 0..1 while the model downloads, 1 when shown
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false, raf = 0;
    let cleanup = () => {};
    Promise.all([
      import('three'),
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/loaders/DRACOLoader.js'),
      import('three/addons/environments/RoomEnvironment.js'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ]).then(([THREE, { GLTFLoader }, { DRACOLoader }, { RoomEnvironment }]: any[]) => {
      if (cancelled) return;
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      const scene = new THREE.Scene();
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 50);

      const key = new THREE.DirectionalLight(0xfff6ec, 1.7); key.position.set(-2, 4, 3); key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024); key.shadow.radius = 6;
      Object.assign(key.shadow.camera, { left: -1.2, right: 1.2, top: 2.2, bottom: -0.2 });
      key.shadow.bias = -0.0005;
      const rim = new THREE.DirectionalLight(0xffdbd1, 0.9); rim.position.set(2.5, 2.5, -3);
      scene.add(key, rim, new THREE.HemisphereLight(0xffffff, 0xe8dccb, 0.55));
      // soft contact shadow on the (transparent) floor, so the cream page shows through
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.ShadowMaterial({ opacity: 0.13 }));
      floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

      const figure = new THREE.Group(); scene.add(figure);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const morphs: { mesh: any; a1: number; a2: number }[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const floaters: { root: any; base: number[]; mbase: number[] | null; scale: number; spin: number; phase: number; desktopOnly: boolean }[] = [];
      const loader = new GLTFLoader();
      const draco = new DRACOLoader(); draco.setDecoderPath('/draco/'); loader.setDRACOLoader(draco);

      loader.load(MODEL,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (g: any) => {
          if (cancelled) return;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          g.scene.traverse((o: any) => {
            if (!o.isMesh) return;
            o.castShadow = true;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) if (/shirt|jeans/.test(m.name)) m.side = THREE.DoubleSide;
            const d = o.morphTargetDictionary;
            if (d && d.arms1 !== undefined) morphs.push({ mesh: o, a1: d.arms1, a2: d.arms2 });
          });
          figure.add(g.scene);
          onProgressRef.current?.(1);
          loadFloaters();
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e: any) => { if (e.total) onProgressRef.current?.(Math.min(0.99, e.loaded / e.total)); },
        () => onProgressRef.current?.(1));

      // the garments float after the model is in, so they never slow down the first view
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cache: Record<string, Promise<any>> = {};
      const texLoader = new THREE.TextureLoader();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const get = (url: string) => (cache[url] ||= (async () => {
        if (!url.endsWith('.gz')) return new Promise<any>((res, rej) => loader.load(url, (g: any) => res(g.scene), undefined, rej));
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Login asset unavailable: ${url}`);
        const packed = await response.arrayBuffer();
        const bytes = new Uint8Array(packed);
        const data = bytes[0] === 0x1f && bytes[1] === 0x8b
          ? await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
          : packed;
        return (await loader.parseAsync(data, '/models/login/')).scene;
      })());
      let stallionTextures: Promise<{ f: HTMLCanvasElement; b: HTMLCanvasElement }> | undefined;
      const getStallionTextures = () => (stallionTextures ||= loadPantsRef('/models/login/pants-outline.json').then(async ref => {
        const [front, back] = await Promise.all([
          makePantsTexture('/media/login/stallion.png', ref.front),
          makePantsTexture('/media/login/stallion_back.png', ref.back),
        ]);
        return { f: front.canvas, b: back.canvas };
      }));
      const photo = (url: string) => {
        const t = texLoader.load(url);
        t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;   // glTF texture convention
        return t;
      };
      function loadFloaters() {
        FLOATERS.forEach((f, i) => get(f.url).then(async src => {
          const pantsTextures = f.pantsPhoto ? await getStallionTextures() : null;
          if (cancelled) return;
          const obj = src.clone(true);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          obj.traverse((o: any) => {
            if (!o.isMesh) return;
            o.morphTargetInfluences?.fill(0);
            const one = !Array.isArray(o.material);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const mats = (one ? [o.material] : o.material).map((m: any) => {
              const c = m.clone(); c.side = THREE.DoubleSide;
              const side = /front/.test(m.name) ? 'f' : /back/.test(m.name) ? 'b' : null;
              if (f.tex && side) {
                c.map = photo(`/models/login/tees/${f.tex}_${side}.jpg`);
                if ('sheen' in c) c.sheen = 0;                 // the sheen was tinted for the green tee
              }
              if (pantsTextures && side) {
                const t = new THREE.CanvasTexture(pantsTextures[side]);
                t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
                c.map = t;
              }
              return c;
            });
            o.material = one ? mats[0] : mats;
          });
          const box = new THREE.Box3().setFromObject(obj, true);
          obj.position.sub(box.getCenter(new THREE.Vector3()));   // spin around its own middle
          const root = new THREE.Group(); root.add(obj); root.scale.setScalar(0.0001);
          scene.add(root);
          floaters.push({ root, base: [...f.pos], mbase: f.mpos ? [...f.mpos] : null, scale: f.scale, spin: f.spin, phase: i * 1.7, desktopOnly: !!f.desktopOnly });
        }).catch(() => {}));
      }

      let aspect = 1, mobile = false;
      const resize = () => {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        aspect = w / h; mobile = aspect < 0.9;
        camera.aspect = aspect;
        camera.fov = mobile ? 40 : 32;
        camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize); ro.observe(canvas);

      const pos = new THREE.Vector3(), tgt = new THREE.Vector3();
      const clock = new THREE.Clock();
      let p = progress.current;
      const tick = () => {
        raf = requestAnimationFrame(tick);
        const r = canvas.getBoundingClientRect();
        const entering = enterAt?.current != null;
        if (!entering && (r.bottom < 0 || r.top > window.innerHeight)) return;   // off screen: don't draw
        const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
        p = entering ? progress.current : p + (progress.current - p) * Math.min(1, dt * 7);   // smooth the scroll
        const e = entering ? ease(Math.min(1, (performance.now() - enterAt!.current!) / ENTER_MS)) : 0;

        // camera
        const K = keys(mobile ? 0 : -Math.min(0.95, (aspect - 1) * 0.75));
        let i = 0; while (i < K.length - 2 && p > K[i + 1].p) i++;
        const k0 = K[i], k1 = K[i + 1], u = ease(seg(p, k0.p, k1.p));
        pos.set(...k0.pos).lerp(new THREE.Vector3(...k1.pos), u);
        tgt.set(...k0.tgt).lerp(new THREE.Vector3(...k1.tgt), u);
        if (mobile) {
          pos.z *= 1.3;                                                 // narrow screen: step back
          const zoom = ease(seg(p, 0.09, 0.2)) * (1 - ease(seg(p, 0.25, 0.34)));
          pos.y -= 0.16 * zoom; tgt.y -= 0.16 * zoom;                   // close-up stays on the shirt, not the face
        }
        if (e > 0) {                                                    // sign-in: fly in close to the shirt
          pos.lerp(new THREE.Vector3(0.04, mobile ? 1.18 : 1.26, mobile ? 0.62 : 0.55), e);
          tgt.lerp(new THREE.Vector3(0.0, mobile ? 1.12 : 1.2, 0), e);
        }
        camera.position.copy(pos); camera.lookAt(tgt);

        // the model: three-quarter view in the hero, then a full turn in screen 3
        const turn = ease(seg(p, 0.4, 0.56)) * Math.PI + ease(seg(p, 0.6, 0.76)) * Math.PI;
        const hero = 1 - ease(seg(p, 0.09, 0.2));
        figure.rotation.y = (-0.45 * hero + turn + Math.sin(t * 0.6) * 0.04 * hero) * (1 - e);

        // arms: lift out (shows how the shirt moves) and back down again
        const arms = ease(seg(p, 0.44, 0.52)) - ease(seg(p, 0.64, 0.72));
        const a1 = arms < 0.5 ? arms * 2 : 2 - arms * 2, a2 = arms < 0.5 ? 0 : arms * 2 - 1;
        for (const m of morphs) { m.mesh.morphTargetInfluences[m.a1] = a1; m.mesh.morphTargetInfluences[m.a2] = a2; }

        // floating garments: grow in for screen 3, gone again before the features
        const show = ease(seg(p, 0.38, 0.48)) * (1 - ease(seg(p, 0.8, 0.9)));
        for (const f of floaters) {
          const b = mobile && f.mbase ? f.mbase : mobile ? [f.base[0] * 0.48, f.base[1], f.base[2]] : f.base;
          f.root.position.set(b[0], b[1] + Math.sin(t * 0.8 + f.phase) * 0.04 + (1 - show) * -0.25, b[2]);
          f.root.rotation.y += dt * 0.35 * f.spin;
          f.root.rotation.z = Math.sin(t * 0.5 + f.phase) * 0.12;
          f.root.scale.setScalar(Math.max(0.0001, f.scale * show * (mobile ? 0.7 : 1)));
          f.root.visible = show > 0.001 && !(mobile && f.desktopOnly);
        }
        renderer.render(scene, camera);
      };
      tick();

      cleanup = () => {
        ro.disconnect();
        renderer.dispose(); pmrem.dispose(); draco.dispose();
      };
    });
    return () => { cancelled = true; cancelAnimationFrame(raf); cleanup(); };
  }, [progress]);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" aria-hidden="true" />;
}
