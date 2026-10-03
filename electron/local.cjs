// Local mode: Relay runs its own Matrix homeserver (Synapse) and the mautrix
// bridges for WhatsApp, Telegram and Discord as background processes on this
// Mac. No Docker and no cloud: everything lives in
// ~/Library/Application Support/Relay/local and only listens on 127.0.0.1.

const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const YAML = require('yaml');

const run = promisify(execFile);

const SERVER_NAME = 'relay.local';
const HS_PORT = 29300;
const HS_URL = `http://127.0.0.1:${HS_PORT}`;
const USERNAME = 'me';
const MY_ID = `@${USERNAME}:${SERVER_NAME}`;

// Every network Relay can connect. The first three are installed during setup;
// `optional` ones are downloaded the first time you add an account for them.
// `ghost` is the user ID prefix the bridge uses for people (e.g. @signal_…).
const BRIDGES = {
  whatsapp:  { repo: 'mautrix/whatsapp',  port: 29301, v2: true,  name: 'WhatsApp' },
  telegram:  { repo: 'mautrix/telegram',  port: 29302, v2: true,  name: 'Telegram', needsKeys: true },
  discord:   { repo: 'mautrix/discord',   port: 29303, v2: false, name: 'Discord' },
  signal:    { repo: 'mautrix/signal',    port: 29304, v2: true,  name: 'Signal', optional: true },
  gmessages: { repo: 'mautrix/gmessages', port: 29305, v2: true,  name: 'Google Messages', optional: true },
  instagram: { repo: 'mautrix/meta',      port: 29306, v2: true,  name: 'Instagram', optional: true, asset: 'mautrix-instagram' },
  facebook:  { repo: 'mautrix/meta',      port: 29307, v2: true,  name: 'Facebook Messenger', optional: true, asset: 'mautrix-meta', ghost: 'meta' },
  slack:     { repo: 'mautrix/slack',     port: 29308, v2: true,  name: 'Slack', optional: true },
  linkedin:  { repo: 'mautrix/linkedin',  port: 29309, v2: true,  name: 'LinkedIn', optional: true },
  twitter:   { repo: 'mautrix/twitter',   port: 29310, v2: true,  name: 'X', optional: true },
  bluesky:   { repo: 'mautrix/bluesky',   port: 29311, v2: true,  name: 'Bluesky', optional: true },
  gvoice:    { repo: 'mautrix/gvoice',    port: 29312, v2: true,  name: 'Google Voice', optional: true },
};

const CORE = Object.keys(BRIDGES).filter((n) => !BRIDGES[n].optional);

const root = () => path.join(app.getPath('userData'), 'local');
const P = {
  get root() { return root(); },
  get state() { return path.join(root(), 'state.json'); },
  get synapse() { return path.join(root(), 'synapse'); },
  get venv() { return path.join(root(), 'synapse', 'venv'); },
  get python() { return path.join(root(), 'synapse', 'venv', 'bin', 'python'); },
  get hsConfig() { return path.join(root(), 'synapse', 'homeserver.yaml'); },
  get synapseDb() { return path.join(root(), 'synapse', 'homeserver.db'); },
  get bin() { return path.join(root(), 'bin'); },
  get logs() { return path.join(root(), 'logs'); },
  bridge: (n) => path.join(root(), 'bridges', n),
  binary: (n) => path.join(root(), 'bin', BRIDGES[n]?.asset || `mautrix-${n}`),
};

const resourcePath = (name) => (app.isPackaged ? path.join(process.resourcesPath, name) : path.join(__dirname, '..', 'resources', name));

const libolmSource = () => app.isPackaged
  ? path.join(process.resourcesPath, 'libolm.3.dylib')
  : path.join(__dirname, '..', 'resources', 'libolm.3.dylib');

// ---------- State ----------

let state = null;

function loadState() {
  if (state) return state;
  try { state = JSON.parse(fs.readFileSync(P.state, 'utf8')); }
  catch { state = {}; }
  return state;
}

function saveState() {
  fs.mkdirSync(P.root, { recursive: true });
  fs.writeFileSync(P.state, JSON.stringify(state, null, 2), { mode: 0o600 });
}

const secret = () => crypto.randomBytes(32).toString('base64url');

function isInstalled() {
  return !!loadState().installed;
}

// ---------- Helpers ----------

async function readYaml(file) {
  return YAML.parseDocument(await fsp.readFile(file, 'utf8'));
}

async function writeYaml(file, doc) {
  await fsp.writeFile(file, doc.toString({ lineWidth: 0 }), { mode: 0o600 });
}

async function findPython() {
  const candidates = ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/Library/Frameworks/Python.framework/Versions/Current/bin/python3', '/usr/bin/python3'];
  for (const py of candidates) {
    if (!fs.existsSync(py)) continue;
    try {
      const { stdout } = await run(py, ['-c', 'import sys; print("%d.%d" % sys.version_info[:2])']);
      const [maj, min] = stdout.trim().split('.').map(Number);
      if (maj === 3 && min >= 10) return py;
    } catch {}
  }
  throw new Error('Python 3.10 or newer is required. Install it with “brew install python” or from python.org, then try again.');
}

