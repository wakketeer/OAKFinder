import * as db from './db.js';
import { processPhoto } from './image.js';

const app = document.getElementById('app');

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const now = () => new Date().toISOString();
const uuid = () =>
  crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15);
        return (c === 'x' ? r : (r & 3) | 8).toString(16);
      });
const byTime = (a, b) => String(a.captured_at).localeCompare(String(b.captured_at));
const pad = (n) => String(n).padStart(3, '0');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

// Object URLs for photo previews, released when the screen changes.
const urls = new Map();
function urlFor(key, blob) {
  if (!blob) return '';
  let u = urls.get(key);
  if (!u) { u = URL.createObjectURL(blob); urls.set(key, u); }
  return u;
}
function revoke(key) {
  const u = urls.get(key);
  if (u) { URL.revokeObjectURL(u); urls.delete(key); }
}
function revokeAll() {
  for (const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear();
}

// Local writes run in order in the background; the UI never waits on them.
let chain = Promise.resolve();
let pendingWrites = 0;
function enqueue(label, fn) {
  pendingWrites++;
  const p = chain.then(fn)
    .catch((err) => { console.error(err); toast(`${label} failed: ${err.message || err}`, 'error', 6000); })
    .finally(() => { pendingWrites--; });
  chain = p;
  return p;
}
window.addEventListener('beforeunload', (e) => {
  if (pendingWrites > 0) { e.preventDefault(); e.returnValue = ''; }
});

let toastTimer;
function toast(msg, kind = 'info', ms = 2000) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, ms);
}

function viewPhoto(photo) {
  const v = document.getElementById('viewer');
  v.querySelector('img').src = urlFor('full:' + photo.id, photo.blob);
  v.hidden = false;
}
document.getElementById('viewer').addEventListener('click', (e) => { e.currentTarget.hidden = true; });

// Ask the browser not to clear this app's storage. Granted at the browser's discretion.
async function requestPersist() {
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch (_) {}
}

// Hidden camera inputs shared by all screens.
const inputs = {};
for (const id of ['rug', 'tag']) {
  const el = document.createElement('input');
  el.type = 'file';
  el.accept = 'image/*';
  el.setAttribute('capture', 'environment');
  el.id = 'in-' + id;
  el.className = 'vh';
  el.tabIndex = -1;
  document.body.appendChild(el);
  inputs[id] = el;
}
let onPhoto = null; // set by the active screen: (file, type) => void
for (const [type, el] of Object.entries(inputs)) {
  el.addEventListener('change', () => {
    const file = el.files && el.files[0];
    el.value = '';
    if (file && onPhoto) onPhoto(file, type);
  });
}

// Resize and store one photo for a rug. Returns the stored record.
async function storePhoto(file, type, rug) {
  const p = await processPhoto(file);
  const rec = {
    id: uuid(), rug_id: rug.id, stack_id: rug.stack_id, type,
    blob: p.blob, thumb: p.thumb, width: p.width, height: p.height, captured_at: now(),
  };
  await db.put('photos', rec);
  return rec;
}

// ---------- router ----------
let cleanup = null;
async function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  onPhoto = null;
  revokeAll();
  document.getElementById('viewer').hidden = true;
  const parts = (location.hash.slice(1) || '/').split('/').filter(Boolean);
  try {
    if (parts[0] === 's' && parts[2] === 'list') await listView(parts[1]);
    else if (parts[0] === 's') await captureView(parts[1]);
    else if (parts[0] === 'r') await rugView(parts[1]);
    else await homeView();
  } catch (err) {
    console.error(err);
    app.innerHTML = `<main class="screen"><p class="error">${esc(err.message)}</p><a class="btn" href="#/">Back to stacks</a></main>`;
  }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

// ---------- home: stacks ----------
async function homeView() {
  const stacks = (await db.all('stacks')).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const rugs = await db.all('rugs');
  const counts = {};
  for (const r of rugs) if (r.status === 'saved') counts[r.stack_id] = (counts[r.stack_id] || 0) + 1;

  app.innerHTML = `
    <header class="bar"><h1 class="bar-title">OAK Room Capture</h1></header>
    <main class="screen">
      <form id="new-stack" class="card">
        <label for="stack-label">New stack</label>
        <input id="stack-label" required autocomplete="off" enterkeyhint="go" value="OAK Stack ${stacks.length + 1}">
        <button class="btn primary big" type="submit">Start stack</button>
      </form>
      <h2 class="section">Stacks</h2>
      ${stacks.length ? `<ul class="stacks">${stacks.map((s) => `
        <li>
          <a class="stack-row" href="#/s/${s.id}">
            <span class="stack-label">${esc(s.label)}</span>
            <span class="muted small">${fmtDate(s.created_at)} · ${plural(counts[s.id] || 0, 'rug')}</span>
          </a>
          <a class="btn" href="#/s/${s.id}/list">List</a>
        </li>`).join('')}</ul>` : '<p class="muted">No stacks yet.</p>'}
    </main>`;

  document.getElementById('new-stack').addEventListener('submit', async (e) => {
    e.preventDefault();
    const label = document.getElementById('stack-label').value.trim();
    if (!label) return;
    const stack = { id: uuid(), label, created_at: now() };
    await db.put('stacks', stack);
    requestPersist();
    location.hash = `#/s/${stack.id}`;
  });
}

