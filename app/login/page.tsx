// app/login/page.tsx
// Login page. A scroll story in the style of a fashion lookbook, built on the Fit Lab 3D model:
//   1 hero: big wordmark + model   2 fabric close-up   3 the model turns, arms lift, real garments float, fit table
//   4 the stage blurs and the features slide over it, then the wardrobe, then sign in.
// Sign-in works exactly like the old /login (components/login/LoginCard.tsx); it opens from the top-right
// button as a slide-in panel and also sits at the bottom of the page.
'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { Inter_Tight, Archivo } from 'next/font/google';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/contexts/AuthContext';
import { getAvatar } from '@/lib/firebase/firestore';
import { colors, useLoginForm, LoginCard, ResetModal } from '@/components/login/LoginCard';
import { seg, ease, ENTER_MS } from '@/components/login/HeroStage';
import css from './login.module.css';
import stylist from './stylist.json';
import landmarks from './scan-landmarks.json';

const HeroStage = dynamic(() => import('@/components/login/HeroStage'), { ssr: false });
const display = Inter_Tight({ subsets: ['latin'], weight: ['400', '500', '600'] });
// brand + big titles: Archivo, extra wide and heavy (fashion-label look)
const brand = Archivo({ subsets: ['latin'], axes: ['wdth'] });
const wide = { fontStretch: '125%' } as const;
const { cream, navy, peach, pink } = colors;
const M = '/media/login';

// one place for every scroll-linked style: [ref, (p) => style]
type Styler = (p: number) => Partial<CSSStyleDeclaration>;

