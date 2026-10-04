// Automations: "when a message like this arrives, do that". Rules live in prefs.automations
// (this computer); Inbox runs them on every new incoming message before deciding to notify.
//
// { id, name, enabled,
//   when: { scope: 'any'|'dm'|'group'|'rooms', rooms: [roomId], networks: [id], sender: 'Ana',
//           words: 'urgente, socorro', kind: 'any'|'media'|'boleto'|'code'|'pix'|'link' },
//   then: { notify: 'normal'|'urgent'|'silent', folder: folderId|'', important, markRead, webhook: url, reply: text } }
import { MsgType, ReceiptType } from 'matrix-js-sdk';
import { getPrefs, setPref } from './prefs.js';
import { getFolders, saveFolders } from './organize.js';
import { senderName, cleanName, peopleCount, stripReplyFallback } from './matrix.js';
import { detectNetwork, networkInfo } from './networks.js';

export const TAG_IMPORTANT = 'u.relay.important';

export const newRule = () => ({
  id: `a${Math.random().toString(36).slice(2, 9)}`, name: '', enabled: true,
  when: { scope: 'any', rooms: [], networks: [], sender: '', words: '', kind: 'any' },
  then: { notify: 'normal', folder: '', important: false, markRead: false, webhook: '', reply: '' },
});

export const KINDS = [
  { id: 'any', label: 'Any message' },
  { id: 'media', label: 'Photo, video, audio or file' },
  { id: 'boleto', label: 'Boleto (bank slip)' },
  { id: 'pix', label: 'Pix' },
  { id: 'code', label: 'Verification code' },
  { id: 'link', label: 'Link' },
];

/** Ready-made rules to start from. */
export const TEMPLATES = [
  { emoji: '🚨', title: 'Urgent breaks the silence', sub: 'A message saying “urgent” or “emergency” notifies even in a muted chat',
    rule: { name: 'Urgent breaks the silence', when: { words: 'urgent, emergency, urgente, socorro' }, then: { notify: 'urgent' } } },
  { emoji: '💸', title: 'Bills into a folder', sub: 'Every boleto that arrives goes into a “Bills” folder',
    rule: { name: 'Bills into a folder', when: { kind: 'boleto' }, then: { folder: '__bills' } } },
  { emoji: '🔕', title: 'Quiet codes', sub: 'Verification codes don’t notify and are marked read',
    rule: { name: 'Quiet codes', when: { kind: 'code' }, then: { notify: 'silent', markRead: true } } },
  { emoji: '🔗', title: 'Send to a webhook', sub: 'Forward a chat’s messages to n8n, Zapier or anything else',
    rule: { name: 'Webhook', when: { scope: 'rooms' }, then: { webhook: 'https://' } } },
];

export const fromTemplate = (t) => {
  const r = newRule();
  return { ...r, name: t.rule.name, when: { ...r.when, ...t.rule.when }, then: { ...r.then, ...t.rule.then } };
};

export const getRules = () => getPrefs().automations || [];
export const saveRules = (rules) => setPref('automations', rules);

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Boleto "linha digitável": 47 (bank) or 48 (utility) digits, usually dotted and spaced.
// Verification codes: a 4–8 digit number near a word like code / código / senha / verification.
const CODE_HINT = /(c[óo]digo|code|senha|password|passcode|token|verifica[çc][ãa]o|verification|verify|otp|pin)/i;
const BOLETO = /\b\d{5}\.?\d{5}\s?\d{5}\.?\d{6}\s?\d{5}\.?\d{6}\s?\d\s?\d{14}\b|\b\d{11,12}[\s-]?\d{11,12}[\s-]?\d{11,12}[\s-]?\d{11,12}\b/;

function kindMatches(kind, content, text, ts) {
  if (!kind || kind === 'any') return true;
  const mt = content.msgtype;
  const isMedia = [MsgType.Image, MsgType.Video, MsgType.Audio, MsgType.File].includes(mt);
  if (kind === 'media') return isMedia;
  if (kind === 'boleto') return BOLETO.test(text) || /\bboleto\b/i.test(text) || (mt === MsgType.File && /boleto/i.test(content.body || content.filename || ''));
  if (kind === 'link') return /https?:\/\/\S+/.test(text);
  if (kind === 'pix') return /br\.gov\.bcb\.pix/i.test(text) || /\bpix\b/i.test(text);
  if (kind === 'code') return CODE_HINT.test(text) && /(?:^|\D)(?:\d{3}[- ]\d{3}|\d{4,8})(?!\d)/.test(text);
  return false;
}

