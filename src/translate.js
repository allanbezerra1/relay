// Message translation with the local AI (src/ai.js → electron/ai.cjs → LM Studio).
//
// - "Translate" under messages written in another language (a cheap guess, no AI involved, decides
//   which ones), and "Translate" in the chat header for all of them at once.
// - Automatic translation per chat (prefs.autoTranslate = { [roomId]: 'es' | … }): what arrives is
//   translated as it shows up, and what you write goes out in the chat's language.
// Messages are translated into the language picked in Settings → AI (the system language by default).
// The UI is in components/Translate.jsx.
import { useSyncExternalStore } from 'react';
import { isDisplayable, effectiveContent, stripReplyFallback } from './matrix.js';
import { getPrefs, setPref } from './prefs.js';
import { aiPrefs, streamChat } from './ai.js';

// ---------- Languages ----------

/** The language messages are translated into: Settings → AI, else the system's ("pt-BR", "en-US"…). */
export const targetTag = (p = getPrefs()) => aiPrefs(p).aiTranslateTo || navigator.language || 'en';
const base = (tag) => String(tag || '').toLowerCase().split(/[-_]/)[0];
export const targetLang = (p) => base(targetTag(p));

let names = null;
/** "es" → "Spanish", "pt-BR" → "Brazilian Portuguese" (English, like the rest of the UI). */
export function langName(tag) {
  if (!tag) return '';
  try {
    names ||= new Intl.DisplayNames(['en'], { type: 'language' });
    return names.of(tag) || tag;
  } catch { return tag; }
}

// Common words per language. A message is "in" a language when enough of its words are.
const STOP = {
  en: 'the and is are you to of it that this for with have has was were what i my we be not can will do does did just so how i\'m don\'t it\'s hey thanks thank yes your our they them there here when where why who would could should about from at on in an a me if or but all get got going know think tomorrow today please sure okay ok good great sounds let like love right now',
  pt: 'não nao você voce vc é está esta estou tá ta com uma um para pra que de do da dos das em no na nos nas o os as eu mas muito também tambem isso isto ele ela vai vou foi ser ter tem tenho obrigado obrigada sim já ja então entao aqui quando onde como porque depois agora hoje amanhã ontem bom boa dia noite tudo bem né ne gente ainda mesmo sei acho meu minha seu sua nosso fazer cara beleza valeu oi olá aí vamos tô pq blz desculpa pode',
  es: 'el la los las y es está esta estoy con una un para que de del en no yo pero muy también eso esto él ella va voy fue ser tener tiene tengo gracias sí ya entonces aquí cuando donde cómo porque por qué después ahora hoy mañana ayer buen buena buenos día noche todo bien hola usted ustedes nosotros mi tu su hay pues bueno vale vamos quiero puedo puedes hacer lo le se al creo sé',
  fr: 'le la les et est je tu il elle nous vous ils pas une un des du de que qui pour avec dans sur mais très bien merci oui non c\'est ça être avoir fait aussi',
  it: 'il lo la gli le e è sono non che di da per con una un ma molto anche questo quello grazie sì ciao come perché dove quando bene io tu lui lei noi voi',
  de: 'der die das und ist ich du er sie wir ihr nicht ein eine zu mit für auf aber sehr auch danke ja nein wie warum wo wann gut bin hast haben sein',
  nl: 'de het een en is van ik je niet dat die op te zijn met voor maar ook wat er hij we dit naar heb hebt bij nog wel geen kan bedankt goed',
};
const SETS = Object.fromEntries(Object.entries(STOP).map(([k, v]) => [k, new Set(v.split(' '))]));

// Languages told apart by their alphabet alone.
const SCRIPTS = [
  ['ja', /[\p{Script=Hiragana}\p{Script=Katakana}]/gu],
  ['ko', /\p{Script=Hangul}/gu],
  ['zh', /\p{Script=Han}/gu],
  ['ru', /\p{Script=Cyrillic}/gu],
  ['el', /\p{Script=Greek}/gu],
  ['ar', /\p{Script=Arabic}/gu],
  ['he', /\p{Script=Hebrew}/gu],
  ['hi', /\p{Script=Devanagari}/gu],
  ['th', /\p{Script=Thai}/gu],
];

