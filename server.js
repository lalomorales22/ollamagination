const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { PNG } = require('pngjs');
const GifWriter = require('omggif').GifWriter;

const app = express();
const PORT = 3333;
const OLLAMA = 'http://127.0.0.1:11434';

const GALLERY = path.join(__dirname, 'gallery');
const DATA = path.join(__dirname, 'data');
['images', 'comics', 'collections', 'animations'].forEach(d =>
  fs.mkdirSync(path.join(GALLERY, d), { recursive: true })
);
fs.mkdirSync(DATA, { recursive: true });

app.use(express.json({ limit: '500mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/gallery', express.static(GALLERY));

// ─── Generation Queue (one Ollama call at a time) ───────────────────────────
const genQueue = [];
let genActive = null;

function enqueue(label, fn) {
  return new Promise((resolve, reject) => {
    const item = { label, fn, resolve, reject, ts: Date.now() };
    genQueue.push(item);
    broadcastQueueStatus();
    processQueue();
  });
}

async function processQueue() {
  if (genActive || genQueue.length === 0) return;
  genActive = genQueue.shift();
  broadcastQueueStatus();
  try {
    const result = await genActive.fn();
    genActive.resolve(result);
  } catch (e) {
    genActive.reject(e);
  } finally {
    genActive = null;
    broadcastQueueStatus();
    processQueue();
  }
}

const queueClients = [];

function broadcastQueueStatus() {
  const status = {
    active: genActive ? genActive.label : null,
    queued: genQueue.map((q, i) => ({ position: i + 1, label: q.label })),
    length: genQueue.length
  };
  const msg = `data: ${JSON.stringify(status)}\n\n`;
  queueClients.forEach(c => { try { c.write(msg); } catch {} });
}

app.get('/api/queue/status', (req, res) => {
  res.json({
    active: genActive ? genActive.label : null,
    queued: genQueue.map((q, i) => ({ position: i + 1, label: q.label })),
    length: genQueue.length
  });
});

app.get('/api/queue/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  queueClients.push(res);
  req.on('close', () => {
    const idx = queueClients.indexOf(res);
    if (idx >= 0) queueClients.splice(idx, 1);
  });
  broadcastQueueStatus();
});

// ─── Prompt History ─────────────────────────────────────────────────────────
const HIST_FILE = path.join(DATA, 'history.json');

function loadHistory() {
  try { return JSON.parse(fs.readFileSync(HIST_FILE, 'utf8')); }
  catch { return { hashes: {}, count: 0 }; }
}

function saveHistory(h) { fs.writeFileSync(HIST_FILE, JSON.stringify(h)); }

function promptHash(p) {
  return crypto.createHash('sha256').update(p.trim().toLowerCase()).digest('hex').slice(0, 16);
}

function isDuplicate(prompt) { return !!loadHistory().hashes[promptHash(prompt)]; }

function recordPrompt(prompt, meta) {
  const h = loadHistory();
  const hash = promptHash(prompt);
  if (h.hashes[hash]) return false;
  h.hashes[hash] = { prompt: prompt.slice(0, 200), ts: Date.now(), ...meta };
  h.count++;
  saveHistory(h);
  return true;
}

// ─── Gallery Metadata ───────────────────────────────────────────────────────
const GAL_FILE = path.join(DATA, 'gallery.json');

function loadGalleryData() {
  try { return JSON.parse(fs.readFileSync(GAL_FILE, 'utf8')); }
  catch { return []; }
}

function saveGalleryData(g) { fs.writeFileSync(GAL_FILE, JSON.stringify(g)); }

function addToGallery(item) {
  const g = loadGalleryData();
  g.unshift(item);
  saveGalleryData(g);
  return item;
}

// ─── Ollama Helpers (queued) ────────────────────────────────────────────────
async function ollamaGenerateRaw(model, prompt, opts = {}) {
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false, ...opts })
  });
  return await res.json();
}

async function ollamaChatRaw(model, messages, opts = {}) {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false, ...opts })
  });
  const data = await res.json();
  return data.message?.content || data.response || '';
}

function ollamaGenerate(model, prompt, label, opts = {}) {
  return enqueue(label || `Image: ${prompt.slice(0, 40)}...`, () => ollamaGenerateRaw(model, prompt, opts));
}

function ollamaChat(model, messages, label, opts = {}) {
  return enqueue(label || 'Chat', () => ollamaChatRaw(model, messages, opts));
}

