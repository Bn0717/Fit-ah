'use client';

import { useEffect, useState } from 'react';
import { Skeleton, ModelSkeleton } from './Skeleton';

function Lines() {
  return <div className="space-y-2"><Skeleton className="h-4 w-28" /><Skeleton className="h-3 w-3/4" /></div>;
}

export function DashboardSkeleton() {
  return (
    <main role="status" aria-label="Loading dashboard" aria-busy="true" className="min-h-screen bg-[#F8F3EA]">
      <div aria-hidden="true" className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:space-y-6 sm:px-6 sm:py-10 lg:px-8">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div className="space-y-4"><Skeleton className="h-10 w-52 sm:h-12" /><div className="flex gap-2">{[0,1,2,3].map(i => <Skeleton key={i} className="h-9 w-16 rounded-2xl sm:w-24 sm:rounded-full" />)}</div><Skeleton className="h-3 w-64" /></div>
          <Skeleton className="h-10 w-48 rounded-full" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">{[0,1,2,3].map(i => <div key={i} className="space-y-3 rounded-2xl border border-[#FFDBD1] bg-white p-4 sm:p-5"><Skeleton className="h-3 w-16" /><Skeleton className="h-8 w-12" /><Skeleton className="h-3 w-3/4" /></div>)}</div>
        <div className="space-y-4 rounded-2xl border border-[#FFDBD1] bg-white p-4 sm:p-6">
          <Lines />
          {[0,1,2].map(i => <div key={i} className="grid grid-cols-[48px_minmax(0,1fr)] items-center gap-3 rounded-xl bg-[#F8F3EA] p-3 md:grid-cols-[56px_minmax(0,1fr)_minmax(0,1.3fr)_max-content]"><Skeleton className="h-14 w-full" /><Lines /><Skeleton className="col-start-2 h-8 w-full md:col-auto" /><Skeleton className="col-start-2 h-9 w-full rounded-full md:col-auto" /></div>)}
        </div>
        <div className="space-y-4 rounded-2xl border border-[#FFDBD1] bg-white p-4 sm:p-6"><Lines />{[0,1].map(i => <div key={i} className="flex items-center justify-between border-t border-[#F8F3EA] pt-3"><Lines /><Skeleton className="h-9 w-14 rounded-full" /></div>)}</div>
      </div>
    </main>
  );
}

export function WardrobeSkeleton() {
  return (
    <main role="status" aria-label="Loading wardrobe" aria-busy="true" className="min-h-dvh bg-[#F8F3EA] px-4 pb-32 pt-5 md:px-10 md:pb-16">
      <div aria-hidden="true" className="mx-auto max-w-6xl">
        <div className="flex gap-2"><Skeleton className="h-11 w-40 rounded-xl" /><Skeleton className="h-11 w-32 rounded-xl" /></div>
        <div className="mt-4 flex gap-3 overflow-hidden border-b border-[#FFDBD1] py-3">{[0,1,2,3].map(i => <Skeleton key={i} className="h-5 w-24 shrink-0" />)}</div>
        <div className="mt-4 flex gap-2">{[0,1,2].map(i => <Skeleton key={i} className="h-9 w-20 rounded-full" />)}</div>
        {[0,1].map(section => <section key={section} className="mt-6"><div className="mb-3 flex items-end justify-between"><Skeleton className="h-6 w-24" /><Skeleton className="h-10 w-28" /></div><div className="grid grid-cols-3 gap-2 min-[480px]:grid-cols-4 md:grid-cols-3 md:gap-4 lg:grid-cols-4 xl:grid-cols-5">{[0,1,2,3,4].map(i => <div key={i} className="overflow-hidden rounded-xl border-2 border-[#FFDBD1] bg-white"><Skeleton className="aspect-square w-full rounded-none md:aspect-[3/4]" /><div className="space-y-2 p-2 sm:p-3"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/2" /></div></div>)}</div></section>)}
      </div>
    </main>
  );
}

export function FittingRoomSkeleton({ layout: requestedLayout, navHeight: requestedNavHeight }: { layout?: 'three' | 'two' | 'phone'; navHeight?: number }) {
  const [viewport, setViewport] = useState<{ layout: 'three' | 'two' | 'phone'; navHeight: number }>({ layout: 'two', navHeight: 61 });
  useEffect(() => {
    const nav = document.querySelector('nav');
    const update = () => {
      const w = window.innerWidth, h = window.innerHeight;
      setViewport({ layout: w >= 1280 && h >= 640 ? 'three' : w >= 1024 || (w > h && w >= 640) ? 'two' : 'phone', navHeight: nav?.getBoundingClientRect().height ?? 61 });
    };
    update();
    window.addEventListener('resize', update);
    const observer = nav ? new ResizeObserver(update) : null;
    if (nav) observer?.observe(nav);
    return () => { window.removeEventListener('resize', update); observer?.disconnect(); };
  }, []);
  const layout = requestedLayout ?? viewport.layout;
  const navHeight = requestedNavHeight ?? viewport.navHeight;
  return (
    <div role="status" aria-label="Loading fitting room" aria-busy="true" className="fixed inset-x-0 bottom-0 overflow-hidden bg-[#F8F3EA]" style={{ top: navHeight }}>
      <div className={`flex h-full ${layout === 'phone' ? 'flex-col' : ''}`}>
        {layout === 'three' && <aside aria-hidden="true" className="w-[clamp(280px,22vw,340px)] shrink-0 space-y-6 overflow-hidden border-r bg-white p-5"><Skeleton className="h-7 w-28" /><Skeleton className="mx-auto h-20 w-20 rounded-full" /><Lines />{[0,1,2,3].map(i => <div key={i} className="space-y-3"><Lines /><Skeleton className="h-2 w-full rounded-full" /></div>)}<Skeleton className="h-10 w-full rounded-xl" /></aside>}
        <div className="relative min-h-0 min-w-0 flex-1"><ModelSkeleton />{layout !== 'three' && <Skeleton aria-hidden="true" className="absolute left-3 top-3 h-10 w-44 rounded-full" />}</div>
        {layout === 'phone' ? <div aria-hidden="true" className="space-y-3 border-t bg-white p-3"><Skeleton className="mx-auto h-1.5 w-10 rounded-full" /><div className="grid grid-cols-3 gap-2">{[0,1,2].map(i => <Skeleton key={i} className="h-11 rounded-xl" />)}</div></div> : <aside aria-hidden="true" className={`${layout === 'three' ? 'w-[clamp(320px,26vw,400px)]' : 'w-[clamp(280px,36vw,380px)]'} shrink-0 space-y-5 overflow-hidden border-l bg-white p-4`}><Skeleton className="h-6 w-32" /><Skeleton className="h-16 w-full rounded-xl" /><div className="flex gap-2">{[0,1,2].map(i => <Skeleton key={i} className="h-9 flex-1 rounded-full" />)}</div><div className="grid grid-cols-3 gap-2">{[0,1,2,3,4,5].map(i => <div key={i} className="space-y-2"><Skeleton className="aspect-[3/4] w-full rounded-xl" /><Skeleton className="h-3 w-3/4" /></div>)}</div></aside>}
      </div>
    </div>
  );
}
