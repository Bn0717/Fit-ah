// app/style/page.tsx  (or wherever you route it)
// Weather-aware Gemini outfit suggestions for FitCheck
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/contexts/AuthContext';
import { getAvatar, getUserClothingItems } from '@/lib/firebase/firestore';
import type { ClothingItem } from '@/lib/types/clothing';
import type { ParametricAvatar } from '@/lib/types/avatar';

// ─── Design tokens (matches FitCheck global palette) ────────────────────────
const C = {
  cream:  '#F8F3EA',
  navy:   '#0B1957',
  peach:  '#FFDBD1',
  pink:   '#FA9EBC',
  green:  '#10b981',
  orange: '#f59e0b',
  red:    '#ef4444',
};

// ─── Preset wardrobe items (bottom / shoes / accessories) ───────────────────
// These are the ONLY options Gemini may pick from — prevents hallucination.
const PRESET_BOTTOMS = [
  { id: 'b1', label: 'Baggy Wide-Leg Jeans',  emoji: '', tags: ['formal','rain','cold'] },
  { id: 'b2', label: 'Casual Sweatpants',           emoji: '', tags: ['casual','cold'] },
  { id: 'b3', label: 'Baggy Cargo Pants',          emoji: '', tags: ['casual','warm','smart'] },
  { id: 'b4', label: 'Wide-Leg Sweatpants',               emoji: '', tags: ['hot','casual'] },
  { id: 'b5', label: 'Pleated Wide-Leg Trousers',             emoji: '', tags: ['cold','casual','cosy'] },
  { id: 'b6', label: 'Casual Shorts',           emoji: '', tags: ['casual','rain','outdoor'] },
  { id: 'b7', label: 'Slacks',        emoji: '', tags: ['smart','casual','warm'] },
];

const PRESET_SHOES = [
  { id: 's1', label: 'White & Light Grey Chunky Sneakers', emoji: '👟', tags: ['casual','warm','smart'] },
  { id: 's2', label: 'Classic Low-Top Sneakers',          emoji: '👟', tags: ['casual','rain','dark'] },
  { id: 's3', label: 'Casual Slip-on Loafers',   emoji: '👞', tags: ['smart','formal'] },
  { id: 's4', label: 'Slip-on Clog',   emoji: '🥿', tags: ['casual','streetwear'] },
  { id: 's5', label: 'Winter Boots',     emoji: '🥾', tags: ['rain','cold','smart'] },
];



// ─── Types ──────────────────────────────────────────────────────────────────
interface WeatherData {
  tempC:     number;
  condition: string;  // e.g. 'Clear', 'Rain', 'Clouds', 'Drizzle', 'Thunderstorm'
  humidity:  number;
  city:      string;
  icon:      string;  // OpenWeatherMap icon code
}

interface FitSummary {
  overall:       'Tight' | 'Regular' | 'Loose';
  easeChestCm:   number;
  easeWaistCm:   number;
  selectedSize:  string;
  shirtName:     string;
  shirtBrand:    string;
  shirtColor:    string;
}

interface OutfitSuggestion {
  bottom:    string;
  shoes:     string;
  accessory: string;
  reason:    string;
  comfort:   string;
  vibe:      string;  // e.g. "Smart Casual", "Streetwear", "Minimalist"
}

// ─── Weather condition helpers ───────────────────────────────────────────────
const CONDITION_META: Record<string, { label: string; emoji: string; bg: string }> = {
  Clear:         { label: 'Sunny',        emoji: '☀️',  bg: '#FFF3CD' },
  Clouds:        { label: 'Cloudy',       emoji: '☁️',  bg: '#E9ECEF' },
  Rain:          { label: 'Rainy',        emoji: '🌧️', bg: '#D6EAF8' },
  Drizzle:       { label: 'Drizzling',    emoji: '🌦️', bg: '#D6EAF8' },
  Thunderstorm:  { label: 'Stormy',       emoji: '⛈️', bg: '#D2B4DE' },
  Snow:          { label: 'Snowy',        emoji: '❄️',  bg: '#EBF5FB' },
  Mist:          { label: 'Misty',        emoji: '🌫️', bg: '#EAECEE' },
  Haze:          { label: 'Hazy',         emoji: '🌫️', bg: '#EAECEE' },
};

