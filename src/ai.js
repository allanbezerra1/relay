// Local AI via LM Studio: "What did I miss?" chat summaries and the daily digest.
// The HTTP happens in the main process (electron/ai.cjs); this side picks the messages,
// writes the prompt and turns the token stream into text.
import { useEffect, useSyncExternalStore } from 'react';
import { EventType, MsgType } from 'matrix-js-sdk';
import { getPrefs, usePrefs } from './prefs.js';
import { isDisplayable, effectiveContent, stripReplyFallback, replyToId, senderName, cleanName } from './matrix.js';

export const AI_DEFAULTS = {
  aiEnabled: true,   // "Summarize" in chat headers and the chat list menu (shown once LM Studio answers)
  aiDigest: true,    // "Daily digest" button in the chat list
  aiHost: 'auto',    // 'auto' tries LM Studio on this computer (localhost:1234, 127.0.0.1:1234)
  aiModel: '',       // '' = the first model LM Studio has loaded
  aiThreshold: 15,   // unread messages before the header button turns into a "Summarize N" pill
  aiTranslate: true, // "Translate" under messages written in another language (src/translate.js)
  aiTranslateTo: '', // '' = the system language
};
export const aiPrefs = (p = getPrefs()) => ({ ...AI_DEFAULTS, ...Object.fromEntries(Object.keys(AI_DEFAULTS).filter((k) => p[k] !== undefined).map((k) => [k, p[k]])) });
export const aiAvailable = () => !!window.relay?.ai;

const MAX_CHARS = 12000;
const RECENT = 150;

// ---------- Talking to LM Studio ----------

let cached = null; // { at, host, status } so a burst of summaries doesn't re-probe every time
const readyListeners = new Set();
let ready = null; // null = not probed yet, else the last status

function setReady(status) {
  ready = status;
  readyListeners.forEach((l) => l());
}

export async function aiStatus({ fresh = false } = {}) {
  const host = aiPrefs().aiHost;
  if (!fresh && cached && cached.host === host && Date.now() - cached.at < 60000 && cached.status.ok) return cached.status;
  const status = await window.relay.ai.status(host);
  cached = { at: Date.now(), host, status };
  setReady(status);
  return status;
}

/**
 * True when the AI buttons should show: AI is on and LM Studio answered (or a host was typed in
 * Settings, so a failure should be explained rather than hidden). Probes once, then again when
 * the window regains focus after a while, so starting LM Studio later makes the buttons appear.
 */
export function useAiReady() {
  const p = aiPrefs(usePrefs());
  const status = useReadyStatus();
  useEffect(() => {
    if (!aiAvailable() || !p.aiEnabled) return;
    let last = 0;
    const probe = () => {
      if (Date.now() - last < 120000) return;
      last = Date.now();
      aiStatus().catch(() => {});
    };
    if (!ready || cached?.host !== p.aiHost) { last = 0; probe(); }
    window.addEventListener('focus', probe);
    return () => window.removeEventListener('focus', probe);
  }, [p.aiEnabled, p.aiHost]);
  if (!aiAvailable() || !p.aiEnabled) return false;
  return p.aiHost !== 'auto' || !!status?.ok;
}

const useReadyStatus = () => useSyncExternalStore((l) => { readyListeners.add(l); return () => readyListeners.delete(l); }, () => ready);

/**
 * Like useAiReady, without probing: for things drawn many times (one per message) inside a view
 * whose header already calls useAiReady.
 */
export function useAiReadyQuiet() {
  const p = aiPrefs(usePrefs());
  const status = useReadyStatus();
  if (!aiAvailable() || !p.aiEnabled) return false;
  return p.aiHost !== 'auto' || !!status?.ok;
}

const shortHost = (h = '') => h.replace(/^https?:\/\//, '');

/** The model to use: the one picked in Settings, else the first one LM Studio has loaded. */
export function pickModel(status) {
  const chosen = aiPrefs().aiModel;
  if (chosen) return chosen;
  return status?.loaded?.[0] || status?.models?.[0]?.id || '';
}

/** A sentence for an error code from electron/ai.cjs. */
export function aiErrorText(error, host) {
  const where = shortHost(host || (aiPrefs().aiHost !== 'auto' ? aiPrefs().aiHost : 'localhost:1234'));
  if (error === 'unreachable') return `Couldn’t reach LM Studio at ${where}. Is it open, with its local server started?`;
  if (error === 'timeout') return `LM Studio (${where}) took too long to answer. Try again, or pick a faster model in Settings → AI.`;
  if (error === 'no-model') return 'LM Studio has no models yet. Download one in LM Studio, then pick it in Settings → AI.';
  if (/HTTP 404|not found|No models? loaded|model/i.test(error || '')) {
    const m = aiPrefs().aiModel;
    return `${m ? `The model “${m}” isn’t` : 'No model is'} available in LM Studio. Pick another one in Settings → AI.`;
  }
  return `The AI answered with an error: ${error}`;
}

/** Hide <think>…</think> (some models think out loud in the content stream). */
export function visibleText(raw) {
  return raw.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/^\s+/, '');
}

