// Ask Relay: a search-by-meaning index over your chats, kept on this computer.
//
// The window reads the history (it has the Matrix client and can decrypt) and hands over plain
// "[date] Name: text" lines. Here they're grouped into short stretches of conversation ("chunks"),
// each turned into a vector by an embedding model in LM Studio (POST /v1/embeddings), and saved
// under userData/ask-index/. Searching mixes meaning (cosine similarity) with exact words.
//
// When LM Studio has no embedding model, chunks are still kept (as text) and search falls back
// to keywords, so Ask Relay keeps working, just less cleverly. Nothing leaves this computer except
// the requests to the user's own LM Studio.

const { app, ipcMain, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { normalize } = require('./ai.cjs');

const BATCH = 32;                 // texts per embeddings request
const CHUNK_MSGS = 10;            // a chunk ends after this many messages…
const CHUNK_CHARS = 900;          // …or this much text…
const CHUNK_GAP = 2 * 3600e3;     // …or a two-hour pause in the conversation
const LIST_TIMEOUT = 4000;

const dir = () => path.join(app.getPath('userData'), 'ask-index');
const metaFile = () => path.join(dir(), 'index.json');
const vecFile = () => path.join(dir(), 'vectors.f32');

let chunks = [];   // [{ id, roomId, room, ts, end, events: [ids], text }]
let vecs = [];     // Float32Array (unit length) | null, same order as chunks
let model = null;  // embedding model the vectors came from
let dim = 0;
let rooms = {};    // roomId → { newest, checked }
let loaded = false;
let busy = null;   // { phase: 'embedding', done, total } while embedding
let lastError = null;
let stopFlag = false;

// ---------- Storage ----------

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile(), 'utf8'));
    chunks = meta.chunks || [];
    rooms = meta.rooms || {};
    model = meta.model || null;
    dim = meta.dim || 0;
    vecs = chunks.map(() => null);
    if (model && dim) {
      const buf = fs.readFileSync(vecFile());
      const all = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
      let at = 0;
      chunks.forEach((c, i) => {
        if (!c.v) return;
        if ((at + 1) * dim > all.length) { c.v = false; return; }
        vecs[i] = all.slice(at * dim, (at + 1) * dim);
        at++;
      });
    }
  } catch {
    chunks = chunks.length ? chunks : [];
    vecs = chunks.map(() => null);
  }
}

let saveTimer = null;
function save(now = false) {
  clearTimeout(saveTimer);
  const write = () => {
    saveTimer = null;
    try {
      fs.mkdirSync(dir(), { recursive: true });
      const withVec = vecs.filter(Boolean);
      const out = new Float32Array(withVec.length * dim);
      withVec.forEach((v, i) => out.set(v, i * dim));
      chunks.forEach((c, i) => { c.v = !!vecs[i]; });
      fs.writeFileSync(vecFile(), Buffer.from(out.buffer));
      fs.writeFileSync(metaFile(), JSON.stringify({ version: 1, model, dim, chunks, rooms, at: Date.now() }));
    } catch (err) { console.error('[ask] saving the index failed', err); }
  };
  if (now) write(); else saveTimer = setTimeout(write, 1500);
}

function progress() {
  const payload = status();
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('ask:progress', payload);
}

function status() {
  load();
  const embedded = vecs.filter(Boolean).length;
  return {
    ready: chunks.length > 0,
    chunks: chunks.length,
    embedded,
    rooms: Object.keys(rooms).length,
    messages: chunks.reduce((n, c) => n + c.events.length, 0),
    model,
    busy,
    error: lastError,
    at: Object.values(rooms).reduce((m, r) => Math.max(m, r.checked || 0), 0) || null,
  };
}

// ---------- Embeddings ----------

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(LIST_TIMEOUT) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Embedding models LM Studio offers, loaded ones first. */
async function embedModels(host) {
  const h = normalize(host);
  try {
    const native = await getJson(`${h}/api/v1/models`);
    if (Array.isArray(native?.models)) {
      return native.models
        .filter((m) => m.type === 'embedding')
        .map((m) => ({ id: m.key, name: m.display_name || m.key, loaded: !!m.loaded_instances?.length }))
        .sort((a, b) => b.loaded - a.loaded);
    }
  } catch {}
  const j = await getJson(`${h}/v1/models`);
  return (j.data || []).filter((m) => /embed/i.test(m.id)).map((m) => ({ id: m.id, name: m.id, loaded: null }));
}