function streamProcess(cmd, args, opts, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const feed = (buf) => {
      const text = buf.toString();
      tail = (tail + text).slice(-4000);
      for (const line of text.split('\n')) if (line.trim()) onLine?.(line.trim());
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited with ${code}\n${tail}`))));
  });
}

async function waitFor(url, timeoutMs = 60000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

// ---------- Install ----------

async function installSynapse(progress) {
  if (!fs.existsSync(P.python)) {
    const py = await findPython();
    progress('synapse', 'Creating Python environment…');
    await fsp.mkdir(P.synapse, { recursive: true });
    await run(py, ['-m', 'venv', P.venv]);
  }
  progress('synapse', 'Installing the Matrix server (Synapse). This takes a minute or two…');
  await streamProcess(P.python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--upgrade', 'matrix-synapse'], {},
    (line) => { if (/^(Collecting|Downloading|Installing|Successfully)/.test(line)) progress('synapse', line.slice(0, 120)); });

  if (!fs.existsSync(P.hsConfig)) {
    progress('synapse', 'Configuring the server…');
    await run(P.python, ['-m', 'synapse.app.homeserver', '--server-name', SERVER_NAME, '--config-path', P.hsConfig,
      '--data-directory', P.synapse, '--generate-config', '--report-stats=no'], { cwd: P.synapse });
  }
}

async function configureSynapse() {
  const doc = await readYaml(P.hsConfig);
  // Client API only, on localhost only. No federation with other servers.
  doc.set('listeners', [{
    port: HS_PORT, type: 'http', tls: false, bind_addresses: ['127.0.0.1'], x_forwarded: false,
    resources: [{ names: ['client'], compress: false }],
  }]);
  doc.set('federation_domain_whitelist', []);
  doc.set('trusted_key_servers', []);
  doc.set('suppress_key_server_warning', true);
  doc.set('enable_registration', false);
  doc.set('presence', { enabled: false });
  doc.set('url_preview_enabled', false);
  // Same limit as WhatsApp (and Beeper): the bridges read it from here, both directions.
  doc.set('max_upload_size', '2000M');
  doc.set('app_service_config_files', [
    ...Object.keys(BRIDGES).filter(isBridgeInstalled).map((n) => path.join(P.bridge(n), 'registration.yaml')),
    path.join(P.synapse, 'doublepuppet.yaml'),
  ]);
  const fast = { per_second: 1000, burst_count: 1000 };
  doc.set('rc_message', fast);
  doc.set('rc_login', { address: fast, account: fast, failed_attempts: fast });
  await writeYaml(P.hsConfig, doc);

  // Lets the bridges act as you, so messages you send from your phone show up as yours.
  const s = loadState();
  s.doublePuppet ||= { as: secret(), hs: secret(), sender: `doublepuppet-${secret().slice(0, 8)}` };
  saveState();
  const dp = new YAML.Document({
    id: 'doublepuppet',
    url: null,
    as_token: s.doublePuppet.as,
    hs_token: s.doublePuppet.hs,
    sender_localpart: s.doublePuppet.sender,
    rate_limited: false,
    namespaces: { users: [{ regex: `@.*:${SERVER_NAME.replace(/\./g, '\\.')}`, exclusive: false }], rooms: [], aliases: [] },
  });
  await writeYaml(path.join(P.synapse, 'doublepuppet.yaml'), dp);
}

async function downloadBridge(name, progress) {
  if (process.arch !== 'arm64') throw new Error('Local mode currently needs a Mac with Apple silicon.');
  const { repo } = BRIDGES[name];
  const rel = await (await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { 'User-Agent': 'Relay' } })).json();
  if (!rel.tag_name) throw new Error(`Couldn’t look up the latest ${name} bridge release (GitHub said: ${rel.message || 'unknown error'})`);
  const s = loadState();
  if (s.bridgeVersions?.[name] === rel.tag_name && fs.existsSync(P.binary(name))) return;

  const asset = `${BRIDGES[name].asset || `mautrix-${name}`}-darwin-arm64`;
  const base = `https://github.com/${repo}/releases/download/${rel.tag_name}`;
  progress(name, `Downloading ${BRIDGES[name].name} bridge ${rel.tag_name}…`);
  const [bin, sums] = await Promise.all([
    fetch(`${base}/${asset}`).then((r) => { if (!r.ok) throw new Error(`Download failed (${r.status})`); return r.arrayBuffer(); }),
    fetch(`${base}/sha256sums.txt`).then((r) => r.text()),
  ]);
  const expected = sums.split('\n').find((l) => l.trim().endsWith(asset))?.split(/\s+/)[0];
  const actual = crypto.createHash('sha256').update(Buffer.from(bin)).digest('hex');
  if (!expected || expected !== actual) throw new Error(`Checksum mismatch for ${asset}, refusing to install it.`);

  await fsp.mkdir(P.bin, { recursive: true });
  const tmp = P.binary(name) + '.download';
  await fsp.writeFile(tmp, Buffer.from(bin), { mode: 0o755 });
  await fsp.rename(tmp, P.binary(name));
  s.bridgeVersions = { ...s.bridgeVersions, [name]: rel.tag_name };
  saveState();
}

function isBridgeInstalled(name) {
  return fs.existsSync(P.binary(name)) && fs.existsSync(path.join(P.bridge(name), 'registration.yaml'));
}

async function configureBridge(name) {
  const b = BRIDGES[name];
  const dir = P.bridge(name);
  const cfg = path.join(dir, 'config.yaml');
  await fsp.mkdir(dir, { recursive: true });
  const s = loadState();
  s.provisioning = { ...s.provisioning, [name]: s.provisioning?.[name] || secret() };
  saveState();

  if (!fs.existsSync(cfg)) {
    if (b.v2) await run(P.binary(name), ['-e', '-c', cfg], { cwd: dir });
    else {
      // The legacy Discord bridge has no -e flag; fetch the example config for the installed version.
      const tag = s.bridgeVersions[name];
      const res = await fetch(`https://raw.githubusercontent.com/${b.repo}/${tag}/example-config.yaml`);
      if (!res.ok) throw new Error('Couldn’t download the Discord bridge example config.');
      await fsp.writeFile(cfg, await res.text());
    }
  }

  const doc = await readYaml(cfg);
  const dpSecret = `as_token:${s.doublePuppet.as}`;
  doc.setIn(['homeserver', 'address'], HS_URL);
  doc.setIn(['homeserver', 'domain'], SERVER_NAME);
  doc.setIn(['appservice', 'address'], `http://127.0.0.1:${b.port}`);
  doc.setIn(['appservice', 'hostname'], '127.0.0.1');
  doc.setIn(['appservice', 'port'], b.port);
  const db = { type: 'sqlite3-fk-wal', uri: `file:${path.join(dir, `${name}.db`)}?_txlock=immediate` };
  const perms = { '*': 'relay', [SERVER_NAME]: 'user', [MY_ID]: 'admin' };
  const logging = { min_level: 'info', writers: [{ type: 'stdout', format: 'json' }] };
  doc.set('logging', logging);

  if (b.v2) {
    doc.setIn(['database', 'type'], db.type);
    doc.setIn(['database', 'uri'], db.uri);
    doc.setIn(['appservice', 'public_address'], null);
    doc.setIn(['bridge', 'permissions'], perms);
    // Per-message send status (com.beeper.message_send_status): a failed send, and in DMs the
    // "delivered" state between sent (one tick) and read (blue ticks).
    doc.setIn(['matrix', 'message_status_events'], true);
    // Archive / pin / mute changes made on the phone keep syncing, not only when a chat is first created.
    doc.setIn(['bridge', 'tag_only_on_create'], false);
    doc.setIn(['bridge', 'mute_only_on_create'], false);
    doc.setIn(['provisioning', 'shared_secret'], s.provisioning[name]);
    doc.setIn(['double_puppet', 'servers'], {});
    doc.setIn(['double_puppet', 'secrets'], { [SERVER_NAME]: dpSecret });
    doc.setIn(['backfill', 'enabled'], true);
    doc.setIn(['backfill', 'max_initial_messages'], 50);
    doc.setIn(['backfill', 'max_catchup_messages'], 500);
    if (name === 'whatsapp') {
      // Chats archived on your phone land in Relay's Archive, as in Beeper.
      doc.setIn(['network', 'archive_tag'], 'm.lowpriority');
      // Names from your phone's contacts first, and no " (WA)" suffix.
      doc.setIn(['network', 'displayname_template'], '{{or .FullName .BusinessName .PushName .Phone .RedactedPhone "Unknown user"}}');
    }
    if (name === 'telegram' && s.telegram) {
      doc.setIn(['network', 'api_id'], Number(s.telegram.apiId));
      doc.setIn(['network', 'api_hash'], s.telegram.apiHash);
      doc.setIn(['network', 'device_info', 'device_model'], 'Relay');
    }
  } else {
    doc.setIn(['appservice', 'database', 'type'], db.type);
    doc.setIn(['appservice', 'database', 'uri'], db.uri);
    doc.setIn(['bridge', 'permissions'], perms);
    doc.setIn(['bridge', 'provisioning', 'shared_secret'], s.provisioning[name]);
    doc.setIn(['bridge', 'double_puppet_server_map'], { [SERVER_NAME]: HS_URL });
    doc.setIn(['bridge', 'login_shared_secret_map'], { [SERVER_NAME]: dpSecret });
    doc.setIn(['bridge', 'backfill', 'forward_limits', 'initial', 'dm'], 50);
    doc.setIn(['bridge', 'backfill', 'forward_limits', 'missed', 'dm'], 200);
  }
  await writeYaml(cfg, doc);

  if (!fs.existsSync(path.join(dir, 'registration.yaml'))) {
    await run(P.binary(name), ['-g', '-c', cfg, '-r', path.join(dir, 'registration.yaml')], { cwd: dir });
  }
}

async function createUser() {
  const s = loadState();
  if (s.password) return;
  const password = secret();
  try {
    await run(path.join(P.venv, 'bin', 'register_new_matrix_user'),
      ['-u', USERNAME, '-p', password, '-a', '-c', P.hsConfig, HS_URL]);
  } catch (err) {
    if (!/already taken|in use/i.test(String(err.stdout) + String(err.stderr) + err.message)) throw err;
    throw new Error('A local user already exists but its password was lost. Use “Reset local server” in Settings.');
  }
  s.password = password;
  saveState();
}

let installing = null;

async function install(progress) {
  if (installing) return installing;
  installing = (async () => {
    await fsp.mkdir(P.logs, { recursive: true });
    await installSynapse(progress);
    for (const name of CORE) await downloadBridge(name, progress);
    progress('config', 'Wiring everything together…');
    await fsp.copyFile(libolmSource(), path.join(P.bin, 'libolm.3.dylib'));
    await configureSynapse();
    for (const name of CORE) await configureBridge(name);
    progress('start', 'Starting your server…');
    await start();
    await createUser();
    loadState().installed = true;
    saveState();
    progress('done', 'Ready');
    return credentials();
  })();
  try { return await installing; } finally { installing = null; }
}

function credentials() {
  const s = loadState();
  return { homeserver: HS_URL, user: USERNAME, userId: MY_ID, password: s.password };
}

// ---------- Process supervision ----------

const procs = new Map(); // name -> { child, status, restarts, wanted }
let statusListener = null;

function setStatus(name, status) {
  const p = procs.get(name);
  if (p) p.status = status;
  statusListener?.(name, status);
}

function logStream(name) {
  const file = path.join(P.logs, `${name}.log`);
  try { if (fs.statSync(file).size > 5 * 1024 * 1024) fs.renameSync(file, file + '.old'); } catch {}
  return fs.createWriteStream(file, { flags: 'a' });
}

function spawnManaged(name, cmd, args, cwd) {
  const existing = procs.get(name);
  if (existing?.child && existing.child.exitCode === null) return;
  const entry = existing || { restarts: 0 };
  entry.wanted = true;
  procs.set(name, entry);

  const out = logStream(name);
  out.write(`\n===== ${new Date().toISOString()} starting ${name} =====\n`);
  const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1' } });
  entry.child = child;
  // end: false: the log is closed in the exit handler below, after its last line.
  child.stdout.pipe(out, { end: false });
  child.stderr.pipe(out, { end: false });
  if (lineHandlers[name]) {
    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('{')) continue;
        try { lineHandlers[name](JSON.parse(line)); } catch {}
      }
    });
  }
  setStatus(name, 'starting');

  const pids = loadState().pids || {};
  pids[name] = child.pid;
  loadState().pids = pids;
  saveState();

  out.on('error', () => {});
  // 'close' (not 'exit'): fires once stdout/stderr are drained too.
  child.on('close', (code, signal) => {
    if (!out.writableEnded) out.end(`===== exited code=${code} signal=${signal} =====\n`);
    if (!entry.wanted) { setStatus(name, 'stopped'); return; }
    // Crashed: restart with backoff (2s, 4s, 8s … max 60s).
    setStatus(name, 'crashed');
    const delay = Math.min(60000, 2000 * 2 ** entry.restarts++);
    setTimeout(() => { if (entry.wanted) spawnManaged(name, cmd, args, cwd); }, delay);
  });
}

