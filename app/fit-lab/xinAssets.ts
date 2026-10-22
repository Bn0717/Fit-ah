/** Isolate built-in Xin surfaces from customer photo swaps that share the legacy cut. */
export const XIN_GRID_DIR = '/models/fitlab/xin-smooth/grid';
export const XIN_WALK_DIR = '/models/fitlab/xin-smooth/walk';
export function xinWalkAssets<T extends { js: string | null; pantsFile: string | null; pantsDir: string; packedPants: boolean }>(selection: T, builtinXin: boolean): T {
  if (!builtinXin || !selection.pantsFile) return selection;
  return { ...selection, js: `xin-smooth/${selection.js}`, pantsDir: XIN_WALK_DIR, packedPants: true };
}
