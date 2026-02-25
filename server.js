const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const { GoogleGenAI } = require('@google/genai');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const AUTH_USER = process.env.AUTH_USER || 'admin';
const AUTH_PASS = process.env.AUTH_PASS || 'changeme';
const SESSION_SECRET = process.env.SESSION_SECRET || 'vibeui-dev-secret';

app.set('trust proxy', 1);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

// ─── Auth middleware ──────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session?.authed) return next();
  res.redirect('/login');
}

// ─── Login routes ─────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session?.authed) return res.redirect('/');
  res.send(loginPage());
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === AUTH_USER && password === AUTH_PASS) {
    req.session.authed = true;
    res.redirect('/');
  } else {
    res.send(loginPage('Wrong username or password.'));
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ─── Protected static files ───────────────────────────────
app.use(requireAuth, express.static(path.join(__dirname, 'public')));

// Rate limit: 5 AI requests per minute per IP
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many requests. Please wait a moment.' },
});

// ─── Health (public) ──────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true }));

// ─── POST /api/moodboard ─────────────────────────────────
// Generates a mood board image from vibes + app info
app.post('/api/moodboard', requireAuth, aiLimiter, async (req, res) => {
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
app.post('/api/preview', requireAuth, aiLimiter, async (req, res) => {
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
app.get('*', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Login page HTML ──────────────────────────────────────
function loginPage(error = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>VibeUI — Login</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'Plus Jakarta Sans', sans-serif;
  background: #0c0c0f;
  color: #f0f0f5;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
.box {
  background: #14141a;
  border: 1px solid #2a2a35;
  border-radius: 16px;
  padding: 40px 36px;
  width: 100%;
  max-width: 380px;
}
.logo { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
.logo span { color: #7c6fff; }
.subtitle { font-size: 13px; color: #7070a0; margin-bottom: 32px; }
label { font-size: 12px; font-weight: 600; color: #7070a0; display: block; margin-bottom: 6px; }
input {
  width: 100%; padding: 10px 14px;
  background: #1c1c24; border: 1px solid #2a2a35;
  border-radius: 8px; color: #f0f0f5; font-size: 14px;
  font-family: inherit; outline: none; margin-bottom: 16px;
  transition: border-color 0.15s;
}
input:focus { border-color: #7c6fff; }
.btn {
  width: 100%; padding: 11px;
  background: #7c6fff; color: white;
  border: none; border-radius: 8px;
  font-size: 14px; font-weight: 600;
  font-family: inherit; cursor: pointer;
  transition: background 0.15s;
}
.btn:hover { background: #9080ff; }
.error {
  background: rgba(239,68,68,0.1);
  border: 1px solid rgba(239,68,68,0.3);
  color: #ef4444; font-size: 13px;
  padding: 10px 12px; border-radius: 8px;
  margin-bottom: 16px;
}
</style>
</head>
<body>
<div class="box">
  <div class="logo">Vibe<span>UI</span></div>
  <div class="subtitle">Build a design system. Send to Claude Code. Ship.</div>
  ${error ? `<div class="error">${error}</div>` : ''}
  <form method="POST" action="/login">
    <label>Username</label>
    <input type="text" name="username" autofocus autocomplete="username" placeholder="Enter username">
    <label>Password</label>
    <input type="password" name="password" autocomplete="current-password" placeholder="Enter password">
    <button class="btn" type="submit">Sign in →</button>
  </form>
</div>
</body>
</html>`;
}

app.listen(PORT, () => {
  console.log(`VibeUI running at http://localhost:${PORT}`);
});
