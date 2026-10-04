// Triage: which chats are waiting on you ("Reply"), which are waiting on someone else
// ("Waiting"), and which were just FYI. Quick rules decide at once; the local AI (when it's
// running) then double-checks the doubtful ones and writes a one-line reason
// ("Ana asked if you're coming on Saturday").
import { useEffect, useSyncExternalStore } from 'react';
import { MsgType, EventType } from 'matrix-js-sdk';
import { stripReplyFallback, replyToId, senderName, cleanName, effectiveContent } from './matrix.js';
import { getPrefs } from './prefs.js';
import { streamChat, aiPrefs, aiAvailable, aiStatus, visibleText, guessLanguage } from './ai.js';
import { notificationSound } from './sounds.js';

const DAY = 864e5;
export const REPLY_DAYS = 7;    // an unanswered question older than this isn't a to-do anymore
export const WAITING_DAYS = 14;

// Lowercase, no accents ("você" → "voce", "mañana" → "manana"), so the patterns stay short.
const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// How a question or request usually starts, in English, Portuguese and Spanish.
const ASK_START = new RegExp(`^(${[
  // English
  'can (you|u|we|i)', 'could (you|u|we)', 'would (you|u)', 'will (you|u)', 'do (you|u)', 'did (you|u)', 'are (you|u)', 'have (you|u)',
  'is (it|there|that|this)', 'any (news|update|chance|idea)', 'anyone', 'anybody', 'what', 'when', 'where', 'who', 'why', 'how',
  'which', 'should (i|we)', 'shall we', 'want to', 'wanna', 'let\u2019?s', "let'?s", 'let me know', 'lmk',
  // Portuguese
  'e ai', 'pode', 'podes', 'poderia', 'consegue', 'conseguiria', 'vc pode', 'voce pode', 'vamos', 'bora', 'quer', 'topa', 'tem como', 'sabe',
  'sabia', 'vc vai', 'voce vai', 'vai\\b', 'qual', 'quais', 'quando', 'onde', 'quem', 'como', 'por que', 'porque', 'pq', 'quanto', 'alguem',
  'ja ', 'tu ', 'vc ', 'voce ',
  // Spanish
  'puedes', 'podes', 'podrias', 'puede', 'podria', 'quieres', 'queres', 'sabes', 'cuando', 'donde', 'quien', 'cual', 'cuanto', 'por que',
  'tienes', 'vienes', 'vas a', 'hay ', 'alguien', 'me (ayudas|pasas|mandas|dices|avisas)',
].join('|')})\\b`);

// A request anywhere in the message.
const REQUEST = new RegExp(`\\b(${[
  // English
  'please', 'pls', 'plz', 'let me know', 'lmk', 'send me', 'call me', 'text me', 'get back to me', 'need you to', 'can you', 'could you',
  'would you mind', 'take a look', 'waiting (for|on) your', 'your thoughts', 'what do you think', 'asap',
  // Portuguese
  'me (manda|envia|passa|liga|avisa|fala|diz|responde|retorna|chama)', 'responde', 'confirma', 'preciso que', 'precisava que', 'tem como',
  'consegue', 'da uma olhada', 'pode ver', 'aguardo (o seu |a sua |seu |sua )?retorno', 'me ajuda', 'por favor', 'pfv', 'pf',
  // Spanish
  '(enviame|mandame|pasame|llamame|avisame|dime|confirmame|ayudame|respondeme|escribeme)', 'porfa', 'necesito que', 'echale un vistazo',
  'espero tu (respuesta|confirmacion)', 'quedo atent[oa]', 'me confirmas',
].join('|')})\\b`);

