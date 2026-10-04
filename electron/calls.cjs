// WhatsApp voice & video calls.
//
// The mautrix bridge carries messages but can't carry call audio/video (whatsmeow has no VoIP
// stack). WhatsApp Web can, so Relay keeps a WhatsApp Web session of its own in a hidden window,
// linked as one more device, and uses it only for calls:
//   - incoming calls are spotted three ways (the bridge's "Incoming call" notice, WhatsApp Web's
//     own call screen, and its notifications) and shown in Relay's own ringing window;
//   - "Answer" brings WhatsApp Web forward and presses its answer button;
//   - the call buttons in a chat open that chat in WhatsApp Web and start the call there.
// Messages never go through this window: its notifications are swallowed (Relay already shows them).

const { app, BrowserWindow, session, ipcMain, shell, screen, desktopCapturer, Notification, nativeImage, systemPreferences } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const IS_MAC = process.platform === 'darwin';
const WA_URL = 'https://web.whatsapp.com/';
const PARTITION = 'persist:whatsapp-web';
const RING_TIMEOUT = 50 * 1000;

let mainWindow = () => null;
let resolveTarget = async () => null; // roomId -> { phone, group, name }
let onState = () => {};

let waWin = null;
let toastWin = null;
let quitting = false;
let sessionReady = false;

// What the page reported last (see wa-preload.cjs).
let dom = { status: 'off', incoming: false, inCall: false };
let inCallSince = null;
let ring = null; // { name, video, avatar, roomId, since, domSeen, timer, logId, test }
let ringNote = null; // the "incoming call" notification, closed when the ring ends
let live = null; // call-log id of the call in progress (answered or placed from Relay)
let liveTimer = null;
let pending = null; // call to place once WhatsApp Web is logged in: { roomId, video, name }

// ---------- Settings (survive restarts, needed before the UI loads) ----------

const settingsFile = () => path.join(app.getPath('userData'), 'calls.json');
let settings = null;
function cfg() {
  if (settings) return settings;
  try { settings = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { settings = {}; }
  settings = { enabled: false, linked: false, ...settings };
  return settings;
}
function saveCfg(patch) {
  settings = { ...cfg(), ...patch };
  try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), { mode: 0o600 }); } catch {}
  broadcast();
}

function publicState() {
  const c = cfg();
  const cur = live && getLog().find((e) => e.id === live);
  return {
    enabled: c.enabled,
    linked: c.linked,
    status: waWin ? dom.status : 'off', // off | loading | qr | ready
    inCall: !!dom.inCall,
    inCallSince,
    ringing: ring ? { name: ring.name, video: ring.video, roomId: ring.roomId, test: !!ring.test } : null,
    call: cur ? { name: cur.name, video: cur.video, roomId: cur.roomId, dir: cur.dir } : null,
    windowVisible: !!waWin && !waWin.isDestroyed() && waWin.isVisible(),
  };
}
let lastSent = '';
function broadcast() {
  const s = publicState();
  const json = JSON.stringify(s);
  if (json === lastSent) return;
  lastSent = json;
  onState(s);
}

// ---------- Call log (the "Calls" history) ----------
// What only this process knows: calls placed from Relay, rings it showed and how they ended,
// and how long the call lasted. The UI merges this with the bridge's call notices in the chats.

