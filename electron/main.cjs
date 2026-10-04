const { app, BrowserWindow, ipcMain, safeStorage, Notification, shell, session, Menu, nativeTheme, systemPreferences, dialog } = require('electron');
const os = require('node:os');
const { execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const local = require('./local.cjs');
const updater = require('./updater.cjs');
require('./automations.cjs').init(); // automations: webhooks (auto:webhook)
require('./smart.cjs').init(); // smart cards: addresses on the map (smart:geocode)
const reminders = require('./reminders.cjs');
const scheduled = require('./scheduled.cjs');

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const sessionFile = () => path.join(app.getPath('userData'), 'session.bin');

let win = null;
let matrixSession = null; // { baseUrl, accessToken, userId, deviceId }

// ---------- Session storage ----------
// Sessions for other homeservers are encrypted with the macOS Keychain. The local server's session
// is kept as a plain 0600 file instead: its token only works against 127.0.0.1, and Synapse's own
// database next to it holds the same token anyway. Skipping the Keychain matters for updates: the
// public builds are ad-hoc signed, so every new version would otherwise ask for the login password.

const localSessionFile = () => path.join(app.getPath('userData'), 'session.json');
const isLocalSession = (data) => !!data && (data.local === true || data.baseUrl?.replace(/\/+$/, '') === local.HS_URL);

function readSession() {
  try { return JSON.parse(fs.readFileSync(localSessionFile(), 'utf8')); } catch {}
  try {
    const raw = fs.readFileSync(sessionFile());
    const data = JSON.parse(safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8'));
    if (isLocalSession(data)) writeSession(data); // move it out of the Keychain
    return data;
  } catch {
    return null;
  }
}

function writeSession(data) {
  const json = JSON.stringify(data);
  if (isLocalSession(data)) {
    fs.writeFileSync(localSessionFile(), json, { mode: 0o600 });
    try { fs.unlinkSync(sessionFile()); } catch {}
    return;
  }
  const buf = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8');
  fs.writeFileSync(sessionFile(), buf, { mode: 0o600 });
  try { fs.unlinkSync(localSessionFile()); } catch {}
}

// ---------- Authenticated media ----------
// Matrix servers now require an access token to download media (MSC3916).
// <img> tags can't send headers, so we inject Authorization for media URLs
// on the homeserver only.

function installPermissions() {
  // Only our own page may ask for anything, and only the microphone (voice messages),
  // notifications, clipboard writes (copy message) and full screen (videos).
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const own = DEV_URL ? wc.getURL().startsWith(DEV_URL) : wc.getURL().startsWith('file://');
    const allowed = permission === 'media' ? !(details.mediaTypes || []).includes('video') : ['notifications', 'clipboard-sanitized-write', 'fullscreen'].includes(permission);
    callback(own && allowed);
  });
}

function installMediaAuth() {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://*/*', 'http://*/*'] },
    (details, callback) => {
      const s = matrixSession;
      if (s && details.url.startsWith(s.baseUrl.replace(/\/$/, '') + '/_matrix/client/v1/media/')) {
        details.requestHeaders.Authorization = `Bearer ${s.accessToken}`;
      }
      callback({ requestHeaders: details.requestHeaders });
    },
  );
}