// ---------- capture loop ----------
async function captureView(stackId) {
  const stack = await db.get('stacks', stackId);
  if (!stack) throw new Error('Stack not found.');
  const rugs = await db.byIndex('rugs', 'stack_id', stackId);
  let savedCount = rugs.filter((r) => r.status === 'saved').length;
  let maxSeq = rugs.reduce((m, r) => Math.max(m, r.seq), 0);
  const persisted = new Set();

  const newDraft = () => ({
    id: uuid(), stack_id: stackId, seq: ++maxSeq, status: 'draft',
    barcode: '', note: '', flag: false, created_at: now(),
  });

  // Resume an unfinished rug if there is one.
  let draft;
  let photos = [];
  const open = rugs.filter((r) => r.status === 'draft').sort((a, b) => b.seq - a.seq)[0];
  if (open) {
    draft = open;
    persisted.add(open.id);
    photos = (await db.byIndex('photos', 'rug_id', open.id)).sort(byTime);
  } else {
    draft = newDraft();
  }

  // The rug record is written with its first photo, so nothing is lost if the browser closes.
  async function persistDraft(d) {
    if (persisted.has(d.id)) return;
    persisted.add(d.id);
    const { id, stack_id, seq, status, barcode, note, flag, created_at } = d;
    await db.put('rugs', { id, stack_id, seq, status, barcode, note, flag, created_at, updated_at: now() });
  }

  function saveField(patch) {
    Object.assign(draft, patch);
    const d = draft;
    if (persisted.has(d.id)) enqueue('Save', () => db.update('rugs', d.id, { ...patch, updated_at: now() }));
  }

  app.innerHTML = `
    <header class="bar">
      <a class="btn ghost" href="#/" aria-label="Back to stacks">‹ Stacks</a>
      <div class="bar-title"><div>${esc(stack.label)}</div><div class="muted small" id="saved-count"></div></div>
      <a class="btn ghost" href="#/s/${stackId}/list">List</a>
    </header>
    <main class="screen capture">
      <h2 class="rug-no" id="rug-no"></h2>
      <section>
        <h3 class="section">Rug photos</h3>
        <div class="grid" id="rug-photos"></div>
        <label for="in-rug" class="btn big camera">+ Rug photo</label>
      </section>
      <section>
        <h3 class="section">Tag photo</h3>
        <div id="tag-slot"></div>
      </section>
      <section class="fields">
        <input id="f-barcode" autocomplete="off" autocapitalize="characters" placeholder="Barcode / tag number (optional)">
        <input id="f-note" autocomplete="off" placeholder="Note (optional)">
        <button type="button" id="f-flag" class="btn flag" aria-pressed="false">☆ Flag</button>
      </section>
    </main>
    <footer class="dock"><button id="save" class="btn primary huge" type="button">Save &amp; next</button></footer>`;

  const el = {
    savedCount: document.getElementById('saved-count'),
    rugNo: document.getElementById('rug-no'),
    rugPhotos: document.getElementById('rug-photos'),
    tagSlot: document.getElementById('tag-slot'),
    barcode: document.getElementById('f-barcode'),
    note: document.getElementById('f-note'),
    flag: document.getElementById('f-flag'),
    save: document.getElementById('save'),
  };

  function tile(p) {
    if (p._processing) return `<div class="tile processing"><span>Saving…</span></div>`;
    return `<div class="tile">
      <img src="${urlFor(p.id, p.thumb)}" alt="" data-view="${p.id}">
      <button type="button" class="x" data-del="${p.id}" aria-label="Delete photo">×</button>
    </div>`;
  }

  function renderPhotos() {
    const rugPhotos = photos.filter((p) => p.type === 'rug');
    const tag = photos.find((p) => p.type === 'tag');
    el.rugPhotos.innerHTML = rugPhotos.map(tile).join('');
    el.tagSlot.innerHTML = tag
      ? `<div class="grid">${tile(tag)}</div><label for="in-tag" class="btn">Retake tag photo</label>`
      : `<label for="in-tag" class="btn big camera">+ Tag photo</label>`;
    el.save.disabled = !rugPhotos.some((p) => !p._processing);
  }

  function renderAll() {
    el.savedCount.textContent = `${savedCount} saved`;
    el.rugNo.textContent = `Rug #${draft.seq}`;
    el.barcode.value = draft.barcode || '';
    el.note.value = draft.note || '';
    el.flag.setAttribute('aria-pressed', String(!!draft.flag));
    el.flag.textContent = draft.flag ? '★ Flagged' : '☆ Flag';
    renderPhotos();
  }

  onPhoto = (file, type) => {
    const d = draft;
    const placeholder = { id: 'p-' + uuid(), type, _processing: true };
    const replaced = type === 'tag' ? photos.find((p) => p.type === 'tag') : null;
    if (replaced) photos = photos.filter((p) => p !== replaced);
    photos.push(placeholder);
    renderPhotos();
    enqueue('Photo', async () => {
      try {
        await persistDraft(d);
        const rec = await storePhoto(file, type, d);
        if (replaced) { await db.del('photos', replaced.id); revoke(replaced.id); }
        if (d === draft) {
          photos = photos.map((p) => (p === placeholder ? rec : p));
          renderPhotos();
        }
      } catch (err) {
        if (d === draft) {
          photos = photos.filter((p) => p !== placeholder);
          if (replaced) photos.push(replaced);
          renderPhotos();
        }
        throw err;
      }
    });
  };

  app.querySelector('main').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      const p = photos.find((x) => x.id === del.dataset.del);
      if (!p || !confirm('Delete this photo?')) return;
      photos = photos.filter((x) => x !== p);
      revoke(p.id);
      renderPhotos();
      enqueue('Delete', () => db.del('photos', p.id));
      return;
    }
    const v = e.target.closest('[data-view]');
    if (v) {
      const p = photos.find((x) => x.id === v.dataset.view);
      if (p) viewPhoto(p);
    }
  });

  el.barcode.addEventListener('change', () => saveField({ barcode: el.barcode.value.trim() }));
  el.note.addEventListener('change', () => saveField({ note: el.note.value.trim() }));
  el.flag.addEventListener('click', () => {
    saveField({ flag: !draft.flag });
    el.flag.setAttribute('aria-pressed', String(draft.flag));
    el.flag.textContent = draft.flag ? '★ Flagged' : '☆ Flag';
  });

  el.save.addEventListener('click', () => {
    // Pick up typed values even if the field still has focus.
    draft.barcode = el.barcode.value.trim();
    draft.note = el.note.value.trim();
    const hasTag = photos.some((p) => p.type === 'tag');
    if (!hasTag && !confirm('No tag photo. Save anyway?')) return;
    const d = draft;
    enqueue('Save', async () => {
      await persistDraft(d);
      await db.update('rugs', d.id, {
        status: 'saved', barcode: d.barcode, note: d.note, flag: d.flag, saved_at: now(), updated_at: now(),
      });
    });
    savedCount++;
    toast(`Rug #${d.seq} saved`);
    if (navigator.vibrate) navigator.vibrate(30);
    for (const p of photos) revoke(p.id);
    draft = newDraft();
    photos = [];
    renderAll();
    window.scrollTo(0, 0);
  });

  renderAll();
}

