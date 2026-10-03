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
    .map(([id, img]) => ({ id, url: img.url, body: img.body || 'Sticker', info: img.info || {}, added: img['dev.relay.added'] || 0 }))
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

async function write(client, images) {
  const c = pack(client);
  await client.setAccountData(TYPE, { ...c, pack: c.pack || { display_name: 'My stickers' }, images });
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
  const images = pack(client).images;
  delete images[id];
  await write(client, images);
}

export async function sendSticker(client, roomId, sticker, replyTo = null) {
  const info = { ...sticker.info };
  delete info['dev.relay.source'];
  const content = { body: sticker.body, url: sticker.url, info };
  if (replyTo) content['m.relates_to'] = { 'm.in_reply_to': { event_id: replyTo.getId() } };
  return client.sendEvent(roomId, EventType.Sticker, content);
}