// Messages that close a conversation rather than open one.
const ACK = new RegExp(`^(${[
  // English
  'ok+', 'okay', 'okie', 'k+', 'kk+', 'thanks?( a lot| so much)?', 'thank you( so much)?', 'thx', 'ty', 'tysm', 'cool', 'nice', 'great', 'perfect',
  'awesome', 'got it', 'sure', 'yes', 'yeah', 'yep', 'yup', 'no', 'nope', 'lol', 'lmao', 'ha(ha)+', 'np', 'no problem', 'no worries',
  'sounds good', 'will do', 'noted', 'done', 'alright', 'right', 'good morning', 'good night', 'gm', 'gn', 'see you', 'see ya', 'cheers', 'you too',
  // Portuguese
  'blz', 'beleza', 'valeu', 'vlw', 'obrigad[oa]', 'obg', 'brigad[oa]', 'tmj', 'show', 'top', 'perfeito', 'massa', 'otimo', 'kkk+', 'rs+',
  'sim', 'nao', 'certo', 'combinado', 'fechado', 'ta', 'ah+', 'entendi', 'boa', 'bom dia', 'boa noite', 'boa tarde', 'de nada', 'amem',
  'isso', 'exato', 'verdade', 'joia', 'uhum', 'aham', 'claro',
  // Spanish
  'vale', 'gracias', 'muchas gracias', 'perfecto', 'genial', 'listo', 'si', 'dale', 'bueno', 'buenos dias', 'buenas noches', 'buenas tardes',
  'buenas', 'entendido', 'exacto', 'va', 'sale', 'ja(ja)+', 'je(je)+', 'igualmente', 'de acuerdo', 'okis',
].join('|')})[!.\\s]*$`);
const EMOJI_ONLY = /^[\p{Extended_Pictographic}\p{Emoji_Component}\s]+$/u;

/** WhatsApp status updates arrive in a bridge room of their own; they're not conversations. */
const isStatusRoom = (room) => room?.currentState.getStateEvents('m.bridge').some((e) => e.getContent()?.channel?.id === 'status@broadcast');

function textOf(ev) {
  const c = effectiveContent(ev) || {};
  return { c, text: stripReplyFallback(c.body || '').trim() };
}

export function isQuestion(text) {
  const t = fold(text);
  if (!t) return false;
  return t.includes('?') || t.includes('¿') || ASK_START.test(t) || REQUEST.test(t);
}

const isAck = (text) => { const t = fold(text); return !t || ACK.test(t) || EMOJI_ONLY.test(text.trim()); };

/** 'reply' | 'waiting' | 'fyi' | null, from the rules alone. */
function quick(r, me) {
  const ev = r.last;
  if (!ev || r.invite || r.archived || isStatusRoom(r.room)) return null;
  const { c, text } = textOf(ev);
  if (ev.getType() === EventType.Sticker || c.msgtype === MsgType.Notice) return 'fyi';
  const media = [MsgType.Image, MsgType.Video, MsgType.Audio, MsgType.File].includes(c.msgtype);
  if (ev.getSender() === me) return isQuestion(text) ? 'waiting' : null;
  if (r.muted && !r.highlight) return null;
  if (r.group) {
    // In groups, only what's aimed at you: a mention, or a reply to one of your messages.
    const toMe = r.highlight > 0 || (replyToId(ev) && r.room.findEventById(replyToId(ev))?.getSender() === me);
    return toMe ? 'reply' : null;
  }
  if (c.msgtype === MsgType.Audio) return 'reply'; // a voice message usually wants an answer
  if (media) return text && isQuestion(text) ? 'reply' : 'fyi';
  if (isAck(text)) return 'fyi';
  return isQuestion(text) ? 'reply' : 'fyi';
}

// ---------- AI verdicts (cached per chat, for its last message) ----------

const KEY = 'relay.triage';
const store = (() => {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '{}');
    // Forget verdicts nobody will look at again.
    for (const id of Object.keys(all)) if (!(Date.now() - (all[id]?.at || 0) < 30 * DAY)) delete all[id];
    return all;
  } catch { return {}; }
})();
let version = 0;
const subs = new Set();
const bump = () => { version++; subs.forEach((f) => f()); };
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch {} };
/** Re-render when the AI has refined a chat. */
export const useTriageVersion = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => version);