function extractImage(data) {
  if (data.images && data.images.length > 0) return data.images[0];
  if (data.image) return data.image;
  if (typeof data.response === 'string' && data.response.length > 1000) {
    const clean = data.response.replace(/^data:image\/\w+;base64,/, '');
    try { Buffer.from(clean, 'base64'); return clean; } catch {}
  }
  return null;
}

function saveImageFile(base64, subdir, prefix = 'img') {
  const id = `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const filename = `${id}.png`;
  const filepath = path.join(GALLERY, subdir, filename);
  const buf = Buffer.from(base64, 'base64');
  fs.writeFileSync(filepath, buf);
  return { id, filename, path: `/gallery/${subdir}/${filename}`, size: buf.length };
}

// ─── API: Models ────────────────────────────────────────────────────────────
app.get('/api/models', async (req, res) => {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`);
    const data = await r.json();
    const models = (data.models || []).map(m => ({
      name: m.name,
      size: m.size,
      family: m.details?.family || '',
      format: m.details?.format || '',
      params: m.details?.parameter_size || '',
      isImage: m.details?.format === 'safetensors'
    }));
    res.json({ models });
  } catch (e) {
    res.status(500).json({ error: 'Cannot connect to Ollama. Is it running?' });
  }
});

// ─── API: Generate Image ────────────────────────────────────────────────────
app.post('/api/generate/image', async (req, res) => {
  const { model, prompt } = req.body;
  if (!model || !prompt) return res.status(400).json({ error: 'model and prompt required' });
  try {
    const data = await ollamaGenerate(model, prompt, `Create: ${prompt.slice(0, 50)}`);
    const img = extractImage(data);
    if (!img) return res.json({ success: false, error: 'No image returned', keys: Object.keys(data) });
    const file = saveImageFile(img, 'images');
    const item = { ...file, type: 'image', prompt, model, ts: Date.now() };
    addToGallery(item);
    recordPrompt(prompt, { model, type: 'image' });
    res.json({ success: true, item, image: img });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── API: Generate Variation ────────────────────────────────────────────────
app.post('/api/generate/variation', async (req, res) => {
  const { model, prompt, chatModel } = req.body;
  if (!model || !prompt) return res.status(400).json({ error: 'model and prompt required' });
  try {
    let varPrompt = prompt;
    if (chatModel) {
      const enhanced = await ollamaChat(chatModel, [
        { role: 'system', content: 'You are a creative image prompt engineer. Given an existing image prompt, create a fresh variation. Output ONLY the new prompt.' },
        { role: 'user', content: `Create a variation of: "${prompt}"` }
      ], 'Variation prompt');
      if (enhanced && enhanced.trim()) varPrompt = enhanced.replace(/^["']|["']$/g, '').trim();
    }
    const data = await ollamaGenerate(model, varPrompt, `Variation: ${varPrompt.slice(0, 50)}`);
    const img = extractImage(data);
    if (!img) return res.json({ success: false, error: 'No image returned' });
    const file = saveImageFile(img, 'images');
    const item = { ...file, type: 'image', prompt: varPrompt, model, ts: Date.now() };
    addToGallery(item);
    recordPrompt(varPrompt, { model, type: 'variation' });
    res.json({ success: true, item, image: img });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── API: Generate Text ─────────────────────────────────────────────────────
app.post('/api/generate/text', async (req, res) => {
  const { model, messages } = req.body;
  try {
    const text = await ollamaChat(model, messages, 'Text generation');
    res.json({ success: true, text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── API: Enhance Prompt ────────────────────────────────────────────────────
app.post('/api/enhance-prompt', async (req, res) => {
  const { model, prompt, context } = req.body;
  if (!model || !prompt) return res.status(400).json({ error: 'model and prompt required' });
  try {
    const sysMsg = context === 'comic'
      ? 'You are a comic book story expert. Enhance the user\'s theme with richer details, characters, settings. Output ONLY the enhanced theme.'
      : 'You are a master image prompt engineer. Enhance the user\'s prompt with composition, lighting, colors, mood details. Output ONLY the enhanced prompt.';
    const text = await ollamaChat(model, [
      { role: 'system', content: sysMsg },
      { role: 'user', content: `Enhance this: "${prompt}"` }
    ], `Enhance: ${prompt.slice(0, 40)}`);
    const enhanced = text.replace(/^["']|["']$/g, '').trim();
    res.json({ success: true, enhanced });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── API: Gallery ───────────────────────────────────────────────────────────
app.get('/api/gallery', (req, res) => {
  const type = req.query.type;
  let items = loadGalleryData();
  if (type && type !== 'all') items = items.filter(i => i.type === type);
  res.json({ items });
});

app.delete('/api/gallery/:id', (req, res) => {
  const g = loadGalleryData();
  const idx = g.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const item = g[idx];
  try { fs.unlinkSync(path.join(__dirname, item.path)); } catch {}
  g.splice(idx, 1);
  saveGalleryData(g);
  res.json({ success: true });
});

app.post('/api/gallery/:id/favorite', (req, res) => {
  const g = loadGalleryData();
  const idx = g.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  g[idx].favorite = !g[idx].favorite;
  saveGalleryData(g);
  res.json({ success: true, favorite: g[idx].favorite });
});

// ─── API: Export GIF ────────────────────────────────────────────────────────
app.post('/api/export/gif', async (req, res) => {
  try {
    const { frames: frameData } = req.body;
    if (!frameData || !frameData.length) return res.status(400).json({ error: 'No frames' });

    const TARGET_W = 480;
    const TARGET_H = 320;

    const decodedFrames = frameData.map(f => {
      const buf = Buffer.from(f.data.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      const png = PNG.sync.read(buf);
      return { png, delay: Math.max(1, Math.round((f.delay || 2000) / 10)) };
    });

    // Build palette from all frames
    const colorCounts = {};
    decodedFrames.forEach(({ png }) => {
      const { width, height, data } = png;
      const xStep = Math.max(1, Math.floor(width / TARGET_W));
      const yStep = Math.max(1, Math.floor(height / TARGET_H));
      for (let y = 0; y < height; y += yStep) {
        for (let x = 0; x < width; x += xStep) {
          const idx = (y * width + x) * 4;
          const key = ((data[idx] >> 3) << 10) | ((data[idx + 1] >> 3) << 5) | (data[idx + 2] >> 3);
          colorCounts[key] = (colorCounts[key] || 0) + 1;
        }
      }
    });

    const topColors = Object.entries(colorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 256)
      .map(e => {
        const k = parseInt(e[0]);
        return [((k >> 10) & 31) << 3, ((k >> 5) & 31) << 3, (k & 31) << 3];
      });
    while (topColors.length < 256) topColors.push([0, 0, 0]);

    const flatPalette = [];
    topColors.forEach(c => flatPalette.push((c[0] << 16) | (c[1] << 8) | c[2]));

    function nearestIdx(r, g, b) {
      let best = 0, bestDist = Infinity;
      for (let i = 0; i < topColors.length; i++) {
        const d = (r - topColors[i][0]) ** 2 + (g - topColors[i][1]) ** 2 + (b - topColors[i][2]) ** 2;
        if (d < bestDist) { bestDist = d; best = i; }
        if (d === 0) break;
      }
      return best;
    }

    const bufSize = TARGET_W * TARGET_H * decodedFrames.length * 2 + 65536;
    const gifBuf = Buffer.alloc(bufSize);
    const gf = new GifWriter(gifBuf, TARGET_W, TARGET_H, { palette: flatPalette, loop: 0 });

    decodedFrames.forEach(({ png, delay }) => {
      const { width, height, data } = png;
      const indexed = new Uint8Array(TARGET_W * TARGET_H);
      for (let y = 0; y < TARGET_H; y++) {
        for (let x = 0; x < TARGET_W; x++) {
          const sx = Math.floor(x * width / TARGET_W);
          const sy = Math.floor(y * height / TARGET_H);
          const si = (sy * width + sx) * 4;
          indexed[y * TARGET_W + x] = nearestIdx(data[si], data[si + 1], data[si + 2]);
        }
      }
      gf.addFrame(0, 0, TARGET_W, TARGET_H, indexed, { delay });
    });

    const gifBytes = gifBuf.slice(0, gf.end());
    const gifId = `gif_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const gifFilename = `${gifId}.gif`;
    fs.writeFileSync(path.join(GALLERY, 'animations', gifFilename), gifBytes);

    res.json({ success: true, path: `/gallery/animations/${gifFilename}`, filename: gifFilename });
  } catch (e) {
    console.error('GIF export error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── API: Auto Generate (SSE) ──────────────────────────────────────────────
let autoSession = null;

app.post('/api/auto/start', (req, res) => {
  if (autoSession?.active && autoSession.clients.length === 0) {
    autoSession.active = false;
    autoSession = null;
  }
  if (autoSession?.active) return res.json({ error: 'Session already running' });

  const { imageModel, chatModel, styles, theme, count, type, include, exclude } = req.body;
  autoSession = {
    active: true, imageModel, chatModel, styles: styles || [], theme: theme || '',
    count: count || 20, type: type || 'random', include: include || '', exclude: exclude || '',
    generated: 0, clients: [], collectionId: `col_${Date.now()}`
  };
  fs.mkdirSync(path.join(GALLERY, 'collections', autoSession.collectionId), { recursive: true });
  runAutoLoop();
  res.json({ success: true, sessionId: autoSession.collectionId });
});

app.post('/api/auto/stop', (req, res) => {
  if (autoSession) autoSession.active = false;
  res.json({ success: true });
});

app.post('/api/auto/reset', (req, res) => {
  if (autoSession) autoSession.active = false;
  autoSession = null;
  res.json({ success: true });
});

app.get('/api/auto/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  if (!autoSession) autoSession = { active: false, clients: [] };
  autoSession.clients.push(res);
  req.on('close', () => {
    if (autoSession) autoSession.clients = autoSession.clients.filter(c => c !== res);
  });
});

function broadcastAuto(event, data) {
  if (!autoSession) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  autoSession.clients.forEach(c => { try { c.write(msg); } catch {} });
}

async function generateAutoPrompt(session, index) {
  const styleList = session.styles.length > 0
    ? session.styles[Math.floor(Math.random() * session.styles.length)]
    : 'digital art';
  const sysPrompt = `You are a creative image prompt engineer. Generate a single, unique, detailed image prompt.
- Output ONLY the prompt text
- Style: ${styleList}
- Theme: ${session.theme || 'diverse and creative'}
${session.include ? `- Must include: ${session.include}` : ''}
${session.exclude ? `- Must NOT include: ${session.exclude}` : ''}
- Image #${index + 1} of ${session.count}. Make each distinct.`;

  let prompt = await ollamaChat(session.chatModel, [
    { role: 'system', content: sysPrompt },
    { role: 'user', content: `Prompt #${index + 1}. Seed: ${crypto.randomBytes(8).toString('hex')}` }
  ], `Auto prompt #${index + 1}`);
  return `${prompt.replace(/^["']|["']$/g, '').trim()}, ${styleList} style`;
}

async function runAutoLoop() {
  if (!autoSession) return;
  broadcastAuto('status', { message: 'Auto generation started', total: autoSession.count });

  for (let i = 0; i < autoSession.count && autoSession.active; i++) {
    try {
      broadcastAuto('progress', { step: 'prompt', index: i, total: autoSession.count });
      const prompt = await generateAutoPrompt(autoSession, i);
      broadcastAuto('progress', { step: 'image', index: i, prompt, total: autoSession.count });

      const data = await ollamaGenerate(autoSession.imageModel, prompt, `Auto #${i + 1}`);
      const img = extractImage(data);
      if (img) {
        const subdir = `collections/${autoSession.collectionId}`;
        const file = saveImageFile(img, subdir, 'auto');
        const item = { ...file, type: 'collection', collectionId: autoSession.collectionId, prompt, model: autoSession.imageModel, ts: Date.now() };
        addToGallery(item);
        recordPrompt(prompt, { model: autoSession.imageModel, type: 'auto' });
        autoSession.generated++;
        broadcastAuto('image', { index: i, item, image: img, total: autoSession.count });
      } else {
        broadcastAuto('error', { index: i, message: 'No image returned' });
      }
    } catch (e) {
      broadcastAuto('error', { index: i, message: e.message });
    }
  }
  autoSession.active = false;
  broadcastAuto('complete', { total: autoSession.generated });
}

// ─── API: Comic Book Generation (SSE) ──────────────────────────────────────
let comicSession = null;

app.post('/api/comic/start', (req, res) => {
  if (comicSession?.active && comicSession.clients.length === 0) {
    comicSession.active = false;
    comicSession = null;
  }
  if (comicSession?.active) return res.json({ error: 'Comic session already running' });

  const { imageModel, chatModel, title, theme, pages, style, include, exclude } = req.body;
  const comicId = `comic_${Date.now()}`;
  fs.mkdirSync(path.join(GALLERY, 'comics', comicId), { recursive: true });
  comicSession = {
    active: true, imageModel, chatModel, title, theme, pages: pages || 10,
    style: style || 'comic book', include: include || '', exclude: exclude || '',
    comicId, generated: 0, clients: [], pageData: [], _started: false
  };
  res.json({ success: true, comicId });
});

app.post('/api/comic/stop', (req, res) => {
  if (comicSession) comicSession.active = false;
  res.json({ success: true });
});

app.post('/api/comic/reset', (req, res) => {
  if (comicSession) comicSession.active = false;
  comicSession = null;
  res.json({ success: true });
});

app.get('/api/comic/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  if (!comicSession) comicSession = { active: false, clients: [] };
  comicSession.clients.push(res);
  req.on('close', () => {
    if (comicSession) comicSession.clients = comicSession.clients.filter(c => c !== res);
  });
  if (comicSession.active && !comicSession._started) {
    comicSession._started = true;
    runComicLoop();
  }
});

function broadcastComic(event, data) {
  if (!comicSession) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  comicSession.clients.forEach(c => { try { c.write(msg); } catch {} });
}

async function runComicLoop() {
  if (!comicSession) return;
  const s = comicSession;
  broadcastComic('status', { message: 'Generating story outline...', total: s.pages });

  try {
    const outlinePrompt = `You are a comic book writer. Create a ${s.pages}-page comic book outline.
Title: "${s.title}"
Theme: ${s.theme}
Style: ${s.style}
${s.include ? `Include: ${s.include}` : ''}
${s.exclude ? `Avoid: ${s.exclude}` : ''}

For each page, provide a JSON array with: "page", "scene" (visual description), "caption" (dialogue/narration).
Output ONLY valid JSON array.`;

    const outlineText = await ollamaChat(s.chatModel, [
      { role: 'system', content: 'You output only valid JSON. No markdown fences.' },
      { role: 'user', content: outlinePrompt }
    ], `Comic outline: ${s.title}`);

    let pages;
    try {
      pages = JSON.parse(outlineText.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
    } catch {
      const match = outlineText.match(/\[[\s\S]*\]/);
      if (match) pages = JSON.parse(match[0]);
      else throw new Error('Failed to parse story outline');
    }

    broadcastComic('outline', { pages: pages.length, outline: pages });

    for (let i = 0; i < pages.length && s.active; i++) {
      const page = pages[i];
      const imgPrompt = `${page.scene}, ${s.style} style, comic book panel, highly detailed`;
      broadcastComic('progress', { page: i + 1, total: pages.length, step: 'generating', prompt: imgPrompt, caption: page.caption });

      const data = await ollamaGenerate(s.imageModel, imgPrompt, `Comic page ${i + 1}/${pages.length}`);
      const img = extractImage(data);
      if (img) {
        const file = saveImageFile(img, `comics/${s.comicId}`, `page_${String(i + 1).padStart(3, '0')}`);
        const item = { ...file, type: 'comic', comicId: s.comicId, page: i + 1, prompt: imgPrompt, caption: page.caption, model: s.imageModel, ts: Date.now() };
        addToGallery(item);
        recordPrompt(imgPrompt, { model: s.imageModel, type: 'comic' });
        s.generated++;
        s.pageData.push({ page: i + 1, ...file, caption: page.caption });
        broadcastComic('page', { page: i + 1, item, image: img, caption: page.caption, total: pages.length });
      } else {
        broadcastComic('error', { page: i + 1, message: 'No image returned' });
      }
    }

    const meta = { title: s.title, theme: s.theme, style: s.style, pages: s.pageData, createdAt: Date.now() };
    fs.writeFileSync(path.join(GALLERY, 'comics', s.comicId, 'meta.json'), JSON.stringify(meta, null, 2));
  } catch (e) {
    broadcastComic('error', { message: e.message });
  }

  s.active = false;
  broadcastComic('complete', { total: s.generated, comicId: s.comicId });
}

// ─── API: History / Stats ───────────────────────────────────────────────────
app.get('/api/history', (req, res) => {
  const h = loadHistory();
  res.json({ count: h.count, recent: Object.values(h.hashes).slice(-50).reverse() });
});

app.get('/api/stats', (req, res) => {
  const g = loadGalleryData();
  const h = loadHistory();
  res.json({
    totalImages: g.length,
    totalPrompts: h.count,
    images: g.filter(i => i.type === 'image').length,
    collections: [...new Set(g.filter(i => i.type === 'collection').map(i => i.collectionId))].length,
    comics: [...new Set(g.filter(i => i.type === 'comic').map(i => i.comicId))].length
  });
});

// ─── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  ✦ OLLAMAGINATION is running at http://localhost:${PORT}\n`);
});