// ---------- Window ----------

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 860,
    minHeight: 560,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 18 },
    // Translucent sidebar like Beeper / Finder: the list shows a blurred desktop behind it.
    ...(process.platform === 'darwin'
      ? { vibrancy: 'sidebar', visualEffectState: 'followWindow', backgroundColor: '#00000000' }
      : { backgroundColor: '#0f1115' }),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  // Native menu for text: fields (cut/copy/paste + spelling) and selections.
  // Our own right-click menus (chats, messages) cancel the event, so they don't reach here.
  win.webContents.on('context-menu', (_e, params) => {
    const items = [];
    if (params.misspelledWord) {
      for (const s of params.dictionarySuggestions.slice(0, 5)) items.push({ label: s, click: () => win.webContents.replaceMisspelling(s) });
      items.push({ label: 'Add to dictionary', click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
      items.push({ type: 'separator' });
    }
    if (params.isEditable) {
      items.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
    } else if (params.selectionText.trim()) {
      items.push({ role: 'copy' });
      if (process.platform === 'darwin') items.push({ label: `Look Up “${params.selectionText.trim().slice(0, 24)}”`, click: () => win.webContents.showDefinitionForSelection() });
    } else if (params.linkURL && /^https?:/.test(params.linkURL)) {
      items.push({ label: 'Open link', click: () => shell.openExternal(params.linkURL) }, { label: 'Copy link', click: () => require('electron').clipboard.writeText(params.linkURL) });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });

  // Open links in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    const allowed = DEV_URL ? url.startsWith(DEV_URL) : url.startsWith('file://');
    if (!allowed) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });

  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  win.on('focus', () => win.webContents.send('window:focus', true));
  win.on('blur', () => win.webContents.send('window:focus', false));
  // Closing the window only hides it (like Messages / WhatsApp on the Mac): Relay keeps
  // running in the background so your bridges keep receiving messages. ⌘Q really quits.
  win.on('close', (e) => {
    if (process.platform === 'darwin' && !quitting) {
      e.preventDefault();
      // Hide the whole app (like ⌘H) rather than the window: on current macOS, hiding the
      // only window makes Electron quit, which would also stop the bridges.
      if (win.isFullScreen()) { win.once('leave-full-screen', () => app.hide()); win.setFullScreen(false); }
      else app.hide();
    }
  });
  win.on('closed', () => (win = null));
}

// ---------- IPC ----------

ipcMain.handle('session:get', () => {
  matrixSession = readSession();
  return matrixSession;
});

ipcMain.handle('session:set', (_e, data) => {
  matrixSession = data;
  writeSession(data);
});

ipcMain.handle('session:clear', () => {
  matrixSession = null;
  try { fs.unlinkSync(sessionFile()); } catch {}
  try { fs.unlinkSync(localSessionFile()); } catch {}
});

ipcMain.handle('app:focused', () => !!win && win.isFocused());

// Shown notifications, per chat. Electron removes a notification from Notification Center when
// its object is garbage-collected, so keep them until the chat is opened (then clear them, like
// WhatsApp does) or macOS closes them.
const shownNotifications = new Map(); // roomId -> Set<Notification>
let notificationsBlocked = false;
ipcMain.handle('notify:blocked', () => notificationsBlocked);
ipcMain.on('notify:openSettings', () => {
  shell.openExternal('x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=dev.relay.desktop');
});
ipcMain.on('notify:test', () => {
  const n = new Notification({ title: 'Relay', body: 'Notifications are on ✅' });
  n.on('failed', () => { notificationsBlocked = true; });
  n.on('show', () => { notificationsBlocked = false; });
  n.show();
});
const MAX_KEPT = 200;

function forgetNotification(roomId, n) {
  const set = shownNotifications.get(roomId);
  if (!set) return;
  set.delete(n);
  if (!set.size) shownNotifications.delete(roomId);
}

ipcMain.on('notify:clear', (_e, roomId) => {
  for (const n of shownNotifications.get(roomId) || []) n.close();
  shownNotifications.delete(roomId);
});

ipcMain.on('notify', (_e, { title, body, roomId, silent }) => {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: !!silent });
  if (!shownNotifications.has(roomId)) shownNotifications.set(roomId, new Set());
  shownNotifications.get(roomId).add(n);
  let kept = 0;
  for (const set of shownNotifications.values()) kept += set.size;
  if (kept > MAX_KEPT) {
    const [oldRoom, oldSet] = shownNotifications.entries().next().value;
    const oldest = oldSet.values().next().value;
    forgetNotification(oldRoom, oldest);
  }
  n.on('close', () => forgetNotification(roomId, n));
  n.on('failed', (_ev, err) => {
    console.error('Notification failed:', err);
    forgetNotification(roomId, n);
    // "Notifications are not allowed for this application" (UNErrorDomain 1): turned off in System Settings.
    if (/not allowed|UNErrorDomain.*\b1\b/i.test(String(err))) notificationsBlocked = true;
  });
  n.on('show', () => { notificationsBlocked = false; });
  n.on('click', () => {
    forgetNotification(roomId, n);
    if (!win) return;
    if (win.isMinimized()) win.restore();
    if (process.platform === 'darwin') app.show();
    win.show();
    win.focus();
    win.webContents.send('notification:click', roomId);
  });
  n.show();
});