// ---------- list ----------
async function listView(stackId) {
  const stack = await db.get('stacks', stackId);
  if (!stack) throw new Error('Stack not found.');
  const rugs = (await db.byIndex('rugs', 'stack_id', stackId)).sort((a, b) => a.seq - b.seq);
  const photos = await db.byIndex('photos', 'stack_id', stackId);
  const byRug = {};
  for (const p of photos.sort(byTime)) (byRug[p.rug_id] ||= []).push(p);
  const saved = rugs.filter((r) => r.status === 'saved');

  app.innerHTML = `
    <header class="bar">
      <a class="btn ghost" href="#/">‹ Stacks</a>
      <div class="bar-title"><div>${esc(stack.label)}</div><div class="muted small">${plural(saved.length, 'rug')} · ${saved.filter((r) => r.flag).length} flagged</div></div>
      <a class="btn ghost" href="#/s/${stackId}">Capture</a>
    </header>
    <main class="screen">
      <div id="export" class="card">
        <button id="prepare" class="btn primary big" type="button" ${saved.length ? '' : 'disabled'}>Export stack</button>
      </div>
      ${rugs.length ? `<ul class="rugs">${rugs.map((r) => {
        const ps = byRug[r.id] || [];
        const first = ps.find((p) => p.type === 'rug') || ps[0];
        return `<li><a class="rug-row" href="#/r/${r.id}">
          ${first ? `<img src="${urlFor(first.id, first.thumb)}" alt="">` : '<span class="noimg"></span>'}
          <span class="rug-info">
            <span class="l1">Rug #${r.seq} ${r.flag ? '<span class="star">★</span>' : ''} ${r.status === 'draft' ? '<span class="badge">In progress</span>' : ''}</span>
            <span class="l2 mono">${r.barcode ? esc(r.barcode) : '<span class="muted">No barcode</span>'}</span>
            ${r.note ? `<span class="l3 muted">${esc(r.note)}</span>` : ''}
          </span>
          <span class="muted small">${plural(ps.length, 'photo')}</span>
        </a></li>`;
      }).join('')}</ul>` : '<p class="muted">No rugs yet.</p>'}
    </main>`;

  document.getElementById('prepare').addEventListener('click', () => prepareExport(stack));
}

