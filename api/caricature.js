/**
 * POST /api/caricature   body: { image: "data:image/jpeg;base64,..." }
 * -> 200 { image: "data:image/png;base64,..." }
 *
 * Server-side only: API keys are read from process.env and never sent to the client.
 * Supports OpenAI (ChatGPT) and Google Gemini.
 */
import { PROMPT } from '../src/prompts.js';

const MAX_BYTES = 4 * 1024 * 1024; // Vercel body limit is ~4.5MB
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const UPSTREAM_TIMEOUT_MS = 180000; // 3 minutes: allows complex AI generation without premature cutoff

// ---- Basic in-memory rate limiter (best-effort per server instance) ----
const hits = new Map(); // ip -> number[] timestamps
function rateLimited(ip) {
  const perMin = Number(process.env.RATE_LIMIT_PER_MINUTE || 6);
  const perHour = Number(process.env.RATE_LIMIT_PER_HOUR || 60);
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 3600_000);
  const lastMin = list.filter((t) => now - t < 60_000).length;
  if (lastMin >= perMin || list.length >= perHour) { hits.set(ip, list); return true; }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear(); // keep memory bounded
  return false;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!openaiKey && !geminiKey) return res.status(500).json({ error: 'not_configured' });

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (rateLimited(ip)) return res.status(429).json({ error: 'rate_limited' });

  // ---- Validate input ----
  const image = req.body && req.body.image;
  const m = typeof image === 'string' && image.match(/^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!m || !ALLOWED.includes(m[1])) return res.status(400).json({ error: 'invalid_image' });
  const [, mime, b64] = m;
  if (Math.floor((b64.length * 3) / 4) > MAX_BYTES) return res.status(413).json({ error: 'too_large' });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    if (openaiKey) {
      // ---- OpenAI (ChatGPT) Image Provider ----
      const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2.5-flare';
      const size = process.env.OPENAI_IMAGE_SIZE || '1024x1024';
      const form = new FormData();
      const buffer = Buffer.from(b64, 'base64');
      const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
      const blob = new Blob([buffer], { type: mime });
      form.append('model', model);
      form.append('image', blob, `photo.${ext}`);
      form.append('prompt', PROMPT);
      if (size) form.append('size', size);

      const r = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          Authorization: `Bearer ${openaiKey}`,
        },
        body: form,
      });

      if (!r.ok) {
        console.error('OpenAI error', r.status, (await r.text()).slice(0, 500));
        return res.status(502).json({ error: 'upstream_error' });
      }

      const data = await r.json();
      const first = data?.data?.[0];
      if (!first) {
        console.error('OpenAI returned no image', JSON.stringify(data).slice(0, 500));
        return res.status(502).json({ error: 'no_image' });
      }

      if (first.b64_json) {
        return res.status(200).json({ image: `data:image/png;base64,${first.b64_json}` });
      }

      if (first.url) {
        const imgRes = await fetch(first.url, { signal: ctrl.signal });
        if (!imgRes.ok) return res.status(502).json({ error: 'image_download_failed' });
        const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
        const imgMime = imgRes.headers.get('content-type') || 'image/png';
        return res.status(200).json({ image: `data:${imgMime};base64,${imgBuffer.toString('base64')}` });
      }

      return res.status(502).json({ error: 'no_image' });
    }

    // ---- Google Gemini Provider (fallback) ----
    const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
    const generationConfig = { responseModalities: ['IMAGE', 'TEXT'] };
    if (process.env.GEMINI_ASPECT_RATIO) generationConfig.imageConfig = { aspectRatio: process.env.GEMINI_ASPECT_RATIO };

    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data: b64 } }] }],
        generationConfig,
      }),
    });
    if (!r.ok) {
      console.error('Gemini error', r.status, (await r.text()).slice(0, 500));
      return res.status(502).json({ error: 'upstream_error' });
    }
    const data = await r.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const img = parts.map((p) => p.inlineData || p.inline_data).find((d) => d && d.data);
    if (!img) {
      console.error('Gemini returned no image', JSON.stringify(data).slice(0, 500));
      return res.status(502).json({ error: 'no_image' });
    }
    return res.status(200).json({ image: `data:${img.mimeType || img.mime_type || 'image/png'};base64,${img.data}` });
  } catch (e) {
    const timeout = e?.name === 'AbortError';
    console.error('caricature failed', e?.message);
    return res.status(timeout ? 504 : 502).json({ error: timeout ? 'timeout' : 'upstream_error' });
  } finally {
    clearTimeout(timer);
  }
}
