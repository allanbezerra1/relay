// Message reminders ("Remind me about this…"). The list lives in the main process
// (electron/reminders.cjs) so reminders fire with the window closed; this is the UI's view of it.
import { useEffect, useState } from 'react';

// Requests between far-apart components (a message's menu → the dialog host; the list → Inbox).
export const emitReminder = (name, detail) => window.dispatchEvent(new CustomEvent(`relay:${name}`, { detail }));
export function onReminder(name, cb) {
  const fn = (e) => cb(e.detail);
  window.addEventListener(`relay:${name}`, fn);
  return () => window.removeEventListener(`relay:${name}`, fn);
}

const api = () => window.relay?.reminders || null;
export const remindersAvailable = () => !!api();

let cache = [];
const listeners = new Set();
let subscribed = false;

function subscribe() {
  if (subscribed || !api()) return;
  subscribed = true;
  const set = (list) => { cache = list || []; listeners.forEach((l) => l(cache)); };
  api().list().then(set).catch(() => {});
  api().onChange(set);
}

/** Every pending reminder, soonest first, kept live. */
export function useReminders() {
  const [list, setList] = useState(cache);
  useEffect(() => {
    subscribe();
    listeners.add(setList);
    setList(cache);
    return () => listeners.delete(setList);
  }, []);
  return list.slice().sort((a, b) => a.remindAt - b.remindAt);
}

/** The pending reminder on one message, if any. */
export function useMessageReminder(roomId, eventId) {
  const list = useReminders();
  return list.find((r) => r.roomId === roomId && r.eventId === eventId) || null;
}

export const addReminder = (item) => api()?.add(item);
export const updateReminder = (id, patch) => api()?.update(id, patch);
export const removeReminder = (id) => api()?.remove(id);

/** Opens the "Remind me about this…" dialog (src/components/Reminders.jsx) for a message. */
export function askReminder(target) { emitReminder('remind-message', target); }

// ---------- Times ----------

const at = (d, h, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x; };

/** The quick picks, each with its moment computed from now. */
export function reminderPresets(now = new Date()) {
  const out = [];
  out.push({ id: 'm20', label: 'In 20 minutes', when: new Date(now.getTime() + 20 * 60 * 1000) });
  out.push({ id: 'h1', label: 'In 1 hour', when: new Date(now.getTime() + 60 * 60 * 1000) });
  const today18 = at(now, 18);
  if (today18 - now > 15 * 60 * 1000) out.push({ id: 'today', label: 'This evening', when: today18 });
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  out.push({ id: 'tomorrow', label: 'Tomorrow morning', when: at(tomorrow, 9) });
  return out;
}

const pad = (n) => String(n).padStart(2, '0');

/** Value for <input type="datetime-local">. */
export function toLocalInput(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "today 18:00", "tomorrow 09:00", "Monday 09:00", "Oct 12 09:00" (times and dates in the system locale). */
export function formatWhen(ts, now = new Date()) {
  const d = new Date(ts);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === now.toDateString()) return `today ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow ${time}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  const days = (d - now) / 86400000;
  const day = days > 0 && days < 6
    ? d.toLocaleDateString([], { weekday: 'long' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' });
  return `${day} ${time}`;
}