/**
 * Stream a chat completion. Calls onText with the full visible text so far, and onModel once
 * the model is known. Returns { cancel, done } where done resolves to { ok, text, error }.
 */
export function streamChat({ messages, onText, onModel, maxTokens, temperature, task = 'summary', model, responseFormat }) {
  const id = Math.random().toString(36).slice(2);
  let raw = '';
  let stopped = false;
  let off = () => {};
  const done = (async () => {
    let status;
    try { status = await aiStatus(); } catch { status = { ok: false, error: 'unreachable' }; }
    if (stopped) return { ok: false, error: 'cancelled' };
    if (!status.ok) { cached = null; return { ok: false, error: aiErrorText(status.error, status.host) }; }
    const useModel = model || pickModel(status);
    if (!useModel) return { ok: false, error: aiErrorText('no-model') };
    onModel?.(useModel);
    off = window.relay.ai.onChunk((c) => {
      if (c.id !== id || !c.delta) return;
      raw += c.delta;
      onText?.(visibleText(raw));
    });
    const res = await window.relay.ai.complete({ id, host: status.host, model: useModel, messages, task, maxTokens, temperature, responseFormat });
    off();
    if (!res.ok) {
      if (res.error === 'unreachable') cached = null;
      return { ok: false, error: res.error === 'cancelled' ? 'cancelled' : aiErrorText(res.error, status.host), text: visibleText(res.text || raw) };
    }
    return { ok: true, text: visibleText(res.text || raw) };
  })();
  return {
    done,
    cancel: () => { stopped = true; off(); window.relay.ai.cancel(id); },
  };
}

/** "qwen/qwen3-8b" → "qwen3-8b", for the small model label on cards. */
export const shortModel = (m = '') => m.split('/').pop();

// ---------- Picking messages ----------

const two = (n) => String(n).padStart(2, '0');
const hhmm = (ts) => { const d = new Date(ts); return `${two(d.getHours())}:${two(d.getMinutes())}`; };
const mmdd = (ts) => { const d = new Date(ts); return `${two(d.getMonth() + 1)}/${two(d.getDate())}`; };

/** Beeper bridges mark call notices with an action; they read as [voice call] / [video call]. */
function callAction(ev) {
  const a = ev?.getContent?.()?.['com.beeper.action_message'];
  return a?.type === 'call' ? { video: a.call_type === 'video' } : null;
}

/** One message as text for the model; media become [photo], [voice message]… */
function messageText(ev) {
  if (ev.isRedacted()) return null;
  if (ev.getType() === EventType.RoomMessageEncrypted) return null;
  if (ev.getType() === EventType.Sticker) return '[sticker]';
  const call = callAction(ev);
  if (call) return call.video ? '[video call]' : '[voice call]';
  const c = effectiveContent(ev);
  const caption = (c.body && c.body !== c.filename && !/\.\w{2,5}$/.test(c.body)) ? ` ${c.body}` : '';
  switch (c.msgtype) {
    case MsgType.Image: return `[photo]${caption}`;
    case MsgType.Video: return `[video]${caption}`;
    case MsgType.Audio: return c['org.matrix.msc3245.voice'] ? '[voice message]' : `[audio: ${c.filename || c.body || 'file'}]`;
    case MsgType.File: return `[file: ${c.filename || c.body || 'file'}]`;
    case 'm.location': return '[location]';
    default: {
      const body = stripReplyFallback(c.body || '').trim();
      return body || null;
    }
  }
}

