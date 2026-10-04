// Reliability: the health panel (Settings → Health) and encrypted backups (Settings → Backup).
// Everything here only reads the local server's state through local.cjs, except "Fix"
// (restarts what's down) and backup / restore (which pause the local server for a moment).

const { app, ipcMain, dialog, shell, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const local = require('./local.cjs');
const core = require('./backup-core.cjs');

let mainWindow = () => null;
const send = (channel, payload) => { const w = mainWindow(); if (w && !w.isDestroyed()) w.webContents.send(channel, payload); };
const userData = () => app.getPath('userData');

// ---------- Logs: last activity ----------

const activityCache = new Map(); // file -> { mtimeMs, ts }

/** Timestamp of the last line a process wrote to its log (JSON "time", Synapse's own format, or our markers). */
async function lastActivity(name) {
  const file = path.join(local.logsDir(), `${name}.log`);
  let st;
  try { st = await fsp.stat(file); } catch { return null; }
  const hit = activityCache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit.ts;
  let ts = null;
  try {
    const fh = await fsp.open(file, 'r');
    try {
      const len = Math.min(st.size, 64 * 1024);
      const { buffer } = await fh.read(Buffer.alloc(len), 0, len, st.size - len);
      const lines = buffer.toString('utf8').split('\n').reverse();
      for (const line of lines) {
        const l = line.trim();
        if (!l) continue;
        if (l.startsWith('{')) {
          try { const j = JSON.parse(l); const t = Date.parse(j.time || j.timestamp || ''); if (t) { ts = t; break; } } catch {}
          continue;
        }
        const m = /^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d:\d\d)(?:[,.](\d{1,3}))?/.exec(l);
        if (m) { const t = new Date(`${m[1]}T${m[2]}.${(m[3] || '0').padEnd(3, '0')}`).getTime(); if (t) { ts = t; break; } }
        const mk = /^===== (\S+) /.exec(l);
        if (mk) { const t = Date.parse(mk[1]); if (t) { ts = t; break; } }
      }
    } finally { await fh.close(); }
  } catch {}
  ts ||= st.mtimeMs;
  activityCache.set(file, { mtimeMs: st.mtimeMs, ts });
  return ts;
}

// ---------- Disk usage ----------

let disk = null;
let diskJob = null;

async function computeDisk() {
  const P = local.P;
  const size = async (p) => { try { const st = await fsp.stat(p); return st.isDirectory() ? (await core.dirSize(p)).bytes : st.size; } catch { return 0; } };
  const [total, media, logs, bridges, venv, bin, db, wal, shm, hslogs] = await Promise.all([
    size(userData()), size(path.join(P.synapse, 'media_store')), size(P.logs), size(path.join(P.root, 'bridges')),
    size(P.venv), size(P.bin), size(P.synapseDb), size(`${P.synapseDb}-wal`), size(`${P.synapseDb}-shm`),
    (async () => { let n = 0; try { for (const f of await fsp.readdir(P.synapse)) if (/^homeserver\.log/.test(f)) n += await size(path.join(P.synapse, f)); } catch {} return n; })(),
  ]);
  let free = null;
  try { const s = await fsp.statfs(userData()); free = s.bavail * s.bsize; } catch {}
  const database = db + wal + shm;
  const programs = venv + bin;
  const logsAll = logs + hslogs;
  return {
    total, database, media, logs: logsAll, bridges, programs,
    other: Math.max(0, total - database - media - logsAll - bridges - programs), free, computedAt: Date.now(),
  };
}

function diskUsage({ force = false } = {}) {
  if ((force || !disk || Date.now() - disk.computedAt > 60000) && !diskJob) {
    diskJob = computeDisk().then((d) => { disk = d; }).catch(() => {}).finally(() => { diskJob = null; });
  }
  return force && diskJob ? diskJob.then(() => disk) : Promise.resolve(disk);
}