ipcMain.on('badge', (_e, count) => {
  app.setBadgeCount(Math.max(0, count | 0));
});

// ---------- Local mode (own server + bridges on this Mac) ----------

const send = (channel, payload) => win?.webContents.send(channel, payload);

ipcMain.handle('local:status', () => local.status());
ipcMain.handle('local:install', () => local.install((step, message) => send('local:progress', { step, message })));
ipcMain.handle('local:start', () => local.start());
ipcMain.handle('local:credentials', () => local.credentials());
ipcMain.handle('local:favoriteStickers', () => local.favoriteStickers());
ipcMain.handle('local:createGroup', (_e, bridge, loginId, params) => local.createGroup(bridge, loginId, params));
ipcMain.handle('local:recording', (_e, roomId) => local.whatsappRecording(roomId).catch(() => []));
ipcMain.on('local:viewing', (_e, roomId, active) => { local.whatsappViewing(roomId, active).catch(() => {}); });
ipcMain.handle('local:loginStart', (_e, name, flowId) => local.loginStart(name, flowId));
ipcMain.handle('local:loginStep', (_e, name, processId, stepId, type, data) => local.loginStep(name, processId, stepId, type, data));
ipcMain.handle('local:loginCancel', (_e, name, processId) => local.loginCancel(name, processId));
ipcMain.handle('local:logout', (_e, name, loginId) => local.logout(name, loginId));
ipcMain.handle('local:setTelegramKeys', (_e, apiId, apiHash) => local.setTelegramKeys(apiId, apiHash));
// ---------- "Log in with the website" (bridgev2 cookie logins) ----------
// Slack, Instagram, Facebook, LinkedIn, X, Google Voice… log in through their website.
// Relay opens it in a window with its own throwaway session, you sign in normally, and
// it hands the bridge only the fields it asked for (cookies, local storage, headers).

