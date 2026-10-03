// Self-updates from the project's GitHub releases.
//
// The public builds are ad-hoc signed (no Apple Developer ID), which Squirrel.Mac and
// electron-updater refuse to install. So Relay does it by hand: find a newer release, download its
// .zip, check the SHA-256 that GitHub publishes for the asset, unpack it with ditto, check it's
// really Relay, and swap the app bundle after Relay quits (then relaunch, if asked).
const { app } = require('electron');
const { execFile, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO = 'alenkpedro/relay';
const BUNDLE_ID = 'dev.relay.desktop';
const FIRST_CHECK = 30 * 1000;
const EVERY = 4 * 60 * 60 * 1000;

let state = { status: 'idle', version: null, progress: 0, error: null, notes: '' };
let onChange = () => {};
let readyApp = null; // path to the unpacked new Relay.app
let relaunch = false;
let busy = null;

const set = (patch) => { state = { ...state, ...patch }; onChange(state); };
const run = (cmd, args) => new Promise((res, rej) => execFile(cmd, args, (err, out) => (err ? rej(err) : res(String(out).trim()))));

/** The running Relay.app, e.g. /Applications/Relay.app. */
const appBundle = () => path.resolve(process.execPath, '..', '..', '..');

/**
 * macOS only lets apps signed with an Apple certificate post notifications, and the public builds
 * are ad-hoc signed (so nobody's name or email ships in them). If this Mac has a Developer ID or
 * Apple Development identity, sign the update with it locally, the same way a local build would be.
 */
async function signLocally(bundle) {
  let out = '';
  try { out = await run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning']); } catch { return false; }
  const ids = [...out.matchAll(/\b([0-9A-F]{40}) "([^"]+)"/g)].map((m) => ({ hash: m[1], name: m[2] }));
  const pick = ids.find((i) => i.name.startsWith('Developer ID Application')) || ids.find((i) => i.name.startsWith('Apple Development'));
  if (!pick) return false;
  try {
    await run('/usr/bin/codesign', ['--force', '--deep', '--timestamp=none', '--sign', pick.hash, bundle]);
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
    return true;
  } catch (err) {
    console.error('Local signing failed, keeping the ad-hoc signature:', err.message);
    return false;
  }
}

function newer(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

/** Why this copy can't update itself, or null. */
function unsupported() {
  if (!app.isPackaged) return 'Updates are off in development builds.';
  if (process.platform !== 'darwin') return 'Updates are only supported on macOS.';
  const bundle = appBundle();
  if (bundle.includes('/AppTranslocation/')) return 'Move Relay to the Applications folder to get updates.';
  try { fs.accessSync(path.dirname(bundle), fs.constants.W_OK); fs.accessSync(bundle, fs.constants.W_OK); }
  catch { return 'Relay can’t write to its own folder, so it can’t update itself.'; }
  return null;
}

async function download(url, file, size) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Relay-updater' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const out = fs.createWriteStream(file);
  const hash = crypto.createHash('sha256');
  let got = 0;
  for await (const chunk of res.body) {
    hash.update(chunk);
    got += chunk.length;
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    set({ progress: size ? got / size : 0 });
  }
  await new Promise((r, j) => out.end((err) => (err ? j(err) : r())));
  return hash.digest('hex');
}

async function check({ manual = false } = {}) {
  if (busy) return busy;
  const why = unsupported();
  if (why) { set({ status: 'unsupported', error: why }); return state; }
  if (readyApp) return state;
  busy = (async () => {
    try {
      set({ status: 'checking', error: null });
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: { 'User-Agent': 'Relay-updater', Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
      const rel = await res.json();
      const version = String(rel.tag_name || '').replace(/^v/, '');
      if (!version || !newer(version, app.getVersion())) { set({ status: 'uptodate', version: null }); return state; }

      const asset = (rel.assets || []).find((a) => a.name.endsWith(`-${process.arch}-mac.zip`));
      const digest = /^sha256:([0-9a-f]{64})$/.exec(asset?.digest || '')?.[1];
      if (!asset) throw new Error(`Relay ${version} has no download for this Mac yet.`);
      if (!digest) throw new Error(`Relay ${version} has no checksum on GitHub, so it wasn't installed.`);

      set({ status: 'downloading', version, notes: rel.body || '', progress: 0 });
      const dir = path.join(app.getPath('temp'), `relay-update-${version}`);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      const zip = path.join(dir, asset.name);
      const sum = await download(asset.browser_download_url, zip, asset.size);
      if (sum !== digest) throw new Error('The download was corrupted (checksum mismatch). It will be retried later.');

      const unpacked = path.join(dir, 'app');
      await run('/usr/bin/ditto', ['-x', '-k', zip, unpacked]);
      fs.rmSync(zip, { force: true });
      const bundle = path.join(unpacked, 'Relay.app');
      const plist = path.join(bundle, 'Contents', 'Info.plist');
      const id = await run('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', plist]);
      const ver = await run('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', plist]);
      if (id !== BUNDLE_ID || ver !== version) throw new Error('The downloaded app isn’t the expected Relay build.');
      await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
      await signLocally(bundle);

      readyApp = bundle;
      set({ status: 'ready', progress: 1 });
    } catch (err) {
      console.error('Update check failed:', err);
      // Background checks fail quietly (offline, rate limits); a manual check shows why.
      set({ status: manual ? 'error' : 'idle', error: err.message });
    } finally {
      busy = null;
    }
    return state;
  })();
  return busy;
}

/** Swaps the bundle once this process has exited. Called on quit when an update is ready. */
function swapOnExit() {
  if (!readyApp) return;
  const target = appBundle();
  const old = `${readyApp}.old`;
  const script = `
    while kill -0 ${process.pid} 2>/dev/null; do sleep 0.2; done
    if mv "$TARGET" "$OLD"; then
      if mv "$NEW" "$TARGET"; then rm -rf "$OLD"; else mv "$OLD" "$TARGET"; fi
    fi
    xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null
    [ "$RELAUNCH" = 1 ] && open "$TARGET"
    rm -rf "$(dirname "$NEW")"
  `;
  spawn('/bin/sh', ['-c', script], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, TARGET: target, NEW: readyApp, OLD: old, RELAUNCH: relaunch ? '1' : '0' },
  }).unref();
  readyApp = null;
}

/** A copy installed from the public .dmg is ad-hoc signed: sign it locally once, if possible. */
async function signSelfIfAdHoc() {
  if (!app.isPackaged || process.platform !== 'darwin' || unsupported()) return;
  try {
    const info = await new Promise((res) => execFile('/usr/bin/codesign', ['-dv', appBundle()], (_e, _o, err) => res(String(err))));
    if (!/Signature=adhoc/.test(info)) return;
    if (await signLocally(appBundle())) console.log('Signed Relay with this Mac’s developer certificate; notifications work after a restart.');
  } catch {}
}

function init(listener) {
  onChange = listener;
  app.on('will-quit', swapOnExit);
  setTimeout(signSelfIfAdHoc, 10 * 1000);
  if (unsupported()) { set({ status: 'unsupported', error: unsupported() }); return; }
  setTimeout(() => check(), FIRST_CHECK);
  setInterval(() => check(), EVERY);
}

module.exports = {
  signLocally,
  init,
  check,
  getState: () => state,
  /** Quit now and reopen on the new version. */
  install: () => { if (!readyApp) return false; relaunch = true; app.quit(); return true; },
};