/** Best guess at a message's language: { lang, confident } (lang is null when unknown). */
export function detectLang(text) {
  const t = String(text || '').toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ').replace(/[@#]\S+/g, ' ').replace(/:[a-z_]+:/g, ' ');
  const letters = (t.match(/\p{L}/gu) || []).length;
  if (!letters) return { lang: null, confident: false };
  for (const [lang, re] of SCRIPTS) {
    const n = (t.match(re) || []).length;
    // Japanese mixes kana with Han, so a little kana is enough.
    if (lang === 'ja' ? n >= 2 : n / letters > 0.5) return { lang, confident: letters >= 2 };
  }
  const words = t.match(/[\p{L}']+/gu) || [];
  if (words.length < 3) return { lang: null, confident: false };
  const score = Object.fromEntries(Object.keys(SETS).map((k) => [k, 0]));
  for (const w of words) for (const k in SETS) if (SETS[k].has(w)) score[k] += 1;
  // Letters only one of these languages uses.
  if (/[ãõ]|ç[ãaoõe]|ção|ções/.test(t)) score.pt += 3;
  if (/[ñ¿¡]/.test(t)) score.es += 3;
  if (/\b(th|wh)\w+/.test(t)) score.en += 0.5;
  if (/[äöüß]/.test(t)) score.de += 2;
  if (/[èàù]|\bè\b/.test(t) && !/[ãõç]/.test(t)) { score.it += 0.5; score.fr += 0.5; }
  if (/ij\b|\bij|aa|oe|uu/.test(t)) score.nl += 0.5;
  const [[lang, best], [, second]] = Object.entries(score).sort((a, b) => b[1] - a[1]);
  if (best < 1) return { lang: null, confident: false };
  // A clear winner, with enough evidence for the message's length.
  const confident = best >= Math.max(1.5, words.length * 0.15) && best >= second * 1.6 + 0.5;
  return { lang, confident };
}

/** The language of `text` when it clearly isn't the one you read in, else null. */
export function foreignLang(text, p) {
  const { lang, confident } = detectLang(text);
  return confident && lang && lang !== targetLang(p) ? lang : null;
}

// ---------- Which messages can be translated ----------

// Notices the bridges write themselves ("You received a view once message…"), which aren't
// anyone's words. They usually come as m.notice (never translated), but not always.
const BRIDGE_NOTICE = new RegExp('^(?:' + [
  'You (?:received|sent) a view once message',
  'You received a one-time passcode',
  '\\*\\*Message unavailable\\*\\*',
  '⚠️? ?Your (?:message|reaction|redaction) (?:was not|may not have been) bridged',
  'Failed to (?:bridge|reupload|decrypt|parse)',
  'Old .+?\\. (?:Media will be requested|Requesting old media)',
  'Unknown message type, please view it',
  'Contact array messages are not yet supported',
  'Started sharing live location',
  'Your security code with .+ changed',
  'Unsupported (?:business|location|product|thumbnail) message',
  'Sent an album',
  '(?:Set the|Automatically enabled) disappearing message timer',
  '(?:Automatically )?turned off disappearing messages',
  'Invitation to join my WhatsApp group',
].join('|') + ')', 'i');

const FORWARDED = /^↷ Forwarded(?:\n\n|\n|$)/;

/** The words of a text message someone wrote, ready to translate, or '' for anything else. */
export function translatableBody(ev) {
  if (!ev || ev.isRedacted?.()) return '';
  const c = effectiveContent(ev);
  // Only what people write: no notices (bots, bridges), media, or view once placeholders.
  if (c.msgtype !== 'm.text' && c.msgtype !== 'm.emote') return '';
  if (c['dev.relay.view_once']) return '';
  const body = stripReplyFallback(c.body || '').replace(FORWARDED, '').trim();
  if (!body || BRIDGE_NOTICE.test(body)) return '';
  return body;
}

// ---------- Translations (per event, shared store) ----------

const translations = new Map(); // event id → { state: 'loading' | 'done' | 'error', text, lang, error, shown, src }
const subs = new Set();
let version = 0;
const notify = () => { version++; subs.forEach((f) => f()); };
const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };
const setT = (id, patch) => { translations.set(id, { ...(translations.get(id) || {}), ...patch }); notify(); };

export const useTranslation = (eventId) => useSyncExternalStore(subscribe, () => translations.get(eventId) || null);
/** Re-render on any translation change (the header button). */
export const useTranslationsVersion = () => useSyncExternalStore(subscribe, () => version);
export const translationOf = (id) => translations.get(id) || null;
export const hideTranslation = (id) => setT(id, { shown: false });
export const showTranslation = (id) => setT(id, { shown: true });

const stripQuotes = (s) => String(s || '').trim().replace(/^["“”'«»]+|["“”'«»]+$/g, '').trim();
const reachFailed = (err) => /Couldn’t reach|took too long/.test(err || '');

const systemPrompt = () => `You are a translator. Translate chat messages into natural ${langName(targetTag())}, ` +
  'keeping the same tone and register (slang for slang, casual for casual). ' +
  'Keep emojis, names, links, numbers and @mentions as they are. Reply ONLY with the translation: no quotes, no notes, no explanations.';

// A chat opened with automatic translation on can have dozens of messages to translate at once;
// LM Studio answers them a couple at a time anyway.
const MAX_RUNNING = 2;
const queue = [];
let running = 0;
function pump() {
  while (running < MAX_RUNNING && queue.length) {
    const run = queue.shift();
    running++;
    run().finally(() => { running--; pump(); });
  }
}

async function translateNow(eventId, text) {
  const job = streamChat({
    task: 'translate',
    maxTokens: Math.min(1500, 120 + text.length * 2),
    messages: [{ role: 'system', content: systemPrompt() }, { role: 'user', content: text }],
    onText: (t) => setT(eventId, { text: stripQuotes(t) }),
  });
  const res = await job.done;
  if (res.ok && res.text.trim()) setT(eventId, { state: 'done', text: stripQuotes(res.text) });
  else setT(eventId, { state: 'error', error: res.error === 'cancelled' ? 'Translation cancelled.' : res.error || 'The AI didn’t answer.' });
}

/** Translate one message (streams into the store). Already translated: just show it again. */
export function translateEvent(eventId, text) {
  const cur = translations.get(eventId);
  if (cur?.src === text && (cur.state === 'done' || cur.state === 'loading')) { showTranslation(eventId); return; }
  setT(eventId, { state: 'loading', text: '', lang: detectLang(text).lang, shown: true, error: null, src: text });
  queue.push(() => translateNow(eventId, text));
  pump();
}

const waitFor = (id) => new Promise((resolve) => {
  const check = () => (translations.get(id)?.state === 'loading' ? setTimeout(check, 150) : resolve());
  check();
});

const BATCH = 6;

/**
 * Translate several messages, [{ id, text }]: six per request (a JSON array comes back), one by
 * one when the model's answer doesn't line up. onProgress(done, total).
 */
export async function translateMany(items, onProgress) {
  const todo = items.filter(({ id, text }) => { const t = translations.get(id); return !(t?.src === text && ['done', 'loading'].includes(t.state)); });
  items.forEach(({ id }) => { if (translations.get(id)?.state === 'done') showTranslation(id); });
  todo.forEach(({ id, text }) => setT(id, { state: 'loading', text: '', lang: detectLang(text).lang, shown: true, error: null, src: text }));
  let done = items.length - todo.length;
  onProgress?.(done, items.length);
  for (let k = 0; k < todo.length; k += BATCH) {
    const chunk = todo.slice(k, k + BATCH);
    const schema = {
      type: 'json_schema',
      json_schema: {
        name: 'translations',
        strict: true,
        schema: { type: 'object', properties: { translations: { type: 'array', items: { type: 'string' }, minItems: chunk.length, maxItems: chunk.length } }, required: ['translations'] },
      },
    };
    const job = streamChat({
      task: 'translate',
      responseFormat: schema,
      maxTokens: Math.min(3000, 200 + chunk.reduce((n, x) => n + x.text.length * 2, 0)),
      messages: [
        { role: 'system', content: `${systemPrompt()}\nYou will get several numbered messages. Reply only with JSON {"translations": [...]}: one translation per message, in the same order.` },
        { role: 'user', content: chunk.map((x, i) => `${i + 1}. ${x.text.replace(/\s*\n\s*/g, ' ')}`).join('\n') },
      ],
    });
    // eslint-disable-next-line no-await-in-loop
    const res = await job.done;
    let list = null;
    if (res.ok) {
      try { list = JSON.parse(res.text.slice(res.text.indexOf('{'))).translations; } catch {}
    }
    if (Array.isArray(list) && list.length === chunk.length && list.every((s) => typeof s === 'string' && s.trim())) {
      chunk.forEach((x, i) => setT(x.id, { state: 'done', text: stripQuotes(list[i]) }));
      done += chunk.length;
      onProgress?.(done, items.length);
    } else if (!res.ok && reachFailed(res.error)) {
      todo.slice(k).forEach((x) => setT(x.id, { state: 'error', error: res.error }));
      return { ok: false, error: res.error };
    } else {
      for (const x of chunk) {
        translations.delete(x.id);
        translateEvent(x.id, x.text);
        // eslint-disable-next-line no-await-in-loop
        await waitFor(x.id);
        onProgress?.(++done, items.length);
      }
    }
  }
  return { ok: true };
}

/** Other people's messages in another language, among the newest loaded ones. */
export function foreignMessages(room, me, limit = 40) {
  return room.getLiveTimeline().getEvents()
    .filter((e) => isDisplayable(e) && !e.isRedacted() && !e.status)
    .slice(-limit)
    .filter((e) => e.getSender() !== me)
    .map((e) => ({ id: e.getId(), text: translatableBody(e) }))
    .filter((x) => x.text && foreignLang(x.text));
}

// ---------- Automatic translation, both ways (per chat) ----------

export const autoTranslateLang = (roomId, p = getPrefs()) => (p.autoTranslate || {})[roomId] || null;

export function setAutoTranslate(roomId, lang) {
  const map = { ...(getPrefs().autoTranslate || {}) };
  if (lang) map[roomId] = lang; else delete map[roomId];
  setPref('autoTranslate', map);
}

/** The language the others write in, from their recent messages (null when it's yours). */
export function roomLanguage(room, me) {
  const count = {};
  for (const { text } of foreignMessages(room, me)) {
    const l = foreignLang(text);
    count[l] = (count[l] || 0) + 1;
  }
  return Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

/** What you wrote → the chat's language. Resolves { ok, text, error }. */
export async function translateOutgoing(text, lang) {
  const job = streamChat({
    task: 'translate',
    maxTokens: Math.min(1500, 120 + text.length * 3),
    messages: [
      {
        role: 'system',
        content: `You translate the chat messages the user writes into natural ${langName(lang)}, keeping the same tone and register ` +
          '(slang for slang, casual for casual). Keep emojis, names, links, numbers and @mentions as they are. ' +
          'Reply ONLY with the translation: no quotes, no notes, no explanations.',
      },
      { role: 'user', content: text },
    ],
  });
  const res = await job.done;
  const out = res.ok ? stripQuotes(res.text) : '';
  return out ? { ok: true, text: out } : { ok: false, error: res.error || 'The AI didn’t answer.' };
}
