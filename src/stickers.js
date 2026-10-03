// Saved stickers, kept in account data as a personal pack (MSC2545 `im.ponies.user_emotes`, the
// format Element, Cinny and FluffyChat use), so they follow the account and survive reinstalls.
import { useEffect, useState } from 'react';
import { ClientEvent, EventType } from 'matrix-js-sdk';
import { downloadBlob, imageInfo } from './media.js';
import { effectiveContent } from './matrix.js';

const TYPE = 'im.ponies.user_emotes';

function pack(client) {
  const c = client.getAccountData(TYPE)?.getContent() || {};
  return { ...c, images: { ...(c.images || {}) } };
}

const isSticker = (img) => !img.usage || img.usage.includes('sticker');

/** Newest first: [{ id, url, body, info }] */
export function savedStickers(client) {
  return Object.entries(pack(client).images)
    .filter(([, img]) => img?.url && isSticker(img))
    .map(([id, img]) => ({ id, url: img.url, body: img.body || 'Sticker', info: img.info || {}, added: img['dev.relay.added'] || 0, wa: !!img['dev.relay.wa'] }))
    .sort((a, b) => b.added - a.added);
}

export function useStickers(client) {
  const [list, setList] = useState(() => savedStickers(client));
  useEffect(() => {
    const on = (ev) => { if (ev.getType() === TYPE) setList(savedStickers(client)); };
    client.on(ClientEvent.AccountData, on);
    return () => client.removeListener(ClientEvent.AccountData, on);
  }, [client]);
  return list;
}

async function write(client, images, extra = {}) {
  const c = pack(client);
  await client.setAccountData(TYPE, { ...c, pack: c.pack || { display_name: 'My stickers' }, ...extra, images });
}

const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function add(client, url, body, info) {
  const images = pack(client).images;
  if (Object.values(images).some((img) => img.url === url)) return;
  images[newId()] = { url, body, info, usage: ['sticker'], 'dev.relay.added': Date.now() };
  await write(client, images);
}

/** The saved sticker matching a message's media, if any. */
export function findSaved(client, ev) {
  const c = effectiveContent(ev);
  const url = c.url || c.file?.url;
  return savedStickers(client).find((s) => s.url === url || (s.info['dev.relay.source'] && s.info['dev.relay.source'] === url));
}

/** Save a received sticker (or image) as a sticker. Encrypted media gets re-uploaded unencrypted. */
export async function saveSticker(client, ev) {
  const c = effectiveContent(ev);
  const info = { ...(c.info || {}) };
  delete info.thumbnail_file;
  let url = c.url;
  if (!url && c.file) {
    const blob = await downloadBlob(client, c);
    ({ content_uri: url } = await client.uploadContent(blob, { type: blob.type, includeFilename: false }));
    info['dev.relay.source'] = c.file.url;
  }
  if (!url) throw new Error('This sticker has no media.');
  await add(client, url, ev.getType() === EventType.Sticker ? (c.body || 'Sticker') : 'Sticker', info);
}

/** Turn image files into stickers (the bridges convert them to each network's format). */
export async function importStickers(client, files) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const { w, h } = await imageInfo(file);
    const { content_uri } = await client.uploadContent(file, { name: file.name, type: file.type });
    await add(client, content_uri, file.name.replace(/\.[^.]+$/, '') || 'Sticker', { mimetype: file.type, size: file.size, w, h });
  }
}

export async function removeSticker(client, id) {
  const c = pack(client);
  const images = c.images;
  // A WhatsApp favorite removed here stays removed (until it's favorited again on the phone).
  const wa = images[id]?.['dev.relay.wa'];
  const dismissed = wa ? [...new Set([...(c['dev.relay.dismissed'] || []), wa])] : c['dev.relay.dismissed'];
  delete images[id];
  await write(client, images, dismissed ? { 'dev.relay.dismissed': dismissed } : {});
}

/**
 * Mirror the WhatsApp favorite stickers that the (patched) local bridge collected into this pack:
 * new favorites are added, ones unfavorited on the phone are removed.
 */
export async function importWhatsAppFavorites(client) {
  const list = await window.relay?.local?.favoriteStickers?.();
  if (!list?.length) return;
  const byKey = new Map();
  for (const s of list) {
    const prev = byKey.get(s.key);
    // The same sticker can be on several accounts: favorite on any of them counts.
    if (!prev || (s.favorite && s.mxc && !(prev.favorite && prev.mxc)) || (!prev.favorite && s.ts > prev.ts)) byKey.set(s.key, s);
  }
  const c = pack(client);
  const images = c.images;
  let dismissed = c['dev.relay.dismissed'] || [];
  let changed = false;
  for (const [key, s] of byKey) {
    const id = `wa:${key}`;
    if (s.favorite && s.mxc) {
      if (!images[id] && !dismissed.includes(key)) {
        images[id] = {
          url: s.mxc, body: 'Sticker', usage: ['sticker'], 'dev.relay.added': s.ts, 'dev.relay.wa': key,
          info: { mimetype: s.mimetype || 'image/webp', w: s.w, h: s.h, size: s.size },
        };
        changed = true;
      }
    } else if (!s.favorite) {
      if (images[id]) { delete images[id]; changed = true; }
      if (dismissed.includes(key)) { dismissed = dismissed.filter((k) => k !== key); changed = true; }
    }
  }
  if (changed) await write(client, images, { 'dev.relay.dismissed': dismissed });
}

// ---- Recent: stickers I sent, from Relay or (via the bridges) from the phone ----

const RECENT_KEY = 'relay.recentStickers';
const localRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } };

function rememberRecent(sticker) {
  const list = [{ url: sticker.url, body: sticker.body, info: sticker.info, ts: Date.now() }, ...localRecent().filter((s) => s.url !== sticker.url)].slice(0, 40);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch {}
}

/** Newest first, one entry per sticker. */
export function recentStickers(client, limit = 32) {
  const me = client.getUserId();
  const found = [...localRecent()];
  for (const room of client.getRooms()) {
    for (const ev of room.getLiveTimeline().getEvents()) {
      if (ev.getType() !== EventType.Sticker || ev.getSender() !== me || ev.isRedacted()) continue;
      const c = ev.getContent();
      if (c.url) found.push({ url: c.url, body: c.body || 'Sticker', info: c.info || {}, ts: ev.getTs() });
    }
  }
  found.sort((a, b) => b.ts - a.ts);
  // The same sticker sent twice from the phone gets two uploads: match on size + dimensions too.
  const seen = new Set();
  const out = [];
  for (const s of found) {
    const k = s.info?.size && s.info?.w ? `${s.info.size}:${s.info.w}x${s.info.h}` : s.url;
    if (seen.has(s.url) || seen.has(k)) continue;
    seen.add(s.url); seen.add(k);
    out.push({ id: `recent:${s.url}`, ...s });
    if (out.length >= limit) break;
  }
  return out;
}

export async function sendSticker(client, roomId, sticker, replyTo = null) {
  rememberRecent(sticker);
  const info = { ...sticker.info };
  delete info['dev.relay.source'];
  const content = { body: sticker.body, url: sticker.url, info };
  if (replyTo) content['m.relates_to'] = { 'm.in_reply_to': { event_id: replyTo.getId() } };
  return client.sendEvent(roomId, EventType.Sticker, content);
}
