// Looks (Settings → Appearance → Style). Classic is Relay's own look; the others are glass looks
// (styles/theme-glass.css, tokens per preset in styles/presets.css). The accent color stays the
// user's choice; a preset changes the canvas, glass and text.
import { getPrefs, setPref } from './prefs.js';

// `preview` paints the live mini card in Settings (a1 = null follows the accent).
export const PRESETS = [
  {
    id: 'classic', name: 'Classic', hint: 'Relay’s own clean, flat look',
    preview: {
      dark: { base: '#0f1115', a1: '#0f1115', a2: '#0f1115', a3: '#0f1115', glass: '#15181d', in: '#20242c', line: '#242932', text: '#e8eaee', glow: 0 },
      light: { base: '#ffffff', a1: '#fff', a2: '#fff', a3: '#fff', glass: '#f6f7f9', in: '#eff1f4', line: '#e3e6eb', text: '#15171c', glow: 0 },
    },
  },
  {
    id: 'aurora', name: 'Aurora', hint: 'A living aurora behind frosted glass',
    preview: {
      dark: { base: '#07080d', a1: null, a2: '#14b8a6', a3: '#c026d3', glass: 'rgba(14,16,25,.62)', in: 'rgba(255,255,255,.1)', line: 'rgba(255,255,255,.1)', text: '#eef0f6' },
      light: { base: '#eceef6', a1: null, a2: '#5eead4', a3: '#e879f9', glass: 'rgba(255,255,255,.66)', in: '#fff', line: 'rgba(20,24,50,.09)', text: '#141625', glow: 0.55 },
    },
  },
  {
    id: 'amber', name: 'Amber', hint: 'Warm sunset, amber and rosé',
    preview: {
      dark: { base: '#0e0806', a1: '#f59e0b', a2: '#e11d48', a3: '#9333ea', glass: 'rgba(30,18,14,.6)', in: 'rgba(255,228,205,.12)', line: 'rgba(255,220,190,.12)', text: '#fbf1e9' },
      light: { base: '#fbefe3', a1: '#fbbf24', a2: '#fb7185', a3: '#c084fc', glass: 'rgba(255,250,245,.66)', in: '#fffcf8', line: 'rgba(110,50,20,.1)', text: '#2b1810', glow: 0.6 },
    },
  },
  {
    id: 'ocean', name: 'Ocean', hint: 'Deep blue, cyan and indigo',
    preview: {
      dark: { base: '#020c14', a1: '#06b6d4', a2: '#0d9488', a3: '#4f46e5', glass: 'rgba(6,22,34,.6)', in: 'rgba(190,240,255,.12)', line: 'rgba(160,230,255,.12)', text: '#e8f7fc' },
      light: { base: '#e3f1f5', a1: '#22d3ee', a2: '#2dd4bf', a3: '#818cf8', glass: 'rgba(250,254,255,.66)', in: '#fff', line: 'rgba(10,60,80,.1)', text: '#0b2430', glow: 0.55 },
    },
  },
  {
    id: 'oled', name: 'OLED', hint: 'Pure black and maximum contrast, great at night', mode: 'dark',
    preview: { dark: { base: '#000', a1: '#000', a2: '#000', a3: '#000', glass: '#000', in: '#18181a', line: 'rgba(255,255,255,.18)', text: '#fff', glow: 0 } },
  },
  {
    id: 'paper', name: 'Paper', hint: 'Cream paper and ink, easy to read', mode: 'light',
    preview: { light: { base: '#efe8db', a1: '#f3d3a4', a2: '#e6cdb0', a3: '#ecc2b6', glass: 'rgba(252,249,242,.9)', in: '#fffdf8', line: 'rgba(70,50,20,.14)', text: '#221c15', glow: 0.35 } },
  },
];

/** Inline CSS variables for a preset's mini preview in the given mode. */
export function previewStyle(preset, dark) {
  const p = preset.preview[dark ? 'dark' : 'light'] || preset.preview.dark || preset.preview.light;
  return {
    '--p-base': p.base, '--p-a1': p.a1 || 'var(--accent)', '--p-a2': p.a2, '--p-a3': p.a3,
    '--p-glass': p.glass, '--p-in': p.in, '--p-line': p.line, '--p-text': p.text, '--p-glow': p.glow ?? 0.85,
  };
}

/** Whether micro-animations should run: the Settings toggle and the OS "reduce motion" setting. */
export function motionOn() {
  if (getPrefs().motion === false) return false;
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Change an appearance pref with a circular reveal growing from the click point
 * (View Transitions), or a quick crossfade where those aren't available.
 */
export function setPrefAnimated(key, value, event) {
  if (getPrefs()[key] === value) return;
  if (!motionOn()) { setPref(key, value); return; }
  const root = document.documentElement;
  if (!document.startViewTransition) {
    root.classList.add('appearance-fade');
    setPref(key, value);
    setTimeout(() => root.classList.remove('appearance-fade'), 500);
    return;
  }
  const r = event?.currentTarget?.getBoundingClientRect?.();
  const x = event?.clientX || (r ? r.left + r.width / 2 : innerWidth / 2);
  const y = event?.clientY || (r ? r.top + r.height / 2 : innerHeight / 2);
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  root.classList.add('appearance-vt');
  const t = document.startViewTransition(() => setPref(key, value));
  t.ready.then(() => {
    root.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: 700, easing: 'cubic-bezier(.22, .8, .2, 1)', pseudoElement: '::view-transition-new(root)' },
    );
  }).catch(() => {});
  t.finished.finally(() => root.classList.remove('appearance-vt'));
}