// ---------- Sync progress ----------
// WhatsApp sends your history in chunks and reports a percentage with each one;
// the bridge logs it. We follow the log to show a progress bar.

const historyProgress = {}; // loginId -> { type, progress, ts }
const STALL_MS = 10 * 60 * 1000;

const lineHandlers = {
  whatsapp(j) {
    if (j.action !== 'store history sync' || j.progress == null || !j.login_id) return;
    if (!['INITIAL_BOOTSTRAP', 'RECENT', 'FULL'].includes(j.sync_type)) return;
    historyProgress[j.login_id] = { type: j.sync_type, progress: j.progress, ts: Date.now() };
    statusListener?.('whatsapp', 'running');
  },
};

const chatCounts = cached(4000, () => withWhatsAppDb((db) => {
  const out = {};
  const rows = db.prepare(`
    SELECT user_login_id AS login, COUNT(*) AS total, SUM(${PORTAL_MXID_SQL('chat_jid')} IS NOT NULL) AS ready
    FROM whatsapp_history_sync_conversation GROUP BY 1`).all();
  for (const r of rows) out[r.login] = { total: r.total, ready: r.ready };
  return out;
}) || {});

/** Per account: how far the history transfer and chat creation have got. */
function whatsappSyncState(logins) {
  const t0 = Date.now();
  const counts = chatCounts();
  if (Date.now() - t0 > 200) console.warn(`Slow WhatsApp sync query: ${Date.now() - t0}ms`);
  const s = loadState();
  s.loginSeen ||= {};
  let dirty = false;
  const result = {};
  for (const l of logins) {
    if (!s.loginSeen[l.id]) { s.loginSeen[l.id] = Date.now(); dirty = true; }
    const h = historyProgress[l.id];
    const c = counts[l.id] || { total: 0, ready: 0 };
    const fresh = Date.now() - s.loginSeen[l.id] < 15 * 60 * 1000;
    const historyActive = h ? h.progress < 100 && Date.now() - h.ts < STALL_MS : fresh && c.total === 0;
    const chatsPending = c.total > 0 && c.total - c.ready > 2; // a couple of chats can never be created (e.g. deleted ones)
    result[l.id] = {
      active: historyActive || chatsPending,
      waitingForPhone: !h && c.total === 0 && fresh,
      history: h ? h.progress : null,
      chats: c,
    };
  }
  if (dirty) saveState();
  return result;
}

