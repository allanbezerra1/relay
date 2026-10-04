// Imported WhatsApp history (electron/imports.cjs): the list, and which Relay chat each one belongs to.
import { useEffect, useState } from 'react';
import { cleanName } from './matrix.js';

const api = () => window.relay?.imports || null;
export const importsAvailable = () => !!api();

let cache = null;
const listeners = new Set();
function subscribe() {
  if (cache || !api()) return;
  cache = [];
  const set = (l) => { cache = l; listeners.forEach((f) => f(l)); };
  api().list().then(set).catch(() => {});
  api().onChanged(set);
}

export function useImports() {
  const [list, setList] = useState(cache || []);
  useEffect(() => { subscribe(); listeners.add(setList); if (cache) setList(cache); return () => { listeners.delete(setList); }; }, []);
  return list;
}

/** The imported history linked to a chat, if any. */
export function useImportFor(roomId) {
  return useImports().find((c) => c.roomId === roomId) || null;
}

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Bridge channel id (JID / LID) → roomId, from the m.bridge state the WhatsApp bridge sets. */
export function channelMap(client) {
  const map = new Map();
  for (const room of client.getRooms()) {
    if (room.getMyMembership() !== 'join') continue;
    for (const ev of room.currentState.getStateEvents('m.bridge') || []) {
      const c = ev.getContent();
      if (c?.protocol?.id === 'whatsapp' && c.channel?.id) map.set(c.channel.id, room.roomId);
    }
  }
  return map;
}

/**
 * The best Relay chat for an imported one: groups by their id, private chats by phone number →
 * LID (the bridge's lid map), and as a last resort by a unique name match.
 */
export function matchRoom(client, chat, { channels, lidmap = {} } = {}) {
  const ch = channels || channelMap(client);
  if (chat.jid) {
    if (ch.has(chat.jid)) return ch.get(chat.jid);
    const user = chat.jid.split('@')[0];
    if (lidmap[user] && ch.has(`${lidmap[user]}@lid`)) return ch.get(`${lidmap[user]}@lid`);
    if (ch.has(`${user}@s.whatsapp.net`)) return ch.get(`${user}@s.whatsapp.net`);
  }
  const name = fold(chat.name);
  if (!name) return null;
  const hits = client.getRooms().filter((r) => r.getMyMembership() === 'join' && fold(cleanName(r.name || '')) === name);
  return hits.length === 1 ? hits[0].roomId : null;
}

export const yearSpan = (c) => {
  if (!c?.first || !c?.last) return '';
  const a = new Date(c.first).getFullYear(), b = new Date(c.last).getFullYear();
  return a === b ? `${a}` : `${a}–${b}`;
};

export const plural = (n, one, many = `${one}s`) => `${(n || 0).toLocaleString()} ${n === 1 ? one : many}`;
