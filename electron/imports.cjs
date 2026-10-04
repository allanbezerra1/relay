// Importing old WhatsApp history (Settings → Import history).
//
// The WhatsApp bridge only brings recent messages. Years of history come from either:
//  • an iPhone backup on this computer, which holds WhatsApp's own database with every chat and
//    its photos and audio. On macOS that's the backup Finder makes (~/Library/Application Support/
//    MobileSync/Backup, readable only with Full Disk Access); on Linux Relay makes one itself over
//    USB with libimobiledevice's idevicebackup2; or
//  • the .zip from WhatsApp's "Export chat", one chat at a time.
// resources/wa_import.py reads them; here we run it and keep the result under userData/imports/
// (never sent anywhere, never written back into WhatsApp or into the backup), then serve it to
// the chat view.

const { app, ipcMain, dialog, shell, BrowserWindow } = require('electron');
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// 'finder': pick one of the backups Finder made (macOS). 'usb': make one with idevicebackup2
// (Linux). 'none': only the .zip. RELAY_IMPORT_MODE / RELAY_MOBILESYNC_DIR are for development.
const MODE = process.env.RELAY_IMPORT_MODE
  || (process.platform === 'darwin' ? 'finder' : process.platform === 'linux' ? 'usb' : 'none');
const FULL_DISK_ACCESS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles';
const PASSWORD_ENV = 'RELAY_BACKUP_PASSWORD';

const root = () => path.join(app.getPath('userData'), 'imports');
const indexFile = () => path.join(root(), 'index.json');
const chatsDir = () => path.join(root(), 'chats');
const usbBackupDir = () => path.join(root(), 'iphone-backup');
const mobileSyncDir = () => process.env.RELAY_MOBILESYNC_DIR || path.join(os.homedir(), 'Library', 'Application Support', 'MobileSync', 'Backup');
const script = () => (app.isPackaged ? path.join(process.resourcesPath, 'wa_import.py') : path.join(__dirname, '..', 'resources', 'wa_import.py'));
// The Python that local mode installs for Synapse (see P.python in local.cjs), and the WhatsApp
// bridge's database (P.bridge('whatsapp')/whatsapp.db).
const localPython = () => path.join(app.getPath('userData'), 'local', 'synapse', 'venv', 'bin', 'python');
const ownPython = () => path.join(root(), 'venv', 'bin', 'python');
const bridgeDb = () => path.join(app.getPath('userData'), 'local', 'bridges', 'whatsapp', 'whatsapp.db');

let index = null; // { chats: { [key]: { key, jid, name, group, count, first, last, source, roomId, at } } }
const load = () => { if (!index) { try { index = JSON.parse(fs.readFileSync(indexFile(), 'utf8')); } catch { index = { chats: {} }; } } return index; };
const save = () => { fs.mkdirSync(root(), { recursive: true }); fs.writeFileSync(indexFile(), JSON.stringify(index, null, 1), { mode: 0o600 }); };

function send(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
}
const progress = (p) => send('import:progress', p);

const which = (cmd) => new Promise((resolve) => execFile('which', [cmd], (err, out) => resolve(err ? null : out.trim())));
const run = (cmd, args, opts = {}) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 30000, maxBuffer: 10 << 20, ...opts }, (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || ''), code: err?.code }));
});

/** Local mode's Python if it's set up, else a system Python 3. */
function basePython() {
  const candidates = [localPython()];
  if (process.platform === 'darwin') candidates.push('/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/Library/Frameworks/Python.framework/Versions/Current/bin/python3');
  candidates.push('/usr/bin/python3');
  return candidates.find((p) => fs.existsSync(p)) || 'python3';
}

const NO_PYTHON = 'Relay needs Python 3 to read the history. Set up local mode, or install Python (for example “brew install python”), and try again.';

/** Runs wa_import.py; stderr lines are progress. Resolves its JSON answer. */
function python(args, { env = {}, py } = {}) {
  return new Promise((resolve) => {
    const child = spawn(py || basePython(), [script(), ...args], { env: { ...process.env, ...env } });
    let out = '', errBuf = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => {
      errBuf += d;
      let nl;
      while ((nl = errBuf.indexOf('\n')) >= 0) {
        const line = errBuf.slice(0, nl); errBuf = errBuf.slice(nl + 1);
        try { progress(JSON.parse(line)); } catch {}
      }
    });
    child.on('close', () => {
      try { resolve(JSON.parse(out)); } catch { resolve({ ok: false, error: 'error', message: (errBuf || out || 'The importer failed.').slice(-400) }); }
    });
    child.on('error', (err) => resolve({ ok: false, error: err.code === 'ENOENT' ? 'no_python' : 'error', message: err.code === 'ENOENT' ? NO_PYTHON : String(err.message || err) }));
  });
}