const logFile = () => path.join(app.getPath('userData'), 'calls-log.json');
const LOG_MAX = 500;
let log = null;
let logTimer = null;
function getLog() {
  if (log) return log;
  try { log = JSON.parse(fs.readFileSync(logFile(), 'utf8')); } catch {}
  if (!Array.isArray(log)) log = [];
  return log;
}
function flushLog() {
  clearTimeout(logTimer);
  logTimer = null;
  try { fs.writeFileSync(logFile(), JSON.stringify(getLog()), { mode: 0o600 }); } catch {}
}
const history = () => ({ entries: getLog(), seenAt: cfg().seenAt || 0 });
function logChanged() {
  if (!logTimer) logTimer = setTimeout(flushLog, 500);
  const w = mainWindow();
  if (w && !w.isDestroyed()) w.webContents.send('calls:history', history());
}
function logAdd(entry) {
  const e = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, ts: Date.now(), ...entry };
  getLog().unshift(e);
  if (log.length > LOG_MAX) log.length = LOG_MAX;
  logChanged();
  return e.id;
}
function logUpdate(id, patch) {
  const e = id && getLog().find((x) => x.id === id);
  if (!e) return;
  Object.assign(e, patch);
  logChanged();
}
/** This call is the one on screen now: the in-call duration goes to it. */
function setLive(id) {
  live = id;
  clearTimeout(liveTimer);
  // Never connected (no answer, or the call screen didn't open): don't pin a later call on it.
  liveTimer = setTimeout(() => { if (!dom.inCall && live === id) { live = null; broadcast(); } }, 90 * 1000);
  broadcast();
}

// ---------- Camera & microphone (macOS privacy) ----------
// On macOS the app itself needs the user's OK for the microphone and camera (the usage strings
// are in package.json → build.mac.extendInfo). WhatsApp Web asking for them isn't enough: without
// it the call connects with no sound, so ask first, from a click, the way FaceTime does.

