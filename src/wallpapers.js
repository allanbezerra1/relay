// Chat wallpapers ("Papel de parede"): built-in ones drawn in CSS/SVG (styles/wallpapers.css),
// plus your own pictures, copied into <app data>/wallpapers by the main process.
// The per-chat choice lives in the room's account data (so it follows you to other devices;
// your own pictures only exist on the device they were picked on), the default in prefs.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { RoomEvent } from 'matrix-js-sdk';
import { usePrefs } from './prefs.js';

export const WALLPAPER_EVENT = 'dev.relay.wallpaper';

export const WALLPAPERS = [
  { id: 'none', name: 'None' },
  { id: 'doodle', name: 'Doodles' },
  { id: 'dots', name: 'Dots' },
  { id: 'grid', name: 'Grid' },
  { id: 'waves', name: 'Waves' },
  { id: 'topo', name: 'Topography' },
  { id: 'confetti', name: 'Confetti' },
  { id: 'mesh', name: 'Mesh' },
  { id: 'blobs', name: 'Aurora' },
  { id: 'sunset', name: 'Sunset' },
  { id: 'ocean', name: 'Sea' },
  { id: 'stars', name: 'Night' },
];
const BUILT_IN = new Set(WALLPAPERS.map((w) => w.id));

// ---------- Your own pictures ----------
let customs = []; // [{ id: 'img:<file>', url }]
let customsLoaded = null;
const customListeners = new Set();
const emitCustoms = () => customListeners.forEach((l) => l());

function loadCustoms() {
  customsLoaded ||= (window.relay?.wallpaper?.list?.() || Promise.resolve([]))
    .then((list) => { customs = list || []; emitCustoms(); })
    .catch(() => {});
  return customsLoaded;
}

export function useCustomWallpapers() {
  useEffect(() => { loadCustoms(); }, []);
  return useSyncExternalStore((l) => { customListeners.add(l); return () => customListeners.delete(l); }, () => customs);
}

/** Open the file picker; resolves to the new wallpaper id, or null if cancelled. */
export async function pickCustomWallpaper() {
  const res = await window.relay?.wallpaper?.pick?.();
  if (!res) return null;
  if (!customs.some((c) => c.id === res.id)) { customs = [...customs, res]; emitCustoms(); }
  return res.id;
}

export async function removeCustomWallpaper(id) {
  await window.relay?.wallpaper?.remove?.(id);
  customs = customs.filter((c) => c.id !== id);
  emitCustoms();
}

const customUrl = (id) => customs.find((c) => c.id === id)?.url || null;
const usable = (id) => BUILT_IN.has(id) || !!customUrl(id);

// ---------- Per-chat choice ----------
const overrides = new Map(); // roomId -> setting, set right away while the account data write is in flight
const overrideListeners = new Set();
const writeTimers = new Map();

export function setRoomWallpaper(client, room, value) {
  overrides.set(room.roomId, value);
  overrideListeners.forEach((l) => l());
  clearTimeout(writeTimers.get(room.roomId));
  // Sliders fire many times a second; only the last value goes to the server.
  writeTimers.set(room.roomId, setTimeout(() => {
    client.setRoomAccountData(room.roomId, WALLPAPER_EVENT, value).catch((err) => console.warn('Wallpaper not saved', err));
  }, 400));
}

/** The chat's own setting ({ id: 'default' } = follow the global default). */
export function useRoomWallpaperSetting(client, room) {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!room) return;
    const on = () => bump((n) => n + 1);
    room.on(RoomEvent.AccountData, on);
    overrideListeners.add(on);
    return () => { room.off(RoomEvent.AccountData, on); overrideListeners.delete(on); };
  }, [room]);
  if (!room) return { id: 'default' };
  return overrides.get(room.roomId) || room.getAccountData(WALLPAPER_EVENT)?.getContent() || { id: 'default' };
}

const clamp = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

/** What to paint behind a chat: { id, dim, blur, url } (id 'none' = plain glass). */
export function resolveWallpaper(setting, fallback) {
  for (const s of [setting, fallback]) {
    if (!s || !s.id || s.id === 'default') continue;
    if (!usable(s.id)) continue;
    return { id: s.id, dim: clamp(s.dim, 0, 0.85, 0), blur: clamp(s.blur, 0, 24, 0), url: customUrl(s.id) };
  }
  return { id: 'none', dim: 0, blur: 0, url: null };
}

export function useChatWallpaper(client, room) {
  const prefs = usePrefs();
  useCustomWallpapers();
  const setting = useRoomWallpaperSetting(client, room);
  return resolveWallpaper(setting, prefs.wallpaper);
}

export const isCustomWallpaper = (id) => typeof id === 'string' && id.startsWith('img:');