async function cleanLogs() {
  const P = local.P;
  let freed = 0;
  const rm = async (f) => { try { const st = await fsp.stat(f); await fsp.rm(f, { force: true }); freed += st.size; } catch {} };
  try { for (const f of await fsp.readdir(P.logs)) if (/\.old$|\.log\.\d+$/.test(f)) await rm(path.join(P.logs, f)); } catch {}
  try { for (const f of await fsp.readdir(P.synapse)) if (/^homeserver\.log\.\S+$/.test(f)) await rm(path.join(P.synapse, f)); } catch {}
  // Current logs: keep only the last 256 KB of anything over 1 MB. The processes append, so
  // truncating in place is safe.
  try {
    for (const f of await fsp.readdir(P.logs)) {
      if (!f.endsWith('.log')) continue;
      const file = path.join(P.logs, f);
      const st = await fsp.stat(file);
      if (st.size <= 1 << 20) continue;
      const keep = 256 * 1024;
      const fh = await fsp.open(file, 'r+');
      try {
        const { buffer } = await fh.read(Buffer.alloc(keep), 0, keep, st.size - keep);
        const nl = buffer.indexOf(10);
        const tail = buffer.subarray(nl >= 0 ? nl + 1 : 0);
        const mark = Buffer.from(`===== ${new Date().toISOString()} log trimmed by Relay =====\n`);
        await fh.truncate(0);
        await fh.write(mark, 0, mark.length, 0);
        await fh.write(tail, 0, tail.length, mark.length);
        freed += st.size - mark.length - tail.length;
      } finally { await fh.close(); }
    }
  } catch {}
  await diskUsage({ force: true });
  return { freed };
}

// ---------- Health ----------

const STUCK_MS = 2 * 60 * 1000;

const osName = () => (process.platform === 'darwin'
  ? `macOS ${process.getSystemVersion?.() || os.release()}`
  : `${os.type()} ${os.release()}`);

const procHealth = (status, info) => {
  if (status === 'running') return 'ok';
  if (status === 'crashed') return 'crashed';
  if (status === 'starting') return info?.startedAt && Date.now() - info.startedAt > STUCK_MS ? 'stuck' : 'starting';
  if (status === 'needs-setup') return 'setup';
  return 'stopped';
};

async function health({ light = false } = {}) {
  const s = await local.status().catch(() => null);
  const procs = local.procInfo();
  const installed = !!s?.installed;
  const out = {
    installed,
    now: Date.now(),
    versions: {
      app: app.getVersion(), electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome,
      os: osName(), arch: process.arch,
    },
    // The rail's background check reuses the last disk scan instead of walking the media folder again.
    disk: light ? disk : await diskUsage(),
    synapse: null,
    bridges: [],
  };
  if (!installed) {
    out.summary = { level: 'ok', title: 'Local mode is off', issues: [] };
    return out;
  }
  out.synapse = { ...procs.synapse, status: s.synapse, health: procHealth(s.synapse, procs.synapse), lastActivity: await lastActivity('synapse') };
  for (const [id, b] of Object.entries(s.bridges)) {
    if (!b.installed) continue;
    out.bridges.push({
      ...procs[id], id, name: b.name, status: b.status, health: procHealth(b.status, procs[id]),
      lastActivity: await lastActivity(id), error: b.error || null,
      logins: (b.logins || []).map((l) => ({
        id: l.id, name: l.profileName || l.name, detail: l.detail, state: l.state, error: l.error, sync: l.sync || null, business: !!l.business,
      })),
    });
  }
  out.bridges.sort((a, b) => (a.id === 'whatsapp' ? -1 : b.id === 'whatsapp' ? 1 : a.name.localeCompare(b.name)));
  out.summary = summarize(out);
  return out;
}