function cookieLogin(params) {
  return new Promise((resolve, reject) => {
    const partition = `relay-login-${Date.now()}`; // in-memory, discarded afterwards
    const ses = session.fromPartition(partition);
    const values = {};
    const fields = params.fields || [];
    let done = false;

    const loginWin = new BrowserWindow({
      parent: win || undefined, width: 980, height: 760, show: !params.hidden, title: 'Log in',
      webPreferences: { partition, contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    if (params.user_agent) loginWin.webContents.setUserAgent(params.user_agent);

    // Request headers / bodies
    const reqSources = fields.flatMap((f) => f.sources.filter((s) => s.type === 'request_header' || s.type === 'request_body').map((s) => ({ f, s })));
    if (reqSources.length) {
      ses.webRequest.onBeforeSendHeaders((details, cb) => {
        for (const { f, s } of reqSources) {
          if (s.type !== 'request_header' || values[f.id]) continue;
          if (s.request_url_regex && !new RegExp(s.request_url_regex).test(details.url)) continue;
          const key = Object.keys(details.requestHeaders).find((h) => h.toLowerCase() === s.name.toLowerCase());
          if (key) values[f.id] = details.requestHeaders[key];
        }
        cb({ requestHeaders: details.requestHeaders });
      });
      ses.webRequest.onBeforeRequest((details, cb) => {
        for (const { f, s } of reqSources) {
          if (s.type !== 'request_body' || values[f.id] || !details.uploadData) continue;
          if (s.request_url_regex && !new RegExp(s.request_url_regex).test(details.url)) continue;
          try {
            const body = Buffer.concat(details.uploadData.map((d) => d.bytes || Buffer.alloc(0))).toString('utf8');
            let v;
            try { v = JSON.parse(body)[s.name]; } catch { v = new URLSearchParams(body).get(s.name); }
            if (v) values[f.id] = typeof v === 'string' ? v : JSON.stringify(v);
          } catch {}
        }
        cb({});
      });
    }

    const collect = async () => {
      for (const f of fields) {
        if (values[f.id]) continue;
        for (const s of f.sources) {
          try {
            if (s.type === 'cookie') {
              const cookies = await ses.cookies.get({ name: s.name });
              const c = cookies.find((c) => !s.cookie_domain || c.domain.replace(/^\./, '').endsWith(s.cookie_domain.replace(/^\./, '')));
              if (c?.value) { values[f.id] = decodeURIComponent(c.value); break; }
            } else if (s.type === 'local_storage') {
              const v = await loginWin.webContents.executeJavaScript(`localStorage.getItem(${JSON.stringify(s.name)})`, true);
              if (v) { values[f.id] = v; break; }
            }
          } catch {}
        }
      }
      if (params.extract_js) {
        try {
          const res = await Promise.race([
            loginWin.webContents.executeJavaScript(params.extract_js, true),
            new Promise((r) => setTimeout(() => r(null), 1500)),
          ]);
          if (res && typeof res === 'object') for (const [k, v] of Object.entries(res)) if (v && !values[k]) values[k] = String(v);
        } catch {}
      }
    };
    const haveAll = () => fields.every((f) => !f.required || values[f.id]);
    const urlOk = () => !params.wait_for_url_pattern || new RegExp(params.wait_for_url_pattern).test(loginWin.webContents.getURL());

    const finish = (err) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      if (!loginWin.isDestroyed()) loginWin.destroy();
      ses.clearStorageData().catch(() => {});
      if (err) reject(err); else resolve(values);
    };
    const timer = setInterval(async () => {
      if (loginWin.isDestroyed()) return;
      await collect();
      if (haveAll() && urlOk()) finish();
    }, 1000);
    loginWin.on('closed', async () => {
      if (done) return;
      if (haveAll()) finish();
      else finish(new Error('Login window closed before signing in.'));
    });
    loginWin.loadURL(params.url).catch(() => {});
  });
}

ipcMain.handle('local:cookieLogin', (_e, params) => cookieLogin(params));
ipcMain.handle('local:addNetwork', (_e, name) => local.addNetwork(name, (step, message) => send('local:progress', { step, message })));
ipcMain.handle('local:openDirectChat', (_e, userId, loginId) => local.openDirectChat(userId, loginId));
ipcMain.handle('local:bridgeCommand', (_e, name, command) => local.bridgeCommand(name, command));
ipcMain.handle('local:restartBridge', (_e, name) => local.restartBridge(name));
ipcMain.handle('local:openLogs', () => shell.openPath(local.logsDir()));
ipcMain.on('local:discordLogin', () => local.discordLogin((msg) => send('local:discord', msg)));
ipcMain.on('local:discordCancel', () => local.discordCancel());
local.onStatusChange((name, status) => send('local:status', { name, status }));

ipcMain.on('app:setTheme', (_e, theme) => {
  nativeTheme.themeSource = ['dark', 'light'].includes(theme) ? theme : 'system';
});
ipcMain.handle('app:version', () => app.getVersion());

// Optional sound pack in ~/Library/Application Support/Relay/sounds: interface/sound_<name>.(wav|m4a|mp3)
// replaces a built-in sound, and every file in notifications/ becomes a notification sound choice.
ipcMain.handle('app:customSounds', () => {
  const dir = path.join(app.getPath('userData'), 'sounds');
  const list = (sub) => { try { return fs.readdirSync(path.join(dir, sub)).filter((f) => /\.(wav|m4a|mp3|aiff?|ogg)$/i.test(f)); } catch { return []; } };
  const url = (sub, f) => require('node:url').pathToFileURL(path.join(dir, sub, f)).href;
  return {
    dir,
    interface: Object.fromEntries(list('interface').map((f) => [f.replace(/^sound_|\.[^.]+$/g, ''), url('interface', f)])),
    notifications: list('notifications').map((f) => [f.replace(/\.[^.]+$/, ''), url('notifications', f)]),
  };
});

// ---------- Chat wallpapers ----------
// Pictures you pick are copied into <app data>/wallpapers (named by content hash, so picking
// the same one twice doesn't duplicate it); the page shows them by file:// URL.
const wallpaperDir = () => path.join(app.getPath('userData'), 'wallpapers');
const WALLPAPER_EXT = /\.(png|jpe?g|webp|gif|avif|bmp)$/i;
const wallpaperEntry = (f) => ({ id: `img:${f}`, url: require('node:url').pathToFileURL(path.join(wallpaperDir(), f)).href });

ipcMain.handle('wallpaper:list', () => {
  try {
    return fs.readdirSync(wallpaperDir()).filter((f) => WALLPAPER_EXT.test(f))
      .map((f) => ({ f, t: fs.statSync(path.join(wallpaperDir(), f)).mtimeMs }))
      .sort((a, b) => a.t - b.t).map(({ f }) => wallpaperEntry(f));
  } catch { return []; }
});

ipcMain.handle('wallpaper:pick', async (e) => {
  const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: 'Choose a wallpaper',
    buttonLabel: 'Use as wallpaper',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp'] }],
  });
  const src = res.filePaths?.[0];
  if (res.canceled || !src) return null;
  if (!WALLPAPER_EXT.test(src)) throw new Error('Choose a picture (PNG, JPG, WebP, GIF or AVIF).');
  if (fs.statSync(src).size > 30 * 1024 * 1024) throw new Error('That picture is over 30 MB. Choose a smaller one.');
  const data = await fs.promises.readFile(src);
  const name = `${require('node:crypto').createHash('sha256').update(data).digest('hex').slice(0, 20)}${path.extname(src).toLowerCase()}`;
  await fs.promises.mkdir(wallpaperDir(), { recursive: true });
  const dest = path.join(wallpaperDir(), name);
  if (!fs.existsSync(dest)) await fs.promises.writeFile(dest, data);
  return wallpaperEntry(name);
});