/** Kill processes left over from a previous run that crashed or was force-quit. */
async function killOrphans() {
  const pids = loadState().pids || {};
  for (const pid of Object.values(pids)) {
    try {
      const { stdout } = await run('ps', ['-p', String(pid), '-o', 'command=']);
      if (stdout.includes(P.root)) process.kill(pid, 'SIGTERM');
    } catch {}
  }
}

function startBridge(name) {
  if (BRIDGES[name].needsKeys && !loadState().telegram) { setStatus(name, 'needs-setup'); return; }
  procs.get(name) && (procs.get(name).restarts = 0);
  spawnManaged(name, P.binary(name), ['-c', path.join(P.bridge(name), 'config.yaml')], P.bridge(name));
  waitFor(`http://127.0.0.1:${BRIDGES[name].port}/_matrix/mau/live`, 60000)
    .then(() => {
      procs.get(name).restarts = 0;
      setStatus(name, 'running');
      if (name === 'whatsapp') {
        scheduleTagImport();
        ensurePatchedWhatsApp().catch(() => {});
      }
    })
    .catch(() => {});
}

let starting = null;

async function start() {
  if (starting) return starting;
  starting = (async () => {
    if (!procs.size) {
      await killOrphans();
      if (fs.existsSync(P.hsConfig)) await configureSynapse().catch((err) => console.error('Configuring Synapse failed:', err));
      retryRefusedAvatars();
      for (const name of Object.keys(BRIDGES).filter(isBridgeInstalled)) {
        await configureBridge(name).catch((err) => console.error(`Configuring ${name} failed:`, err));
      }
    }
    spawnManaged('synapse', P.python, ['-m', 'synapse.app.homeserver', '-c', P.hsConfig], P.synapse);
    await waitFor(`${HS_URL}/_matrix/client/versions`, 90000);
    setStatus('synapse', 'running');
    for (const name of Object.keys(BRIDGES).filter(isBridgeInstalled)) startBridge(name);
  })();
  try { await starting; } finally { starting = null; }
}

/**
 * Install a network's bridge the first time you add an account for it:
 * download, configure, register it with Synapse (which needs a quick restart), start it.
 */
const adding = new Map();
async function addNetwork(name, progress = () => {}) {
  if (!BRIDGES[name]) throw new Error(`Unknown network ${name}`);
  if (isBridgeInstalled(name)) { if (procs.get(name)?.status !== 'running') startBridge(name); return; }
  if (adding.has(name)) return adding.get(name);
  const job = (async () => {
    await downloadBridge(name, progress);
    progress(name, `Setting up ${BRIDGES[name].name}…`);
    await configureBridge(name);
    await configureSynapse();
    progress(name, 'Restarting your chat server…');
    await stopProcess('synapse');
    spawnManaged('synapse', P.python, ['-m', 'synapse.app.homeserver', '-c', P.hsConfig], P.synapse);
    await waitFor(`${HS_URL}/_matrix/client/versions`, 90000);
    setStatus('synapse', 'running');
    progress(name, `Starting the ${BRIDGES[name].name} bridge…`);
    startBridge(name);
    await waitFor(`http://127.0.0.1:${BRIDGES[name].port}/_matrix/mau/live`, 90000);
    progress(name, 'Ready');
  })();
  adding.set(name, job);
  try { return await job; } finally { adding.delete(name); }
}

async function stopProcess(name, timeoutMs = 8000) {
  const p = procs.get(name);
  if (!p?.child || p.child.exitCode !== null) return;
  p.wanted = false;
  const exited = new Promise((r) => p.child.once('exit', r));
  p.child.kill('SIGTERM');
  const timer = setTimeout(() => p.child.exitCode === null && p.child.kill('SIGKILL'), timeoutMs);
  await exited;
  clearTimeout(timer);
}

async function stop() {
  await Promise.all(Object.keys(BRIDGES).map((n) => stopProcess(n)));
  await stopProcess('synapse');
}

async function restartBridge(name) {
  await stopProcess(name);
  startBridge(name);
}

// ---------- Provisioning (logging in to WhatsApp / Telegram / Discord) ----------

