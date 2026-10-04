import {
  createClient,
  AutoDiscovery,
  IndexedDBStore,
  EventType,
  MsgType,
  RelationType,
} from 'matrix-js-sdk';
import { decodeRecoveryKey } from 'matrix-js-sdk/lib/crypto-api/index.js';
import { igPreview } from './igshare.js';

const DB_NAME = 'relay-sync';
const CRYPTO_PREFIX = 'relay-crypto';

// ---------- Login ----------

function normalizeUrl(url) {
  url = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url)) url = 'https://' + url;
  return url;
}

/** Find the homeserver base URL from a domain using .well-known, falling back to the domain itself. */
export async function resolveHomeserver(input) {
  const domain = input.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  try {
    const cfg = await AutoDiscovery.findClientConfig(domain);
    const hs = cfg['m.homeserver'];
    if (hs?.state === AutoDiscovery.SUCCESS && hs.base_url) return normalizeUrl(hs.base_url);
  } catch {}
  return normalizeUrl(input);
}

/** Work out which homeserver to talk to from whatever the user typed. */
export async function homeserverFor({ homeserver, user }) {
  if (homeserver?.trim()) return resolveHomeserver(homeserver);
  const m = /^@[^:]+:(.+)$/.exec(user.trim());
  if (m) return resolveHomeserver(m[1]);
  throw new Error('Enter a homeserver, or a full user ID like @you:example.com');
}

export async function loginWithPassword({ homeserver, user, password }) {
  const baseUrl = await homeserverFor({ homeserver, user });
  const tmp = createClient({ baseUrl });
  const res = await tmp.loginRequest({
    type: 'm.login.password',
    identifier: { type: 'm.id.user', user: user.trim() },
    password,
    initial_device_display_name: `Relay (${navigator.platform || 'desktop'})`,
  });
  return {
    baseUrl: res.well_known?.['m.homeserver']?.base_url ? normalizeUrl(res.well_known['m.homeserver'].base_url) : baseUrl,
    accessToken: res.access_token,
    userId: res.user_id,
    deviceId: res.device_id,
  };
}

/** For SSO-only servers: paste an access token from another client. */
export async function loginWithToken({ homeserver, accessToken }) {
  const baseUrl = await resolveHomeserver(homeserver);
  const tmp = createClient({ baseUrl, accessToken: accessToken.trim() });
  const who = await tmp.whoami();
  if (!who.device_id) throw new Error('This token has no device ID, so encryption won’t work. Generate a fresh token.');
  return { baseUrl, accessToken: accessToken.trim(), userId: who.user_id, deviceId: who.device_id };
}

// ---------- Client lifecycle ----------

export async function startClient(session) {
  const store = new IndexedDBStore({ indexedDB: window.indexedDB, dbName: DB_NAME, localStorage: window.localStorage });
  await store.startup();

  const client = createClient({
    baseUrl: session.baseUrl,
    accessToken: session.accessToken,
    userId: session.userId,
    deviceId: session.deviceId,
    store,
    timelineSupport: true,
    cryptoCallbacks: {
      // Only answered while the user is entering their recovery key.
      getSecretStorageKey: async ({ keys }) => {
        if (!pendingSecretKey) return null;
        const id = (await client.secretStorage.getDefaultKeyId()) || Object.keys(keys)[0];
        return [id, pendingSecretKey];
      },
    },
  });

  try {
    await client.initRustCrypto({ cryptoDatabasePrefix: CRYPTO_PREFIX });
  } catch (err) {
    console.warn('End-to-end encryption unavailable:', err);
  }

  await client.startClient({ initialSyncLimit: 20, lazyLoadMembers: true });
  return client;
}

// ---------- Encryption: recovery key ----------

let pendingSecretKey = null;

/** Is this device trusted by the user's other sessions? */
export async function encryptionStatus(client) {
  const crypto = client.getCrypto();
  if (!crypto) return { available: false };
  const [status, hasBackupStorage] = await Promise.all([
    crypto.getDeviceVerificationStatus(client.getUserId(), client.getDeviceId()),
    crypto.isSecretStorageReady().catch(() => false),
  ]);
  return { available: true, verified: !!status?.crossSigningVerified, hasBackupStorage };
}

/**
 * Use the recovery key (a.k.a. security key) from Element/Beeper to verify
 * this device and download the message key backup, so old encrypted messages decrypt.
 */
export async function recoverWithKey(client, recoveryKey) {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error('Encryption is not available in this session.');
  let key;
  try { key = decodeRecoveryKey(recoveryKey.trim()); }
  catch { throw new Error('That doesn’t look like a recovery key.'); }

  const keyId = await client.secretStorage.getDefaultKeyId();
  if (!keyId) throw new Error('Your account has no recovery set up. Set it up in Element or Beeper first.');
  const info = (await client.secretStorage.getKey(keyId))?.[1];
  if (info && !(await client.secretStorage.checkKey(key, info))) throw new Error('Wrong recovery key.');

  pendingSecretKey = key;
  try {
    await crypto.bootstrapCrossSigning({}); // pulls cross-signing keys from secret storage and signs this device
    await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
    await crypto.checkKeyBackupAndEnable();
    return await crypto.restoreKeyBackup();
  } finally {
    pendingSecretKey = null;
  }
}

export async function signOut(client) {
  try { await client.logout(true); } catch {}
  client.stopClient();
  try { await client.clearStores({ cryptoDatabasePrefix: CRYPTO_PREFIX }); } catch {}
}

// ---------- Helpers ----------

