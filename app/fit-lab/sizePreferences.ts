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