/** Live-timeline messages after my read marker (paginating back to reach it), or the last RECENT. */
export async function gatherMessages(client, room, { expand = 0 } = {}) {
  const me = client.getUserId();
  const timeline = room.getLiveTimeline();
  const displayable = () => timeline.getEvents().filter((e) => isDisplayable(e) && !e.isRedacted());
  const readIdx = () => {
    const upTo = room.getEventReadUpTo(me);
    return upTo ? displayable().findIndex((e) => e.getId() === upTo) : -1;
  };
  // Muted chats have no notification count, so also count what's past the read marker.
  const loadedUnread = readIdx() >= 0 ? displayable().length - readIdx() - 1 : 0;
  const unreadCount = Math.max(room.getUnreadNotificationCount('total') || 0, loadedUnread);
  const want = unreadCount > 0 ? unreadCount : RECENT;
  const extra = expand * RECENT; // "Summarize more": this much earlier context too

  for (let page = 0; page < 12; page++) {
    const evs = displayable();
    const enough = unreadCount > 0
      ? (readIdx() >= 0 && readIdx() >= extra) || evs.length >= want + extra
      : evs.length >= want + extra;
    if (enough) break;
    const more = await client.paginateEventTimeline(timeline, { backwards: true, limit: 50 }).catch(() => false);
    if (!more) break;
  }

  const evs = displayable();
  let start;
  if (unreadCount > 0) {
    const ri = readIdx();
    start = ri >= 0 ? ri + 1 : Math.max(0, evs.length - unreadCount);
  } else {
    start = Math.max(0, evs.length - RECENT);
  }
  start = Math.max(0, start - extra);
  const picked = evs.slice(start);
  return { ...transcript(room, picked, me), mode: unreadCount > 0 ? 'unread' : 'recent', unreadCount, canExpand: start > 0 || !!timeline.getPaginationToken('b') };
}

/** "HH:MM Name: text" lines, newest kept when it's too long. */
export function transcript(room, events, me, maxChars = MAX_CHARS) {
  const multiDay = events.length && new Date(events[0].getTs()).toDateString() !== new Date(events.at(-1).getTs()).toDateString();
  const lines = [];
  let size = 0;
  let count = 0;
  let truncated = false;
  let from = null;
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    const text = messageText(ev);
    if (!text) continue;
    const name = ev.getSender() === me ? 'You' : cleanName(senderName(room, ev.getSender()));
    const replied = replyToId(ev) && room.findEventById(replyToId(ev));
    const re = replied ? ` (replying to ${replied.getSender() === me ? 'You' : cleanName(senderName(room, replied.getSender()))})` : '';
    const line = `${multiDay ? `${mmdd(ev.getTs())} ` : ''}${hhmm(ev.getTs())} ${name}${re}: ${text.replace(/\s*\n\s*/g, ' ⏎ ')}`;
    if (size + line.length > maxChars) { truncated = true; break; }
    lines.push(line);
    size += line.length + 1;
    count++;
    from = ev.getTs();
  }
  lines.reverse();
  return { text: lines.join('\n'), count, truncated, from, to: events.at(-1)?.getTs() || null };
}

// ---------- Prompts ----------

// Times in the transcript are "HH:MM" only, so tell the model what day it is (it otherwise guesses).
const todayLine = () => `Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`;

// The answer should be in the language the chat is in. Small local models don't reliably work
// that out on their own (English instructions pull them into English), so guess it from common
// words and name it, with the headings already translated. Anything else falls back to asking.
const LANGS = {
  English: { words: 'the and you is are to of it that for on with this have was not what can will just do', heads: ['Main topics', 'Decisions', 'Questions for you', 'Links and files'], forYou: 'For you:' },
  Portuguese: { words: 'não você é isso vou eu também uma com pra tá ele ela muito obrigado já mas depois aqui hoje', heads: ['Principais tópicos', 'Decisões', 'Perguntas para você', 'Links e arquivos'], forYou: 'Para você:' },
  Spanish: { words: 'el los es pero yo qué muy gracias una usted tú está hoy ahora también aquí bien y', heads: ['Temas principales', 'Decisiones', 'Preguntas para ti', 'Enlaces y archivos'], forYou: 'Para ti:' },
  French: { words: 'le les est et je tu vous pas une avec pour c\'est sur mais très merci aussi', heads: ['Sujets principaux', 'Décisions', 'Questions pour vous', 'Liens et fichiers'], forYou: 'Pour vous :' },
  German: { words: 'und ich du ist nicht das die der mit wir ein eine auch aber danke heute', heads: ['Hauptthemen', 'Entscheidungen', 'Fragen an dich', 'Links und Dateien'], forYou: 'Für dich:' },
  Italian: { words: 'il che non sono è per una con anche ma grazie oggi ciao perché', heads: ['Argomenti principali', 'Decisioni', 'Domande per te', 'Link e file'], forYou: 'Per te:' },
};
const LANG_WORDS = Object.fromEntries(Object.entries(LANGS).map(([k, v]) => [k, new Set(v.words.split(' '))]));

