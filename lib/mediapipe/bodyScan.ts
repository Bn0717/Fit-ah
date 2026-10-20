// lib/mediapipe/bodyScan.ts
// Body measurements from ONE front photo + the height the person types in (a photo has no scale, so height cannot
// be measured from it). Runs fully in the browser (MediaPipe Pose Landmarker with its person mask); the photo never
// leaves the device.
//   - scale: the person's height in the photo (top of the mask above the head to the heels) = typed height
//   - shoulder: distance between the shoulder points, converted to the seam-to-seam shoulder width
//   - chest / waist / hips: the width of the body outline at that height x a girth-per-width factor measured on
//     the Fit Lab 3D bodies (blender/grid, cross-sections): waist 2.79 (+-1 %), hips 2.62 (+-0.6 %), chest 2.82
//     (+-3 %). A front photo shows width only, not depth, so real people differ more than the 3D bodies do:
//     expect about +-6-8 cm on chest / waist (more in loose clothes); belly needs a side view and is not measured.
// Every failure returns a plain-language reason so the page can ask for a better photo or a typed number.
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

export type ScanProblem = 'no_person' | 'cut_off' | 'side_on' | 'arms' | 'too_small' | 'failed';
export type ScanResult =
  | { ok: true; height: number; shoulder: number; chest: number; waist: number; hip: number;
      plusMinus: { shoulder: number; chest: number; waist: number; hip: number }; notes: string[] }
  | { ok: false; problem: ScanProblem; message: string; debug?: Record<string, number> };

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
// girth = width x factor (Fit Lab 3D bodies, see header); shoulder seam width = shoulder-point distance x factor
// (then checked end to end on rendered Fit Lab bodies, which corrected for the person mask being ~4 % narrower than
// the skin at the waist and the shoulder points sitting inside the shoulder seams)
const K = { chest: 2.93, waist: 2.92, hip: 2.57, shoulder: 1.40 };
const SHOES_CM = 2.5;            // the photo is usually taken in shoes; the typed height is without

let landmarker: Promise<PoseLandmarker> | null = null;
function getLandmarker() {
  landmarker ||= (async () => {
    const vision = await FilesetResolver.forVisionTasks(WASM);
    const make = (delegate: 'GPU' | 'CPU') => PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'IMAGE', numPoses: 1, outputSegmentationMasks: true,
    });
    try { return await make('GPU'); } catch { return await make('CPU'); }
  })();
  landmarker.catch(() => { landmarker = null; });
  return landmarker;
}

const fail = (problem: ScanProblem, message: string): ScanResult => ({ ok: false, problem, message });

