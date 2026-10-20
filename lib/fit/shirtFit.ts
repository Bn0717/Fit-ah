// lib/fit/shirtFit.ts
// The shirt fit rules shared by the profile page and the dashboard, so both always give the same verdict.
// Body and size chart are in the same flat cm the charts use (chest = width across, not all the way around).
// Length is compared with 32% of height (the torso the shirt has to cover).
import type { SizeChart } from '@/lib/types/clothing';

export type Body = { height: number; chest: number; waist: number; shoulder: number };
export type FitStatus = 'tight' | 'loose' | 'good';
export type FitDetail = { label: string; status: FitStatus; message: string };
export type FitLabel = string;   // 'Good Fit' | 'Mixed Fit' | 'Too Tight' | 'Too Loose' | '<Part> Too Tight' | '<Part> Too Loose'
export type ShirtFit = {
  details: FitDetail[]; label: FitLabel; color: string; hasTight: boolean; hasLoose: boolean;
  chestEase: number;   // cm of room at the chest (chart chest minus body chest)
};

export function shirtFit(body: Body, row: SizeChart): ShirtFit {
  const ceA = row.chest - body.chest;
  const seA = row.shoulder - body.shoulder;
  const leA = row.length - body.height * 0.32;
  const weA = row.chest - body.waist;

  const details: FitDetail[] = [
    {
      label: 'Chest',
      status: ceA < -2 ? 'tight' : ceA > 18 ? 'loose' : 'good',
      message: ceA < -2
        ? `Too narrow (${ceA.toFixed(1)}cm) — shirt cannot fit over chest`
        : ceA > 18
        ? `Too baggy (+${ceA.toFixed(1)}cm) — very oversized across chest`
        : `+${ceA.toFixed(1)}cm — ${ceA < 7 ? 'slim fit' : ceA < 12 ? 'regular fit' : 'relaxed fit'}`,
    },
    {
      label: 'Shoulder',
      status: seA < -3 ? 'tight' : seA > 6 ? 'loose' : 'good',
      message: seA < -3
        ? `Too narrow (${seA.toFixed(1)}cm) — seam pulls painfully inward`
        : seA > 6
        ? `Too wide (+${seA.toFixed(1)}cm) — seam droops off shoulder point`
        : `${seA >= 0 ? '+' : ''}${seA.toFixed(1)}cm — seam sits correctly on shoulder`,
    },
    {
      label: 'Length',
      status: leA < -4 ? 'tight' : leA > 20 ? 'loose' : 'good',
      message: leA < -4
        ? `Too short (${leA.toFixed(1)}cm) — will expose midriff when moving`
        : leA > 20
        ? `Very long (+${leA.toFixed(1)}cm) — reaches well past hips`
        : `+${leA.toFixed(1)}cm below torso — appropriate coverage`,
    },
    {
      label: 'Waist',
      status: weA < -2 ? 'tight' : weA > 20 ? 'loose' : 'good',
      message: weA < -2
        ? `Too tight at waist (${weA.toFixed(1)}cm) — restricts movement`
        : weA > 20
        ? `Very boxy (+${weA.toFixed(1)}cm) — excess fabric at waist`
        : `+${weA.toFixed(1)}cm — comfortable range of motion`,
    },
  ];

  const tightCount = details.filter(d => d.status === 'tight').length;
  const looseCount = details.filter(d => d.status === 'loose').length;
  const hasTight = tightCount > 0, hasLoose = looseCount > 0;

  const label = hasTight && hasLoose ? 'Mixed Fit'
    : hasTight ? (tightCount > 1 ? 'Too Tight' : `${details.find(d => d.status === 'tight')!.label} Too Tight`)
    : hasLoose ? (looseCount > 1 ? 'Too Loose' : `${details.find(d => d.status === 'loose')!.label} Too Loose`)
    : 'Good Fit';

  const color = label === 'Good Fit' ? '#10b981'
    : label === 'Mixed Fit' ? '#8b5cf6'
    : hasTight ? '#ef4444'
    : '#f59e0b';

  return { details, label, color, hasTight, hasLoose, chestEase: ceA };
}

// The size to recommend from a chart: the fewest parts out of range, then the chest room closest to a
// regular fit (the middle of the 7 to 12 cm "regular" band above).
export function bestShirtSize(body: Body, chart: SizeChart[]): { size: string; fit: ShirtFit } | null {
  const rows = chart.filter(r => r.chest > 0 && r.shoulder > 0 && r.length > 0);
  if (!rows.length) return null;
  const scored = rows.map(r => {
    const fit = shirtFit(body, r);
    const off = fit.details.filter(d => d.status !== 'good').length;
    return { size: r.size, fit, score: off * 100 + Math.abs(fit.chestEase - 9.5) };
  });
  scored.sort((a, b) => a.score - b.score);
  return { size: scored[0].size, fit: scored[0].fit };
}
