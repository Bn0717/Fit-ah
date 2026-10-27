// app/fit-lab/paths.ts
// Every Fit Lab file location in one place. Layout under public/models/fitlab/:
//   bodies/                 shared by every brand: the simulated body grid (body.glb + meta.json) and the walking body
//   brands/index.json       the pants products shown on the site (each entry has its own folder: dir)
//   brands/<brand>/<style>/ that garment's own files (photos, simulated sizes, catwalk)
// Product folders keep their product ID as the folder name, so saved wardrobes and sizes still match.
// No imports here: tests load this file on its own.

export const FITLAB = '/models/fitlab';

// shared bodies
export const BODY_GRID_DIR = `${FITLAB}/bodies/grid`;   // body.glb, meta.json (also indexes the TNT tee + jeans sims)
export const BODY_WALK_DIR = `${FITLAB}/bodies/walk`;   // walk_body.glb / .json / .bin.gz
export const GRID_META_URL = `${BODY_GRID_DIR}/meta.json`;
export const PRODUCTS_INDEX_URL = `${FITLAB}/brands/index.json`;
export const TOPS_INDEX_URL = `${FITLAB}/brands/tops.json`;         // shirt products shown on the site (blender/new_shirt.sh)

// TNT CO
const TNT = `${FITLAB}/brands/tnt_co`;
export const GON = {
  grid: `${TNT}/gon_tee/grid`,              // shirt_<size>.glb.gz
  walk: `${TNT}/gon_tee/walk`,              // walk_<size>.json, walk_shirt_<size>.glb / .bin.gz (+ _j<jeans> layered)
  colourway: `${TNT}/gon_tee/colourway`,    // reference outline masks for colourway photos
  front: `${TNT}/gon_tee/photos/gon_front.png`,
  back: `${TNT}/gon_tee/photos/gon_back.png`,
};
export const XIN = {
  grid: `${TNT}/xin_jeans/grid`,            // raw Xin sims (used by pants photo swaps): jeans_<size>, belt/, drop/
  walk: `${TNT}/xin_jeans/walk`,            // raw Xin catwalk
  smoothGrid: `${TNT}/xin_jeans/smooth/grid`,   // the built-in Xin's repaired surface
  smoothWalk: `${TNT}/xin_jeans/smooth/walk`,
  outline: `${TNT}/xin_jeans/outline.json`, // pants photo swap reference
  front: `${TNT}/xin_jeans/photos/xin_front.jpg`,
  back: `${TNT}/xin_jeans/photos/xin_back.jpg`,
};