export default function LoginPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [drawer, setDrawer] = useState(false);
  // fly the camera into the shirt, then open the next page (after sign-in, or from "My profile")
  const enterAt = useRef<number | null>(null);
  const [entering, setEntering] = useState<string | null>(null);
  const flyTo = (href: string, label: string) => {
    if (enterAt.current != null) return;              // already flying
    router.prefetch(href);
    setDrawer(false);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    enterAt.current = performance.now();
    setEntering(label);
    setTimeout(() => router.push(href), ENTER_MS + 400);
  };
  // same places as the old login: your profile, or onboarding if you have no body profile yet
  const f = useLoginForm(async uid => {
    const profile = await getAvatar(uid);
    flyTo(profile ? '/profile' : '/onboarding', profile ? 'Opening your profile…' : 'Setting up your profile…');
  });
  const [loaded, setLoaded] = useState(0);
  const progress = useRef(0);
  const storyRef = useRef<HTMLElement>(null);
  const stylers = useRef<[HTMLElement | null, Styler][]>([]);
  const bind = (fn: Styler) => (el: HTMLElement | null) => {
    if (!el) return;
    if (!stylers.current.some(s => s[0] === el)) stylers.current.push([el, fn]);
  };

  // signed-in visitors can still read the page; the top-right button takes them to their profile
  // /login?signin=1 opens the sign-in panel straight away (for links from other pages)
  useEffect(() => { if (new URLSearchParams(window.location.search).get('signin')) setDrawer(true); }, []);

  // scroll -> progress (0..1 across the story) -> styles, every frame, without re-rendering React
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const el = storyRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const range = r.height - window.innerHeight;
      const p = Math.min(1, Math.max(0, -r.top / range));
      progress.current = p;
      for (const [node, fn] of stylers.current) {
        if (!node) continue;
        Object.assign(node.style, fn(p));
        if (enterAt.current != null && node.dataset.keep !== '1') { node.style.transition = 'opacity .35s'; node.style.opacity = '0'; }
      }
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);

  // the slide-in panel: Esc closes, the page behind does not scroll
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawer(false); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [drawer]);

  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  const fade = (a: number, b: number, c: number, d: number, dy = 24): Styler => p => {
    const o = ease(seg(p, a, b)) * (1 - ease(seg(p, c, d)));
    return { opacity: String(o), transform: `translateY(${(1 - ease(seg(p, a, b))) * dy - ease(seg(p, c, d)) * dy}px)`, pointerEvents: o > 0.5 ? 'auto' : 'none' };
  };

  return (
    <main className={`${display.className} min-h-screen`} style={{ backgroundColor: cream, color: navy }}>
      {/* ── header ───────────────────────────────────────────── */}
      <header data-keep="1" ref={bind(p => (p > 0.995
        ? { backgroundColor: 'rgba(248,243,234,0.88)', backdropFilter: 'blur(10px)', boxShadow: '0 1px 0 rgba(11,25,87,0.08)' }
        : { backgroundColor: 'transparent', backdropFilter: 'none', boxShadow: 'none' }))}
        className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-5 sm:px-8 py-4 pointer-events-none transition-[background-color,box-shadow] duration-300">
        <button ref={bind(p => ({ opacity: String(seg(p, 0.1, 0.14)) }))} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className={`${brand.className} pointer-events-auto text-[22px] sm:text-[26px] font-extrabold tracking-[-0.01em] leading-none`} style={{ opacity: 0, ...wide }}
          aria-label="FIT-AH, back to top">
          FIT-AH
        </button>
        <div className="flex items-center gap-6 sm:gap-10 pointer-events-auto">
          <nav className="hidden md:flex items-center gap-8 text-[14px] font-medium" aria-label="Sections">
            <button className="text-left hover:opacity-60" onClick={() => go('features')}>Features</button>
            <button className="text-left hover:opacity-60" onClick={() => go('wardrobe')}>Wardrobe</button>
            <button className="text-left hover:opacity-60" onClick={() => go('signin')}>Get started</button>
          </nav>
          <button onClick={() => (user ? flyTo('/profile', 'Opening your profile…') : setDrawer(true))}
            className="px-5 py-2.5 rounded-full text-sm font-semibold text-white shadow-sm transition-transform hover:scale-[1.03] active:scale-95"
            style={{ backgroundColor: navy }}>
            {user ? 'My profile' : 'Sign In'}
          </button>
        </div>
      </header>

      {/* ── the scroll story (pinned 3D stage) ───────────────── */}
      <section ref={storyRef} id="story" className="relative" style={{ height: '600vh' }}>
        <div className="sticky top-0 h-[100svh] overflow-hidden">
          <div className="absolute inset-0" data-keep="1" ref={bind(p => {
            const b = ease(seg(p, 0.8, 0.95));
            return { filter: b > 0.001 ? `blur(${b * 18}px)` : 'none', opacity: String(1 - b * 0.55) };
          })}>
            <HeroStage progress={progress} onProgress={setLoaded} enterAt={enterAt} />
          </div>

          {/* loading bar (the sign-in button works straight away; only the 3D waits) */}
          <div className="absolute left-5 sm:left-8 right-5 sm:right-8 bottom-4 h-[2px] rounded-full overflow-hidden" style={{ backgroundColor: `${navy}14`, opacity: loaded >= 1 ? 0 : 1 }}>
            <div className={`h-full ${css.loadBar}`} style={{ width: `${Math.max(6, loaded * 100)}%`, backgroundColor: navy }} />
          </div>

          {/* 1 · hero */}
          <h1 ref={bind(p => {
            const e = ease(seg(p, 0, 0.12));
            return { transform: `translateY(${-e * 30}px) scale(${1 - e * 0.55})`, opacity: String(1 - ease(seg(p, 0.07, 0.12))) };
          })}
            className={`${brand.className} absolute left-5 sm:left-8 top-16 sm:top-14 origin-top-left font-extrabold leading-[0.85] tracking-[-0.02em] select-none whitespace-nowrap`}
            style={{ fontSize: 'clamp(44px, 8.5vw, 140px)', ...wide }}>
            FIT-AH
          </h1>
          <div ref={bind(fade(-1, 0, 0.05, 0.1))} className="absolute left-5 sm:left-8 bottom-24 sm:bottom-auto sm:top-[50%] max-w-[330px]">
            <p className="text-[17px] sm:text-[19px] leading-snug">
              Never buy the wrong size again. See every size on your own 3D body, before you pay.
            </p>
          </div>
          <button ref={bind(fade(-1, 0, 0.05, 0.1))} onClick={() => go('features')}
            className="absolute left-5 sm:left-8 bottom-9 sm:bottom-10 px-4 py-2.5 rounded-md text-[13px] font-medium transition-colors hover:bg-white"
            style={{ backgroundColor: `${peach}aa` }}>
            See how it works
          </button>
          <p ref={bind(fade(-1, 0, 0.04, 0.08))} className="absolute right-5 sm:right-8 bottom-10 text-[11px] tracking-[0.18em] uppercase opacity-60 hidden sm:block">
            Scroll
          </p>

          {/* 2 · fabric close-up */}
          <div ref={bind(fade(0.15, 0.19, 0.27, 0.31))}
            className="absolute left-3 sm:left-5 right-3 sm:right-auto bottom-8 max-w-[390px] p-3 sm:p-4 rounded-2xl backdrop-blur-md" style={{ opacity: 0, backgroundColor: 'rgba(248,243,234,0.82)' }}>
            <p className="text-[11px] tracking-[0.18em] uppercase mb-2" style={{ color: navy, opacity: 0.6 }}>01 · Real fabric</p>
            <p className="text-[19px] sm:text-[24px] leading-snug">
              Each shirt is sewn from its real pattern and draped with cloth physics. What you see is how it hangs.
            </p>
          </div>

          {/* 3 · the turn, floating garments, fit table */}
          <div ref={bind(fade(0.38, 0.44, 0.75, 0.8))} style={{ opacity: 0 }}
            className="absolute left-5 sm:left-8 top-24 sm:top-[22%] max-w-[300px] sm:max-w-[400px]">
            <p className="text-[24px] sm:text-[clamp(26px,2.6vw,38px)] leading-[1.12] tracking-[-0.02em]">
              Every size is fitted on a real body: chest, shoulders and length, measured in centimetres.
            </p>
          </div>
          <div ref={bind(fade(0.43, 0.49, 0.75, 0.8))} style={{ opacity: 0 }}
            className="absolute right-5 sm:right-8 left-5 sm:left-auto bottom-8 sm:bottom-10 sm:w-[min(380px,34vw)] text-[12px] sm:text-[13px]">
            <p className="text-[10px] tracking-[0.18em] uppercase mb-2 opacity-60">Fit check · size M</p>
            {[
              ['Your body', '175 cm · chest 101 cm'],
              ['TNT CO Gon Tee · M', 'chest 114.8 cm'],
              ['Room at the chest', '+13.8 cm · Regular fit'],
              ['Xin Denim · M', 'waist +3.9 cm · sits on hips'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 py-2 border-t" style={{ borderColor: `${navy}26` }}>
                <span className="font-medium">{k}</span><span className="opacity-60 text-right">{v}</span>
              </div>
            ))}
            <div className="border-t" style={{ borderColor: `${navy}26` }} />
          </div>
        </div>
      </section>

      {/* ── features: slide up over the blurred stage ────────── */}
      <section id="features" className="relative z-10 -mt-[100svh]"
        style={{ background: `linear-gradient(to bottom, transparent 0, transparent 30svh, ${cream} 70svh)` }}>
        <div className="px-5 sm:px-8 pt-[30svh] pb-10 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <h2 className={`${brand.className} font-extrabold uppercase tracking-[-0.02em] leading-[0.85]`} style={{ fontSize: 'clamp(44px, 9.5vw, 170px)', ...wide }}>Features</h2>
          <p className="max-w-[330px] text-[16px] sm:text-[18px] leading-snug md:mb-4">
            Everything a fitting room tells you, on your phone. Here is what Fit-Ah does.
          </p>
        </div>

        <div className="px-5 sm:px-8 pb-24 space-y-20 sm:space-y-32">
          <Feature n="01" title="Scan your body from one photo"
            text="Upload one front photo and type your height. Fit-Ah finds 33 body points right in your browser and works out your chest, waist and shoulders."
            chips={['One photo + height', '33 body points', 'Saved to your profile']}
            media={<ScanCard />} />
          <Feature n="02" flip title="Try every size before you buy"
            text="The same shirt in S, M, L and XL on the same body, side by side. Pick the one you actually like, not the one you guess."
            chips={['S · M · L · XL', 'Real brand size charts']}
            media={<VideoCard src={`${M}/sizes.mp4`} poster={`${M}/sizes.jpg`} ratio="1620 / 480"
              labels={SIZE_LABELS} />} />
          <Feature n="03" title="See exactly where it's tight"
            text="A colour map shows where the fabric pulls and where there's room. Red is tight, blue is loose, white is just touching."
            chips={['Fit Map', 'Shirts, Jeans and more coming up!']}
            media={<VideoCard src={`${M}/fitmap.mp4`} poster={`${M}/fitmap.jpg`} ratio="1620 / 480" labels={SIZE_LABELS}
              legend={[['#ee2e2e', 'too tight'], ['#ff8c26', 'tight'], ['#ffdb4d', 'snug'], ['#ffffff', 'touching'], ['#9ec7ff', 'loose'], ['#4d85fa', 'very loose']]} />} />
          <Feature n="04" flip title="Clothes that move like clothes"
            text="Every piece is simulated with cloth physics, so you see it fold, swing and drape as you walk, not a flat sticker on a mannequin."
            chips={['Multiple Animations', 'Real Physic Simulation']}
            media={<VideoCard src={`${M}/catwalk.mp4`} poster={`${M}/catwalk.jpg`} ratio="540 / 646" narrow />} />
          <Feature n="05" title="Your wardrobe, cut out automatically"
            text="Snap a photo of any piece you own. The background is removed in your browser and the item is saved with its brand size chart."
            chips={['Background removal', 'Size chart saved']}
            media={<CutoutCard />} />
          <Feature n="06" flip title="Outfit ideas for today's weather"
            text="Fit-Ah checks the live weather where you are, then our AI stylist suggests 3 outfits for your shirt: bottoms, shoes and why they work. Tap a city to see real answers."
            chips={['Local weather', 'AI stylist']}
            media={<StylistCard />} />
        </div>
      </section>

      {/* ── wardrobe (the "Shop" screen) ─────────────────────── */}
      <section id="wardrobe" className="relative z-10 px-5 sm:px-8 pt-10 pb-28" style={{ backgroundColor: cream }}>
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6 mb-10 sm:mb-14">
          <h2 className={`${brand.className} font-extrabold uppercase tracking-[-0.02em] leading-[0.85]`} style={{ fontSize: 'clamp(44px, 9.5vw, 170px)', ...wide }}>Wardrobe</h2>
          <p className="max-w-[330px] text-[16px] sm:text-[18px] leading-snug md:mt-6">
            Real pieces from TNT CO, already simulated on our bodies in every size. Hover to see the back.
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-12 gap-x-4 sm:gap-x-6 gap-y-10">
          <Piece className="md:col-span-3" img="gon-tee" back="gon-tee_back" name="Gon Tee" kind="Tops" sizes="S – XL" />
          <Piece className="md:col-span-3 md:mt-0" img="stallion" back="stallion_back" name="Stallion Pants (Brown)" kind="Bottoms" sizes="S – XL" />
          <Piece className="col-span-2 md:col-span-6 md:row-span-2" img="xin-denim" name="Xin Denim Biker Pants" kind="Bottoms" sizes="M – 2XL" big />
          <Piece className="md:col-span-3" img="shirts/maui-logo-tee-pink_front" back="shirts/maui-logo-tee-pink_back" name="Maui Logo Tee (Pink)" kind="Tops" sizes="New" />
          <Piece className="md:col-span-3" img="shorts" name="NS Matrix Shorts (White)" kind="Bottoms" sizes="S – 2XL" />
          <Piece className="md:col-span-3" img="shirts/horsehoes-tee-black_front" back="shirts/horsehoes-tee-black_back" name="Horseshoe Tee (Black)" kind="Tops" sizes="New" />
          <Piece className="md:col-span-3" img="shirts/maui-logo-tee-blue_front" back="shirts/maui-logo-tee-blue_back" name="Maui Logo Tee (Blue)" kind="Tops" sizes="New" />
          <Piece className="md:col-span-3" img="shirts/flame-horse-tee-white_front" back="shirts/flame-horse-tee-white_back" name="Flame Horse Tee (White)" kind="Tops" sizes="New" />
          <Piece className="md:col-span-3" img="shirts/scribble-logo-tee-red_front" back="shirts/scribble-logo-tee-red_back" name="Scribble Logo Tee (Red)" kind="Tops" sizes="New" />
        </div>
      </section>

      {/* ── sign in ──────────────────────────────────────────── */}
      <section id="signin" className="relative z-10 px-5 sm:px-8 py-20 sm:py-28 border-t" style={{ backgroundColor: cream, borderColor: `${navy}1a` }}>
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className={`${brand.className} font-extrabold uppercase tracking-[-0.02em] leading-[0.92] mb-6`} style={{ fontSize: 'clamp(40px, 5.6vw, 88px)', ...wide }}>
              Find your<br />size<span style={{ color: pink }}></span>
            </h2>
            <p className="text-[17px] sm:text-[19px] leading-snug max-w-[420px] opacity-80">
              Sign in to scan your body and see every piece in your wardrobe on your own 3D model.
            </p>
            <ul className="mt-8 space-y-3">
              {['AI-powered size recommendations', 'Virtual try-on with real cloth physics', 'Precision fit, in centimetres'].map(t => (
                <li key={t} className="flex items-center gap-3 text-[15px]">
                  <span className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: pink }}>
                    <svg className="w-4 h-4" fill="none" stroke={navy} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex md:justify-end"><LoginCard f={f} idPrefix="page" /></div>
        </div>
      </section>

      <footer className="relative z-10 px-5 sm:px-8 py-8 flex justify-between text-[12px] opacity-60" style={{ backgroundColor: cream }}>
        <span>© 2026 Fit-Ah</span><span>Never buy the wrong size again</span>
      </footer>

      {/* ── slide-in sign-in panel ───────────────────────────── */}
      <div className={`fixed inset-0 z-[60] transition-opacity duration-300 ${drawer ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        style={{ backgroundColor: `${navy}55`, backdropFilter: 'blur(4px)' }} onClick={() => setDrawer(false)} aria-hidden={!drawer} />
      <aside role="dialog" aria-modal="true" aria-label="Sign in" inert={!drawer}
        className={`fixed top-0 right-0 bottom-0 z-[61] w-full sm:w-[480px] overflow-y-auto transition-transform duration-500 ease-[cubic-bezier(.2,.8,.2,1)] ${drawer ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ backgroundColor: cream }}>
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <span className={`${brand.className} text-[22px] font-extrabold`} style={wide}>FIT-AH</span>
          <button onClick={() => setDrawer(false)} aria-label="Close sign in"
            className="w-10 h-10 rounded-full flex items-center justify-center hover:opacity-70" style={{ backgroundColor: peach }}>
            <svg className="w-5 h-5" fill="none" stroke={navy} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-4 sm:px-6 pb-8 flex justify-center"><LoginCard f={f} idPrefix="drawer" /></div>
      </aside>

      <ResetModal f={f} />

      <div aria-live="polite" className="fixed inset-0 z-[80] flex flex-col items-center justify-center pointer-events-none transition-opacity duration-500"
        style={{ backgroundColor: cream, opacity: entering ? 1 : 0, transitionDelay: entering ? `${ENTER_MS - 350}ms` : '0ms' }}>
        {entering && (
          <>
            <span className={`${brand.className} text-[34px] font-extrabold`} style={wide}>FIT-AH</span>
            <span className="mt-2 text-[14px] opacity-60">{entering}</span>
          </>
        )}
      </div>
    </main>
  );
}

