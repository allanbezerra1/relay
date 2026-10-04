// App lock: "Lock Relay with a password". Only a scrypt hash + salt of the password is kept
// (userData/lock.json). The main process owns the locked state, so ⌘L / Ctrl+L, the idle timer,
// the screen lock and notifications (no previews while locked) all agree on it. Touch ID on macOS
// and fprintd on Linux can unlock it too.

const { app, ipcMain, powerMonitor, systemPreferences } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');

const file = () => path.join(app.getPath('userData'), 'lock.json');
const which = (bin) => {
  for (const dir of [...(process.env.PATH || '').split(path.delimiter), '/usr/bin', '/usr/local/bin']) {
    const p = path.join(dir, bin);
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {}
  }
  return null;
};
const MINUTES = [0, 1, 5, 15, 60]; // 0 = never by inactivity
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

let cfg = null; // { hash, salt, minutes, hidePreviews }
let locked = false;
let lastActivity = Date.now();
let failures = 0;
let blockedUntil = 0;
let mainWindow = () => null;
let onChange = () => {};
let fingerprint = { available: false };
let fpChild = null;

function load() {
  try { cfg = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { cfg = null; }
  if (cfg && !cfg.hash) cfg = null;
  return cfg;
}

function save() {
  if (!cfg) { try { fs.unlinkSync(file()); } catch {} return; }
  fs.writeFileSync(file(), JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

const hashOf = (password, salt) => new Promise((resolve, reject) => {
  crypto.scrypt(String(password).normalize('NFC'), Buffer.from(salt, 'base64'), 32, SCRYPT, (err, key) => (err ? reject(err) : resolve(key)));
});

async function check(password) {
  if (!cfg) return true;
  const key = await hashOf(password, cfg.salt);
  const want = Buffer.from(cfg.hash, 'base64');
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}

function state() {
  return {
    enabled: !!cfg,
    locked: !!cfg && locked,
    minutes: cfg?.minutes ?? 5,
    hidePreviews: cfg ? cfg.hidePreviews !== false : true,
    fingerprint: fingerprint.available,
    blockedFor: Math.max(0, blockedUntil - Date.now()),
  };
}

function broadcast() {
  const w = mainWindow();
  if (w && !w.isDestroyed()) w.webContents.send('lock:state', state());
  onChange();
}

function lock() {
  if (!cfg || locked) return;
  locked = true;
  broadcast();
}

function unlockNow() {
  locked = false;
  failures = 0;
  blockedUntil = 0;
  lastActivity = Date.now();
  cancelFingerprint();
  broadcast();
}

// ---------- Touch ID (macOS) / fingerprint (Linux, fprintd) ----------

function detectFingerprint() {
  if (process.platform === 'darwin') {
    try { fingerprint = { available: !!systemPreferences.canPromptTouchID?.(), touchId: true }; } catch {}
    if (fingerprint.available) broadcast();
    return;
  }
  if (process.platform !== 'linux') return;
  const list = which('fprintd-list');
  const verify = which('fprintd-verify');
  if (!list || !verify) return;
  execFile(list, [os.userInfo().username], { timeout: 4000 }, (_err, stdout) => {
    // " - #0: right-index-finger" for each enrolled finger; "No devices available" otherwise.
    fingerprint = { available: /#\d+:/.test(String(stdout)), bin: verify };
    if (fingerprint.available) broadcast();
  });
}

function cancelFingerprint() {
  if (fpChild && fpChild.exitCode === null) fpChild.kill('SIGTERM');
  fpChild = null;
}

function verifyFingerprint() {
  if (!fingerprint.available || !locked) return Promise.resolve({ ok: false });
  if (fingerprint.touchId) {
    return systemPreferences.promptTouchID('unlock Relay').then(
      () => { unlockNow(); return { ok: true }; },
      () => ({ ok: false, error: 'Touch ID was cancelled or didn’t match.' }),
    );
  }
  cancelFingerprint();
  return new Promise((resolve) => {
    const child = spawn(fingerprint.bin, [], { stdio: ['ignore', 'pipe', 'pipe'] });
    fpChild = child;
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => child.kill('SIGTERM'), 20000);
    child.on('error', () => { clearTimeout(timer); resolve({ ok: false, error: 'Couldn’t use the fingerprint reader.' }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (fpChild === child) fpChild = null;
      const ok = code === 0 && /verify-match/.test(out);
      if (ok) unlockNow();
      resolve({ ok, error: ok ? null : /no-match/.test(out) ? 'Fingerprint not recognized.' : 'Cancelled or timed out.' });
    });
  });
}

// ---------- Notifications ----------

/** While locked (and the option is on), notifications only say "New message". */
function redactNotification(n) {
  if (!cfg || !locked || cfg.hidePreviews === false) return n;
  return { ...n, title: 'Relay', body: 'New message', icon: null };
}

// ---------- IPC ----------

function init({ mainWindow: getWin, onChange: changed }) {
  mainWindow = getWin;
  onChange = changed || (() => {});
  load();
  locked = !!cfg; // lock on start
  detectFingerprint();

  // Inactivity: no clicks or keys in Relay for N minutes.
  setInterval(() => {
    if (!cfg || locked || !cfg.minutes) return;
    if (Date.now() - lastActivity >= cfg.minutes * 60000) lock();
  }, 10000);
  try { powerMonitor.on('lock-screen', lock); } catch {}

  ipcMain.handle('lock:state', () => state());
  ipcMain.on('lock:activity', () => { lastActivity = Date.now(); });
  ipcMain.handle('lock:lock', () => { lock(); return state(); });
  ipcMain.handle('lock:unlock', async (_e, password) => {
    if (!cfg) { unlockNow(); return { ok: true }; }
    if (Date.now() < blockedUntil) return { ok: false, error: 'Too many attempts. Wait a few seconds.', blockedFor: blockedUntil - Date.now() };
    if (await check(password)) { unlockNow(); return { ok: true }; }
    failures++;
    if (failures >= 5) blockedUntil = Date.now() + Math.min(5 * 60000, 15000 * 2 ** (failures - 5));
    return { ok: false, error: 'Wrong password.', blockedFor: Math.max(0, blockedUntil - Date.now()) };
  });
  ipcMain.handle('lock:fingerprint', () => verifyFingerprint());
  ipcMain.handle('lock:cancelFingerprint', () => cancelFingerprint());
  ipcMain.handle('lock:enable', async (_e, password, minutes) => {
    if (!password || String(password).length < 4) throw new Error('Use a password with at least 4 characters.');
    const salt = crypto.randomBytes(16).toString('base64');
    const key = await hashOf(password, salt);
    cfg = { v: 1, salt, hash: key.toString('base64'), minutes: MINUTES.includes(minutes) ? minutes : 5, hidePreviews: cfg?.hidePreviews ?? true };
    save();
    locked = false;
    lastActivity = Date.now();
    broadcast();
    return state();
  });
  ipcMain.handle('lock:change', async (_e, oldPassword, password) => {
    if (!(await check(oldPassword))) throw new Error('The current password is wrong.');
    if (!password || String(password).length < 4) throw new Error('Use a password with at least 4 characters.');
    const salt = crypto.randomBytes(16).toString('base64');
    cfg = { ...cfg, salt, hash: (await hashOf(password, salt)).toString('base64') };
    save();
    broadcast();
    return state();
  });
  ipcMain.handle('lock:disable', async (_e, password) => {
    if (!(await check(password))) throw new Error('Wrong password.');
    cfg = null;
    locked = false;
    save();
    broadcast();
    return state();
  });
  ipcMain.handle('lock:setOptions', (_e, opts = {}) => {
    if (!cfg) return state();
    if (MINUTES.includes(opts.minutes)) cfg.minutes = opts.minutes;
    if (typeof opts.hidePreviews === 'boolean') cfg.hidePreviews = opts.hidePreviews;
    save();
    lastActivity = Date.now();
    broadcast();
    return state();
  });
}

module.exports = { init, lock, isLocked: () => !!cfg && locked, redactNotification };