function summarize(h) {
  const issues = [];
  const add = (level, short, text, fixable = false) => issues.push({ level, short, text, fixable });
  if (h.synapse.health !== 'ok') {
    add('bad', 'local server down', h.synapse.health === 'starting' ? 'The local server is starting.' : 'The local server isn’t responding.', h.synapse.health !== 'starting');
  }
  for (const b of h.bridges) {
    if (b.health === 'crashed') add('bad', `${b.name} crashed`, `The ${b.name} bridge crashed${b.crashes > 1 ? ` ${b.crashes} times` : ''}.`, true);
    else if (b.health === 'stuck') add('bad', `${b.name} not responding`, `The ${b.name} bridge never finishes starting.`, true);
    else if (b.health === 'stopped') add('warn', `${b.name} stopped`, `The ${b.name} bridge is stopped.`, true);
    else if (b.health === 'ok' && b.error) add('warn', `${b.name} not answering`, `The ${b.name} bridge didn’t answer: ${b.error}`, true);
    for (const l of b.logins) {
      const who = l.name || 'An account';
      if (['BAD_CREDENTIALS', 'LOGGED_OUT'].includes(l.state)) add('bad', `${b.name} signed out`, `${who} was signed out of ${b.name}. Link it again in Accounts.`);
      else if (l.state === 'UNKNOWN_ERROR') add('bad', `${b.name} error`, `${who} on ${b.name} has an error${l.error ? `: ${l.error}` : ''}.`, true);
      else if (l.state === 'TRANSIENT_DISCONNECT') add('warn', `${b.name} reconnecting`, `${who} on ${b.name} lost its connection and is trying again.`);
    }
  }
  if (h.disk?.free != null && h.disk.free < 1024 ** 3) add('warn', 'low disk space', 'Less than 1 GB is free on this disk. The local server may stop saving messages.');
  const level = issues.some((i) => i.level === 'bad') ? 'bad' : issues.length ? 'warn' : 'ok';
  const first = issues.find((i) => i.level === level);
  return {
    level,
    title: level === 'ok' ? 'Everything’s working' : `Needs attention: ${first.short}`,
    issues,
    fixable: issues.some((i) => i.fixable),
  };
}

// ---------- Fix ----------

let fixing = null;

async function waitRunning(name, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (local.procInfo()[name]?.status === 'running') return true;
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
}

async function fix() {
  if (fixing) return fixing;
  fixing = (async () => {
    const h = await health();
    const steps = [];
    const step = (id, label) => { const st = { id, label, state: 'pending' }; steps.push(st); return st; };
    const emit = () => send('health:fixProgress', { steps: steps.map((s) => ({ ...s })) });
    if (!h.installed) return { steps };
    const needSynapse = h.synapse.health !== 'ok' && h.synapse.health !== 'starting';
    const bridges = h.bridges.filter((b) => ['crashed', 'stuck', 'stopped'].includes(b.health) || (b.health === 'ok' && (b.error || b.logins.some((l) => l.state === 'UNKNOWN_ERROR'))));
    const sSyn = needSynapse && step('synapse', 'Restart the local server');
    const sBr = bridges.map((b) => [b, step(b.id, `Restart the ${b.name} bridge`)]);
    if (!steps.length) { step('none', 'Nothing to fix').state = 'done'; emit(); return { steps }; }
    emit();
    if (sSyn) {
      sSyn.state = 'running'; emit();
      try { await local.start(); sSyn.state = 'done'; } catch (err) { sSyn.state = 'failed'; sSyn.error = err.message; }
      emit();
    }
    for (const [b, st] of sBr) {
      st.state = 'running'; emit();
      try {
        await local.restartBridge(b.id);
        st.state = (await waitRunning(b.id)) ? 'done' : 'failed';
        if (st.state === 'failed') st.error = 'It didn’t respond again within a minute.';
      } catch (err) { st.state = 'failed'; st.error = err.message; }
      emit();
    }
    return { steps };
  })();
  try { return await fixing; } finally { fixing = null; }
}

// ---------- Diagnostics (redacted) ----------

