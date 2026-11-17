'use client';
// Shop widget prototype ("level 0", 16 Nov 2026): the honest "see your size" picture for ONE pants product, light
// enough for a shop page. Picture for look, numbers for size: two sizes side by side on the grid body nearest to the
// shopper, with the room at the waist, the hem and the slip under each.
//  - Light: the triangles + textures are downloaded once, then one small file per size for that one body
//    (scripts/fitlab/split_bodies.mjs; about 1.1 MB for the first picture instead of 30+ MB).
//  - No mixing: the single nearest simulated body is shown as it was simulated (no blend between bodies).
//  - By waist: when the shopper gives a waist, the body is chosen by height + waist (pants fit at the waist), else by
//    height + chest.
//  - Private: the numbers typed here stay in this page; only the nearest body's file name is requested.
//  - Kill switch: /models/fitlab/widget/<product>/off.json present = the widget shows nothing for that product.
//  - Any product: /fit-widget?p=<folder> reads /models/fitlab/widget/<folder>/info.json (name, brand, sizes, and which
//    body set: men's grid by default, or the women's grid: body "body_women" + its meta), so a brand's product needs
//    no code change (16 Nov 2026, women's bodies).
import { useEffect, useMemo, useRef, useState } from 'react';
import { jeansState, type PantsData } from '../fit-lab/jeansFit';
import type { GridMeta } from '../fit-lab/engine';

const ROOT = '/models/fitlab/widget';
type Info = { name: string; brand: string; sizes: string[]; body?: string; meta?: string; women?: boolean };
const PRODUCTS: Record<string, Info> = {
  xin: { name: '"Xin" Denim Biker Pants', brand: 'TNT CO', sizes: ['M', 'L', 'XL', '2XL'] },
};
const MEN_META = '/models/fitlab/bodies/grid/meta.json';
const TONE: Record<string, string> = { green: '#15803d', amber: '#b45309', red: '#b91c1c', blue: '#1d4ed8' };

type Part = { mesh: string; material: string; verts: number; indices: number; index32: boolean; texture: string | null; color: number[] | null };
type Base = { parts: Part[]; keys: string[]; textures: string[] };
type Loaded = { base: Base; bin: ArrayBuffer; dir: string };

