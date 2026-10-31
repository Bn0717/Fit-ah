// Shared policy: a saved size is a record, never a new fit recommendation.
export function initialSize(saved: string | null | undefined, recommended: string | null | undefined, sizes: readonly string[]) {
  return [saved, recommended, sizes[0]].find((size): size is string => !!size && sizes.includes(size)) ?? '';
}

export function recommendedTop(sizes: readonly string[], fit: (size: string) => { tier: string } | null | undefined, supported: (size: string) => boolean = () => true) {
  return sizes.find(size => {
    const f = fit(size);
    return supported(size) && !!f && f.tier !== 'Compression' && f.tier !== 'Slim';
  }) ?? null;
}

export function recommendedBottom(sizes: readonly string[], fit: (size: string) => { hide: boolean; now?: { tone: string } | null } | null | undefined, supported: (size: string) => boolean = () => true) {
  return sizes.find(size => {
    const f = fit(size);
    return supported(size) && !!f && !f.hide && f.now?.tone === 'green';
  }) ?? null;
}

// The brand's own body size chart (who each size is made for, e.g. Uniqlo M = chest 88–96 cm). When the brand
// publishes one, its size is the recommendation: the brand designs each cut, oversized included, for those bodies.
// Overlapping ranges: the size whose range centre is nearest; an exact tie goes to the larger size (the usual
// "between sizes, size up" advice). Outside every range: null, so the simulated fit decides instead.
export function brandBodySize(chart: Record<string, { chest?: number[] }> | null | undefined, chest: number | null | undefined,
  supported: (size: string) => boolean = () => true) {
  if (!chart || !(chest! > 0)) return null;
  let best: string | null = null, dist = Infinity;
  for (const [size, r] of Object.entries(chart)) {
    const c = r.chest;
    if (!c || c.length !== 2 || chest! < c[0] || chest! > c[1] || !supported(size)) continue;
    const d = Math.abs(chest! - (c[0] + c[1]) / 2);
    if (d <= dist) { best = size; dist = d; }               // later (larger) sizes win ties
  }
  return best;
}