/** { status: 'reply' | 'waiting', reason, since } for a chat item, or null when there's nothing to do. */
export function triageOf(r, me) {
  const base = quick(r, me);
  const ai = r.last && store[r.id]?.lastId === r.last.getId() ? store[r.id] : null;
  // Whoever wrote last decides the direction; the AI only says whether something is pending.
  const mineLast = r.last?.getSender() === me;
  let status = ai ? ai.status : base;
  if (status === 'reply' && mineLast) status = 'waiting';
  if (status === 'waiting' && !mineLast) status = base === 'reply' ? 'reply' : null;
  if (!status || status === 'fyi') return null;
  // Only what's recent: an unanswered question from months ago isn't a to-do anymore.
  if (Date.now() - r.last.getTs() > (status === 'reply' ? REPLY_DAYS : WAITING_DAYS) * DAY) return null;
  // A reason written for a different status would contradict the tab it's shown in.
  return { status, reason: ai?.status === status ? ai.reason || null : null, since: r.last.getTs() };
}

/** The Reply and Waiting lists, oldest first (whoever has been waiting longest). */
export function triageLists(rooms, me) {
  const reply = [];
  const waiting = [];
  for (const r of rooms) {
    const t = triageOf(r, me);
    if (t) (t.status === 'reply' ? reply : waiting).push(r);
  }
  const byAge = (a, b) => a.ts - b.ts;
  return { reply: reply.sort(byAge), waiting: waiting.sort(byAge) };
}

const SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'triage',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['reply', 'waiting', 'fyi', 'done'] },
        reason: { type: 'string' },
      },
      required: ['status', 'reason'],
    },
  },
};
const MAP = { reply: 'reply', waiting: 'waiting', fyi: 'fyi', done: 'fyi' };
const MEDIA = { 'm.image': '[photo]', 'm.video': '[video]', 'm.audio': '[voice message]', 'm.file': '[file]' };

function snippet(r, me) {
  const evs = r.room.getLiveTimeline().getEvents()
    .filter((e) => (e.getType() === EventType.RoomMessage || e.getType() === EventType.Sticker) && !e.isRedacted()).slice(-8);
  return evs.map((e) => {
    const { c, text } = textOf(e);
    const who = e.getSender() === me ? 'Me' : cleanName(senderName(r.room, e.getSender())).split(' ')[0];
    const body = text || MEDIA[c.msgtype] || '[sticker]';
    return `${who}: ${body.replace(/\s+/g, ' ').slice(0, 300)}`;
  }).join('\n');
}