// ---------- rug detail / edit ----------
async function rugView(rugId) {
  let rug = await db.get('rugs', rugId);
  if (!rug) throw new Error('Rug not found.');
  const stack = await db.get('stacks', rug.stack_id);
  let photos = (await db.byIndex('photos', 'rug_id', rugId)).sort(byTime);

  app.innerHTML = `
    <header class="bar">
      <a class="btn ghost" href="#/s/${rug.stack_id}/list">‹ List</a>
      <div class="bar-title"><div>Rug #${rug.seq}</div><div class="muted small">${esc(stack ? stack.label : '')}</div></div>
      <span></span>
    </header>
    <main class="screen">
      ${rug.status === 'draft' ? `<p class="card">This rug is still in progress. <a href="#/s/${rug.stack_id}">Continue capturing</a></p>` : ''}
      <section>
        <h3 class="section">Rug photos</h3>
        <div class="grid" id="rug-photos"></div>
        <label for="in-rug" class="btn">+ Add rug photo</label>
      </section>
      <section>
        <h3 class="section">Tag photo</h3>
        <div id="tag-slot"></div>
      </section>
      <section class="fields">
        <label for="f-barcode">Barcode / tag number</label>
        <input id="f-barcode" autocomplete="off" autocapitalize="characters" value="${esc(rug.barcode)}">
        <label for="f-note">Note</label>
        <input id="f-note" autocomplete="off" value="${esc(rug.note)}">
        <button type="button" id="f-flag" class="btn flag" aria-pressed="${!!rug.flag}">${rug.flag ? '★ Flagged' : '☆ Flag'}</button>
      </section>
      <button type="button" id="delete-rug" class="btn danger">Delete rug</button>
    </main>`;

  const grid = document.getElementById('rug-photos');
  const tagSlot = document.getElementById('tag-slot');
  const tile = (p) => p._processing
    ? `<div class="tile processing"><span>Saving…</span></div>`
    : `<div class="tile"><img src="${urlFor(p.id, p.thumb)}" alt="" data-view="${p.id}"><button type="button" class="x" data-del="${p.id}" aria-label="Delete photo">×</button></div>`;
  function render() {
    grid.innerHTML = photos.filter((p) => p.type === 'rug').map(tile).join('');
    const tag = photos.find((p) => p.type === 'tag');
    tagSlot.innerHTML = tag
      ? `<div class="grid">${tile(tag)}</div><label for="in-tag" class="btn">Retake tag photo</label>`
      : `<label for="in-tag" class="btn">+ Tag photo</label>`;
  }

  const save = (patch) => {
    Object.assign(rug, patch);
    enqueue('Save', () => db.update('rugs', rug.id, { ...patch, updated_at: now() }));
  };

  onPhoto = (file, type) => {
    const placeholder = { id: 'p-' + uuid(), type, _processing: true };
    const replaced = type === 'tag' ? photos.find((p) => p.type === 'tag') : null;
    if (replaced) photos = photos.filter((p) => p !== replaced);
    photos.push(placeholder);
    render();
    enqueue('Photo', async () => {
      try {
        const rec = await storePhoto(file, type, rug);
        if (replaced) { await db.del('photos', replaced.id); revoke(replaced.id); }
        photos = photos.map((p) => (p === placeholder ? rec : p));
        render();
      } catch (err) {
        photos = photos.filter((p) => p !== placeholder);
        if (replaced) photos.push(replaced);
        render();
        throw err;
      }
    });
  };

  app.querySelector('main').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      const p = photos.find((x) => x.id === del.dataset.del);
      if (!p || !confirm('Delete this photo?')) return;
      photos = photos.filter((x) => x !== p);
      revoke(p.id);
      render();
      enqueue('Delete', () => db.del('photos', p.id));
      return;
    }
    const v = e.target.closest('[data-view]');
    if (v) {
      const p = photos.find((x) => x.id === v.dataset.view);
      if (p) viewPhoto(p);
    }
  });

  document.getElementById('f-barcode').addEventListener('change', (e) => save({ barcode: e.target.value.trim() }));
  document.getElementById('f-note').addEventListener('change', (e) => save({ note: e.target.value.trim() }));
  document.getElementById('f-flag').addEventListener('click', (e) => {
    save({ flag: !rug.flag });
    e.currentTarget.setAttribute('aria-pressed', String(rug.flag));
    e.currentTarget.textContent = rug.flag ? '★ Flagged' : '☆ Flag';
  });
  document.getElementById('delete-rug').addEventListener('click', async () => {
    if (!confirm(`Delete Rug #${rug.seq} and its photos? This can't be undone.`)) return;
    await enqueue('Delete', () => db.deleteRug(rug.id));
    location.hash = `#/s/${rug.stack_id}/list`;
  });

  render();
}