// ── feature row ──────────────────────────────────────────────────────────────
function Feature({ n, title, text, chips, media, flip }: {
  n: string; title: string; text: string; chips: string[]; media: React.ReactNode; flip?: boolean;
}) {
  return (
    <article className="grid md:grid-cols-12 gap-6 sm:gap-10 items-center">
      <div className={`md:col-span-7 ${flip ? 'md:order-2' : ''}`}>{media}</div>
      <div className={`md:col-span-5 ${flip ? 'md:order-1 md:pr-6' : 'md:pl-6'}`}>
        <p className="text-[12px] tracking-[0.18em] uppercase mb-3 opacity-60">{n}</p>
        <h3 className="text-[32px] sm:text-[44px] font-medium leading-[1.02] tracking-[-0.035em] mb-4">{title}</h3>
        <p className="text-[16px] sm:text-[17px] leading-relaxed opacity-80 max-w-[460px]">{text}</p>
        <div className="flex flex-wrap gap-2 mt-6">
          {chips.map(c => (
            <span key={c} className="px-3 py-1.5 rounded-full text-[12px] font-medium border" style={{ borderColor: peach, backgroundColor: 'white' }}>{c}</span>
          ))}
        </div>
      </div>
    </article>
  );
}

// a looping, muted video that only plays while on screen
// the 2 size videos are the same Fit Lab grid (normal and fit map). Sizes match the labels in Fit Lab's own
// video (blender/compose_walk_video.sh): the S shirt is worn with M jeans, the smallest jeans simulated.
// body: the 175 x 101 grid body (public/models/fitlab/grid/meta.json, waist 77.7)
const SIZE_LABELS = ['Shirt S · Jeans M', 'Shirt M · Jeans M', 'Shirt L · Jeans L', 'Shirt XL · Jeans XL'];

