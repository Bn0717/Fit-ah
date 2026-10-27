// Runs Fit-Ah's real AI stylist (same prompt as components/items/FitRecommendationModal.tsx buildPrompt,
// same /api/gemini route + generationConfig, garment photo attached) for a few live-weather cities.
import fs from 'node:fs';
const BASE = 'http://localhost:3000';
const PRESET_BOTTOMS = ['Baggy Wide-Leg Jeans','Casual Sweatpants','Baggy Cargo Pants','Wide-Leg Sweatpants','Pleated Wide-Leg Trousers','Casual Shorts','Slacks'];
const PRESET_SHOES = ['White & Light Grey Chunky Sneakers','Classic Low-Top Sneakers','Casual Slip-on Loafers','Slip-on Clog','Winter Boots'];
const chart = { S: { chest: 54.5, shoulder: 43, length: 71 }, M: { chest: 57, shoulder: 45, length: 73 }, L: { chest: 59.5, shoulder: 47, length: 75 }, XL: { chest: 62, shoulder: 49, length: 77 } };
const profile = { height: 175, chest: 48.5, waist: 37.5, shoulder: 45 };   // demo account's saved body
const item = { name: 'Gon Tee (Green)', brand: 'TNT CO', color: 'green' };
function buildPrompt(weather, size) {
  const row = chart[size];
  const chestEase = row.chest - profile.chest, shoulderEase = row.shoulder - profile.shoulder;
  const lengthEase = row.length - (profile.height * 0.26), waistEase = row.chest - (profile.waist ?? 35);
  const hasTight = chestEase < -2 || shoulderEase < -3 || lengthEase < -4 || waistEase < -2;
  const hasLoose = chestEase > 18 || shoulderEase > 6 || lengthEase > 20 || waistEase > 20;
  const fitLabel = hasTight && hasLoose ? 'Mixed Fit' : hasTight ? 'Too Tight' : hasLoose ? 'Too Loose' : 'Good Fit';
  const partSummary = [
    `chest ${chestEase >= 0 ? '+' : ''}${chestEase.toFixed(1)}cm${chestEase < -2 ? ' (too tight)' : chestEase > 18 ? ' (too loose)' : ''}`,
    `shoulder ${shoulderEase >= 0 ? '+' : ''}${shoulderEase.toFixed(1)}cm${shoulderEase < -3 ? ' (too narrow)' : shoulderEase > 6 ? ' (too wide)' : ''}`,
    `length ${lengthEase >= 0 ? '+' : ''}${lengthEase.toFixed(1)}cm${lengthEase < -4 ? ' (too short)' : lengthEase > 20 ? ' (too long)' : ''}`,
    `waist ${waistEase >= 0 ? '+' : ''}${waistEase.toFixed(1)}cm${waistEase < -2 ? ' (too tight)' : waistEase > 20 ? ' (too boxy)' : ''}`,
  ].join(' · ');
  const fitLine = `Fit: ${fitLabel} (size ${size}) — ${partSummary}.`;
  const prompt = `You are a professional fashion consultant and technical stylist.

CONTEXT:
Weather: ${weather.tempC}°C, ${weather.condition}, Humidity: ${weather.humidity}%.
Shirt: "${item.name}" by ${item.brand} (${item.color}).
${fitLine}

STYLING RULES:
1. Return exactly 3 outfit suggestions with distinct vibes.
2. "reason": Write 40-60 words. Explain the visual balance between the top and bottom. Discuss how the ${fitLabel} fit of the shirt pairs with the silhouette of the bottoms and how the colors harmonize.
3. "comfort": Write 30-50 words. Explain how the fabric and the chest ease (+${(row.chest - profile.chest).toFixed(1)}cm) will feel against the skin in ${weather.tempC}°C heat and ${weather.humidity}% humidity.
4. Output ONLY a valid JSON array. No conversational text.

ALLOWED LISTS:
- BOTTOMS: ${PRESET_BOTTOMS.join(' | ')}
- SHOES: ${PRESET_SHOES.join(' | ')}

OUTPUT FORMAT:
[{"bottom":"...","shoes":"...","reason":"...","comfort":"...","vibe":"..."}]`;
  return { prompt, fitLabel };
}
const img = fs.readFileSync('public/models/fitlab/brands/tnt_co/gon_tee/photos/gon_front.png').toString('base64');
const runs = [['Kuala Lumpur', 'M'], ['Tokyo', 'L'], ['London', 'S']];
const out = [];
for (const [city, size] of runs) {
  const w = await (await fetch(`${BASE}/api/weather?city=${encodeURIComponent(city)}`)).json();
  if (!w.main) { console.log('WEATHER FAIL', city, JSON.stringify(w).slice(0, 200)); continue; }
  const weather = { tempC: Math.round(w.main.temp), condition: w.weather[0]?.main ?? 'Clear', humidity: w.main.humidity, city: w.name };
  const { prompt, fitLabel } = buildPrompt(weather, size);
  const res = await fetch(`${BASE}/api/gemini`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: 'image/png', data: img } }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 1024 } }) });
  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  let outfits = null;
  try { outfits = JSON.parse(raw.replace(/```json|```/g, '').trim()); } catch { console.log('PARSE FAIL', city, res.status, JSON.stringify(data).slice(0, 300)); continue; }
  out.push({ city: weather.city, weather, item: item.name, size, fitLabel, outfits, model: data.modelVersion ?? null });
  console.log('OK', city, weather.tempC, weather.condition, size, fitLabel, outfits.length, data.modelVersion);
}
fs.writeFileSync(process.argv[2], JSON.stringify({ generated: new Date().toISOString(), source: 'Fit-Ah AI stylist (/api/gemini), prompt from FitRecommendationModal.buildPrompt', samples: out }, null, 1));