async function prov(name, method, route, body) {
  const b = BRIDGES[name];
  const prefix = b.v2 ? '/_matrix/provision/v3' : '/_matrix/provision/v1';
  const url = `http://127.0.0.1:${b.port}${prefix}${route}${route.includes('?') ? '&' : '?'}user_id=${encodeURIComponent(MY_ID)}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${loadState().provisioning[name]}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { error: text }; }
  if (!res.ok) {
    const err = new Error(json.error || `Request failed (${res.status})`);
    err.errcode = json.errcode;
    throw err;
  }
  return json;
}

async function status() {
  const s = loadState();
  const out = {
    installed: !!s.installed,
    serverName: SERVER_NAME,
    synapse: procs.get('synapse')?.status || 'stopped',
    telegramKeys: !!s.telegram,
    bridges: {},
  };
  await Promise.all(Object.entries(BRIDGES).map(async ([name, b]) => {
    const installed = isBridgeInstalled(name);
    const info = {
      name: b.name, installed, optional: !!b.optional, v2: b.v2,
      status: !installed ? 'not-installed' : procs.get(name)?.status || (b.needsKeys && !s.telegram ? 'needs-setup' : 'stopped'),
      logins: [],
    };
    if (info.status === 'running') {
      try {
        if (b.v2) {
          const who = await prov(name, 'GET', '/whoami');
          info.flows = who.login_flows;
          info.logins = (who.logins || []).map((l) => ({
            id: l.id,
            name: l.name || l.profile?.name || l.profile?.phone || l.id,
            detail: l.profile?.phone || l.profile?.username || '',
            state: l.state?.state_event || 'UNKNOWN',
            error: l.state?.error || l.state?.message || null,
            profileName: l.profile?.name || null,
            spaceRoom: l.space_room || null,
          }));
          if (name === 'whatsapp') {
            const extra = whatsappAccountExtras();
            for (const l of info.logins) {
              const x = extra[l.id];
              if (!x) continue;
              l.avatarMxc = x.avatar;
              l.order = x.order;
              l.business = x.business;
              if (!l.profileName && x.name) l.profileName = x.name;
            }
            // Oldest account first: that's the one Relay borrows your name and photo from.
            info.logins.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9));
            const sync = whatsappSyncState(info.logins);
            for (const l of info.logins) l.sync = sync[l.id];
          }
        } else {
          const ping = await prov(name, 'GET', '/ping');
          if (ping.discord?.logged_in) {
            info.logins = [{
              id: ping.discord.id,
              name: ping.discord.username || 'Discord account',
              detail: ping.discord.id,
              state: ping.discord.connected ? 'CONNECTED' : 'TRANSIENT_DISCONNECT',
            }];
          }
        }
      } catch (err) {
        info.error = err.message;
      }
    }
    out.bridges[name] = info;
  }));
  return out;
}

const loginStart = (name, flowId) => prov(name, 'POST', `/login/start/${encodeURIComponent(flowId)}`);
const loginStep = (name, processId, stepId, type, data) =>
  prov(name, 'POST', `/login/step/${encodeURIComponent(processId)}/${encodeURIComponent(stepId)}/${type}`, data || {});
const loginCancel = (name, processId) => prov(name, 'POST', `/login/cancel/${encodeURIComponent(processId)}`).catch(() => {});

async function logout(name, loginId) {
  if (BRIDGES[name].v2) return prov(name, 'POST', `/logout/${encodeURIComponent(loginId)}`);
  return prov(name, 'POST', '/logout');
}

// Discord's (older) bridge streams its QR login over a WebSocket.
let discordSocket = null;

function discordLogin(onMessage) {
  discordCancel();
  const { port } = BRIDGES.discord;
  const url = `ws://127.0.0.1:${port}/_matrix/provision/v1/login/qr?user_id=${encodeURIComponent(MY_ID)}`;
  const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${loadState().provisioning.discord}` } });
  discordSocket = ws;
  ws.onmessage = (ev) => { try { onMessage(JSON.parse(ev.data)); } catch {} };
  ws.onerror = () => onMessage({ error: 'Couldn’t reach the Discord bridge.' });
  ws.onclose = () => { if (discordSocket === ws) discordSocket = null; onMessage({ closed: true }); };
}

function discordCancel() {
  try { discordSocket?.close(); } catch {}
  discordSocket = null;
}

// ---------- Reading the WhatsApp bridge's database ----------
// Some details the provisioning API doesn't expose (your own photo, archived
// chats from before Relay connected) are only in the bridge's SQLite file.

function withWhatsAppDb(fn) {
  const file = path.join(P.bridge('whatsapp'), 'whatsapp.db');
  if (!fs.existsSync(file)) return null;
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  try { return fn(db); } catch (err) { console.error('WhatsApp DB read failed:', err.message); return null; } finally { db.close(); }
}

// Chats are keyed by phone-number JID or LID depending on WhatsApp's mood; look up
// both forms. Compare on the bare user part so SQLite can use the lid/pn indexes
// (comparing concatenated strings forced a full scan and took seconds).
const PORTAL_MXID_SQL = (jid) => `COALESCE(
  (SELECT mxid FROM portal WHERE id = ${jid}),
  (SELECT p.mxid FROM whatsmeow_lid_map m JOIN portal p ON p.id = m.pn || '@s.whatsapp.net'
     WHERE substr(${jid}, instr(${jid}, '@') + 1) = 'lid' AND m.lid = substr(${jid}, 1, instr(${jid}, '@') - 1)),
  (SELECT p.mxid FROM whatsmeow_lid_map m JOIN portal p ON p.id = m.lid || '@lid'
     WHERE substr(${jid}, instr(${jid}, '@') + 1) = 's.whatsapp.net' AND m.pn = substr(${jid}, 1, instr(${jid}, '@') - 1))
)`;

/** Cache a function's result for a few seconds; the DB reads run on the main thread. */
function cached(ms, fn) {
  let at = 0;
  let value;
  return () => {
    if (Date.now() - at > ms) { value = fn(); at = Date.now(); }
    return value;
  };
}

/**
 * Profile photos WhatsApp refused ("unauthorized") are usually ones that need a
 * privacy token only the *other* account has; the bulk contact resync always runs
 * on one account. Mark those ghosts as stale so the bridge refetches them through
 * the account that actually talks to that person the next time they message.
 * Runs at most daily, only while the bridge is stopped (it caches ghosts).
 */
function retryRefusedAvatars() {
  const s = loadState();
  if (Date.now() - (s.avatarRetryAt || 0) < 24 * 3600 * 1000) return;
  const file = path.join(P.bridge('whatsapp'), 'whatsapp.db');
  if (!fs.existsSync(file)) return;
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file);
  try {
    const r = db.prepare(`UPDATE ghost SET metadata = json_set(COALESCE(NULLIF(metadata, ''), '{}'), '$.last_sync', 0)
      WHERE avatar_id = 'unauthorized'`).run();
    console.log(`Marked ${r.changes} refused WhatsApp avatars for a retry.`);
    s.avatarRetryAt = Date.now();
    saveState();
  } catch (err) {
    console.error('Avatar retry reset failed:', err.message);
  } finally {
    db.close();
  }
}

/** Your own photo and name for each connected WhatsApp account. */
const whatsappAccountExtras = cached(30000, () => {
  return withWhatsAppDb((db) => {
    const out = {};
    for (const { id, n } of db.prepare('SELECT id, rowid AS n FROM user_login').all()) {
      const lid = db.prepare('SELECT lid FROM whatsmeow_lid_map WHERE pn = ?').get(id)?.lid;
      const ghosts = db.prepare('SELECT name, avatar_mxc FROM ghost WHERE id IN (?, ?)').all(id, lid ? `lid-${lid}` : '');
      // smbi / smba = WhatsApp Business on iPhone / Android.
      const device = db.prepare("SELECT platform, business_name FROM whatsmeow_device WHERE jid LIKE ? || ':%' OR jid LIKE ? || '@%'").get(id, id);
      out[id] = {
        order: n,
        business: !!(device && (/^smb/.test(device.platform || '') || device.business_name)),
        avatar: ghosts.find((g) => g.avatar_mxc)?.avatar_mxc || null,
        name: ghosts.map((g) => (g.name || '').replace(/\s*\(WA\)$/, '')).find((n) => n && !n.startsWith('+')) || null,
      };
    }
    return out;
  }) || {};
});

/**
 * Archive and pin in Relay the chats you'd archived or pinned on WhatsApp before
 * connecting. Each chat is only imported once, so un-archiving it in Relay sticks.
 */
async function importWhatsAppTags() {
  const rows = withWhatsAppDb((db) => [
    ...db.prepare(`
      SELECT archived AS a, pinned AS p, ${PORTAL_MXID_SQL('chat_jid')} AS mxid
      FROM whatsmeow_chat_settings WHERE archived OR pinned`).all(),
  ]);
  if (!rows?.length) return 0;
  const s = loadState();
  const done = new Set(s.tagsImported || []);
  let changed = 0;
  for (const { a, p, mxid } of rows) {
    if (!mxid || done.has(mxid)) continue;
    const tag = p ? 'm.favourite' : a ? 'm.lowpriority' : null;
    try {
      if (tag) await asMe('PUT', `/user/${encodeURIComponent(MY_ID)}/rooms/${encodeURIComponent(mxid)}/tags/${tag}`, { order: 0.5 });
      done.add(mxid);
      changed++;
    } catch (err) {
      console.error('Tagging', mxid, 'failed:', err.message);
    }
  }
  s.tagsImported = [...done];

  // Status updates: archived and muted (so new statuses don't pull them back out), once per room.
  const statusRooms = withWhatsAppDb((db) => db.prepare(`SELECT mxid FROM portal WHERE id = 'status@broadcast' AND mxid IS NOT NULL`).all()) || [];
  s.statusMuted ||= [];
  for (const { mxid } of statusRooms) {
    if (s.statusMuted.includes(mxid)) continue;
    try {
      await asMe('PUT', `/pushrules/global/room/${encodeURIComponent(mxid)}`, { actions: [] });
      await asMe('PUT', `/user/${encodeURIComponent(MY_ID)}/rooms/${encodeURIComponent(mxid)}/tags/m.lowpriority`, { order: 0.5 });
      s.statusMuted.push(mxid);
    } catch (err) {
      console.error('Archiving status room failed:', err.message);
    }
  }
  saveState();
  return changed;
}

// ---------- Patched WhatsApp bridge ----------
// The official bridge's `sync contacts-with-avatars` always uses your *first*
// account. Photos restricted to "my contacts" need the privacy token of the account
// that talks to that person, so Relay builds the same bridge version with a tiny
// patch (resources/whatsapp-sync-login.patch) adding `--login=<id>`. Needs Go;
// without it Relay keeps the official binary and everything else works the same.

// Bump when resources/whatsapp-sync-login.patch changes, so existing installs rebuild.
const PATCH_REV = 5;
const GO = ['/opt/homebrew/bin/go', '/usr/local/go/bin/go', '/usr/local/bin/go'].find((p) => fs.existsSync(p)) || null;
let patching = null;

async function ensurePatchedWhatsApp() {
  const s = loadState();
  const tag = s.bridgeVersions?.whatsapp;
  const want = `${tag}+r${PATCH_REV}`;
  if (!GO || !tag || s.patchedWhatsApp === want) return s.patchedWhatsApp === want;
  if (patching) return patching;
  patching = (async () => {
    const work = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'relay-wa-'));
    try {
      await run('git', ['clone', '-q', '--depth', '1', '--branch', tag, `https://github.com/${BRIDGES.whatsapp.repo}`, work]);
      await run('git', ['apply', resourcePath('whatsapp-sync-login.patch')], { cwd: work });
      const out = path.join(P.bin, 'mautrix-whatsapp.patched');
      await run(GO, ['build', '-tags', 'goolm', '-ldflags', '-s -w', '-o', out, './cmd/mautrix-whatsapp'], { cwd: work, env: { ...process.env, CGO_ENABLED: '1' }, maxBuffer: 1 << 24 });
      await fsp.rename(out, P.binary('whatsapp'));
      // r2 fixed refused photos: resync them through every account once.
      if (!/\+r([2-9]|\d\d)$/.test(s.patchedWhatsApp || '')) s.avatarsSyncedAt = {};
      s.patchedWhatsApp = want;
      saveState();
      console.log(`Built patched WhatsApp bridge ${want}`);
      await restartBridge('whatsapp');
      return true;
    } catch (err) {
      console.error('Building the patched WhatsApp bridge failed (keeping the official one):', err.message);
      return false;
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
      patching = null;
    }
  })();
  return patching;
}