// ---------- Where the backup comes from ----------

async function info() {
  const base = { mode: MODE };
  if (MODE !== 'usb') return base;
  const ok = !!(await which('idevicebackup2')) && !!(await which('idevice_id'));
  let backup = false;
  try { backup = fs.readdirSync(usbBackupDir()).length > 0; } catch {}
  return { ...base, idevice: ok, install: 'sudo apt install libimobiledevice-utils usbmuxd', backup };
}

/**
 * The backups Finder made on this Mac: device name, date and whether each one is encrypted.
 * Reading the folder needs Full Disk Access; without it macOS answers EPERM.
 */
async function finderBackups(dir = mobileSyncDir()) {
  try {
    await fsp.readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: true, backups: [] };
    if (err.code === 'EPERM' || err.code === 'EACCES') return { ok: false, error: 'no_access' };
    return { ok: false, error: 'error', message: String(err.message || err) };
  }
  return python(['backups', '--root', dir]);
}

/** The backup folder to read: one of Finder's by its id, or the one we made over USB. */
function backupPath(id) {
  if (MODE !== 'finder') return usbBackupDir();
  if (!/^[A-Za-z0-9-]+$/.test(String(id || ''))) throw new Error('Invalid backup.');
  return path.join(mobileSyncDir(), id);
}

// ---------- Linux: making the backup over USB ----------

async function devices() {
  const list = await run('idevice_id', ['-l']);
  const udids = list.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const u of udids) {
    // eslint-disable-next-line no-await-in-loop
    const res = await run('ideviceinfo', ['-u', u, '-k', 'DeviceName']);
    if (!res.ok || /pair|trust|lockdown/i.test(res.stderr)) { out.push({ udid: u, name: null, paired: false, error: res.stderr.trim().slice(0, 200) }); continue; }
    // eslint-disable-next-line no-await-in-loop
    const enc = await run('ideviceinfo', ['-u', u, '-q', 'com.apple.mobile.backup', '-k', 'WillEncrypt']);
    out.push({ udid: u, name: res.stdout.trim(), paired: true, encrypted: /true/i.test(enc.stdout) });
  }
  return out;
}

const pair = (udid) => run('idevicepair', ['-u', udid, 'pair']).then((r) => ({ ok: r.ok, message: (r.stdout + r.stderr).trim() }));

let backupChild = null;
function usbBackup(udid) {
  return new Promise((resolve) => {
    fs.mkdirSync(usbBackupDir(), { recursive: true });
    // Incremental after the first time: only what changed is copied again.
    backupChild = spawn('idevicebackup2', ['-u', udid, 'backup', usbBackupDir()]);
    let tail = '';
    const onData = (d) => {
      const s = String(d);
      tail = (tail + s).slice(-2000);
      const pct = [...s.matchAll(/(\d{1,3})% Finished/g)].pop();
      if (pct) progress({ phase: 'backup', pct: +pct[1] });
      if (/Enter PIN|passcode/i.test(s)) progress({ phase: 'backup', hint: 'Unlock the iPhone and enter its passcode if it asks.' });
    };
    backupChild.stdout.on('data', onData);
    backupChild.stderr.on('data', onData);
    backupChild.on('close', (code) => {
      backupChild = null;
      const ok = code === 0 || /Backup Successful/i.test(tail);
      resolve(ok ? { ok: true } : { ok: false, message: tail.split('\n').filter((l) => /error|fail|could not/i.test(l)).slice(-2).join(' ') || `idevicebackup2 exited with code ${code}` });
    });
    backupChild.on('error', (err) => { backupChild = null; resolve({ ok: false, message: String(err.message) }); });
  });
}

// ---------- Reading the backup ----------

/**
 * Encrypted backups need iphone_backup_decrypt, installed on first use into local mode's Python
 * (or, without local mode, into a small venv of our own under userData/imports).
 */
