// WhatsApp calls through Relay's built-in WhatsApp Web (see electron/calls.cjs).
import { useEffect, useState } from 'react';

const api = () => window.relay?.calls || null;
// Calls need the local WhatsApp bridge (to know who a chat is with), so only in local mode.
let localMode = false;
export const setCallsLocalMode = (on) => { localMode = !!on; };
export const callsAvailable = () => !!api() && localMode;

const IDLE = { enabled: false, linked: false, status: 'off', inCall: false, inCallSince: null, ringing: null, call: null, windowVisible: false };

export function useCalls() {
  const [state, setState] = useState(IDLE);
  useEffect(() => {
    const a = api();
    if (!a) return undefined;
    let alive = true;
    a.state().then((s) => alive && setState(s));
    const off = a.onState((s) => setState(s));
    return () => { alive = false; off(); };
  }, []);
  return state;
}

export const startCall = (roomId, video, name) => api()?.start(roomId, video, name) ?? Promise.resolve({ ok: false });
export const openCalls = () => api()?.open();
export const connectCalls = () => api()?.connect();
export const setCallsEnabled = (on) => api()?.setEnabled(on);
export const disconnectCalls = () => api()?.disconnect();
export const answerCall = () => api()?.answer();
export const declineCall = () => api()?.decline();

/** "03:12" / "1:02:09" */
export function callDuration(since, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - since) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export const hangupCall = () => api()?.hangup?.() ?? Promise.resolve(false);
export const diagnoseCalls = () => api()?.diagnose?.() ?? Promise.resolve(null);
export const simulateCall = (video) => api()?.simulate?.(video);
export const markCallsSeen = () => api()?.seen?.();

/** The main process's call log: { entries: [...newest first], seenAt }. Shared by every caller. */
let historyCache = { entries: [], seenAt: Date.now() };
const historySubs = new Set();
let historyWired = false;
function wireHistory() {
  const a = api();
  if (historyWired || !a?.history) return;
  historyWired = true;
  const set = (h) => { if (!h) return; historyCache = h; historySubs.forEach((fn) => fn(h)); };
  a.history().then(set).catch(() => {});
  a.onHistory(set);
}
export function useCallHistory() {
  const [h, setH] = useState(historyCache);
  useEffect(() => {
    wireHistory();
    setH(historyCache);
    historySubs.add(setH);
    return () => { historySubs.delete(setH); };
  }, []);
  return h;
}

/** "45 s" / "12 min" / "1 h 02 min" (short enough for the history row) */
export function spokenDuration(sec) {
  if (!sec && sec !== 0) return '';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m) return `${m} min`;
  return `${s} s`;
}

/** A chat's photo as a data: URL for the ringing window (media needs the session's auth header). */
export async function avatarDataUrl(url) {
  if (!url) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const blob = await fetch(url, { signal: ctrl.signal }).then((r) => (r.ok ? r.blob() : null));
    clearTimeout(t);
    if (!blob || !blob.type.startsWith('image/')) return null;
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch { return null; }
}