function getConditionMeta(condition: string) {
  return CONDITION_META[condition] ?? { label: condition, emoji: '🌤️', bg: C.cream };
}

function getTempLabel(tempC: number): { label: string; color: string } {
  if (tempC >= 33) return { label: 'Very Hot',  color: '#ef4444' };
  if (tempC >= 28) return { label: 'Hot',        color: '#f97316' };
  if (tempC >= 23) return { label: 'Warm',       color: '#eab308' };
  if (tempC >= 17) return { label: 'Mild',       color: '#22c55e' };
  if (tempC >= 10) return { label: 'Cool',       color: '#06b6d4' };
  return                   { label: 'Cold',       color: '#6366f1' };
}

// ─── Gemini prompt builder ───────────────────────────────────────────────────
function buildGeminiPrompt(
  weather:  WeatherData,
  fit:      FitSummary | null,
  shirtUrl: string | null,
): string {
  const fitBlock = fit
    ? `Shirt: "${fit.shirtName}" by ${fit.shirtBrand} (${fit.shirtColor}), size ${fit.selectedSize}.
Fit: ${fit.overall} — chest ease +${fit.easeChestCm}cm, waist ease +${fit.easeWaistCm}cm.`
    : `No specific shirt selected — suggest generally.`;

  return `You are a concise fashion stylist for a Southeast Asian male user.

CONTEXT:
Weather: ${weather.tempC}°C, ${weather.condition}, humidity ${weather.humidity}%.
${fitBlock}

RULES:
- Only select items from the ALLOWED LISTS below. Do NOT invent or suggest other items.
- Give exactly 3 outfit suggestions, each with a different vibe.
- Keep "reason" around 30-50 words. Keep "comfort" under 15 words.
- Output ONLY a valid JSON array — no markdown, no extra text.

ALLOWED BOTTOMS: ${PRESET_BOTTOMS.map(b => b.label).join(' | ')}
ALLOWED SHOES:   ${PRESET_SHOES.map(s => s.label).join(' | ')}

OUTPUT FORMAT:
[
  {
    "bottom":    "<exact label from ALLOWED BOTTOMS>",
    "shoes":     "<exact label from ALLOWED SHOES>",
    "accessory": "<exact label from ALLOWED ACCESSORIES>",
    "reason":    "<why this works with the shirt and weather>",
    "comfort":   "<one short comfort note>",
    "vibe":      "<2-word style vibe, e.g. Smart Casual>"
  }
]`;
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function StyleSuggestionsPage() {
  const { user } = useAuth();

  // Location + weather
  const [locationState, setLocationState] = useState<'idle' | 'requesting' | 'granted' | 'denied' | 'manual'>('idle');
  const [coords,        setCoords]        = useState<{ lat: number; lon: number } | null>(null);
  const [manualCity,    setManualCity]    = useState('');
  const [weather,       setWeather]       = useState<WeatherData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError,   setWeatherError]   = useState<string | null>(null);

  // Wardrobe
  const [items,         setItems]         = useState<ClothingItem[]>([]);
  const [avatar,        setAvatar]        = useState<ParametricAvatar | null>(null);
  const [selectedShirt, setSelectedShirt] = useState<ClothingItem | null>(null);
  const [selectedSize,  setSelectedSize]  = useState<string>('M');
  const [loadingData,   setLoadingData]   = useState(true);

  // Suggestions
  const [suggestions,   setSuggestions]  = useState<OutfitSuggestion[]>([]);
  const [aiLoading,     setAiLoading]    = useState(false);
  const [aiError,       setAiError]      = useState<string | null>(null);
  const [generated,     setGenerated]    = useState(false);

  // ── Load user data ──────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    Promise.all([getUserClothingItems(user.uid), getAvatar(user.uid)])
      .then(([clothingItems, userAvatar]) => {
        setItems(clothingItems);
        setAvatar(userAvatar);
        if (clothingItems.length > 0) setSelectedShirt(clothingItems[0]);
        setLoadingData(false);
      });
  }, [user]);

  // ── Request browser location ────────────────────────────────────
  const requestLocation = useCallback(() => {
    setLocationState('requesting');
    if (!navigator.geolocation) {
      setLocationState('manual');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setLocationState('granted');
      },
      () => setLocationState('denied'),
      { timeout: 10_000 }
    );
  }, []);

  // ── Fetch weather from OpenWeatherMap ───────────────────────────
  const fetchWeather = useCallback(async (lat: number, lon: number) => {
    setWeatherLoading(true);
    setWeatherError(null);
    try {
      const key = process.env.NEXT_PUBLIC_OPENWEATHER_API_KEY;
      if (!key) throw new Error('Missing NEXT_PUBLIC_OPENWEATHER_API_KEY in .env.local');
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${key}`;
      const res  = await fetch(url);
      if (!res.ok) throw new Error(`Weather API error ${res.status}`);
      const data = await res.json();
      setWeather({
        tempC:     Math.round(data.main.temp),
        condition: data.weather[0]?.main ?? 'Clear',
        humidity:  data.main.humidity,
        city:      data.name || 'Your location',
        icon:      data.weather[0]?.icon ?? '01d',
      });
    } catch (e: any) {
      setWeatherError(e.message ?? 'Could not fetch weather.');
    } finally {
      setWeatherLoading(false);
    }
  }, []);

  // Auto-fetch when coords arrive
  useEffect(() => {
    if (coords) fetchWeather(coords.lat, coords.lon);
  }, [coords, fetchWeather]);

  // ── Manual city geocode via OpenWeatherMap ──────────────────────
  const fetchWeatherByCity = useCallback(async () => {
    if (!manualCity.trim()) return;
    setWeatherLoading(true);
    setWeatherError(null);
    try {
      const key = process.env.NEXT_PUBLIC_OPENWEATHER_API_KEY;
      if (!key) throw new Error('Missing NEXT_PUBLIC_OPENWEATHER_API_KEY in .env.local');
      const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(manualCity)}&units=metric&appid=${key}`;
      const res  = await fetch(url);
      if (!res.ok) throw new Error('City not found. Try a different spelling.');
      const data = await res.json();
      setWeather({
        tempC:     Math.round(data.main.temp),
        condition: data.weather[0]?.main ?? 'Clear',
        humidity:  data.main.humidity,
        city:      data.name,
        icon:      data.weather[0]?.icon ?? '01d',
      });
      setLocationState('granted');
    } catch (e: any) {
      setWeatherError(e.message ?? 'Could not fetch weather.');
    } finally {
      setWeatherLoading(false);
    }
  }, [manualCity]);

  // ── Compute fit summary ─────────────────────────────────────────
  const computeFit = useCallback((): FitSummary | null => {
    if (!selectedShirt || !avatar) return null;
    const sizeRow = selectedShirt.sizeChart.find(s => s.size === selectedSize)
      ?? selectedShirt.sizeChart[0];
    if (!sizeRow) return null;

    const easeChest = sizeRow.chest - avatar.chest;
    const easeWaist = sizeRow.waist != null
      ? sizeRow.waist - avatar.waist
      : easeChest * 0.6;  // rough estimate

    const ratio = sizeRow.chest / avatar.chest;
    const overall: FitSummary['overall'] =
      ratio < 0.96 ? 'Tight' : ratio > 1.15 ? 'Loose' : 'Regular';

    return {
      overall,
      easeChestCm:  parseFloat(easeChest.toFixed(1)),
      easeWaistCm:  parseFloat(easeWaist.toFixed(1)),
      selectedSize,
      shirtName:    selectedShirt.name,
      shirtBrand:   selectedShirt.brand,
      shirtColor:   (selectedShirt as any).color ?? 'unknown color',
    };
  }, [selectedShirt, selectedSize, avatar]);

  // ── Call Gemini ─────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!weather) return;
    setAiLoading(true);
    setAiError(null);
    setSuggestions([]);
    setGenerated(false);

    const fit    = computeFit();
    const imgUrl = selectedShirt?.frontImageUrl || selectedShirt?.imageUrl || null;
    const prompt = buildGeminiPrompt(weather, fit, imgUrl);

    try {
      const key = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
      if (!key) throw new Error('Missing NEXT_PUBLIC_GEMINI_API_KEY in .env.local');

      // Build multimodal parts — include shirt image if available
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parts: any[] = [{ text: prompt }];

      if (imgUrl) {
        try {
          const blob   = await fetch(imgUrl).then(r => r.blob());
          const base64 = await new Promise<string>((res, rej) => {
            const reader = new FileReader();
            reader.onloadend = () => res((reader.result as string).split(',')[1]);
            reader.onerror = rej;
            reader.readAsDataURL(blob);
          });
          parts.push({ inlineData: { mimeType: blob.type || 'image/jpeg', data: base64 } });
        } catch {
          // Image fetch failed — continue text-only
        }
      }

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
          }),
        }
      );

      const data = await res.json();
      
      if (!res.ok) {
      throw new Error(data?.error?.message || `Gemini error ${res.status}`);
      }

      const raw  = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      const json = raw.replace(/```json|```/g, '').trim();
      const parsed: OutfitSuggestion[] = JSON.parse(json);
      setSuggestions(parsed);
      setGenerated(true);
    } catch (e: any) {
      setAiError('Could not generate suggestions. Check your API keys in .env.local');
    } finally {
      setAiLoading(false);
    }
  }, [weather, computeFit, selectedShirt]);

  // ─── Helpers ───────────────────────────────────────────────────
  const getPresetEmoji = (label: string, list: { label: string; emoji: string }[]) =>
    list.find(x => x.label === label)?.emoji ?? '•';

  const condMeta  = weather ? getConditionMeta(weather.condition) : null;
  const tempLabel = weather ? getTempLabel(weather.tempC) : null;
  const fit       = computeFit();
  const fitColor  = fit?.overall === 'Tight' ? C.red : fit?.overall === 'Loose' ? C.orange : C.green;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ backgroundColor: C.cream, fontFamily: "'Inter', sans-serif" }}>

      {/* ── TOP HEADER ─────────────────────────────────────────── */}
      <div className="px-6 py-5 border-b" style={{ borderColor: C.peach, backgroundColor: 'white' }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black" style={{ color: C.navy }}>
              🌤️ Style Suggestions
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Weather-aware outfits built around your wardrobe & fit
            </p>
          </div>
          {weather && (
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl border"
              style={{ backgroundColor: condMeta?.bg ?? C.cream, borderColor: C.peach }}>
              <span className="text-xl">{condMeta?.emoji}</span>
              <div>
                <p className="text-xs font-black" style={{ color: C.navy }}>{weather.city}</p>
                <p className="text-xs text-gray-500">{weather.tempC}°C · {condMeta?.label}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">

        {/* ══════════════════════════════════════════════════════
            STEP 1 — LOCATION + WEATHER
        ══════════════════════════════════════════════════════ */}
        <section className="bg-white rounded-2xl border overflow-hidden" style={{ borderColor: C.peach }}>
          <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: C.peach, backgroundColor: C.cream }}>
            <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black text-white" style={{ backgroundColor: C.navy }}>1</span>
            <h2 className="text-sm font-black uppercase tracking-widest" style={{ color: C.navy }}>Weather</h2>
            {weather && <span className="ml-auto text-[10px] font-bold text-green-600">✅ Ready</span>}
          </div>

          <div className="p-5">
            {locationState === 'idle' && (
              <div className="flex flex-col items-center gap-4 py-4 text-center">
                <div className="text-5xl">📍</div>
                <div>
                  <p className="font-bold text-sm" style={{ color: C.navy }}>Enable location for local weather</p>
                  <p className="text-xs text-gray-400 mt-1">Your coordinates are only used to fetch weather — never stored.</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={requestLocation}
                    className="px-5 py-2.5 rounded-xl font-bold text-sm text-white hover:opacity-90 transition-all"
                    style={{ backgroundColor: C.navy }}>
                    📍 Allow Location
                  </button>
                  <button onClick={() => setLocationState('manual')}
                    className="px-5 py-2.5 rounded-xl font-bold text-sm border hover:opacity-80 transition-all"
                    style={{ borderColor: C.peach, color: C.navy }}>
                    ✏️ Enter City
                  </button>
                </div>
              </div>
            )}

            {locationState === 'requesting' && (
              <div className="flex items-center justify-center gap-3 py-6">
                <div className="w-6 h-6 border-3 border-t-transparent rounded-full animate-spin"
                  style={{ borderColor: C.navy, borderTopColor: 'transparent', borderWidth: '3px' }} />
                <p className="text-sm font-medium text-gray-500">Requesting location…</p>
              </div>
            )}

            {(locationState === 'denied' || locationState === 'manual') && !weather && (
              <div className="space-y-3">
                {locationState === 'denied' && (
                  <p className="text-xs text-center text-gray-400">Location access denied. Enter your city below.</p>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={manualCity}
                    onChange={e => setManualCity(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && fetchWeatherByCity()}
                    placeholder="e.g. Kuala Lumpur, Singapore, Jakarta…"
                    className="flex-1 px-4 py-2.5 rounded-xl border text-sm focus:outline-none"
                    style={{ borderColor: C.peach, backgroundColor: C.cream, color: C.navy }}
                  />
                  <button onClick={fetchWeatherByCity} disabled={weatherLoading || !manualCity.trim()}
                    className="px-4 py-2.5 rounded-xl font-bold text-sm text-white disabled:opacity-50 hover:opacity-90 transition-all"
                    style={{ backgroundColor: C.navy }}>
                    {weatherLoading ? '…' : 'Go'}
                  </button>
                </div>
                {weatherError && <p className="text-xs text-red-500">{weatherError}</p>}
              </div>
            )}

            {locationState === 'granted' && weatherLoading && !weather && (
              <div className="flex items-center justify-center gap-3 py-6">
                <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin"
                  style={{ borderColor: C.navy, borderTopColor: 'transparent' }} />
                <p className="text-sm text-gray-500">Fetching weather…</p>
              </div>
            )}

            {weatherError && locationState === 'granted' && (
              <p className="text-xs text-red-500 text-center py-2">{weatherError}</p>
            )}

            {weather && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {/* Temperature */}
                <div className="rounded-xl p-3 text-center border" style={{ backgroundColor: C.cream, borderColor: C.peach }}>
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Temperature</p>
                  <p className="text-3xl font-black tabular-nums" style={{ color: tempLabel?.color }}>
                    {weather.tempC}°
                  </p>
                  <p className="text-[10px] font-bold mt-0.5" style={{ color: tempLabel?.color }}>{tempLabel?.label}</p>
                </div>

                {/* Condition */}
                <div className="rounded-xl p-3 text-center border" style={{ backgroundColor: condMeta?.bg ?? C.cream, borderColor: C.peach }}>
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Condition</p>
                  <p className="text-3xl">{condMeta?.emoji}</p>
                  <p className="text-[10px] font-bold mt-0.5" style={{ color: C.navy }}>{condMeta?.label}</p>
                </div>

                {/* Humidity */}
                <div className="rounded-xl p-3 text-center border" style={{ backgroundColor: C.cream, borderColor: C.peach }}>
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Humidity</p>
                  <p className="text-3xl font-black tabular-nums" style={{ color: C.navy }}>{weather.humidity}%</p>
                  <p className="text-[10px] font-bold mt-0.5 text-gray-400">
                    {weather.humidity > 80 ? 'Very Humid' : weather.humidity > 60 ? 'Humid' : 'Comfortable'}
                  </p>
                </div>

                {/* City */}
                <div className="rounded-xl p-3 text-center border" style={{ backgroundColor: C.cream, borderColor: C.peach }}>
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Location</p>
                  <p className="text-xl">📍</p>
                  <p className="text-[11px] font-black mt-0.5" style={{ color: C.navy }}>{weather.city}</p>
                  <button onClick={() => { setWeather(null); setLocationState('manual'); setManualCity(''); }}
                    className="text-[9px] text-gray-400 hover:text-gray-600 underline mt-0.5">Change</button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════
            STEP 2 — SHIRT SELECTOR + SIZE + FIT
        ══════════════════════════════════════════════════════ */}
        <section className="bg-white rounded-2xl border overflow-hidden" style={{ borderColor: C.peach }}>
          <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: C.peach, backgroundColor: C.cream }}>
            <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black text-white" style={{ backgroundColor: C.navy }}>2</span>
            <h2 className="text-sm font-black uppercase tracking-widest" style={{ color: C.navy }}>Shirt &amp; Fit</h2>
            {fit && <span className="ml-auto text-[10px] font-bold" style={{ color: fitColor }}>● {fit.overall}</span>}
          </div>

          <div className="p-5">
            {loadingData ? (
              <div className="flex justify-center py-6">
                <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: C.navy, borderTopColor: 'transparent' }} />
              </div>
            ) : items.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-6">No items in wardrobe. Add shirts from the Wardrobe page first.</p>
            ) : (
              <div className="space-y-4">
                {/* Shirt scroll row */}
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Select Shirt</p>
                  <div className="flex gap-2.5 overflow-x-auto pb-1">
                    {items.map(item => (
                      <button key={item.id}
                        onClick={() => { setSelectedShirt(item); setSuggestions([]); setGenerated(false); }}
                        className="flex-shrink-0 w-20 rounded-xl overflow-hidden border-2 transition-all hover:scale-105"
                        style={{
                          borderColor: selectedShirt?.id === item.id ? C.navy : C.peach,
                          boxShadow:   selectedShirt?.id === item.id ? `0 0 0 2px ${C.pink}` : 'none',
                        }}>
                        <div className="aspect-square bg-white flex items-center justify-center overflow-hidden">
                          {(item.frontImageUrl || item.imageUrl)
                            ? <img src={item.frontImageUrl || item.imageUrl} alt={item.name}
                                className="w-full h-full object-cover" crossOrigin="anonymous" />
                            : <span className="text-2xl">👕</span>}
                        </div>
                        <div className="px-1.5 py-1" style={{ backgroundColor: selectedShirt?.id === item.id ? C.peach : C.cream }}>
                          <p className="text-[9px] font-bold truncate" style={{ color: C.navy }}>{item.name}</p>
                          <p className="text-[8px] opacity-50 truncate" style={{ color: C.navy }}>{item.brand}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Size + fit row */}
                {selectedShirt && (
                  <div className="flex flex-wrap gap-4 items-start">
                    {/* Size selector */}
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Size</p>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedShirt.sizeChart.map(s => (
                          <button key={s.size}
                            onClick={() => { setSelectedSize(s.size); setSuggestions([]); setGenerated(false); }}
                            className="px-3 py-1.5 rounded-lg font-bold text-xs transition-all"
                            style={{
                              backgroundColor: selectedSize === s.size ? C.navy : C.cream,
                              color:           selectedSize === s.size ? 'white' : C.navy,
                              border:          `1.5px solid ${selectedSize === s.size ? C.navy : C.peach}`,
                            }}>
                            {s.size}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Fit analysis */}
                    {fit && avatar && (
                      <div className="flex-1 rounded-xl p-3 border" style={{ backgroundColor: C.cream, borderColor: C.peach, minWidth: '220px' }}>
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Fit Analysis</p>
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: fitColor }} />
                          <span className="font-black text-base" style={{ color: C.navy }}>{fit.overall}</span>
                          <span className="text-xs text-gray-400">— Size {fit.selectedSize}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                          <div className="rounded-lg px-2 py-1 text-center" style={{ backgroundColor: 'white', border: `1px solid ${C.peach}` }}>
                            <p className="text-gray-400 uppercase font-bold tracking-widest">Chest ease</p>
                            <p className="font-black text-sm" style={{ color: fit.easeChestCm >= 0 ? C.green : C.red }}>
                              {fit.easeChestCm >= 0 ? '+' : ''}{fit.easeChestCm} cm
                            </p>
                          </div>
                          <div className="rounded-lg px-2 py-1 text-center" style={{ backgroundColor: 'white', border: `1px solid ${C.peach}` }}>
                            <p className="text-gray-400 uppercase font-bold tracking-widest">Waist ease</p>
                            <p className="font-black text-sm" style={{ color: fit.easeWaistCm >= 0 ? C.green : C.red }}>
                              {fit.easeWaistCm >= 0 ? '+' : ''}{fit.easeWaistCm} cm
                            </p>
                          </div>
                        </div>
                        <p className="text-[10px] text-gray-500 mt-1.5 leading-relaxed">
                          {fit.overall === 'Tight'
                            ? '⚠️ Shirt is snug — Gemini will factor in ease of movement.'
                            : fit.overall === 'Loose'
                            ? '🌬️ Relaxed fit — good for hot weather styling.'
                            : '✅ Great fit — versatile for most outfit combos.'}
                        </p>
                      </div>
                    )}

                    {!avatar && (
                      <div className="flex-1 rounded-xl p-3 border text-center" style={{ backgroundColor: C.cream, borderColor: C.peach }}>
                        <p className="text-xs text-gray-400">Set up your measurements in the Profile page to see fit analysis.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════
            STEP 3 — PRESET WARDROBE REFERENCE
        ══════════════════════════════════════════════════════ */}
        <section className="bg-white rounded-2xl border overflow-hidden" style={{ borderColor: C.peach }}>
          <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: C.peach, backgroundColor: C.cream }}>
            <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black text-white" style={{ backgroundColor: C.navy }}>3</span>
            <h2 className="text-sm font-black uppercase tracking-widest" style={{ color: C.navy }}>Preset Wardrobe</h2>
            <span className="ml-auto text-[9px] text-gray-400 font-medium">AI selects only from these items</span>
          </div>
          <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Bottoms */}
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">👖 Bottoms</p>
              <div className="space-y-1">
                {PRESET_BOTTOMS.map(b => (
                  <div key={b.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg" style={{ backgroundColor: C.cream }}>
                    <span className="text-sm">{b.emoji}</span>
                    <span className="text-[11px] font-medium" style={{ color: C.navy }}>{b.label}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* Shoes */}
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">👟 Shoes</p>
              <div className="space-y-1">
                {PRESET_SHOES.map(s => (
                  <div key={s.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg" style={{ backgroundColor: C.cream }}>
                    <span className="text-sm">{s.emoji}</span>
                    <span className="text-[11px] font-medium" style={{ color: C.navy }}>{s.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════
            GENERATE BUTTON
        ══════════════════════════════════════════════════════ */}
        <div className="flex justify-center">
          <button
            onClick={handleGenerate}
            disabled={!weather || aiLoading || loadingData}
            className="flex items-center gap-3 px-8 py-4 rounded-2xl font-black text-base text-white shadow-lg hover:shadow-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:scale-[1.02]"
            style={{ backgroundColor: C.navy }}>
            {aiLoading ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Analysing your style…
              </>
            ) : (
              <>
                ✨ Generate Outfit Suggestions
                {!weather && <span className="text-[11px] opacity-60 font-normal ml-1">(set location first)</span>}
              </>
            )}
          </button>
        </div>

        {aiError && (
          <div className="rounded-xl p-4 border text-center" style={{ backgroundColor: '#FFF0F0', borderColor: '#FECACA' }}>
            <p className="text-sm text-red-600 font-medium">{aiError}</p>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════
            STEP 4 — OUTFIT SUGGESTIONS OUTPUT
        ══════════════════════════════════════════════════════ */}
        {generated && suggestions.length > 0 && (
          <section>
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-lg font-black" style={{ color: C.navy }}>
                🎯 Your Outfit Suggestions
              </h2>
              {weather && (
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full"
                  style={{ backgroundColor: C.peach, color: C.navy }}>
                  {condMeta?.emoji} {weather.tempC}°C · {weather.city}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {suggestions.map((s, idx) => (
                <div key={idx}
                  className="bg-white rounded-2xl border overflow-hidden flex flex-col hover:shadow-lg transition-all"
                  style={{ borderColor: C.peach }}>

                  {/* Card header */}
                  <div className="px-4 py-3 border-b flex items-center justify-between"
                    style={{ borderColor: C.peach, backgroundColor: idx === 0 ? C.navy : C.cream }}>
                    <span className="text-[10px] font-black uppercase tracking-widest"
                      style={{ color: idx === 0 ? 'white' : C.navy }}>
                      Option {idx + 1}
                    </span>
                    <span
                      className="text-[10px] font-black px-2 py-0.5 rounded-full"
                      style={{
                        backgroundColor: idx === 0 ? C.pink : C.navy,
                        color:           idx === 0 ? C.navy : 'white',
                      }}>
                      {s.vibe}
                    </span>
                  </div>

                  {/* Outfit items */}
                  <div className="p-4 flex-1 space-y-2">
                    {/* Bottom */}
                    <div className="flex items-center gap-2.5 p-2.5 rounded-xl" style={{ backgroundColor: C.cream }}>
                      <span className="text-xl flex-shrink-0">
                        {getPresetEmoji(s.bottom, PRESET_BOTTOMS)}
                      </span>
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Bottom</p>
                        <p className="text-[11px] font-bold" style={{ color: C.navy }}>{s.bottom}</p>
                      </div>
                    </div>

                    {/* Shoes */}
                    <div className="flex items-center gap-2.5 p-2.5 rounded-xl" style={{ backgroundColor: C.cream }}>
                      <span className="text-xl flex-shrink-0">
                        {getPresetEmoji(s.shoes, PRESET_SHOES)}
                      </span>
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Shoes</p>
                        <p className="text-[11px] font-bold" style={{ color: C.navy }}>{s.shoes}</p>
                      </div>
                    </div>
                  </div>

                  {/* Reason + comfort */}
                  <div className="px-4 pb-4 space-y-1.5">
                    <div className="rounded-xl p-3 border" style={{ backgroundColor: '#f0f9f4', borderColor: '#bbf7d0' }}>
                      <p className="text-[9px] font-black uppercase tracking-widest text-green-700 mb-0.5">Why it works</p>
                      <p className="text-[11px] text-green-900 leading-relaxed">{s.reason}</p>
                    </div>
                    <div className="rounded-xl p-3 border" style={{ backgroundColor: '#fffbeb', borderColor: '#fde68a' }}>
                      <p className="text-[9px] font-black uppercase tracking-widest text-amber-700 mb-0.5">Comfort note</p>
                      <p className="text-[11px] text-amber-900 leading-relaxed">{s.comfort}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Regenerate */}
            <div className="flex justify-center mt-4">
              <button onClick={handleGenerate} disabled={aiLoading}
                className="px-5 py-2 rounded-xl font-bold text-sm border hover:opacity-80 transition-all disabled:opacity-40"
                style={{ borderColor: C.navy, color: C.navy }}>
                🔄 Regenerate
              </button>
            </div>
          </section>
        )}

        {/* Empty state — no suggestions yet */}
        {!generated && !aiLoading && (
          <div className="text-center py-10 space-y-2">
            <p className="text-4xl">👔</p>
            <p className="text-sm font-bold" style={{ color: C.navy }}>
              {!weather ? 'Set your location to get started' : 'Ready to generate — hit the button above!'}
            </p>
            <p className="text-xs text-gray-400">
              Gemini will match your shirt + fit + weather to the preset wardrobe.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}