// Micro-animations that need a bit of JS: the reaction burst, new messages sliding in
// (only the ones that arrive while you look, not the history), and unread counters
// bumping when they go up. All of them stay still when motion is off (motionOn below).
import { useEffect } from 'react';
import { getPrefs } from './prefs.js';

/** Whether micro-animations should run: the Settings toggle and the OS "reduce motion" setting. */
export function motionOn() {
  if (getPrefs().motion === false) return false;
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// ---------- Where the pointer last went down (the burst starts there) ----------
let lastPointer = { x: 0, y: 0, t: 0 };
window.addEventListener('pointerdown', (e) => { lastPointer = { x: e.clientX, y: e.clientY, t: performance.now() }; }, true);

const SPRING = 'cubic-bezier(.2, 1.4, .4, 1)';

/** Emoji pops at the click point, a ring of tiny copies bursts out, then it flies up and fades. */
export function burstReaction(eventId, key) {
  if (!motionOn()) return;
  const msg = document.querySelector(`.timeline [data-event-id="${CSS.escape(eventId)}"]`);
  let { x, y } = lastPointer;
  if (performance.now() - lastPointer.t > 1500 || (!x && !y)) {
    const r = msg?.querySelector('.bubble')?.getBoundingClientRect();
    if (!r) return;
    x = r.left + r.width / 2;
    y = r.top + r.height / 2;
  }
  const layer = document.createElement('div');
  layer.className = 'fx-burst';
  layer.style.left = `${x}px`;
  layer.style.top = `${y}px`;
  document.body.appendChild(layer);

  const main = document.createElement('span');
  main.className = 'fx-emoji';
  main.textContent = key;
  layer.appendChild(main);
  main.animate([
    { transform: 'translate(-50%, -50%) scale(0.2)', opacity: 0 },
    { transform: 'translate(-50%, -50%) scale(1.7)', opacity: 1, offset: 0.22 },
    { transform: 'translate(-50%, -60%) scale(1.35)', opacity: 1, offset: 0.45 },
    { transform: 'translate(-50%, -260%) scale(0.9)', opacity: 0 },
  ], { duration: 1050, easing: 'cubic-bezier(.2, .7, .3, 1)', fill: 'forwards' });

  const ring = document.createElement('span');
  ring.className = 'fx-ring';
  layer.appendChild(ring);
  ring.animate([
    { transform: 'translate(-50%, -50%) scale(0.2)', opacity: 0.9 },
    { transform: 'translate(-50%, -50%) scale(2.6)', opacity: 0 },
  ], { duration: 560, easing: 'cubic-bezier(.1, .7, .3, 1)', fill: 'forwards' });

  const N = 8;
  for (let i = 0; i < N; i++) {
    const p = document.createElement('span');
    p.className = i % 2 ? 'fx-spark' : 'fx-mini';
    if (!(i % 2)) p.textContent = key;
    layer.appendChild(p);
    const a = (i / N) * Math.PI * 2 + Math.random() * 0.5;
    const d = 38 + Math.random() * 26;
    p.animate([
      { transform: 'translate(-50%, -50%) scale(0.3)', opacity: 1 },
      { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d - 10}px)) scale(1)`, opacity: 1, offset: 0.55 },
      { transform: `translate(calc(-50% + ${Math.cos(a) * d * 1.25}px), calc(-50% + ${Math.sin(a) * d * 1.25 + 14}px)) scale(0.4)`, opacity: 0 },
    ], { duration: 720 + Math.random() * 200, delay: 40, easing: 'cubic-bezier(.15, .8, .3, 1)', fill: 'forwards' });
  }
  setTimeout(() => layer.remove(), 1300);

  // When the reaction chip shows up under the message, give it a springy pop.
  if (!msg) return;
  const findChip = () => [...msg.querySelectorAll('.reactions button')].find((b) => b.textContent.trim().startsWith(key));
  const before = findChip()?.textContent;
  let tries = 0;
  const poll = () => {
    const chip = findChip();
    if (chip && chip.textContent !== before) {
      chip.animate([{ transform: 'scale(0.4)' }, { transform: 'scale(1.25)', offset: 0.55 }, { transform: 'scale(1)' }], { duration: 480, easing: SPRING });
      return;
    }
    if (++tries < 40) setTimeout(poll, 50);
  };
  setTimeout(poll, 60);
}

// ---------- New messages slide in, only when they arrive live ----------
/**
 * Watches the timeline: messages added at the bottom after the chat has settled
 * slide in; the initial history, older pages loaded on scroll and a local echo
 * being swapped for the server's copy don't.
 */
export function useLiveArrivals(scrollRef, roomId) {
  useEffect(() => {
    const inner = scrollRef.current?.querySelector('.timeline-inner');
    if (!inner) return;
    let ready = false;
    const settle = setTimeout(() => { ready = true; }, 900);
    const obs = new MutationObserver((records) => {
      if (!ready || !motionOn()) return;
      const replaced = records.some((r) => [...r.removedNodes].some((n) => n.classList?.contains('msg')));
      if (replaced) return;
      for (const r of records) {
        for (const n of r.addedNodes) {
          if (!n.classList?.contains('msg')) continue;
          // Only at the end of the list (pagination prepends at the top).
          let next = n.nextElementSibling;
          while (next && !next.classList.contains('msg')) next = next.nextElementSibling;
          if (next) continue;
          const mine = n.classList.contains('mine');
          n.animate([
            { opacity: 0, transform: `translate(${mine ? 18 : -18}px, 14px) scale(0.96)` },
            { opacity: 1, transform: 'none' },
          ], { duration: 380, easing: 'cubic-bezier(.2, 1.1, .3, 1)' });
        }
      }
    });
    obs.observe(inner, { childList: true });
    return () => { clearTimeout(settle); obs.disconnect(); };
  }, [scrollRef, roomId]);
}

// ---------- Unread counters bump when they go up ----------
const COUNT_SEL = '.count, .rail-count';
const lastCount = new WeakMap();
const startedAt = performance.now();
const num = (el) => { const n = parseInt(el.textContent, 10); return Number.isFinite(n) ? n : el.textContent.includes('+') ? 100 : 0; };

function bump(el) {
  el.animate([
    { transform: 'scale(1)' },
    { transform: 'scale(1.45)', offset: 0.35 },
    { transform: 'scale(0.92)', offset: 0.7 },
    { transform: 'scale(1)' },
  ], { duration: 520, easing: 'cubic-bezier(.3, 1.4, .5, 1)' });
}

const counters = new MutationObserver((records) => {
  if (performance.now() - startedAt < 2500) return; // first sync fills every counter at once
  const hits = new Set();
  for (const r of records) {
    const t = r.type === 'characterData' ? r.target.parentElement : r.target;
    const own = t?.closest?.(COUNT_SEL);
    if (own) hits.add(own);
    for (const n of r.addedNodes || []) {
      if (n.nodeType !== 1) continue;
      if (n.matches(COUNT_SEL)) hits.add(n);
    }
  }
  if (!hits.size || hits.size > 4 || !motionOn()) { hits.forEach((el) => lastCount.set(el, num(el))); return; }
  for (const el of hits) {
    const n = num(el);
    const before = lastCount.get(el) ?? 0;
    lastCount.set(el, n);
    if (n > before) bump(el);
  }
});
counters.observe(document.body, { subtree: true, childList: true, characterData: true });
