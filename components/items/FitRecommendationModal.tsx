// components/items/FitRecommendationModal.tsx
'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { ClothingItem } from '@/lib/types/clothing';
import type { ParametricAvatar } from '@/lib/types/avatar';
import { saveAvatar } from '@/lib/firebase/firestore';
import { useAuth } from '@/lib/contexts/AuthContext';

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  cream: '#F8F3EA', navy: '#0B1957', peach: '#FFDBD1', pink: '#FA9EBC',
  red: '#ef4444', green: '#10b981', orange: '#f59e0b',
};

// ─── 3D / morph constants (unchanged) ────────────────────────────────────────
const SIZE_DATA: Record<string, { chest: number; shoulder: number; length: number; sleeve: number }> = {
  S:     { chest: 54.5, shoulder: 43, length: 71, sleeve: 22   },
  M:     { chest: 57,   shoulder: 45, length: 73, sleeve: 23.5 },
  L:     { chest: 59.5, shoulder: 47, length: 75, sleeve: 25   },
  XL:    { chest: 62,   shoulder: 49, length: 77, sleeve: 26.5 },
  '2XL': { chest: 64.5, shoulder: 51, length: 79, sleeve: 28   },
  '3XL': { chest: 67,   shoulder: 53, length: 79, sleeve: 29.5 },
  '4XL': { chest: 69.5, shoulder: 55, length: 79, sleeve: 29.5 },
};
const BASE      = SIZE_DATA['S'];
const MAX       = SIZE_DATA['4XL'];
const cmToMorph = (v: number, b: number, m: number) => Math.max(0, Math.min(1, (v - b) / (m - b)));
const BODY_BASE = { height: 150, chest: 30, shoulder: 43, waist: 29 };
const BODY_MAX  = { height: 198, chest: 57, shoulder: 55, waist: 54 };
const bodyNorm  = (v: number, b: number, m: number) => Math.max(0, Math.min(1, (v - b) / (m - b)));
const ATLAS_SIZE    = 2048;
const FRONT_RECT    = { x: 0,    y: 0,    w: 1024, h: 1536 };
const BACK_RECT     = { x: 1024, y: 0,    w: 1024, h: 1536 };
const L_SLEEVE_RECT = { x: 0,    y: 1536, w: 1024, h: 512  };
const R_SLEEVE_RECT = { x: 1024, y: 1536, w: 1024, h: 512  };

// ─── Preset wardrobe — the ONLY items Gemini may pick from ───────────────────
// SHOES: add your own shoe photos to /public/shoes/ and reference here
// Each shoe needs: label (shown to AI), emoji (fallback), imageUrl (your photo)
const PRESET_BOTTOMS = [
  { id: 'b1', label: 'Baggy Wide-Leg Jeans',  emoji: '', tags: ['formal','rain','cold'] },
  { id: 'b2', label: 'Casual Sweatpants',           emoji: '', tags: ['casual','cold'] },
  { id: 'b3', label: 'Baggy Cargo Pants',          emoji: '', tags: ['casual','warm','smart'] },
  { id: 'b4', label: 'Wide-Leg Sweatpants',               emoji: '', tags: ['hot','casual'] },
  { id: 'b5', label: 'Pleated Wide-Leg Trousers',             emoji: '', tags: ['cold','casual','cosy'] },
  { id: 'b6', label: 'Casual Shorts',           emoji: '', tags: ['casual','rain','outdoor'] },
  { id: 'b7', label: 'Slacks',        emoji: '', tags: ['smart','casual','warm'] },
];



// ── ADD YOUR SHOE PHOTOS HERE ────────────────────────────────────────────────
// Put PNG/JPG files (no background) in /public/shoes/ then set imageUrl below.
// label = what Gemini sees; material/color/style helps Gemini choose correctly.
const PRESET_SHOES: { id: string; label: string; emoji: string; imageUrl: string | null; material: string; color: string }[] = [
  { id: 's1', label: 'White & Light Grey Chunky Sneakers',  emoji: '👟', imageUrl: '/shoes/chunky-sneaker.jpeg',  material: 'leather',  color: 'white light grey'  },
  { id: 's2', label: 'Classic Low-Top Sneakers',           emoji: '👟', imageUrl: '/shoes/classic-low-top-sneaker-white.jpeg', material: 'leather',     color: 'black'  },
  { id: 's3', label: 'Casual Slip-on Loafers',    emoji: '👞', imageUrl: '/shoes/casual-slipon-loafer.jpeg',           material: 'leather',  color: 'black'  },
  { id: 's4', label: 'Slip-on Clog',    emoji: '🥿', imageUrl: '/shoes/slip-on-clog.jpeg',   material: 'rubber',   color: 'white'  },
  { id: 's5', label: 'Winter Boots',      emoji: '🥾', imageUrl: '/shoes/winter-boot.jpeg',    material: 'suede',  color: 'brown'  },
];
// ─────────────────────────────────────────────────────────────────────────────

// ─── Weather helpers ──────────────────────────────────────────────────────────
const COND_META: Record<string, { label: string; emoji: string; bg: string; fg: string }> = {
  Clear:        { label: 'Sunny',    emoji: '☀️',  bg: '#FFF8E1', fg: '#b45309' },
  Clouds:       { label: 'Cloudy',   emoji: '☁️',  bg: '#F3F4F6', fg: '#4b5563' },
  Rain:         { label: 'Rainy',    emoji: '🌧️', bg: '#EFF6FF', fg: '#1d4ed8' },
  Drizzle:      { label: 'Drizzle',  emoji: '🌦️', bg: '#EFF6FF', fg: '#1d4ed8' },
  Thunderstorm: { label: 'Stormy',   emoji: '⛈️', bg: '#F5F3FF', fg: '#6d28d9' },
  Snow:         { label: 'Snowy',    emoji: '❄️',  bg: '#F0F9FF', fg: '#0284c7' },
  Mist:         { label: 'Misty',    emoji: '🌫️', bg: '#F9FAFB', fg: '#6b7280' },
  Haze:         { label: 'Hazy',     emoji: '🌫️', bg: '#F9FAFB', fg: '#6b7280' },
};
const condMeta = (c: string) => COND_META[c] ?? { label: c, emoji: '🌤️', bg: C.cream, fg: C.navy };
const tempMeta = (t: number) => {
  if (t >= 33) return { label: 'Very Hot', color: '#ef4444' };
  if (t >= 28) return { label: 'Hot',       color: '#f97316' };
  if (t >= 23) return { label: 'Warm',      color: '#eab308' };
  if (t >= 17) return { label: 'Mild',      color: '#22c55e' };
  if (t >= 10) return { label: 'Cool',      color: '#06b6d4' };
  return              { label: 'Cold',      color: '#6366f1' };
};