/** Masks anything that could identify someone or unlock something: phone numbers, tokens, IDs, emails. */
function redact(text) {
  return String(text)
    .replace(/(access_token|token|secret|password|hash|key|authorization)(["'\s:=]+)("?)[^\s"',}]+/gi, '$1$2$3[hidden]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [hidden]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/([@!#$])[^\s:'"]+:([\w.-]+)/g, (_m, sigil, server) => `${sigil}…:${server}`)
    .replace(/\b[A-Za-z0-9_\-+/=]{24,}\b/g, '[token]')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, (m) => (/^\d{4}-\d\d-\d\d/.test(m) || /^\d+\.\d+\.\d+/.test(m) ? m : '[number]'));
}

async function recentProblems(name, max = 8) {
  const file = path.join(local.logsDir(), `${name}.log`);
  let text = '';
  try {
    const st = await fsp.stat(file);
    const fh = await fsp.open(file, 'r');
    try { const len = Math.min(st.size, 256 * 1024); text = (await fh.read(Buffer.alloc(len), 0, len, st.size - len)).buffer.toString('utf8'); } finally { await fh.close(); }
  } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (!l) continue;
    if (l.startsWith('{')) {
      try {
        const j = JSON.parse(l);
        if (!['error', 'warn', 'fatal'].includes(j.level)) continue;
        // Only the log message and error, never the other fields (they can carry message text).
        out.push(`${j.time || ''} ${j.level.toUpperCase()} ${j.message || ''}${j.error ? ` — ${j.error}` : ''}`);
      } catch {}
    } else if (/ - (ERROR|WARNING|CRITICAL) - /.test(l) || /^Traceback|Error:/.test(l)) {
      out.push(l.replace(/ - [\w.]+ - \d+ - /, ' - ').slice(0, 240));
    } else if (/^===== .* (starting|exited)/.test(l)) {
      out.push(l);
    }
  }
  return out.slice(-max).map((l) => redact(l).slice(0, 300));
}