async function mediaAccess(kind) {
  if (!IS_MAC) return true;
  try {
    const status = systemPreferences.getMediaAccessStatus(kind);
    if (status === 'granted') return true;
    if (status === 'denied' || status === 'restricted') return false;
    return await systemPreferences.askForMediaAccess(kind);
  } catch { return false; }
}
/** Microphone always, camera for video calls. Resolves with what's missing (empty when all good). */
async function ensureMedia(video) {
  const missing = [];
  if (!(await mediaAccess('microphone'))) missing.push('microphone');
  if (video && !(await mediaAccess('camera'))) missing.push('camera');
  return missing;
}
const missingMediaError = (missing) => `Relay doesn’t have access to the ${missing.join(' and ')}. Allow it in System Settings → Privacy & Security, then try again.`;
function openPrivacySettings(kind) {
  if (!IS_MAC) return;
  const pane = kind === 'camera' ? 'Privacy_Camera' : 'Privacy_Microphone';
  shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`).catch(() => {});
}

// ---------- The WhatsApp Web session ----------

function chromeUA() {
  const os = IS_MAC ? 'Macintosh; Intel Mac OS X 10_15_7'
    : process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64';
  // A plain Chrome UA: WhatsApp Web refuses browsers it doesn't recognise (and "Electron/…" is one).
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
}

function setupSession() {
  if (sessionReady) return session.fromPartition(PARTITION);
  sessionReady = true;
  const ses = session.fromPartition(PARTITION);
  ses.setUserAgent(chromeUA());
  const allowed = new Set(['media', 'notifications', 'display-capture', 'fullscreen', 'clipboard-sanitized-write', 'clipboard-read', 'speaker-selection', 'idle-detection']);
  const isWA = (url) => /^https:\/\/([a-z0-9-]+\.)*whatsapp\.(com|net)\//.test(url || '');
  ses.setPermissionRequestHandler(async (wc, permission, cb, details) => {
    if (!allowed.has(permission) || !isWA(wc.getURL())) return cb(false);
    if (permission !== 'media') return cb(true);
    // macOS: make sure the app itself may use the devices WhatsApp Web is asking for.
    const types = details?.mediaTypes || [];
    const missing = await ensureMedia(types.includes('video'));
    const audioOk = !missing.includes('microphone') || !types.includes('audio');
    const videoOk = !missing.includes('camera') || !types.includes('video');
    cb(audioOk && videoOk);
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => allowed.has(permission) && isWA(origin || wc?.getURL()));
  // Screen sharing during a call: the system picker where there is one (macOS 15+), else the first screen.
  ses.setDisplayMediaRequestHandler((_req, cb) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] })
      .then((sources) => cb(sources.length ? { video: sources[0] } : {}))
      .catch(() => cb({}));
  }, { useSystemPicker: true });
  return ses;
}

function windowOptions(extra = {}) {
  return {
    width: 1120, height: 780, minWidth: 720, minHeight: 520, show: false,
    // A regular titled window: WhatsApp Web's own layout starts at the very top-left, where
    // hidden-inset traffic lights would sit on top of its buttons.
    title: 'WhatsApp', backgroundColor: '#0b141a',
    ...(IS_MAC ? { tabbingIdentifier: 'relay-whatsapp-web' } : { autoHideMenuBar: true }),
    ...extra,
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, 'wa-preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true,
      backgroundThrottling: false, // keep listening for calls while hidden
      autoplayPolicy: 'no-user-gesture-required',
    },
  };
}

function wireWindow(win) {
  // Keep the title fixed ("WhatsApp"), not whatever the page sets ("(3) WhatsApp").
  win.on('page-title-updated', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    // WhatsApp opens its call screen and media viewers as popups; links go to the browser.
    if (!url || url === 'about:blank' || url.startsWith(WA_URL)) {
      return { action: 'allow', overrideBrowserWindowOptions: windowOptions({ width: 900, height: 640, show: true, parent: undefined }) };
    }
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-create-window', (child) => wireWindow(child));
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(WA_URL)) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); }
  });
}

function ensureWindow() {
  if (waWin && !waWin.isDestroyed()) return waWin;
  setupSession();
  dom = { status: 'loading', incoming: false, inCall: false };
  waWin = new BrowserWindow(windowOptions());
  wireWindow(waWin);
  waWin.on('close', (e) => {
    if (quitting) return;
    e.preventDefault(); // keep it running in the background for incoming calls
    if (waWin.isFullScreen()) { waWin.once('leave-full-screen', () => waWin?.hide()); waWin.setFullScreen(false); } else waWin.hide();
    broadcast();
  });
  waWin.webContents.setAudioMuted(true);
  waWin.on('show', () => { syncAudio(); broadcast(); });
  waWin.on('hide', () => { syncAudio(); broadcast(); });
  waWin.on('focus', syncAudio);
  waWin.on('blur', syncAudio);
  // Call popups open as their own windows: they start muted like the rest.
  waWin.webContents.on('did-create-window', (child) => { child.webContents.setAudioMuted(true); syncAudio(); });
  waWin.on('closed', () => { waWin = null; dom = { status: 'off', incoming: false, inCall: false }; broadcast(); });
  waWin.loadURL(WA_URL).catch(() => {});
  broadcast();
  return waWin;
}

function showWindow() {
  const w = ensureWindow();
  if (w.isMinimized()) w.restore();
  if (IS_MAC) app.focus({ steal: true });
  w.show();
  w.focus();
  broadcast();
}

/**
 * WhatsApp Web stays muted: it gets every message too and would play its own "pop" next to Relay's
 * notification sound. Sound only while a call is up (and not ringing — Relay rings itself), or
 * while you have its window open in front of you.
 */
function syncAudio() {
  const open = !!(waWin && !waWin.isDestroyed() && waWin.isVisible() && waWin.isFocused());
  const muted = !!ring || !(dom.inCall || open);
  for (const wc of waContents()) if (wc.isAudioMuted() !== muted) wc.setAudioMuted(muted);
}

/** Every WhatsApp Web page (the main one and any call popups). */
function waContents() {
  return BrowserWindow.getAllWindows()
    .filter((w) => !w.isDestroyed() && w.webContents.session === session.fromPartition(PARTITION))
    .map((w) => w.webContents);
}

let cmdSeq = 0;
const cmdWaiters = new Map();
ipcMain.on('wa:cmd-result', (_e, { id, result }) => { cmdWaiters.get(id)?.(result); cmdWaiters.delete(id); });

/** Run a command in the page's preload (see wa-preload.cjs); resolves with its result or null. */
function cmd(wc, name, arg, timeoutMs = 20000) {
  return new Promise((resolve) => {
    if (!wc || wc.isDestroyed()) return resolve(null);
    const id = ++cmdSeq;
    const t = setTimeout(() => { cmdWaiters.delete(id); resolve(null); }, timeoutMs);
    cmdWaiters.set(id, (r) => { clearTimeout(t); resolve(r); });
    wc.send('wa:cmd', { id, name, arg });
  });
}
async function cmdAll(name, arg) {
  const results = await Promise.all(waContents().map((wc) => cmd(wc, name, arg, 4000)));
  return results.some(Boolean);
}

// Reports from the page.
ipcMain.on('wa:state', (e, s) => {
  if (!waContents().includes(e.sender)) return;
  const fromMain = waWin && e.sender === waWin.webContents;
  if (fromMain) dom.status = s.status;
  // Call state can come from the main page or a call popup: any page saying so counts.
  const all = { ...(dom.pages || {}), [e.sender.id]: s };
  dom.pages = all;
  const pages = Object.values(all);
  const wasInCall = dom.inCall;
  dom.incoming = pages.some((p) => p.incoming);
  dom.inCall = pages.some((p) => p.inCall);
  // An outgoing call shows the hang-up button while it's still ringing: the clock starts on answer.
  const connecting = pages.some((p) => p.inCall && p.connecting);
  const incomingPage = pages.find((p) => p.incoming);

  if (dom.status === 'ready' && !cfg().linked) saveCfg({ linked: true, enabled: true });
  if (dom.inCall && !connecting && !inCallSince) {
    inCallSince = Date.now();
    if (live) logUpdate(live, { connectedAt: inCallSince });
  }
  if (!dom.inCall && wasInCall) {
    if (live && inCallSince) logUpdate(live, { duration: Math.round((Date.now() - inCallSince) / 1000) });
    live = null;
  }
  if (!dom.inCall) inCallSince = null;
  syncAudio();

  if (dom.incoming) {
    if (!ring) incoming({ name: incomingPage?.name, video: incomingPage?.video, source: 'page' });
    if (ring) ring.domSeen = true;
  } else if (ring?.domSeen) {
    endRing(); // answered elsewhere, declined on the phone, or the caller hung up
  }
  if (dom.status === 'ready' && pending) {
    const p = pending; pending = null;
    placeCall(p.roomId, p.video, p.name);
  }
  broadcast();
});

// WhatsApp Web's notification texts, in English and Portuguese (it follows the system language).
const MISSED = /missed|perdida/i;
const CALLING = /\bcall(ing)?\b|chamada|liga(ção|ndo)/i;
const VIDEO = /video|v[ií]deo/i;

ipcMain.on('wa:notification', (e, n) => {
  if (!waContents().includes(e.sender)) return;
  const text = `${n.title || ''} ${n.body || ''}`;
  // WhatsApp Web's "missed call" notification confirms the last unanswered ring was missed.
  if (MISSED.test(text) && lastEnded && Date.now() - lastEnded.at < 60 * 1000) {
    const { r } = lastEnded;
    lastEnded = null;
    if (r.logId) logUpdate(r.logId, { state: 'missed' });
    if (!r.test) missedNotice(r);
    broadcast();
    return;
  }
  // WhatsApp Web's own notifications are dropped (Relay shows messages itself); calls start ringing.
  if (CALLING.test(text) && !MISSED.test(text)) {
    incoming({ name: n.title, video: VIDEO.test(text), source: 'notification' });
  }
});
app.on('web-contents-created', (_e, wc) => wc.on('destroyed', () => { if (dom.pages) delete dom.pages[wc.id]; }));

// ---------- Ringing ----------

let lastEnded = null; // { r, at }: the last ring that stopped without an answer in Relay

function incoming({ name, video, avatar, roomId, source }) {
  if (dom.inCall && source !== 'page') return; // already talking
  if (ring && source === 'test') return;
  if (ring) {
    // Same call reported by another source: keep the richest details.
    if (name && (source === 'relay' || !ring.name)) ring.name = name;
    if (avatar) ring.avatar = avatar;
    if (roomId) ring.roomId = roomId;
    if (video) ring.video = true;
    logUpdate(ring.logId, { name: ring.name, roomId: ring.roomId, video: ring.video });
    updateToast();
    broadcast();
    return;
  }
  const test = source === 'test';
  ring = { name: name || 'WhatsApp', video: !!video, avatar: avatar || null, roomId: roomId || null, since: Date.now(), domSeen: false, test };
  ring.timer = setTimeout(() => endRing(), test ? 20 * 1000 : RING_TIMEOUT);
  if (!test) ring.logId = logAdd({ dir: 'in', state: 'ringing', video: ring.video, name: ring.name, roomId: ring.roomId });
  // Relay rings itself, so WhatsApp Web's ringtone would double it.
  syncAudio();
  showToast();
  nativeNotice();
  broadcast();
}

/** how: 'answered' / 'declined' when the user acted in Relay; otherwise it's worked out here. */
function endRing(how) {
  if (!ring) return;
  const r = ring;
  clearTimeout(r.timer);
  ring = null;
  ringNote?.close();
  ringNote = null;
  // Gone without an answer in Relay: WhatsApp Web is now in the call (answered there), or it was
  // answered on the phone, or the caller gave up. Those last two look the same from here, so it's
  // only called "missed" once WhatsApp Web itself reports a missed call (see wa:notification).
  const outcome = how || (dom.inCall ? 'answered' : 'ended');
  if (outcome === 'ended') lastEnded = { r, at: Date.now() };
  if (r.logId) {
    logUpdate(r.logId, { state: outcome, ...(outcome === 'answered' && inCallSince ? { connectedAt: inCallSince } : {}) });
    if (outcome === 'answered') setLive(r.logId);
  }
  syncAudio();
  if (toastWin && !toastWin.isDestroyed()) toastWin.webContents.send('toast:end');
  setTimeout(() => { if (!ring && toastWin && !toastWin.isDestroyed()) toastWin.destroy(); }, 260);
  broadcast();
}

/** The caller's photo on the notification, except on macOS where it always carries the app icon. */
function noticeIcon(avatar) {
  if (IS_MAC || !avatar) return {};
  try { const img = nativeImage.createFromDataURL(avatar); return img.isEmpty() ? {} : { icon: img }; } catch { return {}; }
}

function nativeNotice() {
  if (!Notification.isSupported() || !ring) return;
  const n = new Notification({
    title: ring.test ? `${ring.name} (test)` : ring.name,
    body: ring.video ? 'WhatsApp video call' : 'WhatsApp voice call',
    silent: true, // the ringing window plays the ringtone
    ...(IS_MAC ? { actions: [{ type: 'button', text: 'Answer' }] } : {}),
    ...(process.platform === 'linux' ? { urgency: 'critical' } : {}),
    ...noticeIcon(ring.avatar),
  });
  n.on('action', () => answer());
  n.on('click', () => { if (toastWin && !toastWin.isDestroyed()) toastWin.showInactive(); else answer(); });
  n.show();
  ringNote = n;
}

// Kept referenced until closed: a garbage-collected notification loses its click handler.
const missedNotes = new Set();
function missedNotice(r) {
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title: 'Missed call',
    body: `${r.name} · ${r.video ? 'Missed video call' : 'Missed voice call'}`,
    ...noticeIcon(r.avatar),
  });
  missedNotes.add(n);
  n.on('close', () => missedNotes.delete(n));
  n.on('click', () => { missedNotes.delete(n); focusMain(r.roomId); });
  n.show();
}

/** Bring Relay forward on a chat (same path as a message notification), or on the call history. */
function focusMain(roomId) {
  const w = mainWindow();
  if (!w || w.isDestroyed()) return;
  if (w.isMinimized()) w.restore();
  if (IS_MAC) app.show();
  w.show();
  w.focus();
  w.webContents.send(roomId ? 'notification:click' : 'calls:showHistory', roomId);
}

function toastData() {
  return ring && { name: ring.name, video: ring.video, avatar: ring.avatar, linked: cfg().linked && dom.status === 'ready', test: !!ring.test };
}

function showToast() {
  if (toastWin && !toastWin.isDestroyed()) { updateToast(); toastWin.showInactive(); return; }
  const W = 400, H = 132;
  // Top-right corner, under the menu bar, like a macOS notification banner.
  const area = screen.getPrimaryDisplay().workArea;
  toastWin = new BrowserWindow({
    width: W, height: H, x: area.x + area.width - W - 8, y: area.y + 8,
    frame: false, transparent: true, resizable: false, movable: true, alwaysOnTop: true, skipTaskbar: true,
    fullscreenable: false, minimizable: false, maximizable: false, show: false, hasShadow: false,
    // macOS: a non-activating panel, so it floats over full-screen apps without stealing focus.
    ...(IS_MAC ? { type: 'panel' } : {}),
    title: 'Incoming call', backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'call-toast-preload.cjs'), contextIsolation: true, sandbox: true, autoplayPolicy: 'no-user-gesture-required' },
  });
  toastWin.setAlwaysOnTop(true, 'screen-saver');
  if (IS_MAC) toastWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  toastWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  toastWin.webContents.on('will-navigate', (e) => e.preventDefault());
  toastWin.loadFile(path.join(__dirname, 'call-toast.html'));
  toastWin.once('ready-to-show', () => { updateToast(); toastWin.showInactive(); });
  toastWin.on('closed', () => { toastWin = null; });
}

function updateToast() {
  if (toastWin && !toastWin.isDestroyed() && ring) toastWin.webContents.send('toast:data', toastData());
}

ipcMain.on('toast:ready', (e) => { if (toastWin && e.sender === toastWin.webContents) updateToast(); });
ipcMain.on('toast:answer', (e) => { if (toastWin && e.sender === toastWin.webContents) answer(); });
ipcMain.on('toast:decline', (e) => { if (toastWin && e.sender === toastWin.webContents) decline(); });

async function answer() {
  const wasRinging = !!ring;
  const video = !!ring?.video;
  if (ring?.test) { endRing('answered'); return; }
  endRing('answered');
  // The microphone (and camera) prompt comes before WhatsApp Web picks up, not halfway into the call.
  const missing = await ensureMedia(video);
  showWindow();
  if (missing.length) openPrivacySettings(missing[0]);
  if (!wasRinging || dom.status !== 'ready') return;
  // Press WhatsApp's own answer button (in the main page or its call popup).
  for (let i = 0; i < 6; i++) {
    if (await cmdAll('accept')) return;
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function decline() {
  const test = ring?.test;
  endRing('declined');
  if (!test) await cmdAll('decline');
}

// ---------- Placing calls ----------

async function placeCall(roomId, video, name) {
  const target = await resolveTarget(roomId).catch(() => null);
  if (!target) return { ok: false, error: 'Couldn’t find this chat on WhatsApp.' };
  const missing = await ensureMedia(video);
  if (missing.length) { openPrivacySettings(missing[0]); return { ok: false, error: missingMediaError(missing) }; }
  const c = cfg();
  if (!c.enabled) saveCfg({ enabled: true });
  showWindow();
  if (dom.status !== 'ready') {
    // Not linked yet (QR on screen) or still loading: call as soon as it's ready.
    pending = { roomId, video, name };
    return { ok: true, waiting: true };
  }
  let opened = false;
  if (target.phone) {
    // WhatsApp's own deep link: opens the chat, also with people who aren't saved contacts.
    // The page reloads; its new preload says when the chat is on screen.
    const ready = new Promise((resolve) => {
      const t = setTimeout(() => { ipcMain.removeListener('wa:chat-opened', on); resolve(false); }, 40000);
      const on = (e) => { if (e.sender === waWin?.webContents) { clearTimeout(t); ipcMain.removeListener('wa:chat-opened', on); resolve(true); } };
      ipcMain.on('wa:chat-opened', on);
    });
    waWin.webContents.loadURL(`${WA_URL}send?phone=${String(target.phone).replace(/\D/g, '')}`).catch(() => {});
    opened = await ready;
  }
  if (!opened) opened = await cmd(waWin.webContents, 'openChatByName', target.name || name, 15000);
  const wc = waWin.webContents;
  if (!opened) return { ok: false, error: 'WhatsApp Web is open, but the chat wasn’t found there. Open it and call from WhatsApp Web.' };
  const started = await cmd(wc, 'startCall', !!video, 15000);
  if (started) setLive(logAdd({ dir: 'out', state: 'outgoing', video: !!video, name: name || target.name || 'WhatsApp', roomId }));
  return started ? { ok: true } : { ok: false, error: 'The chat is open in WhatsApp Web; press call there.' };
}

// ---------- Public API ----------

function init(opts) {
  mainWindow = opts.mainWindow;
  resolveTarget = opts.resolveTarget;
  onState = opts.onState;
  app.on('before-quit', () => { quitting = true; if (logTimer) flushLog(); });
  // Linked before: start listening for calls in the background.
  if (cfg().enabled && cfg().linked) setTimeout(ensureWindow, 4000);
}

ipcMain.handle('calls:state', () => publicState());
ipcMain.handle('calls:connect', () => { saveCfg({ enabled: true }); showWindow(); return publicState(); });
ipcMain.handle('calls:open', () => { showWindow(); return publicState(); });
ipcMain.handle('calls:setEnabled', (_e, on) => {
  saveCfg({ enabled: !!on });
  if (on && cfg().linked) ensureWindow();
  if (!on && waWin && !dom.inCall) { quitting = true; waWin.destroy(); quitting = false; }
  return publicState();
});
ipcMain.handle('calls:disconnect', async () => {
  if (waWin) { quitting = true; waWin.destroy(); quitting = false; }
  await session.fromPartition(PARTITION).clearStorageData().catch(() => {});
  saveCfg({ linked: false, enabled: false });
  return publicState();
});
ipcMain.handle('calls:start', (_e, roomId, video, name) => placeCall(roomId, video, name));
// The bridge posted "Incoming call" in a chat: Relay knows the name and photo best.
ipcMain.on('calls:incoming', (_e, info) => {
  if (Date.now() - (info.ts || Date.now()) > 60 * 1000) return;
  incoming({ ...info, source: 'relay' });
});
ipcMain.on('calls:answer', () => answer());
ipcMain.on('calls:decline', () => decline());
ipcMain.handle('calls:history', () => history());
ipcMain.handle('calls:seen', () => { saveCfg({ seenAt: Date.now() }); logChanged(); return history(); });
ipcMain.handle('calls:hangup', () => cmdAll('hangup'));
// Settings → Calls: preview the ringing window with a made-up caller (not logged, does nothing).
ipcMain.handle('calls:simulate', (_e, video) => { incoming({ name: 'Test contact', video: !!video, source: 'test' }); return true; });
// Settings → Calls → "Test detection": what the hidden WhatsApp Web can see right now.
ipcMain.handle('calls:diagnose', async () => {
  const c = cfg();
  const base = {
    at: Date.now(), enabled: c.enabled, linked: c.linked, status: publicState().status,
    window: !!waWin && !waWin.isDestroyed(), pages: waContents().length,
    app: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome,
    media: IS_MAC ? { microphone: systemPreferences.getMediaAccessStatus('microphone'), camera: systemPreferences.getMediaAccessStatus('camera') } : null,
  };
  if (!base.window) return { ...base, page: null };
  return { ...base, page: await cmd(waWin.webContents, 'diagnose', null, 8000) };
});
ipcMain.handle('calls:askMedia', async (_e, video) => {
  const missing = await ensureMedia(!!video);
  if (missing.length) openPrivacySettings(missing[0]);
  return missing;
});

module.exports = { init, state: publicState };