// ─── Gemini prompt ────────────────────────────────────────────────────────────
function buildPrompt(
  weather:  { tempC: number; condition: string; humidity: number },
  item:     ClothingItem,
  size:     string,
  profile:  ParametricAvatar | null,
): string {
  const row    = item.sizeChart.find(s => s.size === size) ?? item.sizeChart[0];
  let fitLine  = 'Body measurements unavailable.';
  let fitLabel = 'Unknown';
  if (row && profile) {
    const eC = parseFloat((row.chest - profile.chest).toFixed(1));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eW = (row as any).waist != null
      ? parseFloat(((row as any).waist - profile.waist).toFixed(1))
      : parseFloat((eC * 0.6).toFixed(1));
    const r = row.chest / profile.chest;
    fitLabel = r < 0.96 ? 'Tight' : r > 1.15 ? 'Loose' : 'Regular';
    fitLine = `Fit: ${fitLabel} (size ${size}) — chest ease ${eC >= 0 ? '+' : ''}${eC}cm, waist ease ${eW >= 0 ? '+' : ''}${eW}cm.`;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const color = (item as any).color ?? 'unknown color';
  return `You are a concise fashion stylist.

CONTEXT:
Weather: ${weather.tempC}°C, ${weather.condition}, humidity ${weather.humidity}%.
Shirt: "${item.name}" by ${item.brand} (${color}, ${item.category}).
${fitLine}

RULES:
- Only pick from the exact labels in ALLOWED LISTS. No other items.
- Return exactly 3 outfit combos with distinct vibes.
- "reason" ≤ 18 words. "comfort" ≤ 12 words.
- Output ONLY a valid JSON array, no markdown.

ALLOWED BOTTOMS: ${PRESET_BOTTOMS.map(b => b.label).join(' | ')}
ALLOWED SHOES: ${PRESET_SHOES.map(s => s.label).join(' | ')}
SHOE NOTES: ${PRESET_SHOES.map(s => `${s.label}: ${s.material}, ${s.color}`).join(' | ')}
ALLOWED SHOES: ${PRESET_SHOES.map(s => s.label).join(' | ')}

OUTPUT: [{"bottom":"...","shoes":"...","reason":"...","comfort":"...","vibe":"2-word style"}]`;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface Props {
  isOpen: boolean;
  onClose: () => void;
  item: ClothingItem;
  userProfile: ParametricAvatar | null;
}
type BodyDraft = { height: number; chest: number; waist: number; shoulder: number };
interface StyleOutfit { bottom: string; shoes: string; reason: string; comfort: string; vibe: string; }
interface WeatherData  { tempC: number; condition: string; humidity: number; city: string; }

// ─── Helper ───────────────────────────────────────────────────────────────────
const pEmoji = (label: string, list: { label: string; emoji: string }[]) =>
  list.find(x => x.label === label)?.emoji ?? '•';

// ══════════════════════════════════════════════════════════════════════════════
// STYLE SUGGESTIONS OVERLAY
// ══════════════════════════════════════════════════════════════════════════════
function StyleOverlay({
  item, userProfile, selectedSize, onBack,
}: { item: ClothingItem; userProfile: ParametricAvatar | null; selectedSize: string; onBack: () => void }) {

  const [locState,   setLocState]   = useState<'idle'|'requesting'|'granted'|'denied'|'manual'>('idle');
  const [manualCity, setManualCity] = useState('');
  const [weather,    setWeather]    = useState<WeatherData | null>(null);
  const [wxLoading,  setWxLoading]  = useState(false);
  const [wxError,    setWxError]    = useState<string | null>(null);
  const [outfits,    setOutfits]    = useState<StyleOutfit[]>([]);
  const [aiLoading,  setAiLoading]  = useState(false);
  const [aiError,    setAiError]    = useState<string | null>(null);
  const [generated,  setGenerated]  = useState(false);
  const [activeIdx,  setActiveIdx]  = useState(0);

  // Compute fit summary for display
  const fitInfo = (() => {
    const row = item.sizeChart.find(s => s.size === selectedSize) ?? item.sizeChart[0];
    if (!row || !userProfile) return null;
    const eC   = parseFloat((row.chest - userProfile.chest).toFixed(1));
    const r    = row.chest / userProfile.chest;
    const label = r < 0.96 ? 'Tight' : r > 1.15 ? 'Loose' : 'Regular';
    const col   = label === 'Tight' ? C.red : label === 'Loose' ? C.orange : C.green;
    return { label, col, eC };
  })();

  // Fetch weather by coords
  const fetchByCoords = useCallback(async (lat: number, lon: number) => {
    setWxLoading(true); setWxError(null);
    try {
      const key = process.env.NEXT_PUBLIC_OPENWEATHER_API_KEY;
      if (!key) throw new Error('Add NEXT_PUBLIC_OPENWEATHER_API_KEY to .env.local');
      const r   = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${key}`);
      if (!r.ok) throw new Error(`Weather API ${r.status}`);
      const d = await r.json();
      setWeather({ tempC: Math.round(d.main.temp), condition: d.weather[0]?.main ?? 'Clear', humidity: d.main.humidity, city: d.name });
      setLocState('granted');
    } catch (e: any) { setWxError(e.message); }
    finally { setWxLoading(false); }
  }, []);

  // Fetch weather by city name
  const fetchByCity = useCallback(async () => {
    if (!manualCity.trim()) return;
    setWxLoading(true); setWxError(null);
    try {
      const key = process.env.NEXT_PUBLIC_OPENWEATHER_API_KEY;
      if (!key) throw new Error('Add NEXT_PUBLIC_OPENWEATHER_API_KEY to .env.local');
      const r   = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(manualCity)}&units=metric&appid=${key}`);
      if (!r.ok) throw new Error('City not found — check spelling.');
      const d = await r.json();
      setWeather({ tempC: Math.round(d.main.temp), condition: d.weather[0]?.main ?? 'Clear', humidity: d.main.humidity, city: d.name });
      setLocState('granted');
    } catch (e: any) { setWxError(e.message); }
    finally { setWxLoading(false); }
  }, [manualCity]);

  const requestLocation = useCallback(() => {
    setLocState('requesting');
    if (!navigator.geolocation) { setLocState('manual'); return; }
    navigator.geolocation.getCurrentPosition(
      pos => fetchByCoords(pos.coords.latitude, pos.coords.longitude),
      ()  => setLocState('denied'),
      { timeout: 10_000 },
    );
  }, [fetchByCoords]);

  // Generate with Gemini
  const handleGenerate = useCallback(async () => {
    if (!weather) return;
    setAiLoading(true); setAiError(null); setOutfits([]); setGenerated(false);
    const prompt = buildPrompt(weather, item, selectedSize, userProfile);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts: any[] = [{ text: prompt }];
    const imgUrl = item.frontImageUrl || item.imageUrl;
    if (imgUrl) {
      try {
        const blob   = await fetch(imgUrl).then(r => r.blob());
        const base64 = await new Promise<string>((res, rej) => {
          const reader = new FileReader();
          reader.onloadend = () => res((reader.result as string).split(',')[1]);
          reader.onerror = rej; reader.readAsDataURL(blob);
        });
        parts.push({ inlineData: { mimeType: blob.type || 'image/jpeg', data: base64 } });
      } catch { /* text-only fallback */ }
    }
    try {
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw new Error('Add GEMINI_API_KEY to .env.local');
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${key}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.7, maxOutputTokens: 1024 } }) }
      );
      const data = await res.json();
      const raw  = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      setOutfits(JSON.parse(raw.replace(/```json|```/g, '').trim()));
      setGenerated(true); setActiveIdx(0);
    } catch (e: any) { setAiError('Could not generate. Check API keys in .env.local'); }
    finally { setAiLoading(false); }
  }, [weather, item, selectedSize, userProfile]);

  const wx  = weather ? condMeta(weather.condition) : null;
  const tmp = weather ? tempMeta(weather.tempC)     : null;

  return (
    /* Full overlay — covers the entire modal */
    <div className="absolute inset-0 z-50 flex flex-col overflow-hidden rounded-2xl"
      style={{ backgroundColor: C.cream }}>

      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-3 px-5 py-4"
        style={{ background: `linear-gradient(135deg, ${C.navy} 0%, #1a2f7a 100%)` }}>

        <button onClick={onBack}
          className="w-8 h-8 rounded-full flex items-center justify-center transition-all hover:bg-white/20 text-white font-bold text-lg flex-shrink-0">
          ←
        </button>

        {/* Shirt thumbnail */}
        <div className="w-10 h-10 rounded-xl overflow-hidden border-2 border-white/20 flex-shrink-0">
          {(item.frontImageUrl || item.imageUrl)
            ? <img src={item.frontImageUrl || item.imageUrl} alt="" className="w-full h-full object-cover" crossOrigin="anonymous" />
            : <div className="w-full h-full flex items-center justify-center text-xl"
                style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}>👕</div>}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-[9px] font-bold text-white/50 uppercase tracking-widest">AI Style Suggestions</p>
          <p className="text-sm font-black text-white truncate">{item.name}</p>
        </div>

        {/* Weather pill in header when ready */}
        {weather && wx && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl flex-shrink-0"
            style={{ backgroundColor: wx.bg }}>
            <span className="text-sm leading-none">{wx.emoji}</span>
            <span className="text-xs font-black tabular-nums" style={{ color: wx.fg }}>{weather.tempC}°C</span>
            <span className="text-[10px] font-medium" style={{ color: wx.fg, opacity: 0.7 }}>{weather.city}</span>
          </div>
        )}
      </div>

      {/* ── SCROLLABLE BODY ────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">

        {/* ── SECTION 1: WEATHER ────────────────────────────────────────── */}
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black text-white flex-shrink-0"
              style={{ backgroundColor: weather ? C.green : C.navy }}>
              {weather ? '✓' : '1'}
            </div>
            <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: C.navy }}>
              Current Weather
            </p>
          </div>

          {/* IDLE — ask for location */}
          {!weather && locState === 'idle' && (
            <div className="rounded-2xl p-5 flex flex-col items-center gap-4 text-center border-2 border-dashed"
              style={{ borderColor: C.peach }}>
              <div className="text-4xl">🌍</div>
              <div>
                <p className="text-sm font-black" style={{ color: C.navy }}>Where are you today?</p>
                <p className="text-[11px] text-gray-400 mt-0.5">Used only to fetch weather — never stored</p>
              </div>
              <div className="flex gap-2 w-full">
                <button onClick={requestLocation}
                  className="flex-1 py-2.5 rounded-xl font-bold text-xs text-white hover:opacity-90 transition-all"
                  style={{ backgroundColor: C.navy }}>
                  📍 Use My Location
                </button>
                <button onClick={() => setLocState('manual')}
                  className="flex-1 py-2.5 rounded-xl font-bold text-xs border hover:opacity-80 transition-all"
                  style={{ borderColor: C.peach, color: C.navy, backgroundColor: 'white' }}>
                  ✏️ Enter City
                </button>
              </div>
            </div>
          )}

          {/* Requesting geolocation */}
          {locState === 'requesting' && (
            <div className="flex items-center gap-3 py-4 px-4 rounded-xl" style={{ backgroundColor: 'white' }}>
              <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin flex-shrink-0"
                style={{ borderColor: C.navy, borderTopColor: 'transparent' }} />
              <p className="text-xs text-gray-500">Requesting location permission…</p>
            </div>
          )}

          {/* Manual city input */}
          {(locState === 'denied' || locState === 'manual') && !weather && (
            <div className="space-y-2">
              {locState === 'denied' && (
                <p className="text-[10px] text-center text-gray-400 py-1">
                  Location access denied. Enter your city below.
                </p>
              )}
              <div className="flex gap-2">
                <input type="text" value={manualCity}
                  onChange={e => setManualCity(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && fetchByCity()}
                  placeholder="e.g. Kuala Lumpur, Singapore, Jakarta…"
                  className="flex-1 px-3 py-2.5 rounded-xl border text-xs focus:outline-none focus:ring-2"
                  style={{ borderColor: C.peach, backgroundColor: 'white', color: C.navy,
                           outlineColor: C.navy }} />
                <button onClick={fetchByCity} disabled={wxLoading || !manualCity.trim()}
                  className="px-4 py-2.5 rounded-xl font-bold text-xs text-white transition-all disabled:opacity-40"
                  style={{ backgroundColor: C.navy }}>
                  {wxLoading ? '…' : 'Go →'}
                </button>
              </div>
              {wxError && <p className="text-[10px] text-red-500 pl-1">{wxError}</p>}
            </div>
          )}

          {/* Fetching weather spinner */}
          {wxLoading && locState !== 'manual' && !weather && (
            <div className="flex items-center gap-3 py-4 px-4 rounded-xl" style={{ backgroundColor: 'white' }}>
              <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin flex-shrink-0"
                style={{ borderColor: C.navy, borderTopColor: 'transparent' }} />
              <p className="text-xs text-gray-500">Fetching weather data…</p>
            </div>
          )}

          {/* Weather cards — shown when ready */}
          {weather && wx && tmp && (
            <div className="grid grid-cols-4 gap-2">
              {/* Temp */}
              <div className="rounded-xl p-3 text-center border-2" style={{ backgroundColor: 'white', borderColor: C.peach }}>
                <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 mb-1">Temp</p>
                <p className="text-2xl font-black tabular-nums leading-none" style={{ color: tmp.color }}>{weather.tempC}°</p>
                <p className="text-[8px] font-bold mt-1" style={{ color: tmp.color }}>{tmp.label}</p>
              </div>
              {/* Sky */}
              <div className="rounded-xl p-3 text-center border-2" style={{ backgroundColor: wx.bg, borderColor: C.peach }}>
                <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 mb-1">Sky</p>
                <p className="text-2xl leading-none">{wx.emoji}</p>
                <p className="text-[8px] font-bold mt-1" style={{ color: wx.fg }}>{wx.label}</p>
              </div>
              {/* Humidity */}
              <div className="rounded-xl p-3 text-center border-2" style={{ backgroundColor: 'white', borderColor: C.peach }}>
                <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 mb-1">Humid</p>
                <p className="text-2xl font-black tabular-nums leading-none" style={{ color: C.navy }}>{weather.humidity}%</p>
                <p className="text-[8px] font-bold mt-1 text-gray-400">
                  {weather.humidity > 80 ? 'V.Humid' : weather.humidity > 60 ? 'Humid' : 'OK'}
                </p>
              </div>
              {/* City */}
              <div className="rounded-xl p-3 text-center border-2" style={{ backgroundColor: 'white', borderColor: C.peach }}>
                <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 mb-1">City</p>
                <p className="text-xl leading-none">📍</p>
                <p className="text-[8px] font-black mt-1 truncate" style={{ color: C.navy }}>{weather.city}</p>
              </div>
            </div>
          )}
          {weather && (
            <button onClick={() => { setWeather(null); setLocState('manual'); setManualCity(''); setGenerated(false); setOutfits([]); }}
              className="mt-2 text-[9px] text-gray-400 hover:text-gray-600 underline pl-1">
              Change location
            </button>
          )}
        </div>

        {/* ── SECTION 2: SHIRT + FIT CONTEXT ──────────────────────────── */}
        <div className="px-5 pb-3">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black text-white flex-shrink-0"
              style={{ backgroundColor: C.navy }}>2</div>
            <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: C.navy }}>
              Shirt &amp; Fit Context
            </p>
          </div>

          <div className="rounded-2xl border-2 p-3 flex gap-3 items-center"
            style={{ backgroundColor: 'white', borderColor: C.peach }}>
            {/* Shirt image */}
            <div className="w-16 h-16 rounded-xl overflow-hidden border flex-shrink-0"
              style={{ borderColor: C.peach }}>
              {(item.frontImageUrl || item.imageUrl)
                ? <img src={item.frontImageUrl || item.imageUrl} alt={item.name}
                    className="w-full h-full object-cover" crossOrigin="anonymous" />
                : <div className="w-full h-full flex items-center justify-center text-2xl"
                    style={{ backgroundColor: C.cream }}>👕</div>}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400">{item.brand}</p>
              <p className="text-xs font-black truncate" style={{ color: C.navy }}>{item.name}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">Size {selectedSize} · {item.category}</p>
            </div>

            {/* Fit badge */}
            {fitInfo && (
              <div className="flex-shrink-0 text-right">
                <span className="inline-block text-[10px] font-black px-2.5 py-1 rounded-full"
                  style={{ backgroundColor: fitInfo.col + '20', color: fitInfo.col }}>
                  ● {fitInfo.label}
                </span>
                <p className="text-[9px] text-gray-400 mt-0.5">
                  {fitInfo.eC >= 0 ? '+' : ''}{fitInfo.eC}cm chest ease
                </p>
              </div>
            )}
          </div>

          {/* Fit explanation */}
          {fitInfo && (
            <div className="mt-2 px-3 py-2 rounded-xl text-[10px] leading-relaxed"
              style={{ backgroundColor: fitInfo.col + '12', color: fitInfo.col === C.green ? '#166534' : fitInfo.col === C.orange ? '#7c2d12' : '#7f1d1d' }}>
              {fitInfo.label === 'Tight'
                ? '⚠️ Snug fit — AI will consider movement ease when picking bottoms.'
                : fitInfo.label === 'Loose'
                ? '🌬️ Relaxed/oversized — AI will balance proportions with fitted bottoms.'
                : '✅ Great fit — AI has maximum flexibility in outfit choices.'}
            </div>
          )}
        </div>

        {/* ── GENERATE BUTTON ──────────────────────────────────────────── */}
        {!generated && (
          <div className="px-5 pb-4">
            <button onClick={handleGenerate} disabled={!weather || aiLoading}
              className="w-full py-4 rounded-2xl font-black text-sm text-white flex items-center justify-center gap-2.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background:  weather ? `linear-gradient(135deg, ${C.navy}, #2a3f9a)` : '#9ca3af',
                boxShadow:   weather ? `0 6px 24px ${C.navy}50` : 'none',
              }}>
              {aiLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Analysing style…
                </>
              ) : (
                <>
                  <span className="text-base">✨</span>
                  Generate Outfit Suggestions
                  {!weather && <span className="text-[10px] opacity-60 font-normal">(set location first)</span>}
                </>
              )}
            </button>
            {aiError && (
              <p className="text-[10px] text-red-500 text-center mt-2">{aiError}</p>
            )}
          </div>
        )}

        {/* Loading skeletons */}
        {aiLoading && (
          <div className="px-5 pb-4 space-y-3">
            {[0,1,2].map(i => (
              <div key={i} className="h-24 rounded-2xl animate-pulse" style={{ backgroundColor: C.peach, animationDelay: `${i * 0.1}s` }} />
            ))}
          </div>
        )}

        {/* ── OUTFIT CARDS ─────────────────────────────────────────────── */}
        {generated && outfits.length > 0 && (
          <div className="px-5 pb-6">

            {/* Vibe tab switcher */}
            <div className="flex gap-1.5 mb-4 p-1 rounded-2xl" style={{ backgroundColor: C.peach }}>
              {outfits.map((o, i) => (
                <button key={i} onClick={() => setActiveIdx(i)}
                  className="flex-1 py-2 rounded-xl font-bold text-[11px] transition-all"
                  style={{
                    backgroundColor: activeIdx === i ? C.navy : 'transparent',
                    color:           activeIdx === i ? 'white' : C.navy,
                    boxShadow:       activeIdx === i ? `0 2px 8px ${C.navy}40` : 'none',
                  }}>
                  {o.vibe}
                </button>
              ))}
            </div>

            {/* Active outfit card */}
            {(() => {
              const o = outfits[activeIdx];
              if (!o) return null;
              const isTop = activeIdx === 0;
              return (
                <div className="rounded-2xl overflow-hidden border-2 transition-all"
                  style={{ borderColor: isTop ? C.navy : C.peach, boxShadow: isTop ? `0 8px 32px ${C.navy}25` : 'none' }}>

                  {/* Card header with vibe + weather context */}
                  <div className="px-4 py-3.5 flex items-center justify-between"
                    style={{ background: isTop ? `linear-gradient(135deg, ${C.navy}, #1a2f7a)` : C.cream }}>
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest mb-0.5"
                        style={{ color: isTop ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.4)' }}>
                        Outfit {activeIdx + 1} of {outfits.length}
                      </p>
                      <p className="text-lg font-black leading-tight"
                        style={{ color: isTop ? 'white' : C.navy }}>
                        {o.vibe}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {weather && wx && (
                        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1"
                          style={{ backgroundColor: isTop ? 'rgba(255,255,255,0.15)' : 'white', color: isTop ? 'white' : C.navy }}>
                          {wx.emoji} {weather.tempC}°C
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Three item rows */}
                  <div className="p-3 space-y-2" style={{ backgroundColor: 'white' }}>

                    {/* ── OUTFIT VISUAL COMBO: shirt + bottom + shoes side by side ── */}
                    <div className="rounded-xl overflow-hidden border" style={{ borderColor: C.peach }}>
                      <p className="text-[8px] font-black uppercase tracking-widest text-center py-1 text-gray-400"
                        style={{ backgroundColor: C.cream }}>Full Outfit Preview</p>
                      <div className="grid grid-cols-3 gap-0.5 p-2" style={{ backgroundColor: C.cream }}>

                        {/* Shirt — user's uploaded photo */}
                        <div className="flex flex-col items-center gap-1">
                          <div className="w-full aspect-square rounded-lg overflow-hidden border bg-white"
                            style={{ borderColor: C.peach }}>
                            {(item.frontImageUrl || item.imageUrl)
                              ? <img src={item.frontImageUrl || item.imageUrl} alt="Shirt"
                                  className="w-full h-full object-contain p-1" crossOrigin="anonymous" />
                              : <div className="w-full h-full flex items-center justify-center text-2xl bg-white">👕</div>}
                          </div>
                          <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">Shirt</p>
                        </div>

                        {/* Bottom — emoji + label (no photo for bottoms) */}
                        <div className="flex flex-col items-center gap-1">
                          <div className="w-full aspect-square rounded-lg border bg-white flex flex-col items-center justify-center gap-1 px-1"
                            style={{ borderColor: C.peach }}>
                            <span className="text-2xl">{pEmoji(o.bottom, PRESET_BOTTOMS)}</span>
                            <p className="text-[8px] font-bold text-center leading-tight" style={{ color: C.navy }}>
                              {o.bottom.replace(' pants','').replace(' jeans','').replace(' shorts','').replace(' chinos','').replace(' sweatpants','')}
                            </p>
                          </div>
                          <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">Bottom</p>
                        </div>

                        {/* Shoes — real photo if available */}
                        <div className="flex flex-col items-center gap-1">
                          <div className="w-full aspect-square rounded-lg border bg-white flex items-center justify-center overflow-hidden"
                            style={{ borderColor: C.peach }}>
                            {(() => {
                              const shoe = PRESET_SHOES.find(s => s.label === o.shoes);
                              return shoe?.imageUrl
                                ? <img src={shoe.imageUrl} alt={shoe.label}
                                    className="w-full h-full object-contain p-1" crossOrigin="anonymous" />
                                : <span className="text-2xl">{pEmoji(o.shoes, PRESET_SHOES)}</span>;
                            })()}
                          </div>
                          <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">Shoes</p>
                        </div>
                      </div>
                    </div>

                    {/* Text details */}
                    {[
                      { cat: 'Bottom', val: o.bottom,    list: PRESET_BOTTOMS },
                      { cat: 'Shoes',  val: o.shoes,     list: PRESET_SHOES },
                    ].map(row => (
                      <div key={row.cat} className="flex items-center gap-3 px-3 py-2 rounded-xl"
                        style={{ backgroundColor: C.cream }}>
                        <span className="text-lg w-7 text-center flex-shrink-0">
                          {pEmoji(row.val, row.list)}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">{row.cat}</p>
                          <p className="text-xs font-bold truncate" style={{ color: C.navy }}>{row.val}</p>
                        </div>
                        <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[9px]"
                          style={{ backgroundColor: '#dcfce7', color: '#166534' }}>✓</div>
                      </div>
                    ))}
                  </div>

                  {/* Why it works + Comfort note */}
                  <div className="px-3 pb-3 pt-2 space-y-2" style={{ backgroundColor: 'white' }}>
                    <div className="rounded-xl px-3 py-2.5 border" style={{ backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' }}>
                      <p className="text-[8px] font-black uppercase tracking-widest text-green-700 mb-1">💬 Why it works</p>
                      <p className="text-[11px] leading-relaxed text-green-900">{o.reason}</p>
                    </div>
                    <div className="rounded-xl px-3 py-2.5 border" style={{ backgroundColor: '#fffbeb', borderColor: '#fde68a' }}>
                      <p className="text-[8px] font-black uppercase tracking-widest text-amber-700 mb-1">🌡️ Comfort note</p>
                      <p className="text-[11px] leading-relaxed text-amber-900">{o.comfort}</p>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Dot nav + Regenerate */}
            <div className="flex items-center gap-3 mt-4">
              <button onClick={() => setActiveIdx(i => Math.max(0, i - 1))} disabled={activeIdx === 0}
                className="w-8 h-8 rounded-lg flex items-center justify-center border font-bold text-sm transition-all disabled:opacity-30"
                style={{ borderColor: C.peach, color: C.navy }}>‹</button>
              <div className="flex gap-1.5 flex-1 justify-center">
                {outfits.map((_, i) => (
                  <button key={i} onClick={() => setActiveIdx(i)}
                    className="rounded-full transition-all"
                    style={{ width: activeIdx === i ? '18px' : '6px', height: '6px', backgroundColor: activeIdx === i ? C.navy : C.peach }} />
                ))}
              </div>
              <button onClick={() => setActiveIdx(i => Math.min(outfits.length - 1, i + 1))}
                disabled={activeIdx === outfits.length - 1}
                className="w-8 h-8 rounded-lg flex items-center justify-center border font-bold text-sm transition-all disabled:opacity-30"
                style={{ borderColor: C.peach, color: C.navy }}>›</button>
            </div>

            <button onClick={handleGenerate} disabled={aiLoading}
              className="w-full mt-3 py-2.5 rounded-xl font-bold text-xs border flex items-center justify-center gap-2 transition-all hover:opacity-80 disabled:opacity-40"
              style={{ borderColor: C.navy, color: C.navy }}>
              {aiLoading
                ? <><div className="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin"
                    style={{ borderColor: C.navy, borderTopColor: 'transparent' }} />Regenerating…</>
                : '🔄 Regenerate suggestions'}
            </button>
          </div>
        )}

        {/* Preset wardrobe reference — collapsible */}
        <details className="mx-5 mb-6 rounded-2xl border-2 overflow-hidden" style={{ borderColor: C.peach }}>
          <summary className="cursor-pointer select-none px-4 py-3 flex items-center justify-between text-[10px] font-black uppercase tracking-widest"
            style={{ backgroundColor: C.cream, color: C.navy }}>
            <span>👔 Preset wardrobe AI picks from</span>
            <span className="text-gray-400 font-normal normal-case text-[9px]">bottoms &amp; shoes only</span>
          </summary>
          <div className="p-4 grid grid-cols-2 gap-6" style={{ backgroundColor: 'white' }}>
            {/* Bottoms */}
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: C.navy }}>👖 Bottoms</p>
              {PRESET_BOTTOMS.map(x => (
                <div key={x.id} className="flex items-center gap-1.5 py-0.5">
                  <span className="text-xs">{x.emoji}</span>
                  <span className="text-[9px]" style={{ color: C.navy }}>{x.label}</span>
                </div>
              ))}
            </div>
            {/* Shoes with photos */}
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: C.navy }}>👟 Shoes</p>
              {PRESET_SHOES.map(x => (
                <div key={x.id} className="flex items-center gap-2 py-1">
                  <div className="w-8 h-8 rounded-lg overflow-hidden border flex-shrink-0 bg-white flex items-center justify-center"
                    style={{ borderColor: C.peach }}>
                    {x.imageUrl
                      ? <img src={x.imageUrl} alt={x.label} className="w-full h-full object-contain p-0.5" crossOrigin="anonymous" />
                      : <span className="text-sm">{x.emoji}</span>}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[9px] font-bold truncate" style={{ color: C.navy }}>{x.label}</p>
                    <p className="text-[8px] text-gray-400 truncate">{x.material} · {x.color}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </details>

      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT — FitRecommendationModal (3D scene unchanged)
// ══════════════════════════════════════════════════════════════════════════════
export default function FitRecommendationModal({ isOpen, onClose, item, userProfile }: Props) {
  const { user } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef  = useRef<{
    renderer: { dispose: () => void };
    animId: ReturnType<typeof requestAnimationFrame>;
    applySize: (s: string) => void;
    updateBody: (b: BodyDraft) => void;
    ro: ResizeObserver;
  } | null>(null);

  const [selectedSize,  setSelectedSize]  = useState<string>('M');
  const [fitStatus,     setFitStatus]     = useState<{ text: string; color: string } | null>(null);
  const [modelLoading,  setModelLoading]  = useState(true);
  const [sceneReady,    setSceneReady]    = useState(false);
  const [showStyleOverlay, setShowStyleOverlay] = useState(false);  // ← NEW

  // Body slider state
  const [showBodyPanel, setShowBodyPanel] = useState(false);
  const [bodyDraft,   setBodyDraft]   = useState<BodyDraft>({ height: userProfile?.height ?? 170, chest: userProfile?.chest ?? 90, waist: userProfile?.waist ?? 75, shoulder: userProfile?.shoulder ?? 44 });
  const [savedBody,   setSavedBody]   = useState<BodyDraft>({ ...bodyDraft });
  const [savingBody,  setSavingBody]  = useState(false);
  const [bodySavedOk, setBodySavedOk] = useState(false);

  // Sync body from profile
  useEffect(() => {
    if (!userProfile) return;
    const b: BodyDraft = { height: userProfile.height, chest: userProfile.chest, waist: userProfile.waist, shoulder: userProfile.shoulder };
    setBodyDraft(b); setSavedBody(b);
  }, [userProfile]);

  useEffect(() => { sceneRef.current?.updateBody(bodyDraft); }, [bodyDraft]);

  // Fit status
  useEffect(() => {
    if (!userProfile || !selectedSize) return;
    const sd = item.sizeChart.find(s => s.size === selectedSize);
    if (!sd) return;
    const r = sd.chest / userProfile.chest;
    setFitStatus(r < 0.96 ? { text: 'Tight', color: C.red } : r > 1.15 ? { text: 'Loose', color: C.orange } : { text: 'Just Right', color: C.green });
  }, [selectedSize, userProfile, item]);

  // ── Three.js scene (identical to original) ────────────────────────────────
  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;
    let cancelled = false;
    setModelLoading(true); setSceneReady(false);

    Promise.all([
      import('three'),
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/controls/OrbitControls.js'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ]).then(([THREE, { GLTFLoader }, { OrbitControls }]: any[]) => {
      if (cancelled || !canvasRef.current) return;
      const canvas = canvasRef.current;
      const W = canvas.clientWidth || 560, H = canvas.clientHeight || 560;
      const scene  = new THREE.Scene(); scene.background = new THREE.Color(0x0d0d1a);
      const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100); camera.position.set(0, 1.0, 3.2);
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setSize(W, H, false); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true; controls.autoRotate = true; controls.autoRotateSpeed = 3.5;
      controls.minDistance = 1.5; controls.maxDistance = 6;
      scene.add(new THREE.AmbientLight(0xffffff, 0.9));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(3, 4, 2); scene.add(key);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fill = new THREE.DirectionalLight(0xaaccff, 0.4); fill.position.set(-3, 0, -2); scene.add(fill);

      const atlasCanvas = document.createElement('canvas'); atlasCanvas.width = atlasCanvas.height = ATLAS_SIZE;
      const atlasCtx = atlasCanvas.getContext('2d', { willReadFrequently: true })!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let atlasTexture: any = null, morphMesh: any = null, bodyMesh: any = null;
      let frontImg: HTMLImageElement | null = null, backImg: HTMLImageElement | null = null;

      function processShirtTexture(ctx: CanvasRenderingContext2D, img: HTMLImageElement, rect: typeof FRONT_RECT, isFront: boolean) {
        const tmp = document.createElement('canvas'); tmp.width = img.width; tmp.height = img.height;
        const tCtx = tmp.getContext('2d')!; tCtx.drawImage(img, 0, 0);
        const data = tCtx.getImageData(0, 0, tmp.width, tmp.height).data;
        let minX = img.width, minY = img.height, maxX = 0, maxY = 0, found = false;
        for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
          const i = (y * img.width + x) * 4;
          if (data[i+3] > 20 && (data[i] < 250 || data[i+1] < 250 || data[i+2] < 250)) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; found = true; }
        }
        if (!found) return;
        const sw = maxX - minX, sh = maxY - minY, ss = Math.min(sw * 0.25, 200);
        const pat = document.createElement('canvas'); pat.width = pat.height = ss;
        const pCtx = pat.getContext('2d')!;
        pCtx.drawImage(img, minX + sw*0.5 - ss/2, minY + sh*0.6 - ss/2, ss, ss, 0, 0, ss, ss);
        ctx.fillStyle = ctx.createPattern(pat, 'repeat')!;
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        if (isFront) { ctx.fillRect(L_SLEEVE_RECT.x, L_SLEEVE_RECT.y, L_SLEEVE_RECT.w, L_SLEEVE_RECT.h); ctx.fillRect(R_SLEEVE_RECT.x, R_SLEEVE_RECT.y, R_SLEEVE_RECT.w, R_SLEEVE_RECT.h); }
        const tw = sw * 0.8;
        ctx.drawImage(img, minX + (sw-tw)/2, minY, tw, sh, rect.x, rect.y, rect.w, rect.h);
      }
      function rebuildAtlas() {
        atlasCtx.fillStyle = '#ffffff'; atlasCtx.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
        if (frontImg) processShirtTexture(atlasCtx, frontImg, FRONT_RECT, true);
        if (backImg)  processShirtTexture(atlasCtx, backImg,  BACK_RECT,  false);
        if (!atlasTexture) { atlasTexture = new THREE.CanvasTexture(atlasCanvas); atlasTexture.flipY = false; atlasTexture.colorSpace = THREE.SRGBColorSpace; } else { atlasTexture.needsUpdate = true; }
        if (morphMesh) { morphMesh.material.map = atlasTexture; morphMesh.material.needsUpdate = true; }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function setShirtMorph(prefix: string, value: number, mesh: any) { if (!mesh?.morphTargetDictionary) return; const k = Object.keys(mesh.morphTargetDictionary).find((k: string) => k === prefix || k.startsWith(prefix)); if (k) mesh.morphTargetInfluences[mesh.morphTargetDictionary[k]] = value; }
      function applySize(size: string) { const d = SIZE_DATA[size]; if (!d) return; setShirtMorph('CHEST_WIDE', cmToMorph(d.chest, BASE.chest, MAX.chest), morphMesh); setShirtMorph('SHOULDER_WIDE', cmToMorph(d.shoulder, BASE.shoulder, MAX.shoulder), morphMesh); setShirtMorph('LEN_LONG', cmToMorph(d.length, BASE.length, MAX.length), morphMesh); setShirtMorph('SLEEVE_LONG', cmToMorph(d.sleeve, BASE.sleeve, MAX.sleeve), morphMesh); }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function setBodyMorph(prefix: string, value: number, mesh: any) { if (!mesh?.morphTargetDictionary) return; const k = (Object.keys(mesh.morphTargetDictionary) as string[]).find(k => k === prefix || k.toLowerCase().startsWith(prefix.toLowerCase())); if (k) mesh.morphTargetInfluences[mesh.morphTargetDictionary[k]] = value; }
      function updateBody(b: BodyDraft) { if (!bodyMesh) return; setBodyMorph('CHEST_WIDE', bodyNorm(b.chest, BODY_BASE.chest, BODY_MAX.chest) * 3.0, bodyMesh); setBodyMorph('SHOULDER_WIDE', bodyNorm(b.shoulder, BODY_BASE.shoulder, BODY_MAX.shoulder) * 0.5, bodyMesh); setBodyMorph('HEIGHT', bodyNorm(b.height, BODY_BASE.height, BODY_MAX.height) * 0.8, bodyMesh); setBodyMorph('WAIST_WIDE', bodyNorm(b.waist, BODY_BASE.waist, BODY_MAX.waist) * 10.0, bodyMesh); setBodyMorph('HIP_WIDE', Math.min(bodyNorm(b.chest, BODY_BASE.chest, BODY_MAX.chest) * 0.4, 1) * 2.0, bodyMesh); setBodyMorph('BODY_LENGTH', 1.5, bodyMesh); }

      const loader = new GLTFLoader();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      loader.load('/models/fitcheck_human3d_shirt3dnew.glb?v=' + Date.now(), (gltf: any) => {
        if (cancelled) return;
        const model = gltf.scene;
        model.position.sub(new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3()));
        scene.add(model);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        model.traverse((obj: any) => {
          if (!obj.isMesh || !obj.morphTargetDictionary) return;
          const lkeys = Object.keys(obj.morphTargetDictionary).map((k: string) => k.toLowerCase());
          if (!morphMesh && lkeys.some((k: string) => k.includes('len_long') || k.includes('chest_wide'))) { morphMesh = obj; obj.material = new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide }); rebuildAtlas(); applySize(selectedSize); if (sceneRef.current) sceneRef.current.applySize = applySize; setSceneReady(true); }
          if (!bodyMesh && lkeys.some((k: string) => k.includes('body_length') || (k.includes('height') && k.includes('body')))) { bodyMesh = obj; if (sceneRef.current) sceneRef.current.updateBody = updateBody; }
        });
        setModelLoading(false);
      }, undefined, () => setModelLoading(false));

      const loadImg = (url: string, cb: (img: HTMLImageElement) => void) => { const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => { cb(img); rebuildAtlas(); }; img.src = url; };
      if (item.frontImageUrl) loadImg(item.frontImageUrl, img => { frontImg = img; });
      if (item.backImageUrl)  loadImg(item.backImageUrl,  img => { backImg  = img; });
      else if (item.imageUrl) loadImg(item.imageUrl,      img => { frontImg = img; });

      let animId: ReturnType<typeof requestAnimationFrame> = 0;
      const animate = () => { animId = requestAnimationFrame(animate); controls.update(); if (bodyMesh) setBodyMorph('BODY_LENGTH', 1.5, bodyMesh); renderer.render(scene, camera); };
      animate();
      const ro = new ResizeObserver(() => { const w = canvas.clientWidth, h = canvas.clientHeight; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false); });
      ro.observe(canvas);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sceneRef.current = { renderer, animId, applySize, updateBody: (b: BodyDraft) => updateBody(b), ro };
    });
    return () => { cancelled = true; if (sceneRef.current) { cancelAnimationFrame(sceneRef.current.animId); sceneRef.current.renderer.dispose(); sceneRef.current.ro.disconnect(); sceneRef.current = null; } setSceneReady(false); setModelLoading(true); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => { sceneRef.current?.applySize(selectedSize); }, [selectedSize]);

  const handleSaveBodyPermanently = async () => {
    if (!user) return; setSavingBody(true);
    try { await saveAvatar({ userId: user.uid, ...bodyDraft } as any); setSavedBody({ ...bodyDraft }); setBodySavedOk(true); setTimeout(() => setBodySavedOk(false), 2500); }
    finally { setSavingBody(false); }
  };
  const handleApplySession = () => { setBodySavedOk(true); setTimeout(() => setBodySavedOk(false), 1500); setShowBodyPanel(false); };
  const handleResetBody    = () => { setBodyDraft({ ...savedBody }); };

  if (!isOpen) return null;
  const sizeButtons = item.sizeChart.length > 0 ? item.sizeChart.map(s => s.size) : Object.keys(SIZE_DATA);
  const hasSleve    = item.sizeChart.some(s => (s as any).sleeve !== undefined);

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-50 p-3">

      {/* Outer shell — position:relative so overlay fills it */}
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[90vh] flex overflow-hidden relative">

        {/* ══ LEFT: 3D canvas ══════════════════════════════════════════════ */}
        <div className="flex-1 bg-[#0d0d1a] relative flex flex-col min-w-0">
          {modelLoading && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-[#0d0d1a]">
              <div className="w-12 h-12 border-4 border-t-transparent border-blue-400 rounded-full animate-spin" />
              <p className="text-blue-300 text-sm font-bold tracking-widest uppercase animate-pulse">Loading 3D Model...</p>
            </div>
          )}
          <canvas ref={canvasRef} className="w-full flex-1" style={{ display: 'block', minHeight: 0 }} />

          {/* Body size panel */}
          {showBodyPanel && (
            <div className="absolute bottom-[88px] left-3 z-30 rounded-2xl border border-white/15 shadow-2xl"
              style={{ backgroundColor: 'rgba(10,10,26,0.96)', backdropFilter: 'blur(12px)', width: '260px' }}>
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10">
                <p className="text-[11px] font-black text-white uppercase tracking-widest">⚙️ Body Size</p>
                <button onClick={() => setShowBodyPanel(false)} className="text-white/40 hover:text-white text-xl leading-none transition-colors">×</button>
              </div>
              <div className="p-3 space-y-3">
                {([
                  { key: 'height',   label: 'Height',   min: 150, max: 198, unit: 'cm' },
                  { key: 'chest',    label: 'Chest',    min: 50,  max: 150, unit: 'cm' },
                  { key: 'waist',    label: 'Waist',    min: 40,  max: 140, unit: 'cm' },
                  { key: 'shoulder', label: 'Shoulder', min: 30,  max: 70,  unit: 'cm' },
                ] as const).map(({ key, label, min, max, unit }) => (
                  <div key={key}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[10px] font-bold text-white/50 uppercase tracking-widest">{label}</span>
                      <span className="text-xs font-black text-white tabular-nums">
                        {bodyDraft[key]}<span className="text-[9px] text-white/40 ml-0.5">{unit}</span>
                      </span>
                    </div>
                    <input type="range" min={min} max={max} step={0.5} value={bodyDraft[key]}
                      onChange={e => setBodyDraft(p => ({ ...p, [key]: Number(e.target.value) }))}
                      className="w-full appearance-none cursor-pointer" style={{ accentColor: C.pink, height: '4px' }} />
                  </div>
                ))}
              </div>
              <div className="px-3 pb-3 pt-1 space-y-1.5">
                <button onClick={handleSaveBodyPermanently} disabled={savingBody}
                  className="w-full py-2 rounded-xl font-bold text-xs text-white disabled:opacity-50 hover:opacity-90 transition-all"
                  style={{ backgroundColor: C.navy }}>
                  {savingBody ? 'Saving...' : '💾 Save Permanently'}
                </button>
                <div className="flex gap-1.5">
                  <button onClick={handleApplySession} className="flex-1 py-1.5 rounded-lg font-bold text-xs border border-white/20 text-white/70 hover:text-white transition-all">✓ Apply session</button>
                  <button onClick={handleResetBody}    className="flex-1 py-1.5 rounded-lg font-bold text-xs border border-white/20 text-white/50 hover:text-white/80 transition-all">↩ Reset</button>
                </div>
                {bodySavedOk && <p className="text-center text-[10px] font-bold text-green-400">✅ Applied!</p>}
              </div>
            </div>
          )}

          {/* Bottom size selector bar */}
          <div className="absolute bottom-0 left-0 right-0 px-3 pb-3">
            <div className="bg-black/60 backdrop-blur-md rounded-xl p-2.5 border border-white/10">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold text-white/50 uppercase tracking-widest">Select Size to Preview</p>
                <button onClick={() => setShowBodyPanel(p => !p)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all"
                  style={{ backgroundColor: showBodyPanel ? C.pink : 'rgba(255,255,255,0.1)', color: showBodyPanel ? C.navy : 'rgba(255,255,255,0.8)', border: `1px solid ${showBodyPanel ? C.pink : 'rgba(255,255,255,0.2)'}` }}>
                  ⚙️ Body Size
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {sizeButtons.map(size => (
                  <button key={size} onClick={() => setSelectedSize(size)}
                    className="px-4 py-2 rounded-lg font-bold text-sm transition-all"
                    style={{ backgroundColor: selectedSize === size ? C.pink : 'rgba(255,255,255,0.1)', color: selectedSize === size ? C.navy : 'white', border: `1px solid ${selectedSize === size ? C.pink : 'rgba(255,255,255,0.2)'}`, transform: selectedSize === size ? 'scale(1.08)' : 'scale(1)' }}>
                    {size}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ══ RIGHT: Info panel ════════════════════════════════════════════ */}
        <div className="w-[310px] bg-white flex flex-col overflow-hidden flex-shrink-0">
          <div className="p-4 border-b border-gray-100">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{item.brand}</p>
                <h2 className="text-lg font-black leading-tight" style={{ color: C.navy }}>{item.name}</h2>
                <p className="text-xs text-gray-400">{item.category}</p>
              </div>
              <button onClick={onClose} className="text-gray-300 hover:text-gray-600 mt-1">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {fitStatus && userProfile && (
              <div className="rounded-xl p-3 border-2" style={{ backgroundColor: C.cream, borderColor: C.peach }}>
                <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-1">Fit Analysis</p>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: fitStatus.color }} />
                  <span className="text-lg font-black" style={{ color: C.navy }}>{fitStatus.text}</span>
                  <span className="text-xs font-bold text-gray-400">— {selectedSize}</span>
                </div>
                <p className="text-xs text-gray-600 leading-relaxed">
                  {fitStatus.text === 'Tight' ? 'Restrictive around chest. Consider sizing up.' : fitStatus.text === 'Loose' ? 'Oversized look. Size down for regular fit.' : 'Perfect alignment with your body profile.'}
                </p>
              </div>
            )}

            <div>
              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Size Chart</p>
              <div className="overflow-x-auto rounded-xl border" style={{ borderColor: C.peach }}>
                <table className="w-full" style={{ fontSize: '11px' }}>
                  <thead>
                    <tr style={{ backgroundColor: C.cream }}>
                      {['Sz', 'Chest', 'Len', 'Shldr', ...(hasSleve ? ['Slv'] : [])].map(h => (
                        <th key={h} className="px-2 py-1.5 text-left font-bold" style={{ color: C.navy }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {item.sizeChart.map((s, i) => (
                      <tr key={i} className="border-t cursor-pointer"
                        style={{ borderColor: C.peach, backgroundColor: selectedSize === s.size ? C.peach : 'white' }}
                        onClick={() => setSelectedSize(s.size)}>
                        <td className="px-2 py-1.5 font-black" style={{ color: C.navy }}>{s.size}</td>
                        <td className="px-2 py-1.5" style={{ color: C.navy }}>{s.chest}</td>
                        <td className="px-2 py-1.5" style={{ color: C.navy }}>{s.length}</td>
                        <td className="px-2 py-1.5" style={{ color: C.navy }}>{s.shoulder}</td>
                        {hasSleve && <td className="px-2 py-1.5" style={{ color: C.navy }}>{(s as any).sleeve ?? '—'}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-gray-100 bg-gray-50 space-y-2">
            <button onClick={onClose}
              className="w-full py-3 rounded-xl font-bold text-white shadow hover:shadow-lg transition-all"
              style={{ backgroundColor: C.navy }}>
              Done
            </button>

            {/* ← THE LINKED BUTTON — opens StyleOverlay */}
            <button onClick={() => setShowStyleOverlay(true)}
              className="w-full py-2.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 hover:opacity-90 hover:shadow-md"
              style={{ backgroundColor: C.pink, color: C.navy }}>
              ✨ Get AI Outfit Suggestions
            </button>
          </div>
        </div>

        {/* ══ STYLE OVERLAY — fills entire modal when open ════════════════ */}
        {showStyleOverlay && (
          <StyleOverlay
            item={item}
            userProfile={userProfile}
            selectedSize={selectedSize}
            onBack={() => setShowStyleOverlay(false)}
          />
        )}

      </div>
    </div>
  );
}