export function ruleMatches(rule, { room, ev, content, text, group, network, sender }) {
  const w = rule.when || {};
  if (w.scope === 'dm' && group) return false;
  if (w.scope === 'group' && !group) return false;
  if (w.scope === 'rooms' && !(w.rooms || []).includes(room.roomId)) return false;
  if (w.networks?.length && !w.networks.includes(network)) return false;
  if (w.sender?.trim() && !fold(sender).includes(fold(w.sender.trim()))) return false;
  const words = (w.words || '').split(',').map((x) => fold(x.trim())).filter(Boolean);
  if (words.length && !words.some((x) => fold(text).includes(x))) return false;
  return kindMatches(w.kind, content, text, ev.getTs());
}

// Auto replies: at most one per chat every 6 hours, so two automations can't ping-pong.
const REPLY_GAP = 6 * 3600e3;
const replied = (() => { try { return JSON.parse(localStorage.getItem('relay.autoReplied') || '{}'); } catch { return {}; } })();

const hits = (() => { try { return JSON.parse(localStorage.getItem('relay.autoHits') || '{}'); } catch { return {}; } })();
export const ruleHits = (id) => hits[id] || null;
function countHit(id) {
  hits[id] = { n: (hits[id]?.n || 0) + 1, at: Date.now() };
  try { localStorage.setItem('relay.autoHits', JSON.stringify(hits)); } catch {}
}

async function addToFolder(client, room, folderId) {
  let folders = getFolders(client);
  let id = folderId;
  if (id === '__bills') { // template: a "Bills" folder, created the first time
    let f = folders.find((x) => x.name === 'Bills');
    if (!f) { f = { id: `f${Math.random().toString(36).slice(2, 9)}`, name: 'Bills', icon: '💰', rules: {}, include: [], exclude: [] }; folders = [...folders, f]; }
    id = f.id;
  }
  const f = folders.find((x) => x.id === id);
  if (!f || (f.include || []).includes(room.roomId)) return;
  await saveFolders(client, folders.map((x) => (x.id === id ? { ...x, include: [...(x.include || []), room.roomId], exclude: (x.exclude || []).filter((r) => r !== room.roomId) } : x)));
}

/**
 * Runs every enabled rule on an incoming message. Returns what it means for the notification:
 * { urgent, silent, matched: [names] }.
 */
export async function runAutomations(client, room, ev) {
  const rules = getRules().filter((r) => r.enabled !== false);
  if (!rules.length) return { urgent: false, silent: false, matched: [] };
  const content = ev.getContent() || {};
  const text = stripReplyFallback(content.body || '');
  const ctx = {
    room, ev, content, text,
    group: peopleCount(room) > 2,
    network: detectNetwork(room),
    sender: cleanName(senderName(room, ev.getSender())),
  };
  const out = { urgent: false, silent: false, matched: [] };
  for (const rule of rules) {
    let ok = false;
    try { ok = ruleMatches(rule, ctx); } catch {}
    if (!ok) continue;
    out.matched.push(rule.name || 'Automation');
    countHit(rule.id);
    const t = rule.then || {};
    if (t.notify === 'urgent') out.urgent = true;
    if (t.notify === 'silent') out.silent = true;
    if (t.markRead) {
      const type = getPrefs().readReceipts === false ? ReceiptType.ReadPrivate : ReceiptType.Read;
      client.sendReadReceipt(ev, type).catch(() => {});
    }
    if (t.important && ctx.group && !room.tags?.[TAG_IMPORTANT]) client.setRoomTag(room.roomId, TAG_IMPORTANT, { order: 0.5 }).catch(() => {});
    if (t.folder) addToFolder(client, room, t.folder).catch(() => {});
    if (t.webhook && /^https?:\/\/.+\..+/.test(t.webhook)) {
      window.relay?.auto?.webhook(t.webhook, {
        rule: rule.name, chat: cleanName(room.name || ''), chatId: room.roomId, group: ctx.group,
        network: networkInfo(ctx.network).name, sender: ctx.sender, senderId: ev.getSender(),
        text, type: content.msgtype, ts: ev.getTs(), eventId: ev.getId(),
      }).catch(() => {});
    }
    if (t.reply?.trim() && Date.now() - (replied[room.roomId] || 0) > REPLY_GAP) {
      replied[room.roomId] = Date.now();
      try { localStorage.setItem('relay.autoReplied', JSON.stringify(replied)); } catch {}
      client.sendMessage(room.roomId, { msgtype: MsgType.Text, body: t.reply.trim(), 'dev.relay.auto_reply': true }).catch(() => {});
    }
  }
  if (out.urgent) out.silent = false; // "urgent" wins over "silent"
  return out;
}
