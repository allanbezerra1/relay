// Relay backups: one encrypted file with everything needed to move Relay's local mode (the
// local server's database, signing key, bridge logins…) to another computer without scanning
// QR codes again. Plain Node (no Electron), so it can be tested on its own.
//
// File layout
//   header (40 bytes, authenticated as AAD of every chunk):
//     "RELAYBAK" | version u8 | log2(N) u8 | r u8 | p u8 | salt[16] | noncePrefix[8] | chunkSize u32
//   then chunks until the one flagged final:
//     final u8 | length u32 | ciphertext[length] | tag[16]
//   AES-256-GCM, key = scrypt(passphrase, salt), nonce = noncePrefix | chunk index u32,
//   AAD = header | index u32 | final u8. Chunking lets multi-GB backups stream in constant
//   memory, detects a wrong passphrase on the first chunk, and refuses truncated files.
//
// Plaintext = a small streaming container:
//   entry: type u8 ('M' manifest, 'F' file, 'E' end) | flags u8 (1 = deflated) | pathLen u16 | path
//          | mode u32 | mtime f64 | size u64 (original) | frames: (len u32 | bytes)* then len 0
// Each file is deflated on its own, except photos / videos (already compressed: deflating
// them would only make a multi-GB backup several times slower).

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { Transform, Readable, Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { once } = require('node:events');

const MAGIC = Buffer.from('RELAYBAK');
const VERSION = 1;
const HEADER_LEN = 40;
const CHUNK = 1 << 20; // 1 MiB of plaintext per chunk
const KDF = { log2N: 15, r: 8, p: 1 };

class BackupError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// ---------- Key + chunked AES-GCM ----------

function deriveKey(passphrase, salt, { log2N, r, p }) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(passphrase).normalize('NFC'), salt, 32, { N: 2 ** log2N, r, p, maxmem: 256 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function makeHeader(salt, noncePrefix) {
  const h = Buffer.alloc(HEADER_LEN);
  MAGIC.copy(h, 0);
  h.writeUInt8(VERSION, 8);
  h.writeUInt8(KDF.log2N, 9);
  h.writeUInt8(KDF.r, 10);
  h.writeUInt8(KDF.p, 11);
  salt.copy(h, 12);
  noncePrefix.copy(h, 28);
  h.writeUInt32BE(CHUNK, 36);
  return h;
}

function parseHeader(h) {
  if (h.length < HEADER_LEN || !h.subarray(0, 8).equals(MAGIC)) throw new BackupError('format', 'This file isn’t a Relay backup.');
  const version = h.readUInt8(8);
  if (version !== VERSION) throw new BackupError('format', `This backup was made by a newer version of Relay (format ${version}). Update Relay and try again.`);
  return {
    kdf: { log2N: h.readUInt8(9), r: h.readUInt8(10), p: h.readUInt8(11) },
    salt: h.subarray(12, 28),
    noncePrefix: h.subarray(28, 36),
    chunkSize: h.readUInt32BE(36),
  };
}

const nonceFor = (prefix, i) => { const n = Buffer.alloc(12); prefix.copy(n, 0); n.writeUInt32BE(i, 8); return n; };
const aadFor = (header, i, final) => { const a = Buffer.alloc(HEADER_LEN + 5); header.copy(a, 0); a.writeUInt32BE(i, HEADER_LEN); a.writeUInt8(final ? 1 : 0, HEADER_LEN + 4); return a; };

/** Plaintext in, header + encrypted chunks out. */
function encryptor(key, header, noncePrefix) {
  let pending = [];
  let pendingLen = 0;
  let index = 0;
  const seal = (plain, final) => {
    const c = crypto.createCipheriv('aes-256-gcm', key, nonceFor(noncePrefix, index));
    c.setAAD(aadFor(header, index, final));
    const ct = Buffer.concat([c.update(plain), c.final()]);
    const pre = Buffer.alloc(5);
    pre.writeUInt8(final ? 1 : 0, 0);
    pre.writeUInt32BE(ct.length, 1);
    index++;
    return Buffer.concat([pre, ct, c.getAuthTag()]);
  };
  return new Transform({
    construct(cb) { this.push(header); cb(); },
    transform(chunk, _enc, cb) {
      pending.push(chunk);
      pendingLen += chunk.length;
      // Only seal a full chunk once more data follows it, so the last one can be flagged final.
      while (pendingLen > CHUNK) {
        const all = Buffer.concat(pending);
        this.push(seal(all.subarray(0, CHUNK), false));
        pending = [all.subarray(CHUNK)];
        pendingLen = all.length - CHUNK;
      }
      cb();
    },
    flush(cb) {
      this.push(seal(Buffer.concat(pending), true));
      cb();
    },
  });
}

/** Encrypted chunks in (after the header), plaintext out. Fails on a bad tag or a missing final chunk. */
function decryptor(key, header, noncePrefix, chunkSize) {
  let buf = Buffer.alloc(0);
  let index = 0;
  let done = false;
  return new Transform({
    transform(chunk, _enc, cb) {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      try {
        while (buf.length >= 5) {
          if (done) throw new BackupError('corrupt', 'The backup has extra data after its end. The file may have been modified.');
          const final = buf.readUInt8(0) === 1;
          const len = buf.readUInt32BE(1);
          if (len > chunkSize) throw new BackupError('corrupt', 'The backup is corrupted.');
          if (buf.length < 5 + len + 16) break;
          const d = crypto.createDecipheriv('aes-256-gcm', key, nonceFor(noncePrefix, index));
          d.setAAD(aadFor(header, index, final));
          d.setAuthTag(buf.subarray(5 + len, 5 + len + 16));
          let plain;
          try {
            plain = Buffer.concat([d.update(buf.subarray(5, 5 + len)), d.final()]);
          } catch {
            throw index === 0
              ? new BackupError('passphrase', 'Wrong password (or the file is corrupted).')
              : new BackupError('corrupt', 'The backup is corrupted or was modified: the integrity check failed.');
          }
          buf = buf.subarray(5 + len + 16);
          index++;
          if (final) done = true;
          if (plain.length) this.push(plain);
        }
        cb();
      } catch (err) { cb(err); }
    },
    flush(cb) {
      if (!done || buf.length) cb(new BackupError('truncated', 'The backup is incomplete (the file was cut off partway through copying).'));
      else cb();
    },
  });
}

// ---------- Container ----------

function entryHeader(type, rel, mode, mtime, size, flags = 0) {
  const p = Buffer.from(rel, 'utf8');
  const h = Buffer.alloc(2 + 2 + p.length + 4 + 8 + 8);
  let o = h.writeUInt8(type.charCodeAt(0), 0);
  o = h.writeUInt8(flags, o);
  o = h.writeUInt16BE(p.length, o);
  o += p.copy(h, o);
  o = h.writeUInt32BE(mode & 0o7777, o);
  o = h.writeDoubleBE(mtime, o);
  h.writeBigUInt64BE(BigInt(size), o);
  return h;
}

class ByteReader {
  constructor(iterable) { this.it = iterable[Symbol.asyncIterator](); this.buf = Buffer.alloc(0); }
  async fill() {
    const { value, done } = await this.it.next();
    if (done) throw new BackupError('truncated', 'The backup is incomplete.');
    this.buf = this.buf.length ? Buffer.concat([this.buf, value]) : value;
  }
  async take(n) {
    while (this.buf.length < n) await this.fill();
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return out;
  }
  async *pieces(n) {
    while (n > 0) {
      if (!this.buf.length) await this.fill();
      const k = Math.min(n, this.buf.length);
      const piece = this.buf.subarray(0, k);
      this.buf = this.buf.subarray(k);
      n -= k;
      yield piece;
    }
  }
  /** One entry's data: its frames, inflated when needed. Checks the size matches the header. */
  async *data(entry) {
    const self = this;
    async function* frames() {
      for (;;) {
        const len = (await self.take(4)).readUInt32BE(0);
        if (len === 0) return;
        if (len > 64 << 20) throw new BackupError('corrupt', 'The backup is corrupted.');
        yield* self.pieces(len);
      }
    }
    let got = 0;
    let src = frames();
    if (entry.flags & 1) {
      const inflate = zlib.createInflateRaw();
      const feed = Readable.from(src, { objectMode: false });
      feed.on('error', (err) => inflate.destroy(err));
      src = feed.pipe(inflate);
    }
    for await (const piece of src) {
      got += piece.length;
      if (got > entry.size) throw new BackupError('corrupt', 'The backup is corrupted (unexpected size).');
      yield piece;
    }
    if (got !== entry.size) throw new BackupError('corrupt', 'The backup is corrupted (unexpected size).');
  }
  async rest() { // must be empty
    if (this.buf.length) return false;
    const { done } = await this.it.next();
    return done;
  }
}

async function readEntry(r) {
  const type = String.fromCharCode((await r.take(1))[0]);
  if (type === 'E') return { type };
  if (type !== 'F' && type !== 'M') throw new BackupError('corrupt', 'The backup is corrupted (unknown entry).');
  const flags = (await r.take(1))[0];
  const plen = (await r.take(2)).readUInt16BE(0);
  const rel = (await r.take(plen)).toString('utf8');
  const meta = await r.take(20);
  return { type, flags, rel, mode: meta.readUInt32BE(0), mtime: meta.readDoubleBE(4), size: Number(meta.readBigUInt64BE(12)) };
}

/** Safe relative path inside the backup ("local/…" or a top-level file name). */
function checkRel(rel) {
  if (!rel || rel.includes('\0') || rel.startsWith('/') || /^[a-zA-Z]:/.test(rel) || rel.split('/').some((s) => s === '..' || s === '')) {
    throw new BackupError('corrupt', `The backup contains an invalid path: ${rel}`);
  }
  return rel;
}

// ---------- What goes into a backup ----------

// Inside userData/local: everything except what Relay can download again (the Python venv,
// the bridge programs) and logs. Media is optional (it's usually most of the size).
// session.json is the local server's session (remote sessions live in the Keychain-encrypted
// session.bin, which can't be read on another computer, so they're left out).
const TOP_FILES = ['session.json'];
const isSkipped = (rel, includeMedia) =>
  rel === 'local/synapse/venv' || rel === 'local/bin' || rel === 'local/logs' ||
  /^local\/synapse\/homeserver\.log(\.|$)/.test(rel) || /\.(download|part|old)$/.test(rel) ||
  (!includeMedia && rel === 'local/synapse/media_store');

function category(rel) {
  if (rel.startsWith('local/synapse/media_store/')) return 'media';
  if (/^local\/synapse\/homeserver\.db/.test(rel)) return 'database';
  if (rel.startsWith('local/bridges/')) return 'bridges';
  if (rel.startsWith('local/synapse/')) return 'server';
  return 'settings';
}

async function walk(abs, rel, out, includeMedia) {
  let entries;
  try { entries = await fsp.readdir(abs, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const r = `${rel}/${e.name}`;
    if (isSkipped(r, includeMedia)) continue;
    const p = path.join(abs, e.name);
    if (e.isDirectory()) await walk(p, r, out, includeMedia);
    else if (e.isFile()) {
      try { const st = await fsp.stat(p); out.push({ abs: p, rel: r, size: st.size, mode: st.mode, mtime: st.mtimeMs }); } catch {}
    }
  }
}

/** Files a backup of `userData` would contain. */
async function listFiles(userData, { includeMedia = true } = {}) {
  const files = [];
  await walk(path.join(userData, 'local'), 'local', files, includeMedia);
  for (const f of TOP_FILES) {
    const p = path.join(userData, f);
    try { const st = await fsp.stat(p); if (st.isFile()) files.push({ abs: p, rel: f, size: st.size, mode: st.mode, mtime: st.mtimeMs }); } catch {}
  }
  return files;
}

async function dirSize(dir) {
  let total = 0, files = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) { try { total += (await fsp.stat(p)).size; files++; } catch {} }
    }
  }
  return { bytes: total, files };
}

