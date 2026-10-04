// Message reminders ("Remind me about this…").
//
// The main process owns the list so a reminder fires even with the window closed. It's a JSON
// file in userData; nothing goes to the homeserver. At the time: a native notification
// "Reminder · <chat>" with the message text (and the note, if any); clicking it opens the chat.

const { app, ipcMain, Notification, nativeImage, powerMonitor } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const TICK = 15 * 1000;

let opts = { mainWindow: () => null, getSession: () => null, onOpenMessage: () => {}, redact: (n) => n, icon: null };
let items = [];
let timer = null;
const shown = new Set(); // keeps fired notifications alive until clicked/closed (GC drops their handlers)

const file = () => path.join(app.getPath('userData'), 'reminders.json');

function load() {
  try { items = JSON.parse(fs.readFileSync(file(), 'utf8')).items || []; } catch { items = []; }
}

function save() {
  try {
    const tmp = file() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ items }, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, file());
  } catch (err) {
    console.error('Saving reminders failed:', err.message);
  }
  opts.mainWindow()?.webContents.send('reminders:changed', items);
}

const preview = (s, n = 140) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

function fire(item) {
  console.log(`[reminders] firing ${item.id} (${item.roomName || item.roomId} / ${item.eventId})`);
  if (!Notification.isSupported()) return;
  const text = preview(item.text) || 'Message';
  const body = item.note ? `${preview(item.note, 80)}\n“${preview(item.text, 100)}”` : text;
  const { title, body: shownBody } = opts.redact({ title: `Reminder · ${item.roomName || 'Chat'}`, body, roomId: item.roomId });
  const n = new Notification({
    title, body: shownBody,
    ...(opts.icon && process.platform === 'linux' ? { icon: nativeImage.createFromPath(opts.icon) } : {}),
  });
  shown.add(n);
  const target = { roomId: item.roomId, eventId: item.eventId };
  n.on('click', () => {
    shown.delete(n);
    console.log(`[reminders] notification clicked → open ${target.roomId} / ${target.eventId}`);
    opts.onOpenMessage(target.roomId, target.eventId);
  });
  n.on('close', () => shown.delete(n));
  n.on('failed', () => shown.delete(n));
  n.show();
}

function tick() {
  const now = Date.now();
  const s = opts.getSession();
  const due = items.filter((x) => x.remindAt <= now && (!x.userId || !s?.userId || x.userId === s.userId));
  if (!due.length) return;
  const ids = new Set(due.map((x) => x.id));
  items = items.filter((x) => !ids.has(x.id));
  save();
  for (const item of due) fire(item);
}

function clean(raw) {
  return {
    roomId: String(raw.roomId || ''),
    roomName: String(raw.roomName || '').slice(0, 200),
    eventId: String(raw.eventId || ''),
    sender: String(raw.sender || '').slice(0, 200),
    text: String(raw.text || '').slice(0, 2000),
    note: String(raw.note || '').slice(0, 500),
    remindAt: Number(raw.remindAt) || 0,
  };
}

function init(o) {
  opts = { ...opts, ...o };
  load();
  timer = setInterval(tick, TICK);
  powerMonitor.on('resume', () => setTimeout(tick, 3000));
  setTimeout(tick, 4000);
}

ipcMain.handle('reminders:list', () => items);

ipcMain.handle('reminders:add', (_e, raw) => {
  const item = { id: crypto.randomUUID(), ...clean(raw), userId: opts.getSession()?.userId || null, createdAt: Date.now() };
  if (!item.roomId || !item.eventId) throw new Error('Invalid message');
  if (!item.remindAt) throw new Error('Choose when to remind you');
  // One reminder per message: setting it again replaces the old one.
  items = items.filter((x) => !(x.roomId === item.roomId && x.eventId === item.eventId));
  items.push(item);
  save();
  setTimeout(tick, 0);
  return item;
});

ipcMain.handle('reminders:update', (_e, id, patch) => {
  const item = items.find((x) => x.id === id);
  if (!item) return null;
  if (patch.note !== undefined) item.note = String(patch.note).slice(0, 500);
  if (patch.remindAt !== undefined) item.remindAt = Number(patch.remindAt) || item.remindAt;
  save();
  setTimeout(tick, 0);
  return item;
});

ipcMain.handle('reminders:remove', (_e, id) => {
  items = items.filter((x) => x.id !== id);
  save();
});

app.on('will-quit', () => clearInterval(timer));

module.exports = { init, tick };
