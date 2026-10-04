// Scheduled messages. The queue lives in the main process (electron/scheduled.cjs) so messages
// still go out while the window is closed and Relay keeps running; this is the UI's view of it.
import { useEffect, useState } from 'react';

const api = () => window.relay?.scheduled || null;
export const schedulingAvailable = () => !!api();

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

/** Every scheduled message (all chats), kept live. Pass a roomId to get only that chat's. */
export function useScheduled(roomId) {
  const [list, setList] = useState(cache);
  useEffect(() => {
    subscribe();
    listeners.add(setList);
    setList(cache);
    return () => listeners.delete(setList);
  }, []);
  const mine = roomId ? list.filter((m) => m.roomId === roomId) : list;
  return mine.slice().sort((a, b) => a.sendAt - b.sendAt);
}

export const scheduleMessage = (item) => api()?.add(item);
export const updateScheduled = (id, patch) => api()?.update(id, patch);
export const cancelScheduled = (id) => api()?.cancel(id);
export const sendScheduledNow = (id) => api()?.sendNow(id);

// ---------- Times ----------

const at = (d, h, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x; };
const timeOf = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** The quick picks in the schedule popover, each with its moment computed from now. */
export function schedulePresets(now = new Date()) {
  const out = [];
  const inHour = new Date(now.getTime() + 60 * 60 * 1000);
  inHour.setSeconds(0, 0);
  out.push({ id: 'hour', label: 'In 1 hour', when: inHour });
  const today18 = at(now, 18);
  if (today18 - now > 10 * 60 * 1000) out.push({ id: 'today', label: `This evening, ${timeOf(today18)}`, when: today18 });
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const tomorrow9 = at(tomorrow, 9);
  out.push({ id: 'tomorrow', label: `Tomorrow, ${timeOf(tomorrow9)}`, when: tomorrow9 });
  // Next Monday (a week from today if today is Monday), unless that's tomorrow anyway.
  const monday = new Date(now); monday.setDate(now.getDate() + (((8 - now.getDay()) % 7) || 7));
  if (monday.getDay() === 1 && monday.toDateString() !== tomorrow.toDateString()) {
    const monday9 = at(monday, 9);
    out.push({ id: 'monday', label: `Monday, ${timeOf(monday9)}`, when: monday9 });
  }
  return out;
}

const pad = (n) => String(n).padStart(2, '0');
/** Value for <input type="datetime-local">. */
export function toLocalInput(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "today 6:00 PM", "tomorrow 9:00 AM", "Wednesday 9:00 AM", "Oct 12 9:00 AM". */
export function formatWhen(ts, now = new Date()) {
  const d = new Date(ts);
  const time = timeOf(d);
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