/**
 * Contacts whose WhatsApp ghost still shows a phone number even though the bridge
 * knows their name (e.g. a contact resync got interrupted). Fix them by asking the
 * bridge to resync contacts; the first time also refetch photos.
 */
let healedThisRun = false;
async function healContactNames() {
  if (healedThisRun) return;
  await ensurePatchedWhatsApp().catch(() => false);
  if (healedThisRun) return;
  const s0 = loadState();
  // With the patched bridge, refresh names + photos once through *each* account.
  if (s0.patchedWhatsApp && s0.patchedWhatsApp === `${s0.bridgeVersions?.whatsapp}+r${PATCH_REV}`) {
    const logins = (withWhatsAppDb((db) => db.prepare('SELECT id FROM user_login').all()) || []).map((r) => r.id);
    // A full photo resync takes a while and is lost if Relay quits midway, so repeat it
    // (at most every 6 h per account) while some contacts' photos are still refused.
    s0.avatarsSyncedAt ||= {};
    const refused = withWhatsAppDb((db) => db.prepare("SELECT COUNT(*) AS n FROM ghost WHERE avatar_id = 'unauthorized'").get()?.n) || 0;
    const todo = logins.filter((id) => !s0.avatarsSyncedAt[id] || (refused > 0 && Date.now() - s0.avatarsSyncedAt[id] > 6 * 3600 * 1000));
    if (todo.length) {
      healedThisRun = true;
      for (const id of todo) {
        await bridgeCommand('whatsapp', `sync contacts-with-avatars --login=${id}`);
        s0.avatarsSyncedAt[id] = Date.now();
      }
      saveState();
      console.log(`Resyncing WhatsApp contacts + photos for ${todo.length} account(s).`);
      return;
    }
  }
  const stale = withWhatsAppDb((db) => db.prepare(`
    SELECT COUNT(*) AS n FROM ghost g
    JOIN whatsmeow_contacts c ON c.their_jid = (CASE WHEN g.id LIKE 'lid-%' THEN substr(g.id, 5) || '@lid' ELSE g.id || '@s.whatsapp.net' END)
    WHERE g.name LIKE '% (WA)'
      AND COALESCE(NULLIF(c.full_name, ''), NULLIF(c.push_name, ''), NULLIF(c.business_name, '')) IS NOT NULL`).get()?.n) || 0;
  const s = loadState();
  if (!stale && s.avatarsSynced) return;
  healedThisRun = true;
  await bridgeCommand('whatsapp', s.avatarsSynced ? 'sync contacts' : 'sync contacts-with-avatars');
  s.avatarsSynced = true;
  saveState();
  console.log(`Asked the WhatsApp bridge to resync contacts (${stale} stale names).`);
}

