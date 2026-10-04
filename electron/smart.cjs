// Smart cards (src/smart.js): finding an address on the map.
// Nominatim (OpenStreetMap) asks for at most one request a second and a real User-Agent;
// answers are cached on disk for good.

const { app, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const file = () => path.join(app.getPath('userData'), 'geocode.json');
let cache = null;
const load = () => { if (!cache) { try { cache = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { cache = {}; } } return cache; };
let saveTimer = null;
const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { fs.writeFileSync(file(), JSON.stringify(cache)); } catch {} }, 1000); };

let last = 0;
let chain = Promise.resolve();

async function lookup(q) {
  const wait = Math.max(0, last + 1100 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Relay desktop messenger' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const [hit] = await res.json();
  return hit ? { lat: +hit.lat, lon: +hit.lon, label: hit.display_name } : null;
}

function geocode(q) {
  const key = String(q || '').trim().toLowerCase().slice(0, 200);
  if (!key) return Promise.resolve(null);
  const c = load();
  if (key in c) return Promise.resolve(c[key]);
  const p = chain.then(() => lookup(key)).then((r) => { c[key] = r; save(); return r; }, () => null);
  chain = p.catch(() => {});
  return p;
}

function init() {
  ipcMain.handle('smart:geocode', (_e, q) => geocode(q));
}

module.exports = { init };
