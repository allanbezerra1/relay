// WhatsApp "power features": polls, disappearing messages, group admin, contact info and
// broadcast lists. Everything here goes through what mautrix-whatsapp understands:
//   - polls: MSC3381 events (org.matrix.msc3381.poll.start / .response), see pkg/msgconv/matrixpoll.go
//   - disappearing messages: the com.beeper.disappearing_timer state event (24 h / 7 d / 90 d)
//   - group name / description / photo, add / remove people: plain Matrix state & membership
//   - promote / demote, invite links, "only admins" settings, about text and blocking: the patched
//     bridge (`!wa sync relay …`, resources/whatsapp-sync-login.patch r10), reached through
//     window.relay.local.waPower. Without it those controls are hidden.

export const POLL_START = 'org.matrix.msc3381.poll.start';
export const POLL_RESPONSE = 'org.matrix.msc3381.poll.response';
export const TIMER_EVENT = 'com.beeper.disappearing_timer';
export const POLL_MAX_OPTIONS = 12; // capabilities.go: PollMaxOptions
export const POLL_OPTION_MAX = 100; // PollOptionMaxLength

const BOT = /^@[a-z]+bot:/;

// ---------- Which WhatsApp chat is this? ----------

/** The bridge's channel ID (the WhatsApp JID) from the room's m.bridge state, or null. */
export function waChannel(room) {
  for (const type of ['m.bridge', 'uk.half-shot.bridge']) {
    for (const ev of room?.currentState?.getStateEvents(type) || []) {
      const c = ev.getContent();
      if (c?.protocol?.id === 'whatsapp' && c.channel?.id) return String(c.channel.id);
    }
  }
  return null;
}

/** 'group' | 'dm' | 'status' | null for rooms that aren't WhatsApp chats. */
export function waKind(room, network) {
  const ch = waChannel(room);
  if (ch) {
    if (ch.endsWith('@g.us')) return 'group';
    if (ch === 'status@broadcast') return 'status';
    if (ch.endsWith('@s.whatsapp.net') || ch.endsWith('@lid')) return 'dm';
    return null;
  }
  if (!/^whatsapp/.test(network || '')) return null;
  const people = room.getJoinedMembers().filter((m) => !BOT.test(m.userId)).length;
  return people > 2 ? 'group' : 'dm';
}

/** The other person in a 1:1 chat (their bridge ghost), or null. */
export function dmPartner(room, me) {
  const others = room.getJoinedMembers().filter((m) => m.userId !== me && !BOT.test(m.userId));
  if (others.length === 1) return others[0].userId;
  const inviter = room.getDMInviter?.();
  return inviter && inviter !== me ? inviter : null;
}

/** Phone number from a ghost ID like @whatsapp_15551234567:server (not for @whatsapp_lid-…). */
export function ghostPhone(userId) {
  const m = /^@whatsapp_(\d{8,15}):/.exec(userId || '');
  return m ? m[1] : null;
}

/** "+1 555 123-4567", "+55 11 98765-4321"; other countries in loose groups of digits. */
export function formatPhone(digits) {
  if (!digits) return '';
  const d = String(digits).replace(/\D/g, '');
  const us = /^1(\d{3})(\d{3})(\d{4})$/.exec(d);
  if (us) return `+1 ${us[1]} ${us[2]}-${us[3]}`;
  const br = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(d);
  if (br) return `+55 ${br[1]} ${br[2]}-${br[3]}`;
  return `+${d.replace(/(\d{2,3})(?=(\d{4})+$)/, '$1 ').replace(/(\d{4})(?=\d)/g, '$1 ')}`.trim();
}

// ---------- Patched bridge calls ----------

