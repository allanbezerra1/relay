// Interface and notification sounds. Built-in ones are in public/sounds (made by
// scripts/make-sounds.mjs); a sound pack in ~/Library/Application Support/Relay/sounds
// can replace them and add notification sounds (see app:customSounds in electron/main.cjs).
import { getPrefs } from './prefs.js';

const BUILT_IN = [
  ['receive', 'Relay (default)'],
  ['chime', 'Chime'],
  ['glass', 'Glass'],
  ['drop', 'Drop'],
  ['marimba', 'Marimba'],
  ['harp', 'Harp'],
  ['bell', 'Bell'],
];

const title = (id) => id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

let custom = { interface: {}, notifications: [] };
/** [id, label] choices, built-in first, then the sound pack's, then None. */
export let NOTIFICATION_SOUNDS = [...BUILT_IN, ['none', 'None']];

/** Loads the optional sound pack; call once at start-up. */
export async function loadSoundPack() {
  try {
    const pack = await window.relay?.customSounds?.();
    if (!pack) return;
    custom = pack;
    const extra = pack.notifications.filter(([id]) => !BUILT_IN.some(([b]) => b === id)).map(([id]) => [id, title(id)]);
    NOTIFICATION_SOUNDS = [...BUILT_IN, ...extra, ['none', 'None']];
  } catch {}
}

const cache = new Map();
function audio(src) {
  let a = cache.get(src);
  if (!a) { a = new Audio(src); a.preload = 'auto'; cache.set(src, a); }
  return a;
}

function play(src, volume = 0.6) {
  if (volume <= 0) return;
  const a = audio(src);
  try { a.pause(); a.currentTime = 0; a.volume = Math.min(1, volume); a.play().catch(() => {}); } catch {}
}

const interfaceSrc = (name) => custom.interface[name] || `./sounds/interface/sound_${name}.wav`;

/** UI sounds: send, receive, push, react_like, react_heart, react_haha, react_emphasize, react_question, react_dislike */
export function uiSound(name) {
  if (!getPrefs().interfaceSounds) return;
  play(interfaceSrc(name), 0.5 * getPrefs().interfaceVolume);
}

export function notificationSound(id = getPrefs().notifSoundName) {
  if (!id || id === 'none') return;
  const v = 0.7 * getPrefs().notifVolume;
  const packed = custom.notifications.find(([n]) => n === id)?.[1];
  if (packed) return play(packed, v);
  if (BUILT_IN.some(([b]) => b === id) && id !== 'receive') return play(`./sounds/notifications/${id}.wav`, v);
  play(interfaceSrc('receive'), v); // default, and the fallback for a sound that's gone
}

/** Which reaction sound fits an emoji (WhatsApp/iMessage-style tapbacks). */
export function reactionSound(key) {
  if (/👍|👌|🙌/.test(key)) return 'react_like';
  if (/❤|💕|💖|😍|🥰|♥/.test(key)) return 'react_heart';
  if (/😂|🤣|😆|😹/.test(key)) return 'react_haha';
  if (/‼|❗|😮|😯|😲|🔥|💯/.test(key)) return 'react_emphasize';
  if (/❓|❔|🤔/.test(key)) return 'react_question';
  if (/👎|😢|😭|😞/.test(key)) return 'react_dislike';
  return 'react_like';
}
