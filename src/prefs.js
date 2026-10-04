// User preferences. Per-device, so they live in localStorage.
import { useSyncExternalStore } from 'react';

const KEY = 'relay.prefs';

export const DEFAULTS = {
  // Appearance
  theme: 'system',        // system | dark | light
  accent: 'blue',         // see ACCENTS
  density: 'comfortable', // comfortable | compact
  textSize: 'md',         // sm | md | lg
  motion: true,           // micro-animations (also off when the OS asks for reduced motion)
  // Chats
  enterToSend: true,
  readReceipts: true,     // false = private receipts: chats get marked read here, contacts don't see it
  autoUnarchive: true,
  showPreviews: true,     // last message under each chat in the list
  // Notifications
  notifications: true,
  notifPreview: true,
  notifSound: true,
  notifSoundName: 'receive', // see sounds.js
  interfaceSounds: true,    // send / receive / reaction sounds
  notifVolume: 1,           // 0–1, on top of each sound's own level
  interfaceVolume: 1,
  voiceVolume: 1,           // voice messages and other audio
  notifGroups: 'all',     // all | mentions
  badge: 'messages',      // messages | chats | off
};

export const ACCENTS = {
  violet: { name: 'Violet', a: '#6c5ce7', b: '#8578ff' },
  blue:   { name: 'Blue',   a: '#2f6bf6', b: '#4b84ff' },
  green:  { name: 'Green',  a: '#16a34a', b: '#22c55e' },
  pink:   { name: 'Pink',   a: '#db2777', b: '#f0529c' },
  orange: { name: 'Orange', a: '#ea580c', b: '#fb7c36' },
  graphite: { name: 'Graphite', a: '#4b5563', b: '#6b7280' },
};

let prefs = load();
const listeners = new Set();

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    // v2 switched the default look to Beeper's blue; keep any other color someone picked.
    if (!saved.v2) { if (saved.accent === 'violet') delete saved.accent; saved.v2 = true; }
    // v3: Beeper's receive sound became the default notification sound.
    if (!saved.v3) { if (!saved.notifSoundName || saved.notifSoundName === 'spirit') delete saved.notifSoundName; saved.v3 = true; }
    return { ...DEFAULTS, ...saved };
  } catch { return { ...DEFAULTS }; }
}

export function getPrefs() { return prefs; }

export function setPref(key, value) {
  prefs = { ...prefs, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {}
  applyAppearance();
  listeners.forEach((l) => l());
}

export function usePrefs() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, getPrefs);
}

export function applyAppearance() {
  const root = document.documentElement;
  if (prefs.theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = prefs.theme;
  root.dataset.motion = prefs.motion === false ? 'off' : 'on';
  root.dataset.density = prefs.density;
  root.dataset.text = prefs.textSize;
  const acc = ACCENTS[prefs.accent] || ACCENTS.violet;
  root.style.setProperty('--accent', acc.a);
  root.style.setProperty('--accent-2', acc.b);
  root.style.setProperty('--bubble-out', acc.a);
  window.relay?.setTheme?.(prefs.theme);
}