/** Sizes for the backup dialog: with and without media. */
async function estimate(userData) {
  const files = await listFiles(userData, { includeMedia: true });
  let total = 0, media = 0;
  for (const f of files) { total += f.size; if (category(f.rel) === 'media') media += f.size; }
  return { total, media, withoutMedia: total - media, files: files.length, hasLocal: files.some((f) => f.rel === 'local/state.json') };
}

// ---------- Create ----------

/**
 * Write an encrypted backup of `userData` to `out` (via `out.part`, renamed when complete).
 * onProgress({ phase, done, total, file })
 */
async function createBackup({ userData, out, passphrase, includeMedia = true, appVersion = '', signal, onProgress = () => {} }) {
  if (!passphrase || String(passphrase).length < 8) throw new BackupError('passphrase', 'Use a password with at least 8 characters.');
  onProgress({ phase: 'scan', done: 0, total: 0 });
  const files = await listFiles(userData, { includeMedia });
  if (!files.some((f) => f.rel === 'local/state.json')) throw new BackupError('empty', 'There’s no Relay local server on this computer to back up.');
  const total = files.reduce((n, f) => n + f.size, 0);
  const cats = {};
  for (const f of files) { const c = category(f.rel); cats[c] = cats[c] || { files: 0, bytes: 0 }; cats[c].files++; cats[c].bytes += f.size; }
  const bridges = [...new Set(files.map((f) => /^local\/bridges\/([^/]+)\//.exec(f.rel)?.[1]).filter(Boolean))];
  const manifest = Buffer.from(JSON.stringify({
    app: 'Relay', format: VERSION, appVersion, created: new Date().toISOString(),
    userData, platform: process.platform, arch: process.arch, host: os.hostname(),
    includesMedia: includeMedia, files: files.length, bytes: total, categories: cats, bridges,
  }), 'utf8');

  const salt = crypto.randomBytes(16);
  const noncePrefix = crypto.randomBytes(8);
  const header = makeHeader(salt, noncePrefix);
  const key = await deriveKey(passphrase, salt, KDF);

  let done = 0;
  let lastReport = 0;
  const report = (file, force) => {
    const now = Date.now();
    if (force || now - lastReport > 120) { lastReport = now; onProgress({ phase: 'write', done, total, file }); }
  };

  const frameLen = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n, 0); return b; };
  const END = frameLen(0);
  const stored = (rel) => category(rel) === 'media' || /\.(jpe?g|png|webp|gif|heic|mp4|webm|mov|ogg|opus|m4a|mp3|zip|gz|xz|zst|7z)$/i.test(rel);

  async function* container() {
    yield entryHeader('M', 'manifest.json', 0o600, Date.now(), manifest.length);
    yield frameLen(manifest.length);
    yield manifest;
    yield END;
    for (const f of files) {
      let st;
      try { st = await fsp.stat(f.abs); } catch { continue; } // vanished since the scan
      const deflate = !stored(f.rel) && st.size > 0;
      yield entryHeader('F', f.rel, f.mode, st.mtimeMs, st.size, deflate ? 1 : 0);
      let left = st.size;
      if (left > 0) {
        const input = fs.createReadStream(f.abs, { start: 0, end: st.size - 1, highWaterMark: 1 << 20 });
        input.on('data', (chunk) => { left -= chunk.length; done += chunk.length; report(f.rel); });
        let out = input;
        if (deflate) {
          const z = zlib.createDeflateRaw({ level: 4, chunk: 1 << 18 });
          input.on('error', (err) => z.destroy(err));
          out = input.pipe(z);
        }
        for await (const chunk of out) {
          yield frameLen(chunk.length);
          yield chunk;
        }
      }
      yield END;
      if (left !== 0) throw new BackupError('changed', `The file ${f.rel} changed during the backup. Try again.`);
    }
    yield Buffer.from('E');
  }

  const part = `${out}.part`;
  try {
    await pipeline(
      Readable.from(container(), { objectMode: false }),
      encryptor(key, header, noncePrefix),
      fs.createWriteStream(part, { mode: 0o600 }),
      { signal },
    );
    await fsp.rename(part, out);
  } catch (err) {
    await fsp.rm(part, { force: true });
    if (err.name === 'AbortError') throw new BackupError('cancelled', 'Backup cancelled.');
    throw err;
  }
  report('', true);
  const size = (await fsp.stat(out)).size;
  onProgress({ phase: 'done', done: total, total });
  return { file: out, size, files: files.length, bytes: total, includesMedia: includeMedia };
}

// ---------- Read (verify / extract) ----------

async function openBackup(file, passphrase) {
  const fh = await fsp.open(file, 'r');
  let header;
  try {
    const { bytesRead, buffer } = await fh.read(Buffer.alloc(HEADER_LEN), 0, HEADER_LEN, 0);
    header = buffer.subarray(0, bytesRead);
  } finally { await fh.close(); }
  const h = parseHeader(header);
  if (h.kdf.log2N > 20 || h.kdf.r > 32 || h.kdf.p > 16 || h.chunkSize > 64 << 20) throw new BackupError('format', 'Invalid backup parameters.');
  const key = await deriveKey(passphrase, h.salt, h.kdf);
  const size = (await fsp.stat(file)).size;
  return { header, key, size, ...h };
}

/**
 * Decrypt and walk every entry. `onFile(entry, pieces)` consumes (or ignores) its data.
 * Verifies every chunk's tag and the final marker, so a resolved promise means the whole file is intact.
 */
async function readBackup(file, passphrase, { onFile, onProgress = () => {}, signal } = {}) {
  const b = await openBackup(file, passphrase);
  let read = HEADER_LEN;
  let last = 0;
  const src = fs.createReadStream(file, { start: HEADER_LEN, highWaterMark: 1 << 20 });
  src.on('data', (c) => {
    read += c.length;
    const now = Date.now();
    if (now - last > 120) { last = now; onProgress({ done: read, total: b.size }); }
  });
  const plain = decryptor(b.key, b.header, b.noncePrefix, b.chunkSize);
  src.pipe(plain);
  const fail = (err) => plain.destroy(err);
  src.on('error', fail);
  if (signal) signal.addEventListener('abort', () => fail(new BackupError('cancelled', 'Cancelled.')), { once: true });

  const r = new ByteReader(plain);
  let manifest = null;
  const entries = [];
  try {
    for (;;) {
      const e = await readEntry(r);
      if (e.type === 'E') break;
      if (e.type === 'M') {
        if (e.size > 4 << 20) throw new BackupError('corrupt', 'The backup is corrupted.');
        const chunks = [];
        for await (const p of r.data(e)) chunks.push(p);
        manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        continue;
      }
      checkRel(e.rel);
      entries.push({ rel: e.rel, size: e.size });
      if (onFile) await onFile(e, r.data(e));
      else for await (const _ of r.data(e)); // eslint-disable-line no-unused-vars
    }
    if (!(await r.rest())) throw new BackupError('corrupt', 'The backup has extra data after its end.');
  } catch (err) {
    plain.destroy();
    src.destroy();
    if (/^Z_/.test(err.code || '')) throw new BackupError('corrupt', 'The backup is corrupted.');
    throw err;
  }
  onProgress({ done: b.size, total: b.size });
  if (!manifest) throw new BackupError('corrupt', 'The backup is missing its table of contents.');
  return { manifest, entries };
}

function summarize(manifest, entries) {
  const cats = {};
  for (const e of entries) { const c = category(e.rel); cats[c] = cats[c] || { files: 0, bytes: 0 }; cats[c].files++; cats[c].bytes += e.size; }
  const bridges = [...new Set(entries.map((e) => /^local\/bridges\/([^/]+)\//.exec(e.rel)?.[1]).filter(Boolean))];
  return {
    created: manifest.created, appVersion: manifest.appVersion, host: manifest.host, platform: manifest.platform, arch: manifest.arch,
    includesMedia: manifest.includesMedia, files: entries.length, bytes: entries.reduce((n, e) => n + e.size, 0),
    categories: cats, bridges, hasSession: entries.some((e) => e.rel === 'session.json'),
    hasServer: entries.some((e) => e.rel === 'local/synapse/homeserver.yaml'),
    oldUserData: manifest.userData,
  };
}

/** Full verification pass: decrypts and checks everything, writes nothing. */
async function inspectBackup(file, passphrase, opts = {}) {
  const { manifest, entries } = await readBackup(file, passphrase, opts);
  return summarize(manifest, entries);
}

/** Extract into `dest` (a fresh staging folder). Every byte is authenticated on the way. */
async function extractBackup(file, passphrase, dest, opts = {}) {
  await fsp.mkdir(dest, { recursive: true });
  const root = path.resolve(dest);
  const { manifest, entries } = await readBackup(file, passphrase, {
    ...opts,
    onFile: async (e, pieces) => {
      const target = path.resolve(root, ...e.rel.split('/'));
      if (!target.startsWith(root + path.sep)) throw new BackupError('corrupt', `Invalid path in the backup: ${e.rel}`);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      const ws = fs.createWriteStream(target, { mode: (e.mode & 0o777) || 0o600 });
      try {
        for await (const p of pieces) if (!ws.write(p)) await once(ws, 'drain');
        ws.end();
        await once(ws, 'finish');
      } catch (err) { ws.destroy(); throw err; }
      if (e.mtime > 0) await fsp.utimes(target, new Date(), new Date(e.mtime)).catch(() => {});
    },
  });
  return summarize(manifest, entries);
}

/**
 * Synapse, the bridges and the venv store absolute paths: rewrite the old data folder to the new
 * one in their config files.
 */
function fixPaths(localDir, from, to) {
  if (!from || !to || from === to) return 0;
  let fixed = 0;
  const fix = (file) => {
    try {
      if (fs.statSync(file).size > 1 << 20) return;
      const text = fs.readFileSync(file, 'utf8');
      if (text.includes(from)) { fs.writeFileSync(file, text.split(from).join(to)); fixed++; }
    } catch {}
  };
  const walkDir = (dir, depth, test) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth > 0 && e.name !== 'media_store' && e.name !== 'lib') walkDir(p, depth - 1, test);
      else if (e.isFile() && test(e.name)) fix(p);
    }
  };
  walkDir(localDir, 3, (n) => /\.(ya?ml|config|cfg|json)$/.test(n));
  walkDir(path.join(localDir, 'synapse', 'venv', 'bin'), 0, () => true);
  return fixed;
}

module.exports = {
  BackupError, createBackup, inspectBackup, extractBackup, fixPaths, estimate, listFiles, dirSize, TOP_FILES,
  // for tests
  _internal: { encryptor, decryptor, makeHeader, parseHeader, deriveKey, HEADER_LEN },
};