function VideoCard({ src, poster, ratio, labels, legend, narrow }: {
  src: string; poster: string; ratio: string; labels?: string[]; legend?: [string, string][]; narrow?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) v.play().catch(() => {}); else v.pause(); }, { threshold: 0.25 });
    io.observe(v);
    return () => io.disconnect();
  }, []);
  return (
    <div className={narrow ? 'max-w-[420px] mx-auto' : ''}>
      <div className="rounded-2xl overflow-hidden p-1.5 shadow-[0_20px_60px_-30px_rgba(11,25,87,0.5)]" style={{ backgroundColor: navy }}>
        <video ref={ref} src={src} poster={poster} muted loop playsInline preload="metadata"
          className="w-full h-auto block rounded-xl" style={{ aspectRatio: ratio }} />
      </div>
      {labels && (
        <div className="grid grid-cols-4 mt-3 text-center text-[11px] sm:text-[13px] font-medium">
          {labels.map(l => <span key={l} className="leading-tight">{l}</span>)}
        </div>
      )}
      {labels && (
        <p className="mt-2 text-center text-[11px] sm:text-[12px] opacity-60">
          Same body in every size: 175 cm · chest 101 cm · waist 78 cm · shoulders 45 cm
        </p>
      )}
      {legend && (
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 mt-4 text-[12px]">
          {legend.map(([c, l]) => (
            <span key={l} className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full border" style={{ backgroundColor: c, borderColor: `${navy}33` }} />{l}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// 01: the 33 body points MediaPipe Pose really finds on this picture (scan-landmarks.json, not hand-placed),
// joined with MediaPipe's own POSE_CONNECTIONS
const POSE_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10],
  [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19], [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28], [27, 29], [28, 30], [29, 31], [30, 32], [27, 31], [28, 32],
];
function ScanCard() {
  const P = landmarks.points as [number, number, number][];
  return (
    <div className="relative max-w-[400px] mx-auto rounded-2xl overflow-hidden border-2" style={{ borderColor: peach, backgroundColor: '#f0e6d8' }}>
      <Image src={`${M}/scan-crop.jpg`} alt="A front photo with the 33 body points MediaPipe found" width={680} height={1360} className="w-full h-auto block" />
      {/* same picture rendered at 2x and cropped: the points stay in the 600 x 900 frame MediaPipe saw */}
      <svg viewBox="130 150 340 680" className="absolute inset-0 w-full h-full" aria-hidden="true">
        {POSE_CONNECTIONS.map(([a, b], i) => (
          <line key={i} className={css.bone} x1={P[a][0]} y1={P[a][1]} x2={P[b][0]} y2={P[b][1]} stroke={navy} strokeWidth={2.2} strokeLinecap="round"
            style={{ animationDelay: `${i * 0.02}s` }} />
        ))}
        {P.map(([x, y], i) => (
          <circle key={i} className={css.dot} cx={x} cy={y} r={i <= 10 ? 3.6 : 5.5} fill={pink} stroke="white" strokeWidth={i <= 10 ? 1.4 : 2}
            style={{ animationDelay: `${i * 0.035}s` }} />
        ))}
      </svg>
      <div className={css.scanLine} />
      <span className="absolute top-4 left-4 px-3 py-1.5 rounded-full text-[12px] font-semibold bg-white/90 shadow-sm">33 / 33 points found</span>
      <div className="absolute left-4 right-4 bottom-4 flex flex-wrap gap-2 justify-center">
        {['Height 175 cm', 'Chest 101 cm', 'Waist 78 cm', 'Shoulders 45 cm'].map((t, i) => (
          <span key={t} className={`${css.chip} px-3 py-1.5 rounded-full text-[12px] font-semibold bg-white shadow-sm`} style={{ animationDelay: `${i * 0.08}s` }}>{t}</span>
        ))}
      </div>
    </div>
  );
}

// 05: a photo's background is wiped away, leaving the cut-out
function CutoutCard() {
  return (
    <div className="relative max-w-[560px] mx-auto aspect-[4/3] rounded-2xl overflow-hidden border-2" style={{ borderColor: peach, backgroundColor: 'white' }}>
      {/* stand-in "phone photo" background: bed sheet + window light */}
      <div className={`absolute inset-0 ${css.photoBg}`}
        style={{ background: 'radial-gradient(120% 90% at 25% 15%, #f4efe6 0%, #cfc6b8 45%, #8f8577 100%)' }}>
        <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'repeating-linear-gradient(115deg, transparent 0 18px, rgba(255,255,255,.5) 18px 20px)' }} />
      </div>
      <div className={`absolute top-0 bottom-0 w-[3px] -ml-[1.5px] ${css.wipeEdge}`} style={{ backgroundColor: pink, boxShadow: `0 0 20px 4px ${pink}` }} />
      <Image src={`${M}/gon-tee.png`} alt="Gon Tee, cut out" fill sizes="560px" className="object-contain p-8" />
      <span className={`absolute top-4 left-4 px-3 py-1.5 rounded-full text-[12px] font-semibold bg-white/90 ${css.tagBefore}`}>Your photo</span>
      <span className={`absolute top-4 left-4 px-3 py-1.5 rounded-full text-[12px] font-semibold text-white ${css.tagAfter}`} style={{ backgroundColor: navy }}>Background removed ✓</span>
      <span className="absolute bottom-4 right-4 px-3 py-1.5 rounded-full text-[12px] font-medium border bg-white" style={{ borderColor: peach }}>
        Size chart: chest 57 cm · length 73 cm (M)
      </span>
    </div>
  );
}

// 06: real answers from Fit-Ah's AI stylist (scripts/login-stylist-samples.mjs ran the app's own prompt
// through /api/gemini with live weather; saved in stylist.json, not written by hand)
const BOTTOM_IMG: Record<string, string> = {
  'Baggy Wide-Leg Jeans': '/bottoms/baggy-wide-leg-jeans-black.jpg', 'Casual Sweatpants': '/bottoms/casual-sweatpants-white.jpg',
  'Baggy Cargo Pants': '/bottoms/baggy-cargo-pants-olivegreen.jpg', 'Wide-Leg Sweatpants': '/bottoms/wide-leg-sweatpants.jpg',
  'Pleated Wide-Leg Trousers': '/bottoms/pleated-whide-leg-trousers-beige.jpg', 'Casual Shorts': '/bottoms/casual-shorts-cream.jpg',
  'Slacks': '/bottoms/slacks-black.png',
};
const SHOE_IMG: Record<string, string> = {
  'White & Light Grey Chunky Sneakers': '/shoes/chunky-sneaker.png', 'Classic Low-Top Sneakers': '/shoes/classic-low-top-sneaker-white.png',
  'Casual Slip-on Loafers': '/shoes/casual-slipon-loafer.png', 'Slip-on Clog': '/shoes/Slip-on-clog.png', 'Winter Boots': '/shoes/winter-boot.png',
};
const WX_ICON: Record<string, string> = { Rain: '🌧️', Clouds: '☁️', Clear: '☀️', Drizzle: '🌦️', Thunderstorm: '⛈️', Snow: '❄️' };

function StylistCard() {
  const samples = stylist.samples;
  const [ci, setCi] = useState(0);
  const [oi, setOi] = useState(0);
  const s = samples[ci], o = s.outfits[Math.min(oi, s.outfits.length - 1)];
  const day = new Date(stylist.generated).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <div className="max-w-[600px] mx-auto rounded-2xl p-5 sm:p-6 border-2" style={{ borderColor: peach, backgroundColor: 'white' }}>
      {/* city = a different live-weather sample */}
      <div className="flex flex-wrap gap-2 mb-5" role="tablist" aria-label="Weather samples">
        {samples.map((x, i) => (
          <button key={x.city} role="tab" aria-selected={i === ci} onClick={() => { setCi(i); setOi(0); }}
            className="px-3 py-1.5 rounded-full text-[12px] font-semibold border transition-colors"
            style={i === ci ? { backgroundColor: navy, color: 'white', borderColor: navy } : { borderColor: peach, backgroundColor: cream }}>
            {x.city}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-full flex items-center justify-center text-[22px]" style={{ backgroundColor: peach }}>{WX_ICON[s.weather.condition] ?? '🌤️'}</span>
          <div>
            <p className="text-[13px] opacity-60">{s.city} · humidity {s.weather.humidity}%</p>
            <p className="text-[20px] font-semibold tracking-[-0.02em]">{s.weather.tempC}°C · {s.weather.condition}</p>
          </div>
        </div>
        <span className="px-3 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wider text-white" style={{ backgroundColor: navy }}>AI stylist</span>
      </div>
      {/* the 3 outfits the AI returned for this weather */}
      <div className="flex flex-wrap gap-2 mb-4">
        {s.outfits.map((x, i) => (
          <button key={i} onClick={() => setOi(i)} className="px-3 py-1 rounded-lg text-[12px] font-medium border"
            style={i === oi ? { borderColor: navy, color: navy, backgroundColor: `${peach}66` } : { borderColor: `${navy}22`, opacity: 0.7 }}>
            {x.vibe}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 mb-4">
        {[[`${M}/gon-tee.png`, `${s.item} · ${s.size}`], [BOTTOM_IMG[o.bottom], o.bottom], [SHOE_IMG[o.shoes], o.shoes]].map(([src, label], i) => (
          <figure key={i}>
            <div className="relative aspect-square rounded-xl overflow-hidden" style={{ backgroundColor: cream }}>
              {src && <Image src={src} alt={label} fill sizes="180px" className="object-contain p-2 mix-blend-multiply" />}
            </div>
            <figcaption className="text-[11px] mt-1.5 leading-tight opacity-80">{label}</figcaption>
          </figure>
        ))}
      </div>
      <div className="rounded-xl p-4 text-[14px] leading-relaxed space-y-2" style={{ backgroundColor: cream }}>
        <p>{o.reason}</p>
        <p className="opacity-75"><span className="font-semibold">Comfort: </span>{o.comfort}</p>
      </div>
    </div>
  );
}

// wardrobe card: front photo, back on hover
function Piece({ img, back, name, kind, sizes, className = '', big }: {
  img: string; back?: string; name: string; kind: string; sizes: string; className?: string; big?: boolean;
}) {
  return (
    <figure className={`group ${className}`}>
      <div className={`relative w-full ${big ? 'aspect-[4/5]' : 'aspect-square'} rounded-sm overflow-hidden`} style={{ backgroundColor: '#efe7da' }}>
        <Image src={`${M}/${img}.png`} alt={name} fill sizes={big ? '(min-width: 768px) 50vw, 100vw' : '(min-width: 768px) 25vw, 50vw'}
          className={`object-contain ${big ? 'p-10' : 'p-5'} transition-all duration-500 ${back ? 'group-hover:opacity-0 group-hover:scale-[1.03]' : 'group-hover:scale-[1.03]'}`} />
        {back && (
          <Image src={`${M}/${back}.png`} alt={`${name}, back`} fill sizes="(min-width: 768px) 25vw, 50vw"
            className="object-contain p-5 opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
        )}
      </div>
      <figcaption className="mt-3">
        <div className="flex justify-between gap-3 text-[15px] font-medium"><span>{name}</span><span className="opacity-70 whitespace-nowrap">{sizes}</span></div>
        <p className="text-[12px] opacity-50 mt-0.5">{kind} · TNT CO</p>
      </figcaption>
    </figure>
  );
}
