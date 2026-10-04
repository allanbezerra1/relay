// Renderer helpers for the health panel and backups (electron/reliability.cjs).
import { useEffect, useState } from 'react';

export const health = () => window.relay?.health;
export const backup = () => window.relay?.backup;

export function fmtBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** "just now", "3 min ago", "2 h ago", "4 days ago" */
export function fmtAgo(ts, now = Date.now()) {
  if (!ts) return '—';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d > 1 ? 's' : ''} ago`;
}

/** "3 h 12 min", "4 days" */
export function fmtDuration(ms) {
  if (!ms || ms < 0) return '—';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'under 1 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
  const d = Math.floor(h / 24);
  return `${d} day${d > 1 ? 's' : ''}${h % 24 ? ` ${h % 24} h` : ''}`;
}

export const cleanIpcError = (err) => String(err?.message || err).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '');

/** Health summary level for the Settings button dot ('ok' | 'warn' | 'bad'), polled every 30 s. */
export function useHealthLevel(enabled) {
  const [level, setLevel] = useState('ok');
  useEffect(() => {
    const api = health();
    if (!enabled || !api) return undefined;
    let alive = true;
    const run = () => api.summary().then((s) => alive && setLevel(s?.level || 'ok')).catch(() => {});
    const first = setTimeout(run, 8000); // let the bridges start first
    const every = setInterval(run, 30000);
    return () => { alive = false; clearTimeout(first); clearInterval(every); };
  }, [enabled]);
  return level;
}
