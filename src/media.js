import { useEffect, useState } from 'react';
import { MsgType } from 'matrix-js-sdk';
import { mediaUrl } from './matrix.js';

// In encrypted rooms, attachments are AES-CTR encrypted and the key travels
// inside the (end-to-end encrypted) message as `content.file`.
// https://spec.matrix.org/latest/client-server-api/#sending-encrypted-attachments

const b64 = {
  decode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  },
  encode(bytes) {
    let bin = '';
    for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
    return btoa(bin).replace(/=+$/, '');
  },
};

const blobCache = new Map(); // mxc -> Promise<objectURL>

/** Copy an image (blob: or http URL) to the clipboard as PNG, which every app can paste. */
export async function copyImage(url) {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close();
  const png = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

/** The media of a message as a Blob (decrypted when needed). */
export async function downloadBlob(client, content) {
  const mime = content?.info?.mimetype || 'application/octet-stream';
  if (content?.file) return fetch(await fetchDecrypted(client, content.file, mime)).then((r) => r.blob());
  const res = await fetch(mediaUrl(client, content?.url));
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  return new Blob([await res.arrayBuffer()], { type: mime });
}

async function fetchDecrypted(client, file, mimetype) {
  const res = await fetch(mediaUrl(client, file.url));
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const data = await res.arrayBuffer();

  const expected = file.hashes?.sha256;
  if (expected) {
    const actual = b64.encode(await crypto.subtle.digest('SHA-256', data));
    if (actual !== expected.replace(/=+$/, '')) throw new Error('Attachment hash mismatch');
  }
  const key = await crypto.subtle.importKey('jwk', file.key, { name: 'AES-CTR' }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-CTR', counter: b64.decode(file.iv), length: 64 }, key, data);
  return URL.createObjectURL(new Blob([plain], { type: mimetype || 'application/octet-stream' }));
}

/**
 * Resolve a message's media to a URL the <img>/<video> can load.
 * `thumb` asks for a thumbnail where one exists.
 */
export function useMedia(client, content, { thumb = false } = {}) {
  const info = content?.info || {};
  const file = thumb && info.thumbnail_file ? info.thumbnail_file : content?.file;
  const plainMxc = thumb && info.thumbnail_url ? info.thumbnail_url : content?.url;

  const initial = !file && plainMxc ? mediaUrl(client, plainMxc) : null;
  const [state, setState] = useState({ url: initial, error: null });

  useEffect(() => {
    if (!file) {
      setState({ url: plainMxc ? mediaUrl(client, plainMxc) : null, error: null });
      return;
    }
    let cancelled = false;
    let p = blobCache.get(file.url);
    if (!p) {
      p = fetchDecrypted(client, file, thumb ? info.thumbnail_info?.mimetype : info.mimetype);
      blobCache.set(file.url, p);
      p.catch(() => blobCache.delete(file.url));
    }
    setState({ url: null, error: null });
    p.then((url) => !cancelled && setState({ url, error: null }))
      .catch((error) => !cancelled && setState({ url: null, error }));
    return () => { cancelled = true; };
  }, [client, file?.url, plainMxc]);

  return state;
}

// ---------- Uploading ----------

async function encryptFile(buffer) {
  const key = await crypto.subtle.generateKey({ name: 'AES-CTR', length: 256 }, true, ['encrypt', 'decrypt']);
  const iv = new Uint8Array(16);
  crypto.getRandomValues(iv.subarray(0, 8)); // the low 64 bits are the counter and must start at 0
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-CTR', counter: iv, length: 64 }, key, buffer);
  const jwk = await crypto.subtle.exportKey('jwk', key);
  const sha = await crypto.subtle.digest('SHA-256', ciphertext);
  return {
    data: ciphertext,
    file: {
      v: 'v2',
      key: { kty: 'oct', alg: 'A256CTR', ext: true, k: jwk.k, key_ops: ['encrypt', 'decrypt'] },
      iv: b64.encode(iv),
      hashes: { sha256: b64.encode(sha) },
    },
  };
}

export async function imageInfo(file) {
  try {
    const bmp = await createImageBitmap(file);
    const info = { w: bmp.width, h: bmp.height };
    bmp.close();
    return info;
  } catch {
    return {};
  }
}

/** Size, duration and a JPEG poster frame (so the video has a preview on the phone). */
function videoInfo(file) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(file);
    const done = (info, thumb = null) => { URL.revokeObjectURL(url); resolve({ info, thumb }); };
    v.preload = 'auto';
    v.muted = true;
    v.onloadedmetadata = () => {
      const info = { w: v.videoWidth, h: v.videoHeight, duration: Math.round(v.duration * 1000) };
      v.onseeked = () => {
        try {
          const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
          const c = document.createElement('canvas');
          c.width = Math.round(v.videoWidth * scale);
          c.height = Math.round(v.videoHeight * scale);
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          c.toBlob((blob) => done(info, blob && { blob, w: c.width, h: c.height }), 'image/jpeg', 0.8);
        } catch { done(info); }
      };
      v.currentTime = Math.min(1, v.duration / 3 || 0);
    };
    v.onerror = () => done({});
    setTimeout(() => done({}), 15000);
    v.src = url;
  });
}

function msgtypeFor(mime = '') {
  if (mime.startsWith('image/')) return MsgType.Image;
  if (mime.startsWith('video/')) return MsgType.Video;
  if (mime.startsWith('audio/')) return MsgType.Audio;
  return MsgType.File;
}

/** Upload a File and build the m.room.message content for it. */
export async function uploadAttachment(client, room, file, onProgress, extra = {}) {
  const msgtype = extra.msgtype || msgtypeFor(file.type);
  const info = { mimetype: file.type || 'application/octet-stream', size: file.size };
  if (msgtype === MsgType.Image) Object.assign(info, await imageInfo(file));
  let thumb = null;
  if (msgtype === MsgType.Video) {
    const v = await videoInfo(file);
    Object.assign(info, v.info);
    thumb = v.thumb;
  }

  const encrypted = room.hasEncryptionStateEvent();
  if (thumb && !encrypted) {
    try {
      const { content_uri } = await client.uploadContent(thumb.blob, { name: 'thumbnail.jpg', type: 'image/jpeg' });
      info.thumbnail_url = content_uri;
      info.thumbnail_info = { mimetype: 'image/jpeg', size: thumb.blob.size, w: thumb.w, h: thumb.h };
    } catch {}
  }
  const content = { msgtype, body: file.name, filename: file.name, ...extra, info: { ...info, ...extra.info } };
  const progressHandler = onProgress ? ({ loaded, total }) => onProgress(loaded / total) : undefined;

  if (encrypted) {
    const { data, file: fileInfo } = await encryptFile(await file.arrayBuffer());
    const { content_uri } = await client.uploadContent(new Blob([data]), {
      type: 'application/octet-stream', includeFilename: false, progressHandler,
    });
    content.file = { ...fileInfo, url: content_uri };
  } else {
    const { content_uri } = await client.uploadContent(file, { name: file.name, type: info.mimetype, progressHandler });
    content.url = content_uri;
  }
  return content;
}
