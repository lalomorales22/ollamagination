/* ═══════════════════════════════════════════════════════════════════════════
   OLLAMAGINATION — Main Application
   ═══════════════════════════════════════════════════════════════════════════ */

const API = '';
let state = {
  imageModels: [],
  chatModels: [],
  selectedStyle: null,
  autoSelectedStyles: new Set(),
  generating: false,
  autoRunning: false,
  comicRunning: false
};

// ─── Init ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initNav();
  initStyles();
  initAutoStyles();
  initComicStyles();
  initGalleryFilters();
  initModal();
  initEnhance();
  initEditor();
  initQueueStatus();
  await loadModels();
  await loadGallery();
  loadStats();
  setStatus('Ready — Choose your vision');
});

// ─── Queue Status (SSE) ──────────────────────────────────────────────────
function initQueueStatus() {
  const evtSource = new EventSource(`${API}/api/queue/events`);
  evtSource.onmessage = (e) => {
    const data = JSON.parse(e.data);
    const bar = document.getElementById('queueBar');
    const label = document.getElementById('queueLabel');
    const count = document.getElementById('queueCount');
    const fill = document.getElementById('queueProgressFill');

    if (data.active || data.length > 0) {
      bar.style.display = 'flex';
      label.textContent = data.active || 'Waiting...';
      fill.classList.add('pulse-anim');
      count.textContent = data.length > 0 ? `+${data.length} queued` : '';
    } else {
      bar.style.display = 'none';
      fill.classList.remove('pulse-anim');
    }
  };
}

// ─── Navigation ──────────────────────────────────────────────────────────
function initNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`view-${btn.dataset.view}`).classList.add('active');
      if (btn.dataset.view === 'gallery') loadGallery();
    });
  });
}

// ─── Models ──────────────────────────────────────────────────────────────
async function loadModels() {
  try {
    const res = await fetch(`${API}/api/models`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const imageSelect = document.getElementById('imageModel');
    const chatSelect = document.getElementById('chatModel');
    imageSelect.innerHTML = '';
    chatSelect.innerHTML = '';

    state.imageModels = data.models.filter(m => m.isImage);
    state.chatModels = data.models.filter(m => !m.isImage);

    state.imageModels.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.name;
      opt.textContent = `${m.name}${m.params ? ` (${m.params})` : ''}`;
      imageSelect.appendChild(opt);
    });

    state.chatModels.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.name;
      opt.textContent = `${m.name}${m.params ? ` (${m.params})` : ''}`;
      chatSelect.appendChild(opt);
    });

    document.getElementById('ollamaStatus').classList.remove('offline');
    document.getElementById('ollamaStatus').title = `Ollama connected — ${data.models.length} models`;
  } catch (e) {
    document.getElementById('ollamaStatus').classList.add('offline');
    document.getElementById('ollamaStatus').title = 'Ollama offline';
    toast('Cannot connect to Ollama. Is it running?', 'error');
  }
}

// ─── Style Presets ───────────────────────────────────────────────────────
function initStyles() {
  const catContainer = document.getElementById('styleCategories');
  const grid = document.getElementById('styleGrid');
  const search = document.getElementById('styleSearch');

  const allBtn = document.createElement('button');
  allBtn.className = 'cat-btn active';
  allBtn.textContent = 'All';
  allBtn.onclick = () => filterStyles('all');
  catContainer.appendChild(allBtn);

  STYLE_CATEGORIES.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'cat-btn';
    btn.textContent = cat;
    btn.onclick = () => filterStyles(cat);
    catContainer.appendChild(btn);
  });

  renderStyleGrid(STYLE_PRESETS);

  search.addEventListener('input', () => {
    const q = search.value.toLowerCase();
    const filtered = STYLE_PRESETS.filter(s =>
      s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q)
    );
    renderStyleGrid(filtered);
  });

  document.getElementById('generateBtn').addEventListener('click', generateSingle);
}

function renderStyleGrid(styles) {
  const grid = document.getElementById('styleGrid');
  grid.innerHTML = '';
  styles.forEach(s => {
    const card = document.createElement('div');
    card.className = `style-card${state.selectedStyle?.id === s.id ? ' selected' : ''}`;
    card.textContent = s.name;
    card.title = s.prompt;
    card.onclick = () => {
      state.selectedStyle = state.selectedStyle?.id === s.id ? null : s;
      document.querySelectorAll('#styleGrid .style-card').forEach(c => c.classList.remove('selected'));
      if (state.selectedStyle) card.classList.add('selected');
    };
    grid.appendChild(card);
  });
}