// ---------- export ----------
const safeName = (s) => String(s).replace(/[\\/:*?"<>|]+/g, '-').trim();
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Build the export files: photos as JPEGs plus one CSV. Only saved rugs are included.
async function buildExport(stack) {
  await chain; // finish any pending local writes first
  const rugs = (await db.byIndex('rugs', 'stack_id', stack.id)).filter((r) => r.status === 'saved').sort((a, b) => a.seq - b.seq);
  const photos = (await db.byIndex('photos', 'stack_id', stack.id)).sort(byTime);
  const base = safeName(stack.label);
  const files = [];
  const rows = [['stack', 'rug_number', 'barcode', 'note', 'flagged', 'rug_photos', 'tag_photo', 'saved_at']];
  for (const r of rugs) {
    const mine = photos.filter((p) => p.rug_id === r.id);
    const rugNames = [];
    let tagName = '';
    mine.filter((p) => p.type === 'rug').forEach((p, i) => {
      const name = `${base} - Rug ${pad(r.seq)} - ${i + 1}.jpg`;
      files.push(new File([p.blob], name, { type: 'image/jpeg' }));
      rugNames.push(name);
    });
    const tag = mine.find((p) => p.type === 'tag');
    if (tag) {
      tagName = `${base} - Rug ${pad(r.seq)} - tag.jpg`;
      files.push(new File([tag.blob], tagName, { type: 'image/jpeg' }));
    }
    rows.push([stack.label, r.seq, r.barcode, r.note, r.flag ? 'yes' : '', rugNames.join('; '), tagName, r.saved_at || '']);
  }
  const csv = '﻿' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  files.unshift(new File([csv], `${base}.csv`, { type: 'text/csv' }));
  return { files, rugCount: rugs.length };
}

async function prepareExport(stack) {
  const box = document.getElementById('export');
  box.innerHTML = '<p class="muted">Preparing files…</p>';
  let built;
  try {
    built = await buildExport(stack);
  } catch (err) {
    box.innerHTML = `<p class="error">Export failed: ${esc(err.message)}</p>`;
    return;
  }
  const { files, rugCount } = built;
  const mb = (files.reduce((n, f) => n + f.size, 0) / 1048576).toFixed(1);
  const canShare = !!(navigator.canShare && navigator.canShare({ files }));
  // Sharing needs its own tap: browsers only open the share sheet straight from a user action.
  box.innerHTML = `
    <p>${plural(rugCount, 'rug')} · ${plural(files.length, 'file')} · ${mb} MB</p>
    ${canShare ? '<button id="share" class="btn primary big" type="button">Share to OneDrive…</button>' : ''}
    <button id="download" class="btn${canShare ? '' : ' primary big'}" type="button">Download files</button>
    <p class="muted small">${canShare ? 'In the share sheet, pick OneDrive and choose a folder.' : 'Sharing files isn\'t supported in this browser. Files will download instead.'}</p>`;
  if (canShare) {
    document.getElementById('share').addEventListener('click', async () => {
      try {
        await navigator.share({ files, title: stack.label });
      } catch (err) {
        if (err.name !== 'AbortError') toast(`Share failed: ${err.message}`, 'error', 6000);
      }
    });
  }
  document.getElementById('download').addEventListener('click', async () => {
    for (const f of files) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(f);
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      await new Promise((r) => setTimeout(r, 300)); // browsers drop rapid back-to-back downloads
    }
  });
}

// ---------- start ----------
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Offline cache unavailable', err));
}
route();