function triagePrompt(r, me) {
  const convo = snippet(r, me);
  const lang = guessLanguage(convo);
  const mine = r.last.getSender() === me;
  const myName = cleanName(r.room.getMember(me)?.name || '');
  const known = myName && !myName.startsWith('@') && myName !== 'me' ? ` “Me” is ${myName}: when someone writes to ${myName.split(' ')[0]}, they mean the user.` : '';
  return [
    {
      role: 'system',
      content: [
        `You triage chat conversations (WhatsApp, Telegram, etc.) for the user, shown as "Me".${known} Read the end of the conversation and answer with a status:`,
        '- "reply": the other person expects an answer or something from Me (a question, a request, an invitation, something left pending with Me);',
        '- "waiting": Me asked or requested something and nobody has answered yet;',
        '- "fyi": just information, thanks, or small talk that asks for nothing;',
        '- "done": the subject is closed.',
        `In "reason", one short sentence (at most 70 characters) in ${lang || 'English'} saying what is pending. Call the user "you" (never "Me" or their name). ` +
          'Start with the other person’s name, or with "You" when the user is the one waiting, e.g. "Ana asked if you’re coming on Saturday", ' +
          '"You asked Pedro for the quote". For fyi or done, leave it empty.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `${r.group ? 'Group chat' : 'Chat'} "${r.name}":\n${convo}\n\n` +
        `(The last message is ${mine ? 'from ME, so the answer can only be "waiting", "fyi" or "done"' : 'from the OTHER person, so the answer can only be "reply", "fyi" or "done"'}.)`,
    },
  ];
}

let running = false;

/** Ask the AI about chats whose quick status could be wrong (one at a time, in the background). */
export async function refineTriage(items, me) {
  if (running || !aiAvailable() || !aiPrefs().aiEnabled || getPrefs().triageAI === false) return;
  const todo = items.filter((r) => {
    if (!r.last || r.invite || r.archived || (r.muted && !r.highlight) || isStatusRoom(r.room)) return false;
    if (store[r.id]?.lastId === r.last.getId()) return false;
    if (Date.now() - r.last.getTs() > WAITING_DAYS * DAY) return false;
    const q = quick(r, me);
    return q === 'reply' || q === 'waiting' || (!r.group && q === 'fyi' && r.last.getSender() !== me && (r.unread || r.markedUnread));
  }).slice(0, 12);
  if (!todo.length) return;
  const status = await aiStatus().catch(() => null);
  if (!status?.ok) return;
  running = true;
  try {
    for (const r of todo) {
      const lastId = r.last.getId();
      const job = streamChat({ task: 'triage', responseFormat: SCHEMA, maxTokens: 200, temperature: 0.1, messages: triagePrompt(r, me) });
      // eslint-disable-next-line no-await-in-loop
      const res = await job.done;
      if (!res.ok) break; // LM Studio went away: try again on the next change
      try {
        const text = visibleText(res.text);
        const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
        store[r.id] = { lastId, status: MAP[j.status] || null, reason: String(j.reason || '').trim().slice(0, 90) || null, at: Date.now() };
        persist();
        bump();
      } catch {}
    }
  } finally {
    running = false;
  }
}

// ---------- Nudges: "Ana is waiting for your reply" ----------

const NUDGED = 'relay.nudged';
const nudged = (() => { try { return JSON.parse(localStorage.getItem(NUDGED) || '{}'); } catch { return {}; } })();

/** "just now", "3 h ago", "2 days ago". */
export function ago(ts) {
  const h = Math.floor((Date.now() - ts) / 3600e3);
  if (h < 1) return 'just now';
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}

/** Every half hour (daytime only), a gentle reminder about chats left waiting on you for over a day. */
export function useTriageNudges(roomsRef, me) {
  useEffect(() => {
    const check = () => {
      const p = getPrefs();
      if (p.triage === false || p.triageNudges === false || !p.notifications) return;
      const hour = new Date().getHours();
      if (hour < 9 || hour >= 21) return; // not at night
      const minAge = (p.triageNudgeHours || 24) * 3600e3;
      const due = (roomsRef.current || [])
        .map((r) => ({ r, t: triageOf(r, me) }))
        .filter(({ r, t }) => t?.status === 'reply' && !r.muted && Date.now() - t.since > minAge && nudged[r.id] !== r.last.getId())
        .sort((a, b) => a.t.since - b.t.since)
        .slice(0, 2);
      for (const { r, t } of due) {
        nudged[r.id] = r.last.getId();
        const who = cleanName(senderName(r.room, r.last.getSender())).split(' ')[0];
        const { text } = textOf(r.last);
        if (p.notifSound) notificationSound();
        window.relay?.notify({
          title: `${who} is waiting for your reply`,
          body: t.reason || `${r.group ? `In ${r.name}: ` : ''}“${(text || 'message').slice(0, 90)}” · ${ago(t.since)}`,
          roomId: r.id,
          silent: true,
        });
      }
      if (due.length) {
        // Keep only the chats that still exist, so this doesn't grow forever.
        const ids = new Set((roomsRef.current || []).map((r) => r.id));
        for (const id of Object.keys(nudged)) if (!ids.has(id)) delete nudged[id];
        try { localStorage.setItem(NUDGED, JSON.stringify(nudged)); } catch {}
      }
    };
    const first = setTimeout(check, 60000);
    const every = setInterval(check, 30 * 60000);
    return () => { clearTimeout(first); clearInterval(every); };
  }, [roomsRef, me]);
}