async function gunzip(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`);
  let buf = await r.arrayBuffer(); const h = new Uint8Array(buf, 0, 2);
  if (h[0] === 0x1f && h[1] === 0x8b) buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return buf;
}
const cache = new Map<string, Promise<unknown>>();
const once = <T,>(k: string, f: () => Promise<T>) => { if (!cache.has(k)) cache.set(k, f()); return cache.get(k) as Promise<T>; };
const loadBase = (dir: string) => once(`base ${dir}`, async (): Promise<Loaded> =>
  ({ base: await (await fetch(`${dir}/base.json`)).json(), bin: await gunzip(`${dir}/base.bin.gz`), dir }));
const loadBody = (dir: string, key: string) => once(`body ${dir} ${key}`, () => gunzip(`${dir}/${key}.bin.gz`));

// one garment / body on one grid body -> three.js meshes (normals shared across parts so seams do not show)
function build(THREE: typeof import('three'), L: Loaded, pos: ArrayBuffer, hide: (p: Part) => boolean) {
  const head = new Float32Array(pos, 0, 6), q = new Uint16Array(pos, 24), total = q.length / 3;
  const P = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) P[i] = q[i] * head[3 + (i % 3)] + head[i % 3];
  const group = new THREE.Group(); let vo = 0, bo = 0; const geos: { g: import('three').BufferGeometry; vo: number; n: number }[] = [];
  for (const p of L.base.parts) {
    const iBytes = p.indices * (p.index32 ? 4 : 2), idx = p.index32 ? new Uint32Array(L.bin.slice(bo, bo + iBytes)) : new Uint16Array(L.bin.slice(bo, bo + iBytes));
    bo += iBytes; const uvq = new Uint16Array(L.bin.slice(bo, bo + p.verts * 4)); bo += p.verts * 4;
    if (!hide(p)) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(P.subarray(vo * 3, (vo + p.verts) * 3), 3));
      const uv = new Float32Array(p.verts * 2); for (let i = 0; i < uv.length; i++) uv[i] = uvq[i] / 65535;
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(new THREE.BufferAttribute(idx, 1));
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide, color: p.color ? new THREE.Color(p.color[0], p.color[1], p.color[2]) : 0xffffff });
      if (p.texture) { const t = new THREE.TextureLoader().load(`${L.dir}/${p.texture}`); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; mat.map = t; }
      group.add(new THREE.Mesh(g, mat)); geos.push({ g, vo, n: p.verts });
    }
    vo += p.verts;
  }
  // normals: face normals summed per POSITION (vertices doubled along texture seams and between parts share one)
  const acc = new Map<string, [number, number, number]>(), key = (i: number) => `${q[i * 3]},${q[i * 3 + 1]},${q[i * 3 + 2]}`;
  for (const { g, vo: o } of geos) {
    const ix = g.index!.array;
    for (let f = 0; f < ix.length; f += 3) {
      const a = (o + ix[f]) * 3, b = (o + ix[f + 1]) * 3, c = (o + ix[f + 2]) * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const n: [number, number, number] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      for (const v of [o + ix[f], o + ix[f + 1], o + ix[f + 2]]) { const k = key(v), e = acc.get(k); if (e) { e[0] += n[0]; e[1] += n[1]; e[2] += n[2]; } else acc.set(k, [n[0], n[1], n[2]]); }
    }
  }
  for (const { g, vo: o, n } of geos) {
    const N = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const e = acc.get(key(o + i)) ?? [0, 1, 0], l = Math.hypot(e[0], e[1], e[2]) || 1; N[i * 3] = e[0] / l; N[i * 3 + 1] = e[1] / l; N[i * 3 + 2] = e[2] / l; }
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  }
  void total; return group;
}

function View({ product, mode, size, bodyKey, centre, bodyDir }: { product: string; mode: string; size: string; bodyKey: string; centre: string; bodyDir: string }) {
  const ref = useRef<HTMLDivElement>(null); const [err, setErr] = useState('');
  useEffect(() => {
    let dead = false, raf = 0; let renderer: import('three').WebGLRenderer | null = null;
    (async () => {
      try {
        const THREE = await import('three'); const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
        const file = (k: string) => k === centre ? '_base' : k;
        const [bodyL, pantsL] = await Promise.all([loadBase(`${ROOT}/${bodyDir}`), loadBase(`${ROOT}/${product}/${mode}/${size}`)]);
        const [bodyP, pantsP] = await Promise.all([loadBody(`${ROOT}/${bodyDir}`, file(bodyKey)), loadBody(`${ROOT}/${product}/${mode}/${size}`, file(bodyKey))]);
        if (dead || !ref.current) return;
        const el = ref.current, w = el.clientWidth, h = el.clientHeight;
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(w, h);
        el.replaceChildren(renderer.domElement);
        const scene = new THREE.Scene(); scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc8bc, 2.4));
        const d = new THREE.DirectionalLight(0xffffff, 2.2); d.position.set(1.5, 3, 3); scene.add(d);
        scene.add(build(THREE, bodyL, bodyP, p => p.mesh === 'Pants'));                 // the body's basic pants are under the product
        scene.add(build(THREE, pantsL, pantsP, () => false));
        const cam = new THREE.PerspectiveCamera(28, w / h, 0.1, 20); cam.position.set(0, 0.62, 3.1);
        const ctl = new OrbitControls(cam, renderer.domElement); ctl.target.set(0, 0.6, 0); ctl.enablePan = false; ctl.enableZoom = false;
        ctl.minPolarAngle = ctl.maxPolarAngle = Math.PI / 2 - 0.02; ctl.update();
        const loop = () => { if (dead) return; ctl.update(); renderer!.render(scene, cam); raf = requestAnimationFrame(loop); }; loop();
      } catch (e) { if (!dead) setErr(String(e)); }
    })();
    return () => { dead = true; cancelAnimationFrame(raf); renderer?.dispose(); };
  }, [product, mode, size, bodyKey, centre, bodyDir]);
  return <div ref={ref} className="w-full" style={{ aspectRatio: '3 / 4', background: '#f4efe7', borderRadius: 16 }}>{err && <p className="p-3 text-xs" style={{ color: '#b91c1c' }}>{err}</p>}</div>;
}

export default function FitWidget() {
  // the product folder from ?p= (letters, digits, - and _ only: it becomes part of a file path)
  // (read once on the client; the server renders nothing until the product's info has loaded, so no mismatch)
  const [product] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const p = new URLSearchParams(window.location.search).get('p') ?? 'xin';
    return /^[a-z0-9_-]{1,64}$/i.test(p) ? p : 'xin';
  });
  const [info, setInfo] = useState<Info | null>(null);
  const [meta, setMeta] = useState<GridMeta | null>(null); const [pants, setPants] = useState<PantsData | null>(null);
  const [off, setOff] = useState(false);
  const [height, setHeight] = useState(175), [chest, setChest] = useState(101), [waist, setWaist] = useState(''), [belt, setBelt] = useState(true);
  useEffect(() => {
    if (!product) return;
    const use = (j: Info | null) => {
      setInfo(j);
      if (j?.women) { setHeight(160); setChest(84); }   // a women's product starts on the women's centre body (160 cm, bust 84)
    };
    fetch(`${ROOT}/${product}/info.json`).then(r => (r.ok ? r.json() : null)).then((j: Info | null) => use(j ?? PRODUCTS[product] ?? null))
      .catch(() => use(PRODUCTS[product] ?? null));
  }, [product]);
  const women = !!info?.women;
  useEffect(() => {
    if (!product || !info) return;
    fetch(`${ROOT}/${product}/off.json`).then(r => setOff(r.ok)).catch(() => {});
    (async () => {
      const m: GridMeta = await (await fetch(info.meta ?? MEN_META)).json();
      const ld = async (mode: string) => Object.fromEntries(await Promise.all(info.sizes.map(async z => [z, await (await fetch(`${ROOT}/${product}/${mode}/${z}/fit.json`)).json()])));
      const b = await ld('belt'), d = await ld('drop');
      setMeta(m); setPants({ name: info.name, sizes: b, belt: b, drop: d } as PantsData);
    })().catch(() => {});
  }, [product, info]);

  // the nearest simulated body: by height + waist when a waist is given (pants fit at the waist), else height + chest
  const pick = useMemo(() => {
    if (!meta || !pants || !info) return null;
    const keys = Object.keys(pants.sizes[info.sizes[0]].bodies), w = +waist > 0 ? +waist : null;
    let best: { k: string; d: number } | null = null;
    for (const k of keys) {
      const b = meta.body[k]; if (!b) continue;
      const d = Math.abs(b.height - height) / 5 + (w !== null ? Math.abs((b.waist ?? 0) - w) / 4 : Math.abs(b.chest - chest) / 5);
      if (!best || d < best.d) best = { k, d };
    }
    return best && { key: best.k, body: meta.body[best.k], byWaist: w !== null };
  }, [meta, pants, height, chest, waist, info]);

  const rows = useMemo(() => {
    if (!meta || !pants || !pick || !info) return [];
    const st = (z: string) => jeansState(meta, pants, z, belt, pick.body.height, pick.body.chest, null, null, 0, +waist > 0 ? { waist: +waist } : {});
    const all = info.sizes.map(z => ({ z, st: st(z) }));
    // "your size": the smallest size that is drawn and not tight; shown with the next size up (or down at the top)
    let i = all.findIndex(r => r.st && !r.st.hide && r.st.now && r.st.now.waistEase >= 0 && r.st.now.tone !== 'red');
    if (i < 0) i = all.findIndex(r => r.st && !r.st.hide);
    if (i < 0) return all.slice(0, 2).map(r => ({ ...r, yours: false }));
    const j = i + 1 < all.length ? i + 1 : i - 1;
    return [{ ...all[i], yours: true }, ...(j >= 0 ? [{ ...all[j], yours: false }] : [])].sort((a, b) => info.sizes.indexOf(a.z) - info.sizes.indexOf(b.z));
  }, [meta, pants, pick, belt, waist, info]);

  if (off || !product || !info) return null;
  const mode = belt ? 'belt' : 'drop', bodyDir = info.body ?? 'body', bustWord = women ? 'Bust' : 'Chest';
  const hr = meta ? [meta.heights[0], meta.heights[meta.heights.length - 1]] : [155, 195];
  return (
    <main className="mx-auto max-w-2xl p-4 space-y-3" style={{ color: '#1c1917' }}>
      <header>
        <div className="text-xs uppercase tracking-wide" style={{ opacity: 0.6 }}>{info.brand}</div>
        <h1 className="text-lg font-semibold">{info.name}: see your size</h1>
      </header>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
        <label className="flex flex-col gap-1">Height (cm)<input type="number" min={hr[0] - 5} max={hr[1] + 5} value={height} onChange={e => setHeight(+e.target.value)} className="rounded-lg border px-2 py-1" /></label>
        <label className="flex flex-col gap-1">{bustWord} (cm)<input type="number" min={70} max={136} value={chest} onChange={e => setChest(+e.target.value)} className="rounded-lg border px-2 py-1" /></label>
        <label className="flex flex-col gap-1">Waist (cm, optional)<input type="number" min={55} max={125} value={waist} onChange={e => setWaist(e.target.value)} placeholder="tape" className="rounded-lg border px-2 py-1" /></label>
        <label className="flex items-end gap-2 pb-1"><input type="checkbox" checked={belt} onChange={e => setBelt(e.target.checked)} />with a belt</label>
      </div>
      {pick && <p className="text-xs" style={{ opacity: 0.7 }}>Shown on the nearest simulated body: {pick.body.height.toFixed(0)} cm tall, {bustWord.toLowerCase()} {pick.body.chest.toFixed(0)}, hips {(pick.body.hip ?? 0).toFixed(0)}, waist {(pick.body.waist ?? 0).toFixed(0)} cm{pick.byWaist ? ' (matched to your waist)' : ''}. Your numbers stay on this page.</p>}
      <div className="grid grid-cols-2 gap-3">
        {rows.map(({ z, st, yours }) => {
          const n = st?.now, hidden = !st || st.hide;
          return (
            <section key={z} className="space-y-1">
              <div className="flex items-baseline gap-2"><span className="font-semibold">{z}</span>{yours && <span className="text-xs rounded-full px-2" style={{ background: '#1c1917', color: '#fff' }}>suggested</span>}</div>
              {hidden || !pick ? <div className="w-full flex items-center justify-center p-3 text-center text-sm" style={{ aspectRatio: '3 / 4', background: '#f4efe7', borderRadius: 16, color: '#b91c1c' }}>{st?.reason ?? 'Not available for this body'}</div>
                : <View product={product} mode={mode} size={z} bodyKey={pick.key} centre={meta!.centre} bodyDir={bodyDir} />}
              {n && !hidden && <div className="text-xs space-y-0.5">
                <div className="font-semibold" style={{ color: TONE[n.tone] }}>{n.label}</div>
                <div>Waist: {n.waistEase >= 0 ? `${n.waistEase.toFixed(1)} cm of room` : `${(-n.waistEase).toFixed(1)} cm too small`}</div>
                <div>Hem: {n.hem <= 0.5 ? 'rests on the shoes' : `${n.hem.toFixed(0)} cm above the floor`}</div>
                {n.drop > 1 && <div>Slips {n.drop.toFixed(0)} cm without a belt</div>}
              </div>}
            </section>
          );
        })}
      </div>
      <p className="text-xs" style={{ opacity: 0.55 }}>A cloth simulation of this garment on a body close to yours, not a photo. Drag to turn.</p>
    </main>
  );
}