/** The model picked in Settings, else the first embedding model LM Studio lists. */
async function resolveModel(host, wanted) {
  if (wanted) return wanted;
  const list = await embedModels(host);
  if (!list.length) { const e = new Error('no-embed-model'); e.code = 'no-embed-model'; throw e; }
  return list[0].id;
}

// Some embedding models are trained with task prefixes; using them noticeably helps.
const prefix = (m, kind) => (/nomic/i.test(m) ? (kind === 'q' ? 'search_query: ' : 'search_document: ')
  : /\be5\b|-e5-/i.test(m) ? (kind === 'q' ? 'query: ' : 'passage: ') : '');

async function embed(host, m, texts) {
  const res = await fetch(`${normalize(host)}/v1/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: m, input: texts }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const j = await res.json();
  if (!Array.isArray(j.data) || j.data.length !== texts.length) throw new Error('LM Studio returned no embeddings');
  return j.data.sort((a, b) => a.index - b.index).map((d) => {
    const v = Float32Array.from(d.embedding);
    let n = 0;
    for (let i = 0; i < v.length; i++) n += v[i] * v[i];
    n = Math.sqrt(n) || 1;
    for (let i = 0; i < v.length; i++) v[i] /= n;
    return v;
  });
}

const reason = (err) => {
  if (err?.code === 'no-embed-model') return 'no-embed-model';
  const code = err?.cause?.code || err?.code;
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'timeout';
  if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET'].includes(code) || err?.message === 'fetch failed') return 'unreachable';
  return String(err?.message || err);
};

/** Embeds every chunk that has no vector yet (all of them after switching models). */
async function embedPending({ host, model: wanted }) {
  load();
  if (busy) return status();
  stopFlag = false;
  let m;
  try { m = await resolveModel(host, wanted); } catch (err) { lastError = reason(err); progress(); return status(); }
  if (m !== model) { vecs = chunks.map(() => null); model = m; dim = 0; }
  const todo = [];
  chunks.forEach((c, i) => { if (!vecs[i]) todo.push(i); });
  if (!todo.length) { lastError = null; progress(); return status(); }
  busy = { phase: 'embedding', done: 0, total: todo.length };
  progress();
  try {
    for (let k = 0; k < todo.length && !stopFlag; k += BATCH) {
      const part = todo.slice(k, k + BATCH);
      // eslint-disable-next-line no-await-in-loop
      const out = await embed(host, m, part.map((i) => `${prefix(m, 'd')}${chunks[i].room}\n${chunks[i].text}`.slice(0, 2000)));
      if (model !== m) break; // the index was cleared meanwhile
      if (!dim) dim = out[0].length;
      part.forEach((i, j) => { if (out[j].length === dim) vecs[i] = out[j]; });
      busy.done += part.length;
      progress();
      if (k % (BATCH * 8) === 0) save();
    }
    lastError = null;
  } catch (err) {
    lastError = reason(err);
    console.warn('[ask] embedding failed:', lastError);
  }
  busy = null;
  save();
  progress();
  return status();
}

// ---------- Adding messages ----------

/** Consecutive messages → stretches of conversation. */
function toChunks(roomId, room, msgs) {
  const out = [];
  let cur = null;
  for (const m of msgs) {
    if (cur && (cur.events.length >= CHUNK_MSGS || cur.text.length + m.line.length > CHUNK_CHARS || m.ts - cur.end > CHUNK_GAP)) { out.push(cur); cur = null; }
    if (!cur) cur = { id: `${roomId}|${m.id}`, roomId, room, ts: m.ts, end: m.ts, events: [], text: '' };
    cur.events.push(m.id);
    cur.end = m.ts;
    cur.text += `${cur.text ? '\n' : ''}${m.line}`;
  }
  if (cur) out.push(cur);
  return out;
}

/** New messages of one chat (oldest first). Returns how many chunks were added. */
function addMessages({ roomId, room, messages, newest }) {
  load();
  const known = new Set();
  for (const c of chunks) if (c.roomId === roomId) c.events.forEach((e) => known.add(e));
  const fresh = (messages || []).filter((m) => m && m.id && m.line && !known.has(m.id));
  const list = toChunks(roomId, String(room || ''), fresh);
  for (const c of list) { chunks.push(c); vecs.push(null); }
  // Keep the chat's name current on older chunks too (shown in answers and used by keyword search).
  if (room) for (const c of chunks) if (c.roomId === roomId) c.room = room;
  rooms[roomId] = { newest: Math.max(rooms[roomId]?.newest || 0, newest || 0, ...fresh.map((m) => m.ts)), checked: Date.now() };
  save();
  return list.length;
}

// ---------- Search ----------

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Small words in a few languages that say nothing about what's being looked for.
const STOP = new Set(('the and for you your what when where who which how did does was were with about that this from have has said say tell told ' +
  'que para com uma por quem qual quando onde como foi era sobre voce disse falou mandou ' +
  'los las del una por quien cual cuando donde como fue sobre dijo ' +
  'les des une pour qui quel quand comment est sur dit ' +
  'der die das und wer wann warum wie was ist mit').split(' ').map(fold));
const queryWords = (q) => [...new Set(fold(q).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w)))];

async function search({ query, host, model: wanted, k = 8 }) {
  load();
  if (!chunks.length) return { results: [], mode: 'empty' };
  const words = queryWords(query);
  let q = null;
  let note = null;
  if (model && vecs.some(Boolean)) {
    try {
      const m = await resolveModel(host, wanted);
      if (m === model) [q] = await embed(host, m, [`${prefix(m, 'q')}${query}`]);
      else note = 'model-changed';
    } catch (err) { note = reason(err); }
  } else {
    note = lastError || 'not-embedded';
  }
  if (q && q.length !== dim) q = null;
  const scored = [];
  for (let i = 0; i < chunks.length; i++) {
    let s = 0;
    let hit = 0;
    if (words.length) {
      const t = fold(`${chunks[i].room} ${chunks[i].text}`);
      for (const w of words) if (t.includes(w)) hit++;
    }
    if (q && vecs[i]) {
      const v = vecs[i];
      for (let d = 0; d < dim; d++) s += v[d] * q[d];
      s += 0.06 * hit;
    } else if (q) {
      s = 0.06 * hit; // not embedded yet: only exact words count
    } else {
      if (!hit) continue;
      s = hit / words.length + chunks[i].end / 1e15; // keywords only: more words first, then newer
    }
    scored.push([s, i]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  // Not five stretches of the same chat in a row: at most 3 per chat.
  const perRoom = {};
  const results = [];
  for (const [s, i] of scored) {
    const c = chunks[i];
    if ((perRoom[c.roomId] = (perRoom[c.roomId] || 0) + 1) > 3) continue;
    results.push({ id: c.id, roomId: c.roomId, room: c.room, ts: c.ts, end: c.end, events: c.events, text: c.text, score: Math.round(s * 1000) / 1000 });
    if (results.length >= k) break;
  }
  return { results, mode: q ? 'semantic' : 'keywords', note: q ? null : note };
}

function clear() {
  stopFlag = true;
  chunks = []; vecs = []; rooms = {}; model = null; dim = 0; lastError = null;
  clearTimeout(saveTimer);
  try { fs.rmSync(dir(), { recursive: true, force: true }); } catch {}
  progress();
  return status();
}

function init() {
  ipcMain.handle('ask:status', () => status());
  ipcMain.handle('ask:rooms', () => { load(); return rooms; });
  ipcMain.handle('ask:add', (_e, batch) => addMessages(batch || {}));
  ipcMain.handle('ask:embed', (_e, opts) => embedPending(opts || {}));
  ipcMain.handle('ask:search', (_e, opts) => search(opts || {}));
  ipcMain.handle('ask:models', async (_e, host) => {
    try { return { ok: true, models: await embedModels(host) }; } catch (err) { return { ok: false, error: reason(err), models: [] }; }
  });
  ipcMain.handle('ask:stop', () => { stopFlag = true; return true; });
  ipcMain.handle('ask:clear', () => clear());
  app.on('before-quit', () => { if (saveTimer) save(true); });
}

module.exports = { init };