// ---------- Favorite stickers (patched WhatsApp bridge, r3+) ----------

const patchedReady = (s = loadState()) => s.patchedWhatsApp && s.patchedWhatsApp === `${s.bridgeVersions?.whatsapp}+r${PATCH_REV}`;

/**
 * Ask the bridge for each account's full favorite sticker list, about once a day per account.
 * The bridge notes each finished sync in the file (`_synced`); requests are spaced 30 min apart
 * so one that got lost (bridge restarting) is simply retried.
 */
async function syncFavoriteStickers() {
  await ensurePatchedWhatsApp().catch(() => false);
  if (!patchedReady() || procs.get('whatsapp')?.status !== 'running') return;
  const s = loadState();
  s.favStickersAskedAt ||= {};
  const synced = readFavoriteFile()._synced || {};
  const logins = (withWhatsAppDb((db) => db.prepare('SELECT id FROM user_login').all()) || []).map((r) => r.id);
  const now = Date.now();
  const todo = logins.filter((id) => now - (synced[id]?.ts || 0) > 24 * 3600 * 1000 && now - (s.favStickersAskedAt[id] || 0) > 30 * 60 * 1000);
  for (const id of todo) {
    await bridgeCommand('whatsapp', `sync favorite-stickers --login=${id}`);
    s.favStickersAskedAt[id] = now;
  }
  if (todo.length) saveState();
}

function readFavoriteFile() {
  try { return JSON.parse(fs.readFileSync(path.join(P.bridge('whatsapp'), 'favorite-stickers.json'), 'utf8')); } catch { return {}; }
}

/**
 * Favorite stickers the bridge has collected: [{ key, login, mxc, mimetype, w, h, size, favorite, ts }].
 * WhatsApp's download links for older favorites expire, so a favorite without media is looked up
 * by its hash (the index key is the sticker's SHA-256) among the media already on the local
 * server, i.e. any copy of that sticker someone sent in a chat.
 */
function favoriteStickers() {
  const all = readFavoriteFile();
  const out = [];
  for (const [login, items] of Object.entries(all)) {
    if (login === '_synced') continue;
    for (const [key, v] of Object.entries(items || {})) out.push({ key, login, ...v });
  }
  const missing = out.filter((s) => s.favorite && !s.mxc && !s.lottie);
  if (missing.length && fs.existsSync(P.synapseDb)) {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(P.synapseDb, { readOnly: true });
    try {
      const q = db.prepare('SELECT media_id, media_type, media_length FROM local_media_repository WHERE sha256 = ? AND quarantined_by IS NULL LIMIT 1');
      for (const s of missing) {
        const hex = Buffer.from(s.key, 'base64').toString('hex');
        if (hex.length !== 64) continue;
        const row = q.get(hex);
        if (row) Object.assign(s, { mxc: `mxc://${SERVER_NAME}/${row.media_id}`, mimetype: row.media_type, size: row.media_length, fromChat: true });
      }
    } catch (err) {
      console.error('Sticker lookup failed:', err.message);
    } finally {
      db.close();
    }
  }
  return out.map(({ path: _p, url: _u, error: _e, ...s }) => s);
}

// ---------- Typing indicators (patched WhatsApp bridge, r5+) ----------

const viewingTarget = new Map(); // roomId -> { login, chat } | null

