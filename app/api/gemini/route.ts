// app/api/gemini/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY; // server-side only — never exposed to browser
  if (!apiKey) {
    return NextResponse.json({ error: 'Gemini API key not configured on server.' }, { status: 500 });
  }

  try {
    const body = await req.json();
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Gemini request failed' }, { status: 500 });
  }
}