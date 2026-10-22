// components/ui/Skeleton.tsx
'use client';

import { HTMLAttributes } from 'react';

const colors = {
  cream: '#F8F3EA',
  navy: '#0B1957',
  peach: '#FFDBD1',
  pink: '#FA9EBC'
};

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export function Skeleton({ className = '', style, ...props }: SkeletonProps) {
  return (
    <div
      className={`skeleton-shimmer rounded-lg ${className}`}
      style={style}
      {...props}
    />
  );
}

export function ItemCardSkeleton() {
  return (
    <div className="bg-white rounded-xl shadow-sm border-2 overflow-hidden" style={{ borderColor: colors.peach }}>
      <Skeleton className="aspect-[3/4] w-full" />
      <div className="p-4 space-y-3">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-3 w-24" />
      </div>
    </div>
  );
}

export function ProfileSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

export function DashboardCardSkeleton() {
  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border-2" style={{ borderColor: colors.peach }}>
      <Skeleton className="h-6 w-32 mb-4" />
      <Skeleton className="h-16 w-full mb-2" />
      <Skeleton className="h-4 w-full" />
    </div>
  );
}

export function ModelSkeleton() {
  return (
    <div role="status" aria-label="Loading 3D model" aria-busy="true" className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6">
      <div aria-hidden="true" className="flex w-full max-w-48 flex-col items-center gap-2 motion-reduce:animate-none">
        <Skeleton className="h-12 w-12 rounded-full" />
        <Skeleton className="h-36 w-28 rounded-[2rem]" />
        <div className="flex gap-2"><Skeleton className="h-36 w-10" /><Skeleton className="h-36 w-10" /></div>
      </div>
      <span className="text-xs font-medium" style={{ color: colors.navy }}>Loading 3D model…</span>
    </div>
  );
}