function filterStyles(cat) {
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  const filtered = cat === 'all' ? STYLE_PRESETS : STYLE_PRESETS.filter(s => s.category === cat);
  renderStyleGrid(filtered);
}

// ─── Single Generation ───────────────────────────────────────────────────
async function generateSingle() {
  const prompt = document.getElementById('promptInput').value.trim();
  const model = document.getElementById('imageModel').value;

  if (!prompt && !state.selectedStyle) {
    toast('Enter a prompt or select a style', 'error');
    return;
  }
  if (!model) {
    toast('Select an image model', 'error');
    return;
  }

  const fullPrompt = [prompt, state.selectedStyle?.prompt].filter(Boolean).join(', ');
  state.generating = true;
  toggleGenerateBtn(true);
  document.getElementById('createProgress').style.display = '';
  document.getElementById('generateStatus').textContent = 'Queued...';
  setStatus('Queued for generation...');

  try {
    document.getElementById('generateStatus').textContent = 'Generating...';
    const res = await fetch(`${API}/api/generate/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: fullPrompt })
    });
    const data = await res.json();

    if (data.success && data.image) {
      showPreview(`data:image/png;base64,${data.image}`, data.item);
      setStatus('Image generated successfully');
      toast('Image created!', 'success');
      loadStats();
    } else {
      setStatus('Generation failed');
      toast(data.error || 'No image returned. Check model compatibility.', 'error');
    }
  } catch (e) {
    setStatus('Error');
    toast(`Error: ${e.message}`, 'error');
  } finally {
    state.generating = false;
    toggleGenerateBtn(false);
    document.getElementById('createProgress').style.display = 'none';
  }
}

function toggleGenerateBtn(loading) {
  const btn = document.getElementById('generateBtn');
  btn.querySelector('.btn-text').style.display = loading ? 'none' : '';
  btn.querySelector('.btn-loading').style.display = loading ? '' : 'none';
  btn.disabled = loading;
}

function showPreview(src, item) {
  const area = document.getElementById('previewArea');
  area.innerHTML = '';
  const img = document.createElement('img');
  img.src = src;
  img.className = 'fade-in';
  img.onclick = () => openModal(item);
  area.appendChild(img);
}

// ─── Auto Mode ───────────────────────────────────────────────────────────
function initAutoStyles() {
  const grid = document.getElementById('autoStyleGrid');
  STYLE_PRESETS.forEach(s => {
    const chip = document.createElement('div');
    chip.className = 'auto-style-chip';
    chip.textContent = s.name;
    chip.title = s.prompt;
    chip.onclick = () => {
      if (state.autoSelectedStyles.has(s.name)) {
        state.autoSelectedStyles.delete(s.name);
        chip.classList.remove('selected');
      } else {
        state.autoSelectedStyles.add(s.name);
        chip.classList.add('selected');
      }
    };
    grid.appendChild(chip);
  });

  document.getElementById('startAutoBtn').addEventListener('click', startAuto);
  document.getElementById('stopAutoBtn').addEventListener('click', stopAuto);
}

async function startAuto() {
  const imageModel = document.getElementById('imageModel').value;
  const chatModel = document.getElementById('chatModel').value;

  if (!imageModel || !chatModel) {
    toast('Select both image and chat models', 'error');
    return;
  }

  const config = {
    imageModel,
    chatModel,
    type: document.getElementById('autoType').value,
    theme: document.getElementById('autoTheme').value,
    include: document.getElementById('autoInclude').value,
    exclude: document.getElementById('autoExclude').value,
    styles: [...state.autoSelectedStyles],
    count: parseInt(document.getElementById('autoCount').value) || 20
  };

  try {
    const res = await fetch(`${API}/api/auto/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    let data = await res.json();
    if (data.error) {
      await fetch(`${API}/api/auto/reset`, { method: 'POST' });
      const retry = await fetch(`${API}/api/auto/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      data = await retry.json();
      if (data.error) {
        toast(data.error, 'error');
        return;
      }
    }

    state.autoRunning = true;
    document.getElementById('startAutoBtn').style.display = 'none';
    document.getElementById('stopAutoBtn').style.display = '';
    document.getElementById('autoProgress').style.display = 'flex';
    document.getElementById('autoGrid').innerHTML = '';

    const evtSource = new EventSource(`${API}/api/auto/events`);
    state.autoEventSource = evtSource;

    evtSource.addEventListener('progress', e => {
      const d = JSON.parse(e.data);
      const pct = ((d.index + 1) / d.total * 100);
      document.getElementById('autoProgressFill').style.width = `${pct}%`;
      document.getElementById('autoProgressText').textContent = `${d.index + 1} / ${d.total}`;
      document.getElementById('autoStatus').textContent = d.step === 'prompt' ? 'Crafting prompt...' : 'Generating image...';
      if (d.prompt) setStatus(`Auto: ${d.prompt.slice(0, 80)}...`);
    });

    evtSource.addEventListener('image', e => {
      const d = JSON.parse(e.data);
      addAutoCard(d);
      loadStats();
    });

    evtSource.addEventListener('error', e => {
      try {
        const d = JSON.parse(e.data);
        toast(`Auto error: ${d.message}`, 'error');
      } catch {}
    });

    evtSource.addEventListener('complete', e => {
      const d = JSON.parse(e.data);
      autoComplete(d.total);
    });

    evtSource.onerror = () => {
      if (state.autoRunning) autoComplete(0);
    };

  } catch (e) {
    toast(`Failed to start: ${e.message}`, 'error');
  }
}

function addAutoCard(d) {
  const grid = document.getElementById('autoGrid');
  const card = document.createElement('div');
  card.className = 'auto-image-card fade-in';
  card.innerHTML = `
    <img src="data:image/png;base64,${d.image}" alt="">
    <div class="card-overlay">${(d.item?.prompt || '').slice(0, 100)}</div>
  `;
  card.onclick = () => openModal(d.item);
  grid.prepend(card);
}

async function stopAuto() {
  await fetch(`${API}/api/auto/stop`, { method: 'POST' });
  autoComplete(0);
}

function autoComplete(total) {
  state.autoRunning = false;
  if (state.autoEventSource) { state.autoEventSource.close(); state.autoEventSource = null; }
  document.getElementById('startAutoBtn').style.display = '';
  document.getElementById('stopAutoBtn').style.display = 'none';
  document.getElementById('autoStatus').textContent = total > 0 ? `Done! ${total} images generated` : 'Stopped';
  setStatus('Auto generation complete');
  toast(total > 0 ? `Auto complete: ${total} images!` : 'Auto generation stopped', total > 0 ? 'success' : '');
  loadStats();
}

// ─── Comic Studio ────────────────────────────────────────────────────────
function initComicStyles() {
  const select = document.getElementById('comicStyle');
  STYLE_PRESETS.filter(s => ['Comics', 'Drawing', 'Digital'].includes(s.category)).forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.prompt;
    opt.textContent = s.name;
    select.appendChild(opt);
  });
  // Add remaining styles too
  STYLE_PRESETS.filter(s => !['Comics', 'Drawing', 'Digital'].includes(s.category)).forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.prompt;
    opt.textContent = s.name;
    select.appendChild(opt);
  });

  document.getElementById('startComicBtn').addEventListener('click', startComic);
  document.getElementById('stopComicBtn').addEventListener('click', stopComic);
}

async function startComic() {
  const imageModel = document.getElementById('imageModel').value;
  const chatModel = document.getElementById('chatModel').value;

  if (!imageModel || !chatModel) {
    toast('Select both image and chat models', 'error');
    return;
  }

  const title = document.getElementById('comicTitle').value.trim();
  const theme = document.getElementById('comicTheme').value.trim();
  if (!title || !theme) {
    toast('Enter a title and theme for your comic', 'error');
    return;
  }

  const config = {
    imageModel,
    chatModel,
    title,
    theme,
    pages: parseInt(document.getElementById('comicPages').value) || 6,
    style: document.getElementById('comicStyle').value,
    include: document.getElementById('comicInclude').value,
    exclude: document.getElementById('comicExclude').value
  };

  try {
    const res = await fetch(`${API}/api/comic/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    let data = await res.json();
    if (data.error) {
      // Auto-reset stale session and retry
      await fetch(`${API}/api/comic/reset`, { method: 'POST' });
      const retry = await fetch(`${API}/api/comic/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      data = await retry.json();
      if (data.error) {
        toast(data.error, 'error');
        return;
      }
    }

    state.comicRunning = true;
    document.getElementById('startComicBtn').style.display = 'none';
    document.getElementById('stopComicBtn').style.display = '';
    document.getElementById('comicProgress').style.display = 'flex';
    document.getElementById('comicGrid').innerHTML = '';

    const evtSource = new EventSource(`${API}/api/comic/events`);
    state.comicEventSource = evtSource;

    evtSource.addEventListener('status', e => {
      const d = JSON.parse(e.data);
      document.getElementById('comicStatus').textContent = d.message;
      setStatus(d.message);
    });

    evtSource.addEventListener('outline', e => {
      const d = JSON.parse(e.data);
      document.getElementById('comicStatus').textContent = `Story outlined: ${d.pages} pages`;
    });

    evtSource.addEventListener('progress', e => {
      const d = JSON.parse(e.data);
      const pct = (d.page / d.total * 100);
      document.getElementById('comicProgressFill').style.width = `${pct}%`;
      document.getElementById('comicProgressText').textContent = `Page ${d.page} / ${d.total}`;
      document.getElementById('comicStatus').textContent = `Generating page ${d.page}...`;
      setStatus(`Comic: Page ${d.page} — ${(d.prompt || '').slice(0, 60)}...`);
    });

    evtSource.addEventListener('page', e => {
      const d = JSON.parse(e.data);
      addComicCard(d);
      loadStats();
    });

    evtSource.addEventListener('error', e => {
      try {
        const d = JSON.parse(e.data);
        toast(`Comic error: ${d.message}`, 'error');
      } catch {}
    });

    evtSource.addEventListener('complete', e => {
      const d = JSON.parse(e.data);
      comicComplete(d.total);
    });

    evtSource.onerror = () => {
      if (state.comicRunning) comicComplete(0);
    };

  } catch (e) {
    toast(`Failed to start: ${e.message}`, 'error');
  }
}

function addComicCard(d) {
  const grid = document.getElementById('comicGrid');
  const card = document.createElement('div');
  card.className = 'comic-page-card fade-in';
  card.innerHTML = `
    <img src="data:image/png;base64,${d.image}" alt="Page ${d.page}">
    <span class="page-number">Page ${d.page}</span>
    <div class="card-overlay">${d.caption || ''}</div>
  `;
  card.onclick = () => openModal(d.item);
  grid.appendChild(card);
}

async function stopComic() {
  await fetch(`${API}/api/comic/stop`, { method: 'POST' });
  comicComplete(0);
}

function comicComplete(total) {
  state.comicRunning = false;
  if (state.comicEventSource) { state.comicEventSource.close(); state.comicEventSource = null; }
  document.getElementById('startComicBtn').style.display = '';
  document.getElementById('stopComicBtn').style.display = 'none';
  document.getElementById('comicStatus').textContent = total > 0 ? `Done! ${total} pages created` : 'Stopped';
  setStatus('Comic generation complete');
  toast(total > 0 ? `Comic complete: ${total} pages!` : 'Comic generation stopped', total > 0 ? 'success' : '');
  loadStats();
}

// ─── Gallery ─────────────────────────────────────────────────────────────
let galleryFilter = 'all';

function initGalleryFilters() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      galleryFilter = btn.dataset.filter;
      loadGallery();
    });
  });
}

async function loadGallery() {
  try {
    const res = await fetch(`${API}/api/gallery?type=${galleryFilter}`);
    const data = await res.json();
    const grid = document.getElementById('galleryGrid');
    const empty = document.getElementById('galleryEmpty');

    grid.innerHTML = '';
    if (!data.items || data.items.length === 0) {
      grid.style.display = 'none';
      empty.style.display = 'flex';
      return;
    }

    grid.style.display = 'grid';
    empty.style.display = 'none';

    data.items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'gallery-card fade-in';
      const badgeClass = item.type === 'image' ? 'badge-image' : item.type === 'collection' ? 'badge-collection' : 'badge-comic';
      const badgeText = item.type === 'collection' ? 'auto' : item.type;
      card.innerHTML = `
        <img src="${item.path}" alt="" loading="lazy">
        <span class="card-badge ${badgeClass}">${badgeText}</span>
        <div class="card-overlay">${(item.prompt || '').slice(0, 120)}</div>
      `;
      card.onclick = () => openModal(item);
      grid.appendChild(card);
    });
  } catch (e) {
    console.error('Gallery load error:', e);
  }
}

// ─── Modal ───────────────────────────────────────────────────────────────
let modalItem = null;

function initModal() {
  document.querySelector('#imageModal .modal-overlay').addEventListener('click', closeModal);
  document.querySelector('#imageModal .modal-close').addEventListener('click', closeModal);
  document.getElementById('modalDownload').addEventListener('click', downloadModal);
  document.getElementById('modalDelete').addEventListener('click', deleteModal);
  document.getElementById('modalFavorite').addEventListener('click', favoriteModal);
  document.getElementById('modalSimilar').addEventListener('click', generateSimilar);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeFramePicker(); } });
}

function openModal(item) {
  if (!item) return;
  modalItem = item;
  document.getElementById('modalImage').src = item.path;
  document.getElementById('modalPrompt').textContent = item.prompt || 'No prompt';
  document.getElementById('modalModel').textContent = item.model || '';
  document.getElementById('modalDate').textContent = item.ts ? new Date(item.ts).toLocaleString() : '';
  const favBtn = document.getElementById('modalFavorite');
  favBtn.classList.toggle('favorited', !!item.favorite);
  favBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="${item.favorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> ${item.favorite ? 'Favorited' : 'Favorite'}`;
  document.getElementById('imageModal').style.display = 'flex';
}

function closeModal() {
  document.getElementById('imageModal').style.display = 'none';
  modalItem = null;
}

function downloadModal() {
  if (!modalItem) return;
  const a = document.createElement('a');
  a.href = modalItem.path;
  a.download = modalItem.filename || 'ollamagination-image.png';
  a.click();
}

async function deleteModal() {
  if (!modalItem) return;
  if (!confirm('Delete this image?')) return;
  try {
    await fetch(`${API}/api/gallery/${modalItem.id}`, { method: 'DELETE' });
    closeModal();
    loadGallery();
    loadStats();
    toast('Image deleted', 'success');
  } catch (e) {
    toast('Failed to delete', 'error');
  }
}

// ─── Favorite ────────────────────────────────────────────────────────────
async function favoriteModal() {
  if (!modalItem) return;
  try {
    const res = await fetch(`${API}/api/gallery/${modalItem.id}/favorite`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      modalItem.favorite = data.favorite;
      const favBtn = document.getElementById('modalFavorite');
      favBtn.classList.toggle('favorited', data.favorite);
      favBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="${data.favorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> ${data.favorite ? 'Favorited' : 'Favorite'}`;
      toast(data.favorite ? 'Added to favorites' : 'Removed from favorites', 'success');
    }
  } catch (e) {
    toast('Failed to toggle favorite', 'error');
  }
}

// ─── Generate Similar ────────────────────────────────────────────────────
async function generateSimilar() {
  if (!modalItem) return;
  const model = document.getElementById('imageModel').value;
  const chatModel = document.getElementById('chatModel').value;
  if (!model) { toast('Select an image model first', 'error'); return; }

  const btn = document.getElementById('modalSimilar');
  btn.disabled = true;
  btn.textContent = 'Generating...';
  setStatus('Generating similar image...');

  try {
    const res = await fetch(`${API}/api/generate/variation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: modalItem.prompt, chatModel })
    });
    const data = await res.json();
    if (data.success && data.image) {
      closeModal();
      openModal(data.item);
      toast('Similar image generated!', 'success');
      loadGallery();
      loadStats();
    } else {
      toast(data.error || 'Failed to generate variation', 'error');
    }
  } catch (e) {
    toast(`Error: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/></svg> Generate Similar`;
    setStatus('Ready');
  }
}

// ─── AI Prompt Enhance ───────────────────────────────────────────────────
function initEnhance() {
  document.getElementById('enhancePromptBtn').addEventListener('click', async () => {
    const textarea = document.getElementById('promptInput');
    const prompt = textarea.value.trim();
    if (!prompt) { toast('Enter a prompt first', 'error'); return; }
    const chatModel = document.getElementById('chatModel').value;
    if (!chatModel) { toast('Select a chat model', 'error'); return; }

    const btn = document.getElementById('enhancePromptBtn');
    btn.disabled = true;
    btn.textContent = 'Enhancing...';

    try {
      const res = await fetch(`${API}/api/enhance-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: chatModel, prompt, context: 'image' })
      });
      const data = await res.json();
      if (data.success && data.enhanced) {
        textarea.value = data.enhanced;
        toast('Prompt enhanced!', 'success');
      } else {
        toast(data.error || 'Enhancement failed', 'error');
      }
    } catch (e) {
      toast(`Error: ${e.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> AI Enhance`;
    }
  });

  document.getElementById('enhanceComicBtn').addEventListener('click', async () => {
    const textarea = document.getElementById('comicTheme');
    const prompt = textarea.value.trim();
    if (!prompt) { toast('Enter a story theme first', 'error'); return; }
    const chatModel = document.getElementById('chatModel').value;
    if (!chatModel) { toast('Select a chat model', 'error'); return; }

    const btn = document.getElementById('enhanceComicBtn');
    btn.disabled = true;
    btn.textContent = 'Enhancing...';

    try {
      const res = await fetch(`${API}/api/enhance-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: chatModel, prompt, context: 'comic' })
      });
      const data = await res.json();
      if (data.success && data.enhanced) {
        textarea.value = data.enhanced;
        toast('Theme enhanced!', 'success');
      } else {
        toast(data.error || 'Enhancement failed', 'error');
      }
    } catch (e) {
      toast(`Error: ${e.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> AI Enhance`;
    }
  });
}

// ─── Editor ──────────────────────────────────────────────────────────────
let editorState = {
  frames: [],
  currentFrame: -1,
  overlays: [],
  selectedOverlay: -1,
  tool: 'select',
  playing: false,
  animTimer: null
};

function initEditor() {
  document.getElementById('addFrameBtn').addEventListener('click', openFramePicker);
  document.getElementById('deleteOverlayBtn').addEventListener('click', deleteSelectedOverlay);
  document.getElementById('applyOverlayBtn').addEventListener('click', applyOverlayText);
  document.getElementById('playAnimBtn').addEventListener('click', playAnimation);
  document.getElementById('stopAnimBtn').addEventListener('click', stopAnimation);
  document.getElementById('exportGifBtn').addEventListener('click', exportGif);

  document.querySelectorAll('.editor-tool').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.editor-tool').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      editorState.tool = btn.dataset.tool;
      document.getElementById('editorTextControls').style.display =
        ['speech', 'thought', 'caption', 'text'].includes(btn.dataset.tool) ? 'flex' : 'none';
    });
  });

  const canvas = document.getElementById('editorCanvas');
  canvas.addEventListener('click', onCanvasClick);

  // Frame picker modal
  document.querySelector('#framePickerModal .modal-overlay').addEventListener('click', closeFramePicker);
  document.querySelector('#framePickerModal .modal-close').addEventListener('click', closeFramePicker);
}

function openFramePicker() {
  const modal = document.getElementById('framePickerModal');
  const grid = document.getElementById('framePickerGrid');
  grid.innerHTML = '<p style="color:var(--text-dim);padding:20px">Loading gallery...</p>';
  modal.style.display = 'flex';

  fetch(`${API}/api/gallery?type=all`)
    .then(r => r.json())
    .then(data => {
      grid.innerHTML = '';
      if (!data.items || data.items.length === 0) {
        grid.innerHTML = '<p style="color:var(--text-dim);padding:20px">No images in gallery yet.</p>';
        return;
      }
      data.items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'frame-picker-card';
        card.innerHTML = `<img src="${item.path}" alt="" loading="lazy">`;
        card.onclick = () => {
          addEditorFrame(item);
          closeFramePicker();
        };
        grid.appendChild(card);
      });
    });
}

function closeFramePicker() {
  document.getElementById('framePickerModal').style.display = 'none';
}

function addEditorFrame(item) {
  const frame = {
    id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    item,
    overlays: [],
    duration: parseInt(document.getElementById('frameDuration').value) || 2000,
    transition: document.getElementById('frameTransition').value
  };
  editorState.frames.push(frame);
  editorState.currentFrame = editorState.frames.length - 1;
  renderFrameList();
  renderCanvas();
  renderTimeline();
  document.getElementById('editorEmpty').style.display = 'none';
  document.getElementById('editorStatus').textContent = `Frame ${editorState.currentFrame + 1} of ${editorState.frames.length}`;
}

function renderFrameList() {
  const list = document.getElementById('editorFrameList');
  list.innerHTML = '';
  editorState.frames.forEach((f, i) => {
    const el = document.createElement('div');
    el.className = `editor-frame-item${i === editorState.currentFrame ? ' active' : ''}`;
    el.innerHTML = `
      <img src="${f.item.path}" alt="">
      <div class="frame-info">
        <span>Frame ${i + 1}</span>
        <span class="frame-dur">${f.duration}ms</span>
      </div>
      <button class="frame-remove" data-idx="${i}">&times;</button>
    `;
    el.querySelector('img').onclick = () => {
      editorState.currentFrame = i;
      renderFrameList();
      renderCanvas();
      document.getElementById('editorStatus').textContent = `Frame ${i + 1} of ${editorState.frames.length}`;
    };
    el.querySelector('.frame-remove').onclick = (e) => {
      e.stopPropagation();
      editorState.frames.splice(i, 1);
      if (editorState.currentFrame >= editorState.frames.length) editorState.currentFrame = editorState.frames.length - 1;
      renderFrameList();
      renderCanvas();
      renderTimeline();
      if (editorState.frames.length === 0) {
        document.getElementById('editorEmpty').style.display = '';
        document.getElementById('editorStatus').textContent = 'Add frames to begin';
      }
    };
    list.appendChild(el);
  });
}

function renderCanvas() {
  const canvas = document.getElementById('editorCanvas');
  const ctx = canvas.getContext('2d');
  const overlayLayer = document.getElementById('editorOverlayLayer');
  overlayLayer.innerHTML = '';

  if (editorState.currentFrame < 0 || editorState.currentFrame >= editorState.frames.length) {
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const frame = editorState.frames[editorState.currentFrame];
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    const x = (canvas.width - w) / 2;
    const y = (canvas.height - h) / 2;
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, x, y, w, h);
  };
  img.src = frame.item.path;

  frame.overlays.forEach((ov, i) => {
    const el = document.createElement('div');
    el.className = `overlay-item overlay-${ov.type}${i === editorState.selectedOverlay ? ' selected' : ''}`;
    el.style.left = ov.x + 'px';
    el.style.top = ov.y + 'px';
    if (ov.type === 'caption') {
      el.style.left = '0';
      el.style.right = '0';
      el.style.bottom = '0';
      el.style.top = 'auto';
    }
    el.innerHTML = ov.text;
    el.style.fontSize = ov.fontSize + 'px';
    el.style.color = ov.color;
    if (ov.type !== 'text') el.style.backgroundColor = ov.bgColor;
    el.onclick = (e) => {
      e.stopPropagation();
      editorState.selectedOverlay = i;
      renderCanvas();
      document.getElementById('overlayText').value = ov.text;
      document.getElementById('overlayFontSize').value = ov.fontSize;
      document.getElementById('overlayColor').value = ov.color;
      document.getElementById('overlayBgColor').value = ov.bgColor;
      document.getElementById('editorTextControls').style.display = 'flex';
    };
    makeDraggable(el, ov);
    overlayLayer.appendChild(el);
  });
}

function onCanvasClick(e) {
  if (editorState.tool === 'select') {
    editorState.selectedOverlay = -1;
    renderCanvas();
    return;
  }
  if (editorState.currentFrame < 0) return;

  const rect = e.target.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const text = document.getElementById('overlayText').value || 'Text here';
  const fontSize = parseInt(document.getElementById('overlayFontSize').value) || 18;
  const color = document.getElementById('overlayColor').value;
  const bgColor = document.getElementById('overlayBgColor').value;

  const overlay = { type: editorState.tool, text, x, y, fontSize, color, bgColor };
  const frame = editorState.frames[editorState.currentFrame];
  frame.overlays.push(overlay);
  editorState.selectedOverlay = frame.overlays.length - 1;
  renderCanvas();
}

function makeDraggable(el, ov) {
  let dragging = false, startX, startY, origX, origY;
  el.addEventListener('mousedown', e => {
    if (ov.type === 'caption') return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    origX = ov.x;
    origY = ov.y;
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    ov.x = origX + (e.clientX - startX);
    ov.y = origY + (e.clientY - startY);
    el.style.left = ov.x + 'px';
    el.style.top = ov.y + 'px';
  });
  document.addEventListener('mouseup', () => { dragging = false; });
}

function deleteSelectedOverlay() {
  if (editorState.currentFrame < 0 || editorState.selectedOverlay < 0) return;
  const frame = editorState.frames[editorState.currentFrame];
  frame.overlays.splice(editorState.selectedOverlay, 1);
  editorState.selectedOverlay = -1;
  renderCanvas();
}

function applyOverlayText() {
  if (editorState.currentFrame < 0 || editorState.selectedOverlay < 0) return;
  const frame = editorState.frames[editorState.currentFrame];
  const ov = frame.overlays[editorState.selectedOverlay];
  ov.text = document.getElementById('overlayText').value;
  ov.fontSize = parseInt(document.getElementById('overlayFontSize').value) || 18;
  ov.color = document.getElementById('overlayColor').value;
  ov.bgColor = document.getElementById('overlayBgColor').value;
  renderCanvas();
  toast('Overlay updated', 'success');
}

function renderTimeline() {
  const tl = document.getElementById('editorTimeline');
  tl.innerHTML = '';
  editorState.frames.forEach((f, i) => {
    const block = document.createElement('div');
    block.className = `timeline-block${i === editorState.currentFrame ? ' active' : ''}`;
    block.innerHTML = `<img src="${f.item.path}" alt=""><span>${f.duration}ms</span>`;
    block.onclick = () => {
      editorState.currentFrame = i;
      renderFrameList();
      renderCanvas();
      renderTimeline();
    };
    tl.appendChild(block);
  });
}

// ─── Animation Playback ──────────────────────────────────────────────────
function playAnimation() {
  if (editorState.frames.length === 0) { toast('Add frames first', 'error'); return; }
  if (editorState.playing) return;

  editorState.playing = true;
  document.getElementById('playAnimBtn').style.display = 'none';
  document.getElementById('stopAnimBtn').style.display = '';

  const loop = document.getElementById('loopMode').value;
  let idx = 0;
  let direction = 1;

  function nextFrame() {
    if (!editorState.playing) return;
    editorState.currentFrame = idx;
    renderFrameList();
    renderCanvas();
    renderTimeline();

    const frame = editorState.frames[idx];
    editorState.animTimer = setTimeout(() => {
      if (!editorState.playing) return;
      if (loop === 'bounce') {
        if (idx >= editorState.frames.length - 1) direction = -1;
        if (idx <= 0) direction = 1;
        idx += direction;
      } else {
        idx++;
        if (idx >= editorState.frames.length) {
          if (loop === 'loop') idx = 0;
          else { stopAnimation(); return; }
        }
      }
      nextFrame();
    }, frame.duration);
  }
  nextFrame();
}

function stopAnimation() {
  editorState.playing = false;
  if (editorState.animTimer) clearTimeout(editorState.animTimer);
  document.getElementById('playAnimBtn').style.display = '';
  document.getElementById('stopAnimBtn').style.display = 'none';
}

// ─── GIF Export ──────────────────────────────────────────────────────────
async function exportGif() {
  if (editorState.frames.length === 0) { toast('Add frames first', 'error'); return; }

  const btn = document.getElementById('exportGifBtn');
  btn.disabled = true;
  btn.textContent = 'Rendering frames...';
  setStatus('Exporting animation...');

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    const renderedFrames = [];

    for (let i = 0; i < editorState.frames.length; i++) {
      const frame = editorState.frames[i];
      await new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          const x = (canvas.width - w) / 2;
          const y = (canvas.height - h) / 2;
          ctx.fillStyle = '#0a0a12';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, x, y, w, h);

          frame.overlays.forEach(ov => {
            ctx.font = `${ov.fontSize}px 'Inter', sans-serif`;
            if (ov.type !== 'text') {
              const metrics = ctx.measureText(ov.text);
              const pad = 10;
              let bx = ov.x - pad, by = ov.y - ov.fontSize;
              let bw = metrics.width + pad * 2, bh = ov.fontSize + pad * 2;
              if (ov.type === 'caption') {
                bx = 0; by = canvas.height - bh - 10; bw = canvas.width;
              }
              ctx.fillStyle = ov.bgColor + 'cc';
              if (ov.type === 'speech') {
                drawSpeechBubble(ctx, bx, by, bw, bh, 12, ov.bgColor + 'cc');
              } else if (ov.type === 'thought') {
                drawThoughtBubble(ctx, bx, by, bw, bh, ov.bgColor + 'cc');
              } else {
                ctx.fillRect(bx, by, bw, bh);
              }
            }
            ctx.fillStyle = ov.color;
            const tx = ov.type === 'caption' ? canvas.width / 2 : ov.x;
            const ty = ov.type === 'caption' ? canvas.height - 20 : ov.y;
            ctx.textAlign = ov.type === 'caption' ? 'center' : 'left';
            ctx.fillText(ov.text, tx, ty);
            ctx.textAlign = 'left';
          });

          renderedFrames.push({ data: canvas.toDataURL('image/png'), delay: frame.duration });
          resolve();
        };
        img.src = frame.item.path;
      });
    }

    btn.textContent = 'Building GIF...';

    const res = await fetch(`${API}/api/export/gif`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frames: renderedFrames })
    });
    const data = await res.json();
    if (data.success) {
      const a = document.createElement('a');
      a.href = data.path;
      a.download = data.filename;
      a.click();
      toast('GIF exported!', 'success');
    } else {
      toast(data.error || 'Export failed', 'error');
    }
  } catch (e) {
    toast(`Export error: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Export as GIF';
    setStatus('Ready');
  }
}

function drawSpeechBubble(ctx, x, y, w, h, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + 30, y + h);
  ctx.lineTo(x + 15, y + h + 15);
  ctx.lineTo(x + 20, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.fill();
}

function drawThoughtBubble(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + 15, y + h + 8, 6, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + 8, y + h + 18, 4, 3, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ─── Stats ───────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const res = await fetch(`${API}/api/stats`);
    const data = await res.json();
    document.getElementById('footerStats').textContent =
      `${data.totalImages} images | ${data.totalPrompts} unique prompts | ${data.collections} collections | ${data.comics} comics`;
    document.getElementById('galleryStats').textContent =
      `${data.totalImages} total`;
  } catch {}
}

// ─── Helpers ─────────────────────────────────────────────────────────────
function setStatus(text) {
  document.getElementById('statusText').textContent = text;
}

function toast(message, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 4000);
}
