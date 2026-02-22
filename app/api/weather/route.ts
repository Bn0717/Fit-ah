// app/api/weather/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const apiKey = process.env.OPENWEATHER_API_KEY; // server-side only
  if (!apiKey) {
    return NextResponse.json({ error: 'Weather API key not configured' }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const lat  = searchParams.get('lat');
  const lon  = searchParams.get('lon');
  const city = searchParams.get('city');

  try {
    const query = lat && lon
      ? `lat=${lat}&lon=${lon}`
      : `q=${encodeURIComponent(city ?? '')}`;

    const res  = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?${query}&units=metric&appid=${apiKey}`
    );
    const data = await res.json();
    if (!res.ok) return NextResponse.json({ error: data.message ?? 'Weather fetch failed' }, { status: res.status });
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}