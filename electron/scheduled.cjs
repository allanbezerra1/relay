// Scheduled messages ("Send later").
//
// The main process owns the queue so messages go out on time even with the window closed
// (Relay keeps running on macOS after its window is closed). The queue is a JSON file in userData;
// each message is sent straight to the homeserver with the client-server API, using the same
// session the window signed in with. The transaction id is derived from the message id, so a
// retry after a timeout that actually reached the server can't post the message twice.

const { app, ipcMain, Notification, nativeImage, powerMonitor } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const TICK = 15 * 1000;
const MAX_BACKOFF = 10 * 60 * 1000;
const WARN_AFTER = 5; // failed attempts before telling the user it's late (it keeps trying)

let opts = { getSession: () => null, mainWindow: () => null, onOpenRoom: () => {}, icon: null };
let items = [];
let timer = null;
const inFlight = new Set();

const file = () => path.join(app.getPath('userData'), 'scheduled.json');

function load() {
  try { items = JSON.parse(fs.readFileSync(file(), 'utf8')).items || []; } catch { items = []; }
}

function save() {
  try {
    const tmp = file() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ items }, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, file());
  } catch (err) {
    console.error('Saving scheduled messages failed:', err.message);
  }
  opts.mainWindow()?.webContents.send('scheduled:changed', items);
}

function notify(title, body, roomId) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, ...(opts.icon && process.platform === 'linux' ? { icon: nativeImage.createFromPath(opts.icon) } : {}) });
  n.on('click', () => opts.onOpenRoom(roomId));
  n.show();
}

const preview = (s, n = 80) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

async function send(item) {
  const s = opts.getSession();
  if (!s?.accessToken || !s?.baseUrl) throw Object.assign(new Error('Not signed in'), { retry: true });
  // Queued under another account (signed out and in as someone else): never post it from this one.
  if (item.userId && s.userId && item.userId !== s.userId) throw Object.assign(new Error('Scheduled from another account'), { retry: false });
  const url = `${s.baseUrl.replace(/\/+$/, '')}/_matrix/client/v3/rooms/${encodeURIComponent(item.roomId)}/send/m.room.message/${encodeURIComponent(`relay-sched-${item.id}`)}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${s.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'm.text', body: item.body }),
      signal: AbortSignal.timeout(30 * 1000),
    });
  } catch (err) {
    throw Object.assign(new Error('Can’t reach the server'), { retry: true, cause: err });
  }
  if (res.ok) return;
  const json = await res.json().catch(() => ({}));
  // Rate limits and server hiccups are worth retrying; a closed room or a revoked token isn't.
  const retry = res.status === 429 || res.status >= 500;
  throw Object.assign(new Error(json.error || `Error ${res.status}`), { retry, after: json.retry_after_ms });
}

async function attempt(item) {
  if (inFlight.has(item.id)) return;
  inFlight.add(item.id);
  try {
    await send(item);
    items = items.filter((x) => x.id !== item.id);
    save();
    notify(`Scheduled message sent · ${item.roomName || 'Chat'}`, preview(item.body), item.roomId);
  } catch (err) {
    const cur = items.find((x) => x.id === item.id);
    if (!cur) return; // cancelled meanwhile
    cur.attempts = (cur.attempts || 0) + 1;
    cur.lastError = err.message;
    if (err.retry) {
      cur.retryAt = Date.now() + (err.after || Math.min(MAX_BACKOFF, 30 * 1000 * 2 ** (cur.attempts - 1)));
      if (cur.attempts === WARN_AFTER) notify(`Scheduled message delayed · ${cur.roomName || 'Chat'}`, `Couldn’t send it yet (${err.message}). Relay will keep trying.`, cur.roomId);
    } else {
      cur.status = 'failed';
      notify(`Couldn’t send scheduled message · ${cur.roomName || 'Chat'}`, `${err.message}: “${preview(cur.body, 60)}”`, cur.roomId);
    }
    save();
  } finally {
    inFlight.delete(item.id);
  }
}

function tick() {
  const now = Date.now();
  for (const item of items) {
    if (item.status === 'failed') continue;
    if (item.sendAt <= now && (!item.retryAt || item.retryAt <= now)) attempt(item);
  }
}

function clean(item) {
  return {
    roomId: String(item.roomId),
    roomName: String(item.roomName || '').slice(0, 200),
    body: String(item.body || ''),
    sendAt: Number(item.sendAt) || Date.now(),
  };
}

function init(o) {
  opts = { ...opts, ...o };
  load();
  // Poll rather than one long setTimeout: timers drift across sleep, and a laptop that wakes
  // up past the due time should send right away (resume triggers a check too).
  timer = setInterval(tick, TICK);
  powerMonitor.on('resume', () => setTimeout(tick, 5000));
  setTimeout(tick, 5000);
}

ipcMain.handle('scheduled:list', () => items);

ipcMain.handle('scheduled:add', (_e, raw) => {
  const s = opts.getSession();
  const item = { id: crypto.randomUUID(), ...clean(raw), userId: s?.userId || null, createdAt: Date.now(), attempts: 0 };
  if (!item.body.trim()) throw new Error('Empty message');
  items.push(item);
  save();
  setTimeout(tick, 0);
  return item;
});

ipcMain.handle('scheduled:update', (_e, id, patch) => {
  const item = items.find((x) => x.id === id);
  if (!item) return null;
  if (patch.body !== undefined) item.body = String(patch.body);
  if (patch.sendAt !== undefined) item.sendAt = Number(patch.sendAt);
  // Edited after failing: give it a fresh start.
  delete item.status; delete item.retryAt; delete item.lastError; item.attempts = 0;
  save();
  setTimeout(tick, 0);
  return item;
});

ipcMain.handle('scheduled:cancel', (_e, id) => {
  items = items.filter((x) => x.id !== id);
  save();
});

ipcMain.handle('scheduled:sendNow', async (_e, id) => {
  const item = items.find((x) => x.id === id);
  if (!item) return false;
  item.sendAt = Date.now();
  delete item.status; delete item.retryAt;
  await attempt(item);
  return !items.some((x) => x.id === id);
});

app.on('will-quit', () => clearInterval(timer));

module.exports = { init };