/** Tell the WhatsApp bridge a chat is open (active) or not, so it can receive "typing…". */
async function whatsappViewing(roomId, active) {
  if (!isBridgeInstalled('whatsapp') || procs.get('whatsapp')?.status !== 'running') return;
  if (!viewingTarget.has(roomId)) {
    viewingTarget.set(roomId, withWhatsAppDb((db) => {
      const p = db.prepare('SELECT id, receiver FROM portal WHERE mxid = ?').get(roomId);
      if (!p) return null;
      const login = p.receiver || db.prepare('SELECT login_id FROM user_portal WHERE portal_id = ? AND portal_receiver = ? ORDER BY preferred DESC LIMIT 1').get(p.id, p.receiver)?.login_id;
      return login ? { login, chat: p.id } : null;
    }));
  }
  const t = viewingTarget.get(roomId);
  if (!t) return;
  await prov('whatsapp', 'POST', '/relay/viewing', { login_id: t.login, chat: t.chat, active: !!active }).catch(() => {});
}

let tagTimer = null;
function scheduleTagImport() {
  clearInterval(tagTimer);
  const runIt = () => importWhatsAppTags().catch((err) => console.error('Tag import failed:', err));
  setTimeout(runIt, 20000);
  setTimeout(() => healContactNames().catch((err) => console.error('Contact resync failed:', err)), 60000);
  // New chats keep arriving during the first sync; pick them up too.
  setTimeout(() => syncFavoriteStickers().catch((err) => console.error('Favorite sticker sync failed:', err)), 90000);
  tagTimer = setInterval(() => {
    runIt();
    syncFavoriteStickers().catch(() => {});
  }, 10 * 60 * 1000);
}

// ---------- Starting a direct chat from a group member ----------

/**
 * Open (or create) the 1:1 chat with a bridged user, through a given account.
 * The bridge returns the existing chat if there is one, so this never duplicates.
 */
async function openDirectChat(userId, loginId) {
  const m = /^@([a-z]+)_([^:]+):/.exec(userId);
  const bridge = m && Object.keys(BRIDGES).find((k) => (BRIDGES[k].ghost || k) === m[1]);
  if (!bridge || !BRIDGES[bridge].v2) throw new Error('Direct chats can’t be started on this network from Relay yet.');
  const raw = m[2];
  let identifier = raw;
  if (bridge === 'whatsapp') {
    if (raw.startsWith('lid-')) {
      const lid = raw.slice(4);
      const pn = withWhatsAppDb((db) => db.prepare('SELECT pn FROM whatsmeow_lid_map WHERE lid = ?').get(lid)?.pn);
      identifier = pn ? `+${pn}` : `${lid}@lid`;
    } else {
      identifier = `+${raw}`;
    }
  }
  const qs = loginId ? `?login_id=${encodeURIComponent(loginId)}` : '';
  const res = await prov(bridge, 'POST', `/create_dm/${encodeURIComponent(identifier)}${qs}`);
  if (!res.dm_room_mxid) throw new Error('The bridge didn’t return a chat.');
  return res.dm_room_mxid;
}

/**
 * Create a group on a network through its bridge. `participants` are ghost MXIDs (the bridge maps
 * them back to network IDs); `avatar` is an mxc:// URL on the local server.
 */
async function createGroup(bridge, loginId, { name, participants, avatar }) {
  if (!BRIDGES[bridge]?.v2) throw new Error('Groups can’t be created on this network from Relay yet.');
  const body = { name: { name }, participants };
  if (avatar) body.avatar = { url: avatar };
  const res = await prov(bridge, 'POST', `/create_group/group?login_id=${encodeURIComponent(loginId)}`, body);
  if (!res.mxid) throw new Error('The bridge didn’t return the new group.');
  return { roomId: res.mxid, failed: Object.keys(res.failed_participants || {}) };
}

// ---------- Bridge commands ----------

/** Talk to the local homeserver as you, using the double-puppet appservice token. */
async function asMe(method, route, body) {
  const sep = route.includes('?') ? '&' : '?';
  const res = await fetch(`${HS_URL}/_matrix/client/v3${route}${sep}user_id=${encodeURIComponent(MY_ID)}`, {
    method,
    headers: { Authorization: `Bearer ${loadState().doublePuppet.as}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

/** Run an admin command (e.g. "sync contacts-with-avatars") in a private room with the bridge bot. */
async function bridgeCommand(name, command) {
  const s = loadState();
  const bot = `@${name}bot:${SERVER_NAME}`;
  s.commandRooms ||= {};
  let roomId = s.commandRooms[name];
  if (!roomId) {
    ({ room_id: roomId } = await asMe('POST', '/createRoom', { preset: 'private_chat', is_direct: true, invite: [bot], name: `${BRIDGES[name].name} bridge` }));
    s.commandRooms[name] = roomId;
    saveState();
    // Wait for the bot to accept the invite.
    for (let i = 0; i < 20; i++) {
      const { joined } = await asMe('GET', `/rooms/${encodeURIComponent(roomId)}/joined_members`);
      if (joined?.[bot]) break;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const prefix = { whatsapp: '!wa', telegram: '!tg', discord: '!discord' }[name];
  await asMe('PUT', `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/relay-${Date.now()}`, { msgtype: 'm.text', body: `${prefix} ${command}` });
}

async function setTelegramKeys(apiId, apiHash) {
  if (!/^\d+$/.test(String(apiId).trim()) || !/^[0-9a-f]{32}$/i.test(String(apiHash).trim())) {
    throw new Error('The api_id is a number and the api_hash is 32 letters/numbers. Copy both from my.telegram.org.');
  }
  loadState().telegram = { apiId: String(apiId).trim(), apiHash: String(apiHash).trim() };
  saveState();
  await configureBridge('telegram');
  await restartBridge('telegram');
}

function onStatusChange(fn) { statusListener = fn; }

module.exports = {
  HS_URL, MY_ID, BRIDGES,
  isInstalled, install, credentials, start, stop, status,
  loginStart, loginStep, loginCancel, logout,
  favoriteStickers, syncFavoriteStickers, whatsappViewing, createGroup,
  discordLogin, discordCancel, setTelegramKeys, restartBridge, onStatusChange, bridgeCommand, openDirectChat, addNetwork,
  logsDir: () => P.logs,
};