export function mediaUrl(client, mxc, size) {
  if (!mxc || !mxc.startsWith('mxc://')) return null;
  return size
    ? client.mxcUrlToHttp(mxc, size, size, 'crop', false, true, true)
    : client.mxcUrlToHttp(mxc, undefined, undefined, undefined, false, true, true);
}

export function roomAvatar(client, room, size = 96) {
  const own = room.getMxcAvatarUrl();
  if (own) return mediaUrl(client, own, size);
  const member = room.getAvatarFallbackMember();
  const mxc = member?.getMxcAvatarUrl();
  return mxc ? mediaUrl(client, mxc, size) : null;
}

export function memberAvatar(client, room, userId, size = 64) {
  const mxc = room.getMember(userId)?.getMxcAvatarUrl();
  return mxc ? mediaUrl(client, mxc, size) : null;
}

/** Tidy bridged names: drop network suffixes and space out Brazilian phone numbers. */
export function cleanName(name = '') {
  name = name.replace(/\s*\((WA|WhatsApp|Telegram|TG|Discord)\)$/, '');
  const br = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(name);
  return br ? `+55 ${br[1]} ${br[2]}-${br[3]}` : name;
}

export function senderName(room, userId) {
  const m = room.getMember(userId);
  return cleanName(m?.rawDisplayName || m?.name || userId);
}

const BOT = /^@[a-z]+bot:/;

/** Joined people in a room, not counting bridge bots. */
export function peopleCount(room) {
  return room.getJoinedMembers().filter((m) => !BOT.test(m.userId)).length;
}

const DISPLAYABLE = new Set([EventType.RoomMessage, EventType.Sticker, EventType.RoomMessageEncrypted]);

/** True for events that show up as bubbles in the timeline. */
export function isDisplayable(ev) {
  if (!DISPLAYABLE.has(ev.getType())) return false;
  if (ev.getRelation()?.rel_type === RelationType.Replace) return false; // edits are folded into the original
  return true;
}

export function isState(ev) {
  return ev.isState() && [EventType.RoomMember, EventType.RoomName, EventType.RoomTopic, EventType.RoomAvatar].includes(ev.getType());
}

export function previewText(room, ev, myUserId) {
  if (!ev) return '';
  if (ev.isRedacted()) return 'Message deleted';
  if (ev.isDecryptionFailure?.()) return '🔒 Unable to decrypt';
  if (ev.getType() === EventType.RoomMessageEncrypted) return '🔒 Encrypted message';
  const c = ev.getContent();
  const who = ev.getSender() === myUserId ? 'You' : null;
  let text;
  if (ev.getType() === EventType.Sticker) text = 'Sticker';
  else if (c['dev.relay.view_once'] || (c.msgtype === MsgType.Notice && /view once message/i.test(c.body || ''))) text = '① View once message';
  else switch (c.msgtype) {
    case MsgType.Image: text = '📷 Photo'; break;
    case MsgType.Video: text = '🎥 Video'; break;
    case MsgType.Audio: text = '🎤 Audio'; break;
    case MsgType.File: text = `📎 ${c.body || 'File'}`; break;
    case MsgType.Emote: text = `* ${senderName(room, ev.getSender())} ${c.body}`; break;
    case 'm.location': text = '📍 Location'; break;
    default: text = igPreview(c.body || '', room.client?.getUser?.(myUserId)?.displayName) || (c.body || '').replace(/\s*\((WA|WhatsApp|TG|Telegram|Discord)\)/g, '');
  }
  // Group chats show who sent the last message.
  const isGroup = peopleCount(room) > 2;
  if (who) return `You: ${text}`;
  if (isGroup && c.msgtype !== MsgType.Emote) {
    const name = senderName(room, ev.getSender());
    return `${name.startsWith('+') ? name : name.split(' ')[0]}: ${text}`;
  }
  return text;
}

export function lastMessage(room) {
  const events = room.getLiveTimeline().getEvents();
  for (let i = events.length - 1; i >= 0; i--) {
    if (isDisplayable(events[i])) return events[i];
  }
  return null;
}

/** Latest content for a message, taking edits into account. */
export function effectiveContent(ev) {
  const replacing = ev.replacingEvent?.();
  if (replacing) return replacing.getContent()['m.new_content'] || ev.getContent();
  return ev.getContent();
}

export function replyToId(ev) {
  return ev.getContent()['m.relates_to']?.['m.in_reply_to']?.event_id || null;
}

/** Strip the legacy "> <@user> quoted text" fallback that replies carry. */
export function stripReplyFallback(body = '') {
  const lines = body.split('\n');
  while (lines.length && lines[0].startsWith('> ')) lines.shift();
  if (lines[0] === '') lines.shift();
  return lines.join('\n');
}

export function reactionsFor(room, ev) {
  const timelineSet = room.getUnfilteredTimelineSet();
  const rels = timelineSet.relations?.getChildEventsForEvent(ev.getId(), RelationType.Annotation, EventType.Reaction);
  if (!rels) return [];
  return rels.getSortedAnnotationsByKey()?.map(([key, events]) => ({
    key,
    count: events.size,
    senders: [...events].map((e) => e.getSender()),
    mine: [...events].find((e) => e.getSender() === room.client.getUserId() && !e.isRedacted()),
  })).filter((r) => r.count > 0) ?? [];
}

export function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const diffDays = (now - d) / 86400000;
  if (diffDays < 6) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function formatDay(ts) {
  const d = new Date(ts);
  const now = new Date();
  const yesterday = new Date(now - 86400000);
  if (d.toDateString() === now.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export function formatBytes(n) {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}