/** Best guess at the language most of the transcript is in, or null when unsure. */
export function guessLanguage(text) {
  const score = Object.fromEntries(Object.keys(LANGS).map((k) => [k, 0]));
  for (const line of text.split('\n')) {
    const body = line.slice(line.indexOf(': ') + 2).toLowerCase(); // drop "HH:MM Name:"
    for (const w of body.split(/[^\p{L}']+/u)) {
      for (const k in score) if (LANG_WORDS[k].has(w)) score[k]++;
    }
  }
  const [best, second] = Object.entries(score).sort((a, b) => b[1] - a[1]);
  return best[1] >= 3 && best[1] >= second[1] * 1.5 ? best[0] : null;
}

function language(convo) {
  const lang = guessLanguage(convo.text);
  return lang
    ? { lang, ...LANGS[lang], rule: `Write your whole answer in ${lang}, the language of these messages.` }
    : { lang: null, ...LANGS.English, rule: 'Write your whole answer, section headings included, in the language most of the messages are written in.' };
}

function myName(client) {
  const n = client.getUser(client.getUserId())?.displayName;
  return n && n !== 'me' && !n.startsWith('@') ? n : null;
}

export function summaryPrompt(client, room, convo) {
  const me = myName(client);
  const you = me ? `${me} (shown as “You” in the messages when ${me} is the one writing)` : 'the user (shown as “You”)';
  const group = room.getJoinedMembers().length > 2;
  const L = language(convo);
  const [topics, decisions, questions, links] = L.heads;
  return [
    {
      role: 'system',
      content: [
        `You summarize chat conversations (WhatsApp, Telegram, etc.) for ${you}, who has been away for a while.`,
        `${L.rule} Be direct and natural, with no introduction and no conclusion.`,
        'Use exactly this Markdown format, with these sections in this order. Leave out a section entirely when there is nothing for it (never write “none”):',
        '',
        `**${topics}**`,
        '- at most 6 short points, saying who said what (e.g. “Bob suggested…”)',
        '',
        `**${decisions}**`,
        '- what was agreed or decided',
        '',
        `**${questions}**`,
        `- EVERY question, request, task or mention aimed at ${me || 'You'} (by name or with @), saying who asked and any deadline`,
        '',
        `**${links}**`,
        '- each relevant link (with its address), document, photo or voice message, and who sent it',
        '',
        'Rules: one line per point; use people’s names; don’t repeat the same fact in two sections;',
        'don’t make up anything that isn’t in the messages; ignore greetings and small talk.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `${todayLine()}\n${group ? 'Group chat' : 'Chat'}: “${cleanName(room.name)}”\n` +
        `${convo.truncated ? '(older messages were cut off)\n' : ''}` +
        `Messages (${convo.count}), formatted as “HH:MM Name: text”:\n\n${convo.text}\n\n` +
        // Repeated last: small models follow the most recent instruction best.
        `(${L.lang ? `Answer in ${L.lang}.` : 'Answer in the language most of these messages are written in.'})`,
    },
  ];
}

export function digestPrompt(client, room, convo) {
  const me = myName(client) || 'the user';
  const handle = (client.getUserId() || '').replace(/^@/, '').split(':')[0];
  const L = language(convo);
  return [
    {
      role: 'system',
      content: [
        `You write a quick catch-up of a group chat for ${me} (shown as “You”; others may mention them${handle ? ` as @${handle}` : ''} or by name).`,
        `${L.rule} Reply only with 2 to 4 short Markdown bullets ("- ...").`,
        '1. First, the main points: each bullet sums up a point in your own words, merging related messages and saying who said it. Never copy messages word for word.',
        `2. Then, only if a message asks ${me} to do something or asks them a question, add one last bullet ("- **${L.forYou}** …") ` +
          'saying what they were asked and by whom, and leave that out of the other bullets.',
        'No introduction, no conclusion, don’t make anything up.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `${todayLine()}\nGroup: “${cleanName(room.name)}”\nUnread messages (${convo.count}):\n\n${convo.text}\n\n` +
        `(${L.lang ? `Answer in ${L.lang}.` : 'Answer in the language most of these messages are written in.'})`,
    },
  ];
}

/** Ask a chat view to open its summary card (chat list menu). */
export const requestSummary = (roomId) => window.dispatchEvent(new CustomEvent('relay:summarize', { detail: { roomId } }));