async function decryptPython() {
  let py = fs.existsSync(localPython()) ? localPython() : ownPython();
  if (!fs.existsSync(py)) {
    progress({ phase: 'preparing', hint: 'Setting up the reader for encrypted backups…' });
    const made = await run(basePython(), ['-m', 'venv', path.dirname(path.dirname(py))], { timeout: 120000 });
    if (!made.ok) return { ok: false, message: made.code === 'ENOENT' ? NO_PYTHON : made.stderr.slice(-300) || NO_PYTHON };
  }
  const has = await run(py, ['-c', 'import iphone_backup_decrypt']);
  if (has.ok) return { ok: true, py };
  progress({ phase: 'preparing', hint: 'Installing the reader for encrypted backups…' });
  const inst = await run(py, ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', 'iphone_backup_decrypt'], { timeout: 300000 });
  return inst.ok ? { ok: true, py } : { ok: false, message: `Couldn’t install the reader for encrypted backups. ${inst.stderr.slice(-300)}` };
}

async function withPassword(password, fn) {
  if (!password) return fn({});
  const dp = await decryptPython();
  if (!dp.ok) return { ok: false, error: 'needs_decrypt_lib', message: dp.message };
  return fn({ py: dp.py, env: { [PASSWORD_ENV]: password } });
}

async function scan({ backupId, password } = {}) {
  let dir;
  try { dir = backupPath(backupId); } catch (err) { return { ok: false, error: 'error', message: err.message }; }
  return withPassword(password, ({ py, env }) =>
    python(['scan', '--backup', dir, ...(env ? ['--password-env', PASSWORD_ENV] : [])], { py, env }));
}

// ---------- Keeping the result ----------

/** Moves wa_import.py's output (OUT/<key>.json + OUT/media/<key>) into the library. */
async function adopt(outDir, chats, roomIds = {}) {
  load();
  fs.mkdirSync(chatsDir(), { recursive: true });
  const added = [];
  for (const c of chats) {
    const json = path.join(outDir, `${c.key}.json`);
    if (!fs.existsSync(json)) continue;
    const dest = path.join(chatsDir(), `${c.key}.json`);
    // eslint-disable-next-line no-await-in-loop
    await fsp.rename(json, dest).catch(() => fsp.copyFile(json, dest));
    cache.delete(c.key);
    const media = path.join(outDir, 'media', c.key);
    if (fs.existsSync(media)) {
      const mediaDest = path.join(root(), 'media', c.key);
      // eslint-disable-next-line no-await-in-loop
      await fsp.rm(mediaDest, { recursive: true, force: true });
      // eslint-disable-next-line no-await-in-loop
      await fsp.mkdir(path.dirname(mediaDest), { recursive: true });
      // eslint-disable-next-line no-await-in-loop
      await fsp.rename(media, mediaDest).catch(() => fsp.cp(media, mediaDest, { recursive: true }));
    }
    const prev = index.chats[c.key];
    index.chats[c.key] = { ...c, roomId: roomIds[c.key] ?? prev?.roomId ?? null, at: Date.now() };
    added.push(index.chats[c.key]);
  }
  save();
  await fsp.rm(outDir, { recursive: true, force: true }).catch(() => {});
  send('import:changed', list());
  return added;
}

async function extract({ backupId, chats, password, media = true, roomIds = {} }) {
  let dir;
  try { dir = backupPath(backupId); } catch (err) { return { ok: false, error: 'error', message: err.message }; }
  const out = path.join(root(), `tmp-${Date.now()}`);
  const res = await withPassword(password, ({ py, env }) => python(['extract', '--backup', dir, '--out', out, '--chats', chats.map(Number).join(','),
    ...(media ? ['--media'] : []), ...(env ? ['--password-env', PASSWORD_ENV] : [])], { py, env }));
  if (!res.ok) { await fsp.rm(out, { recursive: true, force: true }).catch(() => {}); return res; }
  return { ok: true, chats: await adopt(out, res.chats, roomIds) };
}

/** Asks for an exported .zip and peeks inside: chat name, how many messages, who wrote them. */
async function zipPick(win) {
  const r = await dialog.showOpenDialog(win, { title: 'Choose a WhatsApp chat export (.zip)', filters: [{ name: 'WhatsApp chat export', extensions: ['zip'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return { ok: false, error: 'cancelled' };
  return zipLook(r.filePaths[0]);
}

async function zipLook(file) {
  const look = await python(['zip', '--file', file]);
  return look.ok ? { ...look, file } : look;
}

async function zipImport({ file, me, roomId }) {
  const out = path.join(root(), `tmp-${Date.now()}`);
  const key = `zip-${(roomId || path.basename(file, path.extname(file))).replace(/[^A-Za-z0-9_.-]/g, '_')}`.slice(0, 90);
  const res = await python(['zip', '--file', file, '--out', out, '--key', key, ...(me ? ['--me', me] : [])]);
  if (!res.ok) { await fsp.rm(out, { recursive: true, force: true }).catch(() => {}); return res; }
  return { ok: true, chats: await adopt(out, res.chats, { [key]: roomId || null }) };
}

// ---------- Serving it ----------

const list = () => Object.values(load().chats).sort((a, b) => (b.last || 0) - (a.last || 0));

const cache = new Map(); // key → messages (the last few chats opened)
async function messages(key) {
  if (cache.has(key)) return cache.get(key);
  if (!load().chats[key]) return [];
  const data = JSON.parse(await fsp.readFile(path.join(chatsDir(), `${key}.json`), 'utf8'));
  cache.set(key, data.messages);
  if (cache.size > 6) cache.delete(cache.keys().next().value);
  return data.messages;
}

/** A page of messages older than `before` (oldest first). */
async function page({ key, before, limit = 150 }) {
  const all = await messages(key);
  let end = all.length;
  if (before != null && Number.isFinite(before)) {
    let lo = 0, hi = all.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (all[mid].ts < before) lo = mid + 1; else hi = mid; }
    end = lo;
  }
  const start = Math.max(0, end - limit);
  return { messages: all.slice(start, end), more: start > 0, total: all.length };
}

async function media(rel) {
  const full = path.resolve(root(), String(rel || ''));
  if (!full.startsWith(path.resolve(root(), 'media') + path.sep)) throw new Error('Invalid path.');
  return fsp.readFile(full);
}

function link(key, roomId) {
  load();
  if (!index.chats[key]) return null;
  index.chats[key].roomId = roomId || null;
  save();
  send('import:changed', list());
  return index.chats[key];
}

async function remove(key) {
  load();
  if (!index.chats[key]) return false;
  delete index.chats[key];
  save();
  cache.delete(key);
  await fsp.rm(path.join(chatsDir(), `${key}.json`), { force: true }).catch(() => {});
  await fsp.rm(path.join(root(), 'media', key), { recursive: true, force: true }).catch(() => {});
  send('import:changed', list());
  return true;
}

/** Phone number → LID, from the WhatsApp bridge's database (it names private chats by LID). */
function lidmap() {
  const file = bridgeDb();
  if (!fs.existsSync(file)) return {};
  const { DatabaseSync } = require('node:sqlite');
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const out = {};
    for (const { lid, pn } of db.prepare('SELECT lid, pn FROM whatsmeow_lid_map').all()) out[String(pn).split('@')[0]] = String(lid).split('@')[0];
    return out;
  } catch {
    return {};
  } finally {
    try { db?.close(); } catch {}
  }
}

function init() {
  ipcMain.handle('import:info', () => info());
  ipcMain.handle('import:finderBackups', () => finderBackups());
  ipcMain.handle('import:openFullDiskAccess', () => (process.platform === 'darwin' ? shell.openExternal(FULL_DISK_ACCESS_URL).then(() => true) : false));
  ipcMain.handle('import:devices', () => devices());
  ipcMain.handle('import:pair', (_e, udid) => pair(String(udid)));
  ipcMain.handle('import:backup', (_e, udid) => usbBackup(String(udid)));
  ipcMain.handle('import:cancelBackup', () => { backupChild?.kill('SIGINT'); return true; });
  ipcMain.handle('import:deleteBackup', async () => { await fsp.rm(usbBackupDir(), { recursive: true, force: true }); return true; });
  ipcMain.handle('import:scan', (_e, opts) => scan(opts));
  ipcMain.handle('import:extract', (_e, opts) => extract(opts));
  ipcMain.handle('import:zipPick', (e) => zipPick(BrowserWindow.fromWebContents(e.sender)));
  ipcMain.handle('import:zipImport', (_e, opts) => zipImport(opts));
  ipcMain.handle('import:list', () => list());
  ipcMain.handle('import:page', (_e, opts) => page(opts));
  ipcMain.handle('import:media', (_e, rel) => media(rel));
  ipcMain.handle('import:link', (_e, key, roomId) => link(key, roomId));
  ipcMain.handle('import:remove', (_e, key) => remove(key));
  ipcMain.handle('import:lidmap', () => lidmap());
}

module.exports = { init, finderBackups, zipLook, zipImport, scan, extract, list, page };