ipcMain.handle('wallpaper:remove', async (_e, id) => {
  const name = path.basename(String(id || '').replace(/^img:/, ''));
  if (!WALLPAPER_EXT.test(name)) return false;
  await fs.promises.rm(path.join(wallpaperDir(), name), { force: true });
  return true;
});

// ---------- Voice messages ----------
// Chromium records WebM/Opus, but WhatsApp voice notes must be Ogg/Opus. ffmpeg
// re-wraps the same Opus audio into an Ogg container (no re-encoding, instant).

const FFMPEG = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].find((p) => fs.existsSync(p)) || null;

ipcMain.handle('media:canMakeOgg', () => !!FFMPEG);

ipcMain.handle('media:toOgg', async (_e, bytes) => {
  if (!FFMPEG) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-voice-'));
  const input = path.join(dir, 'in.webm');
  const output = path.join(dir, 'out.ogg');
  fs.writeFileSync(input, Buffer.from(bytes));
  const ff = (args) => new Promise((resolve, reject) =>
    execFile(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, ...args, output], (err) => (err ? reject(err) : resolve())));
  try {
    // Re-encode instead of just re-wrapping Chromium's Opus: the copied stream starts at a negative
    // timestamp with pre-skip 0, which WhatsApp on iPhone refuses ("This audio is no longer
    // available", no transcription). A real libopus encode gives a standard Ogg Opus voice note.
    try {
      await ff(['-vn', '-map_metadata', '-1', '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '32k', '-vbr', 'on',
        '-application', 'voip', '-frame_duration', '20', '-avoid_negative_ts', 'make_zero', '-f', 'ogg']);
    } catch { await ff(['-vn', '-c:a', 'copy', '-avoid_negative_ts', 'make_zero', '-f', 'ogg']); }
    return fs.readFileSync(output);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- Voice message transcription (local, whisper.cpp) ----------
// Uses `whisper-cli` (brew install whisper-cpp) and the best multilingual ggml model
// already on this Mac. Audio never leaves the computer.

const WHISPER = ['/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli'].find((p) => fs.existsSync(p)) || null;
let whisperModel;

function findWhisperModel() {
  if (whisperModel !== undefined) return whisperModel;
  const home = os.homedir();
  const dirs = [
    path.join(app.getPath('userData'), 'models'),
    '/opt/homebrew/share/whisper-cpp', '/opt/homebrew/share/whisper-cpp/models', '/usr/local/share/whisper-cpp',
    path.join(home, '.cache', 'whisper'), path.join(home, 'whisper.cpp', 'models'), path.join(home, 'models'),
  ];
  // Other apps' model folders, e.g. ~/.something/models or ~/Library/Application Support/X/models
  for (const base of [home, path.join(home, 'Library', 'Application Support')]) {
    try {
      for (const d of fs.readdirSync(base)) dirs.push(path.join(base, d, 'models'));
    } catch {}
  }
  const found = [];
  for (const d of dirs) {
    try {
      for (const f of fs.readdirSync(d)) if (/^ggml-.+\.bin$/.test(f)) found.push(path.join(d, f));
    } catch {}
  }
  // Prefer multilingual models (no ".en"), bigger/better first.
  const rank = (f) => {
    const n = path.basename(f);
    const en = /\.en[.-]/.test(n) ? 100 : 0;
    const order = ['large-v3-turbo', 'large-v3', 'large', 'medium', 'small', 'base', 'tiny'];
    const i = order.findIndex((o) => n.includes(o));
    return en + (i < 0 ? 50 : i);
  };
  found.sort((a, b) => rank(a) - rank(b));
  whisperModel = found[0] || null;
  return whisperModel;
}

ipcMain.handle('media:canTranscribe', () => {
  const model = WHISPER && FFMPEG ? findWhisperModel() : null;
  return { available: !!model, model: model ? path.basename(model) : null, whisper: !!WHISPER };
});

ipcMain.handle('media:transcribe', async (_e, bytes) => {
  const model = findWhisperModel();
  if (!WHISPER || !FFMPEG || !model) throw new Error('Transcription needs whisper.cpp (brew install whisper-cpp) and a ggml model.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-tx-'));
  const input = path.join(dir, 'in');
  const wav = path.join(dir, 'audio.wav');
  fs.writeFileSync(input, Buffer.from(bytes));
  const exec = (cmd, args) => new Promise((resolve, reject) =>
    execFile(cmd, args, { maxBuffer: 1 << 24, timeout: 5 * 60 * 1000 }, (err, stdout) => (err ? reject(err) : resolve(stdout))));
  try {
    await exec(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
    const out = await exec(WHISPER, ['-m', model, '-l', 'auto', '-nt', '-np', '-t', String(Math.max(2, Math.min(8, os.cpus().length - 2))), '-f', wav]);
    return out.split('\n').map((l) => l.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

ipcMain.handle('media:askMic', async () => {
  if (process.platform !== 'darwin') return true;
  if (systemPreferences.getMediaAccessStatus('microphone') === 'granted') return true;
  return systemPreferences.askForMediaAccess('microphone');
});

ipcMain.handle('update:state', () => updater.getState());
ipcMain.handle('update:check', () => updater.check({ manual: true }));
ipcMain.handle('update:install', () => updater.install());

ipcMain.handle('app:getOpenAtLogin', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('app:setOpenAtLogin', (_e, on) => app.setLoginItemSettings({ openAtLogin: !!on }));

// Keep bridges running while the window is closed; stop them cleanly on quit.
let quitting = false;
app.on('before-quit', () => { quitting = true; });
let stopping = false;
app.on('before-quit', (e) => {
  if (stopping || !primary || !local.isInstalled()) return;
  e.preventDefault();
  stopping = true;
  local.stop().finally(() => app.quit());
});

// Killed from a terminal (Ctrl+C / kill): shut the local server down cleanly too.
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.quit());

// ---------- App lifecycle ----------

app.setName('Relay');

// One Relay at a time: a second copy would fight over the local server's ports.
const primary = app.requestSingleInstanceLock();
if (!primary) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}

app.whenReady().then(() => {
  if (!primary) return;
  installMediaAuth();
  installPermissions();
  if (!app.isPackaged && process.platform === 'darwin') {
    try { app.dock.setIcon(path.join(__dirname, '..', 'build', 'icon.png')); } catch {}
  }
  if (local.isInstalled()) local.start().catch((err) => console.error('Local server failed to start:', err));
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]));
  }
  createWindow();
  reminders.init({
    mainWindow: () => win,
    getSession: () => matrixSession || readSession(),
    onOpenMessage: (roomId) => {
      if (!win) return;
      if (win.isMinimized()) win.restore();
      if (process.platform === 'darwin') app.show();
      win.show();
      win.focus();
      win.webContents.send('notification:click', roomId);
    },
  });
  updater.init((s) => send('update:state', s));
  // Scheduled messages go out from here, window open or not, with the session the window signed in with.
  scheduled.init({
    mainWindow: () => win,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    getSession: () => matrixSession || (matrixSession = readSession()),
    onOpenRoom: (roomId) => {
      if (!win) return;
      if (win.isMinimized()) win.restore();
      if (process.platform === 'darwin') app.show();
      win.show();
      win.focus();
      win.webContents.send('notification:click', roomId);
    },
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else { if (process.platform === 'darwin') app.show(); win?.show(); }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
