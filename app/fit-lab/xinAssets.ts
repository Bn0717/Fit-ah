/** Isolate built-in Xin surfaces from customer photo swaps that share the legacy cut. */
import { XIN } from './paths';
export const XIN_GRID_DIR = XIN.smoothGrid;
export const XIN_WALK_DIR = XIN.smoothWalk;
export function xinWalkAssets<T extends { js: string | null; pantsFile: string | null; pantsDir: string; packedPants: boolean }>(selection: T, builtinXin: boolean): T {
  if (!builtinXin || !selection.pantsFile) return selection;
  // js is only a cache key (kept as before so the smooth and raw Xin never share a cache entry)
  return { ...selection, js: `xin-smooth/${selection.js}`, pantsDir: XIN_WALK_DIR, packedPants: true };
}
