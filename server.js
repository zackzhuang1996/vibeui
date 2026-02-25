const express = require('express');
const rateLimit = require('express-rate-limit');
const { GoogleGenAI } = require('@google/genai');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limit: 5 AI requests per minute per IP
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many requests. Please wait a moment.' },
});

// ─── Health ───────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true }));

// ─── POST /api/moodboard ──────────────────────────────────
// Generates a mood board image from vibes + app info
app.post('/api/moodboard', aiLimiter, async (req, res) => {
  const { appName, appDesc, vibes, techStack } = req.body;

  if (!vibes?.length) {
    return res.status(400).json({ error: 'vibes is required' });
  }

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
  }

  const vibeStr = vibes.join(', ');
  const prompt = `Create a professional, high-quality design mood board for a ${vibeStr} application${appName ? ` called "${appName}"` : ''}${appDesc ? ` — ${appDesc}` : ''}.

The mood board should be a clean 2×2 grid layout on a dark background, featuring:
- Top-left: Color palette of 6 swatches with hex codes, arranged elegantly
- Top-right: Typography inspiration — two complementary font styles (NOT Inter), shown as sample text
- Bottom-left: UI element sketches — buttons, cards, minimal icons that match the vibe
- Bottom-right: Atmospheric/texture/pattern imagery that captures the ${vibeStr} mood

Overall style: ${vibeStr}. No generic gradients. No blue-purple AI clichés. Make it feel unique and directional.
Output as a single cohesive image, professional design industry standard.`;

  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: prompt,
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    });

    let imageBase64 = null;
    let mimeType = 'image/png';

    const parts = response.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        imageBase64 = part.inlineData.data;
        mimeType = part.inlineData.mimeType || 'image/png';
        break;
      }
    }

    if (!imageBase64) {
      return res.status(500).json({ error: 'No image generated' });
    }

    res.json({ image: imageBase64, mimeType });
  } catch (err) {
    console.error('Moodboard error:', err.message);
    res.status(500).json({ error: err.message || 'Generation failed' });
  }
});

// ─── POST /api/preview ────────────────────────────────────
// Generates a UI preview image from the full design system
app.post('/api/preview', aiLimiter, async (req, res) => {
  const { appName, appDesc, audience, vibes, colors, fontHeading, fontBody, pages, radius } = req.body;

  if (!appName || !colors) {
    return res.status(400).json({ error: 'appName and colors are required' });
  }

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
  }

  const vibeStr = (vibes || []).join(', ');
  const pageList = (pages || ['Landing Page']).slice(0, 3).join(', ');

  const prompt = `Create a high-fidelity UI mockup screenshot for "${appName}" — ${appDesc || 'a modern web application'}.

Design specifications to follow EXACTLY:
- Background: ${colors.bg}
- Surface/cards: ${colors.surface}
- Primary text: ${colors.textPrimary}
- Secondary text: ${colors.textSecondary}
- Accent/CTA color: ${colors.accent}
- Border color: ${colors.border}
- Heading font style: ${fontHeading || 'elegant serif'}
- Body font style: ${fontBody || 'clean sans-serif'}
- Border radius style: ${radius || 'medium'} corners
- Visual vibe: ${vibeStr || 'modern, clean'}

Show a desktop-width landing page with:
1. Navigation bar: logo "${appName}" on left, 4 nav links, CTA button on right
2. Hero section: large headline (2-3 words), supporting subtext describing "${appDesc || appName}", two CTAs side by side
3. Three feature cards in a row on the surface color, each with an icon, title, and description

Target audience: ${audience || 'modern users'}
Pages in this app: ${pageList}

Make it look like a real, polished, production-ready website screenshot. Use the exact colors specified. No wireframe style — full color, full detail.`;

  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: prompt,
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    });

    let imageBase64 = null;
    let mimeType = 'image/png';

    const parts = response.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        imageBase64 = part.inlineData.data;
        mimeType = part.inlineData.mimeType || 'image/png';
        break;
      }
    }

    if (!imageBase64) {
      return res.status(500).json({ error: 'No image generated' });
    }

    res.json({ image: imageBase64, mimeType });
  } catch (err) {
    console.error('Preview error:', err.message);
    res.status(500).json({ error: err.message || 'Generation failed' });
  }
});

// ─── Fallback ─────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`VibeUI running at http://localhost:${PORT}`);
});