const fmtBytes = (n) => (n == null ? '?' : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`);
const fmtAgo = (ts) => (ts ? `${Math.round((Date.now() - ts) / 1000)} s ago (${new Date(ts).toISOString()})` : '—');

async function diagnostics() {
  const h = await health();
  const d = h.disk || (await diskUsage({ force: true })) || {};
  const L = [];
  L.push('Relay diagnostics', `Generated ${new Date().toISOString()}`, '');
  L.push(`Relay ${h.versions.app} · Electron ${h.versions.electron} · Node ${h.versions.node} · Chromium ${h.versions.chrome}`);
  L.push(`System: ${h.versions.os} (${h.versions.arch})`, '');
  L.push(`Summary: ${h.summary.title}`);
  for (const i of h.summary.issues) L.push(`  - [${i.level}] ${i.text}`);
  L.push('');
  if (h.installed) {
    const p = (label, x) => L.push(`${label}: ${x.status} · health ${x.health} · pid ${x.pid ? 'yes' : 'no'} · started ${fmtAgo(x.startedAt)} · crashes ${x.crashes || 0} · last activity ${fmtAgo(x.lastActivity)}`);
    p('Local server (Synapse)', h.synapse);
    for (const b of h.bridges) {
      p(`${b.name} bridge`, b);
      if (b.error) L.push(`    error: ${b.error}`);
      b.logins.forEach((l, i) => {
        const sync = l.sync ? ` · history ${l.sync.history ?? '—'}% · chats ${l.sync.chats?.ready ?? 0}/${l.sync.chats?.total ?? 0}${l.sync.active ? ' (syncing)' : ''}` : '';
        L.push(`    account ${i + 1}: ${l.state}${l.error ? ` (${l.error})` : ''}${l.business ? ' · Business' : ''}${sync}`);
      });
    }
    L.push('');
    L.push(`Disk: total ${fmtBytes(d.total)} · database ${fmtBytes(d.database)} · media ${fmtBytes(d.media)} · logs ${fmtBytes(d.logs)} · bridges ${fmtBytes(d.bridges)} · programs ${fmtBytes(d.programs)} · free ${fmtBytes(d.free)}`);
    L.push('');
    for (const name of ['synapse', ...h.bridges.map((b) => b.id)]) {
      const lines = await recentProblems(name);
      if (!lines.length) continue;
      L.push(`Recent warnings from ${name}:`);
      for (const l of lines) L.push(`  ${l}`);
      L.push('');
    }
  } else {
    L.push('Local mode: not installed.');
  }
  L.push('(Phone numbers, tokens, IDs and message contents were removed from this report.)');
  return redact(L.join('\n'));
}

// ---------- Backup / restore ----------

let backupAbort = null;
const EXT = 'relaybackup';
const lastBackupFile = () => path.join(userData(), 'backup.json');
const readLast = () => { try { return JSON.parse(fs.readFileSync(lastBackupFile(), 'utf8')); } catch { return null; } };
const progress = (p) => send('backup:progress', p);

async function backupInfo() {
  const est = await core.estimate(userData());
  return { ...est, installed: local.isInstalled(), supported: local.isSupported(), last: readLast() };
}

async function createBackup({ passphrase, includeMedia }) {
  if (backupAbort) throw new Error('A backup is already in progress.');
  const stamp = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow() || undefined, {
    title: 'Save Relay backup',
    defaultPath: path.join(app.getPath('documents'), `relay-backup-${stamp}.${EXT}`),
    filters: [{ name: 'Relay backup', extensions: [EXT] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  });
  if (canceled || !filePath) return { cancelled: true };
  const out = filePath.endsWith(`.${EXT}`) ? filePath : `${filePath}.${EXT}`;
  if (path.resolve(out).startsWith(path.resolve(userData()) + path.sep)) throw new Error('Save the backup outside Relay’s data folder.');
  backupAbort = new AbortController();
  const wasInstalled = local.isInstalled();
  try {
    // SQLite files are only consistent while nothing writes to them: pause the local server.
    if (wasInstalled) { progress({ phase: 'stopping' }); await local.stop(); }
    const res = await core.createBackup({
      userData: userData(), out, passphrase, includeMedia, appVersion: app.getVersion(), signal: backupAbort.signal,
      onProgress: (p) => progress(p),
    });
    fs.writeFileSync(lastBackupFile(), JSON.stringify({ at: Date.now(), file: out, size: res.size, includesMedia: includeMedia }));
    return res;
  } finally {
    backupAbort = null;
    if (wasInstalled) {
      progress({ phase: 'restarting' });
      await local.start().catch((err) => console.error('Restarting the local server after the backup failed:', err));
    }
    progress({ phase: 'idle' });
  }
}

async function pickBackup() {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow() || undefined, {
    title: 'Choose a Relay backup',
    defaultPath: app.getPath('documents'),
    filters: [{ name: 'Relay backup', extensions: [EXT] }, { name: 'All files', extensions: ['*'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths?.[0]) return null;
  const st = await fsp.stat(filePaths[0]);
  return { path: filePaths[0], name: path.basename(filePaths[0]), size: st.size };
}

const BUSY = 'Wait for the backup in progress to finish.';

async function inspect(file, passphrase) {
  if (backupAbort) throw new Error(BUSY);
  backupAbort = new AbortController();
  try {
    return await core.inspectBackup(file, passphrase, { signal: backupAbort.signal, onProgress: (p) => progress({ phase: 'verify', ...p }) });
  } finally { backupAbort = null; progress({ phase: 'idle' }); }
}

async function restore(file, passphrase) {
  if (!local.isSupported()) throw new Error('Local mode isn’t available on this computer, so this backup can’t be restored here.');
  const ud = userData();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const staging = path.join(ud, `local.restore-tmp-${ts}`);
  if (backupAbort) throw new Error(BUSY);
  backupAbort = new AbortController();
  let summary;
  try {
    // 1. Extract next to the current data. Nothing is touched until every byte checks out.
    summary = await core.extractBackup(file, passphrase, staging, { signal: backupAbort.signal, onProgress: (p) => progress({ phase: 'extract', ...p }) });
  } catch (err) {
    await fsp.rm(staging, { recursive: true, force: true });
    backupAbort = null;
    progress({ phase: 'idle' });
    throw err;
  }
  backupAbort = null;
  // 2. Swap: the current local server is kept aside, not deleted. A first-run setup may still be
  //    installing in the background: let it finish first so it doesn't write into the new folder.
  progress({ phase: 'waiting' });
  await local.whenIdle();
  progress({ phase: 'stopping' });
  await local.stop();
  const cur = path.join(ud, 'local');
  if (fs.existsSync(cur)) await fsp.rename(cur, path.join(ud, `local.before-restore-${ts}`));
  if (fs.existsSync(path.join(staging, 'local'))) await fsp.rename(path.join(staging, 'local'), cur);
  for (const f of core.TOP_FILES) {
    const src = path.join(staging, f);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(ud, f);
    if (fs.existsSync(dst)) await fsp.rename(dst, `${dst}.before-restore-${ts}`);
    await fsp.rename(src, dst);
  }
  await fsp.rm(staging, { recursive: true, force: true });
  // 3. Absolute paths from the other computer, and details that belonged to the old programs.
  progress({ phase: 'finishing' });
  core.fixPaths(cur, summary.oldUserData, ud);
  try {
    const sf = path.join(cur, 'state.json');
    const st = JSON.parse(fs.readFileSync(sf, 'utf8'));
    delete st.pids; // processes of the other computer
    delete st.patchedWhatsApp; // the bridge programs aren't in the backup: rebuild the patch
    fs.writeFileSync(sf, JSON.stringify(st, null, 2), { mode: 0o600 });
  } catch {}
  local.resetState();
  // 4. Download the programs the backup leaves out (Python server, bridges). If this fails
  //    (offline), the next start tries again.
  progress({ phase: 'repair', message: 'Preparing the local server…' });
  await local.repairMissing((_step, message) => progress({ phase: 'repair', message })).catch((err) => console.error('Repair after restore failed:', err));
  // The chat cache belongs to the old server.
  await session.defaultSession.clearStorageData({ storages: ['indexdb'] }).catch(() => {});
  progress({ phase: 'relaunch' });
  setTimeout(() => { app.relaunch(); app.exit(0); }, 1200);
  return summary;
}

// ---------- IPC ----------

function init({ mainWindow: getWin }) {
  mainWindow = getWin;
  ipcMain.handle('health:get', () => health());
  ipcMain.handle('health:summary', async () => (await health({ light: true })).summary);
  ipcMain.handle('health:disk', () => diskUsage({ force: true }));
  ipcMain.handle('health:fix', () => fix());
  ipcMain.handle('health:cleanLogs', () => cleanLogs());
  ipcMain.handle('health:diagnostics', () => diagnostics());
  ipcMain.handle('health:openLogs', () => shell.openPath(local.logsDir()));
  ipcMain.handle('backup:info', () => backupInfo());
  ipcMain.handle('backup:create', (_e, opts) => createBackup(opts || {}));
  ipcMain.handle('backup:cancel', () => { backupAbort?.abort(); });
  ipcMain.handle('backup:pick', () => pickBackup());
  ipcMain.handle('backup:inspect', (_e, file, passphrase) => inspect(file, passphrase));
  ipcMain.handle('backup:restore', (_e, file, passphrase) => restore(file, passphrase));
  ipcMain.handle('backup:showFile', (_e, file) => { if (file && fs.existsSync(file)) shell.showItemInFolder(file); });
}

module.exports = { init, redact, health };