export async function scanBody(img: HTMLImageElement | HTMLCanvasElement, heightCm: number): Promise<ScanResult> {
  if (!(heightCm >= 120 && heightCm <= 230)) return fail('failed', 'Please type your height first (in cm).');
  let pl: PoseLandmarker;
  try { pl = await getLandmarker(); } catch { return fail('failed', 'The body scanner could not start (check your internet connection) — you can type your measurements instead.'); }
  const W = 'naturalWidth' in img ? img.naturalWidth : img.width, H = 'naturalHeight' in img ? img.naturalHeight : img.height;
  const res = pl.detect(img);
  const L = res.landmarks?.[0], maskObj = res.segmentationMasks?.[0];
  if (!L || !maskObj) return fail('no_person', "We couldn't find a person in this photo. Use a photo of your whole body, standing, facing the camera.");
  const mw = maskObj.width, mh = maskObj.height, mask = maskObj.getAsFloat32Array();
  maskObj.close();
  const vis = (i: number) => (L[i].visibility ?? 1) > 0.5 && L[i].y > 0 && L[i].y < 1 && L[i].x > 0 && L[i].x < 1;
  // whole body in view: head, shoulders, hips, ankles / heels
  if (![0, 11, 12, 23, 24].every(vis)) return fail('cut_off', 'Your head, shoulders or hips are not fully in the photo. Step back so your whole body fits, head to feet.');
  if (![27, 28].every(vis) && ![29, 30].every(vis)) return fail('cut_off', 'Your feet are not in the photo. Step back so your whole body fits, head to feet.');
  const px = (i: number) => ({ x: L[i].x * mw, y: L[i].y * mh });
  const on = (x: number, y: number) => x >= 0 && x < mw && y >= 0 && y < mh && mask[Math.round(y) * mw + Math.round(x)] > 0.5;
  // runs of the person mask in one row: [start, end] pairs
  const runs = (y: number) => {
    const r: [number, number][] = []; let s = -1;
    for (let x = 0; x <= mw; x++) { const o = x < mw && on(x, y); if (o && s < 0) s = x; if (!o && s >= 0) { r.push([s, x - 1]); s = -1; } }
    return r;
  };
  const sL = px(11), sR = px(12), hL = px(23), hR = px(24);
  const sMid = { x: (sL.x + sR.x) / 2, y: (sL.y + sR.y) / 2 }, hMid = { x: (hL.x + hR.x) / 2, y: (hL.y + hR.y) / 2 };
  const torso = hMid.y - sMid.y;
  // top of the head: highest mask pixel near the head's column
  const nose = px(0);
  let top = -1;
  for (let y = 0; y < nose.y && top < 0; y++) for (let x = Math.max(0, Math.round(nose.x - 0.4 * torso)); x < Math.min(mw, nose.x + 0.4 * torso); x++) if (on(x, y)) { top = y; break; }
  if (top <= 1) return fail('cut_off', 'The top of your head is cut off. Step back so your whole body fits, head to feet.');
  const feet = [27, 28, 29, 30, 31, 32].filter(vis).map(i => px(i).y);
  let bottom = Math.max(...feet);
  for (let y = Math.round(bottom); y < mh; y++) { if (runs(y).length) bottom = y; else break; }   // to the sole
  if (bottom >= mh - 2) return fail('cut_off', 'Your feet touch the bottom edge of the photo. Step back a little so there is space under your feet.');
  const bodyPx = bottom - top;
  if (bodyPx < 0.45 * mh) return fail('too_small', 'You are too small in the photo. Stand closer (about 2–3 m away) so your body fills most of the picture.');
  const cmPerPx = (heightCm + SHOES_CM) / bodyPx;
  // facing the camera: shoulders clearly wider than a side view would show
  const shPx = Math.hypot(sL.x - sR.x, sL.y - sR.y);
  if (shPx < 0.13 * bodyPx) return fail('side_on', 'Please face the camera straight on (this looks like a side or angled view).');
  // width of the body outline (the run that contains the body's centre line) in one row
  const elbows = [px(13), px(14)];
  const widthAt = (y: number) => {
    const cx = sMid.x + (hMid.x - sMid.x) * ((y - sMid.y) / torso);
    const r = runs(Math.round(y)).find(([a, b]) => a <= cx && cx <= b);
    if (!r) return null;
    // the arm touches the body when the run reaches an elbow / beyond the shoulder points
    const merged = elbows.some(e => Math.abs(e.y - y) < 0.25 * torso && e.x >= r[0] - 2 && e.x <= r[1] + 2);
    return { w: r[1] - r[0], merged };
  };
  const scanRows = (f0: number, f1: number) => {
    const out: { y: number; w: number; merged: boolean }[] = [];
    for (let f = f0; f <= f1 + 1e-9; f += 0.01) { const y = sMid.y + f * torso, m = widthAt(y); if (m) out.push({ y, ...m }); }
    return out;
  };
  // chest: the widest torso row 20-45 % down from the shoulders where the arms are clear of the body (a row much
  // wider than the shoulder points includes the arms)
  const chestRows = scanRows(0.2, 0.45).filter(r => !r.merged && r.w < 1.25 * shPx);
  // waist: the narrowest row 55-85 % down; hips: the widest row from the hip points to 20 % below them
  const waistRows = scanRows(0.55, 0.85), hipRows = scanRows(0.95, 1.2);
  if (!chestRows.length || waistRows.some(r => r.merged) || hipRows.some(r => r.merged)) {
    return fail('arms', 'Your arms are touching your body, so we cannot see your outline. Stand with your arms slightly away from your sides (like a letter A).');
  }
  const chestW = Math.max(...chestRows.map(r => r.w)), waistW = Math.min(...waistRows.map(r => r.w)), hipW = Math.max(...hipRows.map(r => r.w));
  const r1 = (v: number) => Math.round(v * 2) / 2;
  const out = {
    height: heightCm,
    shoulder: r1(shPx * cmPerPx * K.shoulder),
    chest: r1(chestW * cmPerPx * K.chest), waist: r1(waistW * cmPerPx * K.waist), hip: r1(hipW * cmPerPx * K.hip),
  };
  const notes: string[] = [];
  // sanity: girths a person can have; outside it the outline is not the body (bag, loose coat, someone behind)
  if (out.chest < 70 || out.chest > 150 || out.waist < 55 || out.waist > 150 || out.hip < 70 || out.hip > 150 || out.waist > out.chest + 25) {
    return { ...fail('failed', 'The outline does not look like a body outline (loose clothes, a bag or something behind you?). Try a photo in fitted clothes against a plain wall.'),
      debug: { ...out, chestW, waistW, hipW, cmPerPx, bodyPx, top, bottom, mw, mh, torso } } as ScanResult;
  }
  if (out.chest - out.waist < 3 && out.hip - out.waist < 3) notes.push('Loose clothes can make the waist look wider than it is: fitted clothes give a better result.');
  notes.push('Belly shape is not measured from a front photo: it stays "natural".');
  return { ok: true, ...out, plusMinus: { shoulder: 2.5, chest: 7, waist: 7, hip: 6 }, notes };
}