/** Run one `sync relay` operation: { ok, … }, or { ok: false, unsupported } without the patched bridge. */
export async function waPower(op, ...args) {
  const api = window.relay?.local?.waPower;
  if (!api) return { ok: false, unsupported: true };
  try {
    return (await api(op, args)) || { ok: false, error: 'No answer' };
  } catch (err) {
    return { ok: false, error: String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') };
  }
}

/** Whether the patched WhatsApp bridge is installed and running (a local check, no bridge round trip). */
export async function probePower() {
  if (!window.relay?.local?.waPower) return false;
  return !!(await waPower('probe')).ok;
}

/** WhatsApp's participant error codes, in words. */
export function participantError(code, invite) {
  if (!code) return null;
  if (code === 403 || invite) return 'Their privacy settings don’t allow you to add them. Send them the invite link instead.';
  if (code === 408) return 'They left the group recently and can’t be added back yet.';
  if (code === 409) return 'They’re already in the group.';
  if (code === 401) return 'They blocked you, or you’re not allowed to do that.';
  if (code === 404) return 'They’re not in the group.';
  if (code === 406) return 'They can’t be added (invalid number or not on WhatsApp).';
  if (code === 500) return 'The group is full.';
  return `WhatsApp refused (code ${code}).`;
}

// ---------- Power levels (WhatsApp admins are PL 50, the creator 75: chatinfo.go) ----------

export function powerLevels(room) {
  return room.currentState.getStateEvents('m.room.power_levels', '')?.getContent() || {};
}
export function userLevel(room, userId) {
  const pl = powerLevels(room);
  return pl.users?.[userId] ?? pl.users_default ?? 0;
}
export function eventLevel(room, type, state = true) {
  const pl = powerLevels(room);
  return pl.events?.[type] ?? (state ? pl.state_default ?? 50 : pl.events_default ?? 0);
}
export function canSendState(room, userId, type) {
  return userLevel(room, userId) >= eventLevel(room, type, true);
}
/** WhatsApp group settings as the bridge mirrors them into power levels. */
export function groupSettings(room) {
  const pl = powerLevels(room);
  return {
    announce: (pl.events_default ?? 0) >= 50, // "Only admins can send messages"
    locked: (pl.events?.['m.room.name'] ?? 0) >= 50, // "Only admins can edit group info"
  };
}

// ---------- Disappearing messages ----------

const H = 3600 * 1000;
export const TIMERS = [
  { ms: 0, label: 'Off', short: 'Off' },
  { ms: 24 * H, label: '24 hours', short: '24h' },
  { ms: 7 * 24 * H, label: '7 days', short: '7d' },
  { ms: 90 * 24 * H, label: '90 days', short: '90d' },
];

export function timerLabel(ms) {
  const t = TIMERS.find((x) => x.ms === ms);
  if (t) return t.label;
  if (ms >= 86400000) { const d = Math.round(ms / 86400000); return `${d} day${d > 1 ? 's' : ''}`; }
  if (ms >= H) { const h = Math.round(ms / H); return `${h} hour${h > 1 ? 's' : ''}`; }
  const m = Math.max(1, Math.round(ms / 60000));
  return `${m} minute${m > 1 ? 's' : ''}`;
}

/** The room's current timer in ms (0 = off). */
export function roomTimer(room) {
  const c = room?.currentState?.getStateEvents(TIMER_EVENT, '')?.getContent();
  return c?.type && c.timer > 0 ? c.timer : 0;
}

export function setRoomTimer(client, roomId, ms) {
  return client.sendStateEvent(roomId, TIMER_EVENT, ms ? { type: 'after_send', timer: ms } : {}, '');
}

/** For a timer state event that changed something: { ms, label }; otherwise null. */
export function timerChange(ev) {
  if (ev.getType() !== TIMER_EVENT || !ev.isState()) return null;
  const c = ev.getContent() || {};
  const ms = c.type && c.timer > 0 ? c.timer : 0;
  const prev = ev.getPrevContent?.() || {};
  const prevMs = prev.type && prev.timer > 0 ? prev.timer : 0;
  const hadPrev = !!ev.getUnsigned?.()?.prev_content;
  if (ms === prevMs && hadPrev) return null;
  if (!ms && !hadPrev) return null; // "off" as the initial state: nothing to say
  return { ms, label: ms ? `Disappearing messages on: ${timerLabel(ms)}` : 'Disappearing messages off' };
}

/** The bridge's own "Set the disappearing message timer to …" notice (drawn as the state line instead). */
export function isTimerNotice(ev) {
  return ev.getContent()?.['com.beeper.action_message']?.type === 'disappearing_timer';
}

/** Whether a message will disappear: it says so itself, or it's yours and was sent with a timer on. */
export function expiresIn(room, ev, content) {
  const own = content?.[TIMER_EVENT];
  if (own?.timer > 0) return own.timer;
  if (ev.getSender() !== room.client?.getUserId()) return 0;
  const state = room.currentState.getStateEvents(TIMER_EVENT, '');
  const ms = roomTimer(room);
  return ms && state && ev.getTs() >= state.getTs() ? ms : 0;
}

// ---------- Polls ----------

const text1767 = (m) => {
  if (!m) return '';
  if (typeof m === 'string') return m;
  if (m['org.matrix.msc1767.text']) return m['org.matrix.msc1767.text'];
  if (m['m.text']) return Array.isArray(m['m.text']) ? m['m.text'][0]?.body || '' : m['m.text'];
  const list = m['org.matrix.msc1767.message'];
  if (Array.isArray(list)) return (list.find((x) => !x.mimetype || x.mimetype === 'text/plain') || list[0])?.body || '';
  return m.body || '';
};

/** { question, answers: [{ id, text }], max, multiple } for a poll start event, else null. */
export function pollOf(ev, content = ev.getContent()) {
  const p = content?.[POLL_START] || content?.['m.poll'];
  if (!p || !Array.isArray(p.answers)) return null;
  const answers = p.answers.map((a) => ({ id: String(a.id), text: text1767(a) })).filter((a) => a.id);
  if (!answers.length) return null;
  const max = Number(p.max_selections) > 0 ? Math.min(Number(p.max_selections), answers.length) : 1;
  return { question: text1767(p.question), answers, max, multiple: max > 1 };
}

/** Latest vote per person: Map(userId -> { answers: [ids], ts, pending }). */
export function pollVotes(room, pollId) {
  const seen = new Map();
  const consider = (e) => {
    if (!e || e.isRedacted?.()) return;
    if (e.getType() !== POLL_RESPONSE && e.getType() !== 'm.poll.response') return;
    const c = e.getContent();
    if (c?.['m.relates_to']?.event_id !== pollId) return;
    const r = c[POLL_RESPONSE] || c['m.selections'] || {};
    const answers = Array.isArray(r) ? r : Array.isArray(r.answers) ? r.answers : [];
    const id = e.getId() || e.getTxnId?.();
    seen.set(id, { sender: e.getSender(), answers: answers.map(String), ts: e.getTs(), pending: !!e.status });
  };
  try {
    const rels = room.getUnfilteredTimelineSet().relations?.getChildEventsForEvent(pollId, 'm.reference', POLL_RESPONSE);
    rels?.getRelations().forEach(consider);
  } catch { /* relations not loaded */ }
  for (const e of room.getLiveTimeline().getEvents()) consider(e);
  const out = new Map();
  for (const v of seen.values()) {
    const cur = out.get(v.sender);
    if (!cur || v.ts >= cur.ts) out.set(v.sender, v);
  }
  return out;
}

/** { counts: Map(answerId -> n), voters: Map(answerId -> [userId]), total, people, mine: [ids] } */
export function pollTally(room, poll, pollId, me) {
  const votes = pollVotes(room, pollId);
  const valid = new Set(poll.answers.map((a) => a.id));
  const counts = new Map(poll.answers.map((a) => [a.id, 0]));
  const voters = new Map(poll.answers.map((a) => [a.id, []]));
  let people = 0;
  let total = 0;
  for (const [user, v] of votes) {
    const picks = [...new Set(v.answers.filter((a) => valid.has(a)))].slice(0, poll.max);
    if (!picks.length) continue;
    people++;
    for (const a of picks) { counts.set(a, counts.get(a) + 1); voters.get(a).push(user); total++; }
  }
  const mine = votes.get(me)?.answers.filter((a) => valid.has(a)) || [];
  return { counts, voters, total, people, mine };
}

export function sendPoll(client, roomId, { question, options, multiple }) {
  const answers = options.map((text, i) => ({ id: `opt${i + 1}-${Math.random().toString(36).slice(2, 7)}`, 'org.matrix.msc1767.text': text }));
  const fallback = `${question}\n${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}`;
  return client.sendEvent(roomId, POLL_START, {
    [POLL_START]: {
      kind: 'org.matrix.msc3381.poll.disclosed',
      max_selections: multiple ? options.length : 1,
      question: { 'org.matrix.msc1767.text': question },
      answers,
    },
    'org.matrix.msc1767.text': fallback,
    body: fallback,
  });
}

/**
 * Vote (or clear your vote with an empty list). WhatsApp keeps only your latest vote. The bridge
 * maps answer IDs back to WhatsApp's option hashes (polls from WhatsApp use the hex hashes as IDs).
 */
export function sendVote(client, roomId, pollId, answers) {
  return client.sendEvent(roomId, POLL_RESPONSE, {
    'm.relates_to': { rel_type: 'm.reference', event_id: pollId },
    [POLL_RESPONSE]: { answers },
  });
}

// ---------- Broadcast lists (account data) ----------

export const LISTS_KEY = 'dev.relay.broadcast_lists';

export function broadcastLists(client) {
  return client.getAccountData(LISTS_KEY)?.getContent()?.lists || [];
}

export function saveBroadcastLists(client, lists) {
  return client.setAccountData(LISTS_KEY, { lists });
}

