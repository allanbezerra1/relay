// Morning briefing: once a morning, what matters today. Who's waiting on you, what you're
// waiting on, plans people mentioned for today and the coming days, and which groups are busy.
// Written up by the local AI when it's running, laid out plainly when it isn't. Shown as the
// "Good morning" panel and announced with a notification.
import { useEffect } from 'react';
import { EventType } from 'matrix-js-sdk';
import { stripReplyFallback, senderName, cleanName, isDisplayable } from './matrix.js';
import { getPrefs } from './prefs.js';
import { triageOf, ago } from './triage.js';
import { streamChat, aiAvailable, aiPrefs, aiStatus, visibleText, guessLanguage } from './ai.js';
import { notificationSound } from './sounds.js';

const DAY = 864e5;
const KEY = 'relay.briefing';
export const BRIEFING_NOTIFICATION = '__briefing'; // roomId of the morning notification
const dayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
export const lastBriefing = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const keep = (b) => { try { localStorage.setItem(KEY, JSON.stringify(b)); } catch {} };

const first = (s) => cleanName(s || '').split(' ')[0];
const isStatusRoom = (room) => room?.currentState.getStateEvents('m.bridge').some((e) => e.getContent()?.channel?.id === 'status@broadcast');

// ---------- Plans mentioned in messages ("dinner on Friday at 8pm", "reunião amanhã às 10h") ----------

const fold = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const WEEKDAYS = [
  ['sunday', 'domingo'], ['monday', 'segunda', 'lunes'], ['tuesday', 'terca', 'martes'], ['wednesday', 'quarta', 'miercoles'],
  ['thursday', 'quinta', 'jueves'], ['friday', 'sexta', 'viernes'], ['saturday', 'sabado'],
];
const MONTHS = [
  ['january', 'jan', 'janeiro', 'enero'], ['february', 'feb', 'fevereiro', 'febrero'], ['march', 'mar', 'marco', 'marzo'],
  ['april', 'apr', 'abril'], ['may', 'maio', 'mayo'], ['june', 'jun', 'junho', 'junio'], ['july', 'jul', 'julho', 'julio'],
  ['august', 'aug', 'agosto'], ['september', 'sep', 'sept', 'setembro', 'septiembre', 'setiembre'], ['october', 'oct', 'outubro', 'octubre'],
  ['november', 'nov', 'novembro', 'noviembre'], ['december', 'dec', 'dezembro', 'diciembre'],
];
const monthIndex = (w) => MONTHS.findIndex((names) => names.includes(w));
const weekdayIndex = (w) => WEEKDAYS.findIndex((names) => names.includes(w));
const MONTH_RE = MONTHS.flat().sort((a, b) => b.length - a.length).join('|');
const WEEKDAY_RE = WEEKDAYS.flat().join('|');
// Something has to be planned: one of these words, or an explicit time.
const PLAN = /\b(meeting|call|appointment|dinner|lunch|breakfast|party|birthday|flight|trip|exam|deadline|due|event|interview|doctor|dentist|concert|game|wedding|reuniao|consulta|aniversario|festa|evento|jantar|almoco|encontro|prova|entrega|viagem|voo|show|churrasco|vencimento|vence|reunion|cita|cumpleanos|fiesta|cena|almuerzo|viaje|vuelo|examen|boda|partido)\b/;

// 12/03: day first, unless this computer writes dates month first (US).
const MONTH_FIRST = (() => {
  try { return new Intl.DateTimeFormat().formatToParts(new Date(2020, 11, 31)).find((p) => p.type === 'month' || p.type === 'day')?.type === 'month'; } catch { return false; }
})();

/** "at 7pm", "19:30", "às 19h", "a las 8", "7 da noite", "noon" → [h, m] or null. */
function findTime(t) {
  if (/\b(noon|meio[- ]dia|mediodia)\b/.test(t)) return [12, 0];
  const m = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/.exec(t)
    || /\b(?:at|as|a partir das|pelas|por volta das|a las|desde las)\s+(\d{1,2})(?:[:h](\d{2}))?\s*(?:h|hs|horas|o'?clock)?\b(?:\s*(?:da|de la|in the)\s*(manha|tarde|noite|noche|morning|afternoon|evening|night))?/.exec(t)
    || /\b(\d{1,2})[:h](\d{2})\b/.exec(t)
    || /\b(\d{1,2})\s*(?:h|hs|horas)\b(?:\s*(?:da|de la)\s*(manha|tarde|noite|noche))?/.exec(t)
    || /\b(\d{1,2})\s*(?:da|de la)\s*(manha|tarde|noite|noche)\b/.exec(t);
  if (!m) return null;
  let h = +m[1];
  const min = m[2] && /^\d+$/.test(m[2]) ? +m[2] : 0;
  const period = m.slice(2).find((x) => x && !/^\d+$/.test(x)) || '';
  if (/^p|tarde|noite|noche|afternoon|evening|night/.test(period) && h < 12) h += 12;
  if (/^a/.test(period) && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return [h, min];
}

function explicitDate(t, b) {
  let m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(t);
  if (m) {
    const [day, month] = MONTH_FIRST ? [+m[2], +m[1]] : [+m[1], +m[2]];
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      let y = m[3] ? +m[3] : b.getFullYear();
      if (y < 100) y += 2000;
      const d = new Date(y, month - 1, day);
      if (!m[3] && d < b) d.setFullYear(y + 1);
      return d;
    }
  }
  // "5 de março", "5 de marzo", "5 March", "March 5th"
  m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:de\\s+|of\\s+)?(${MONTH_RE})\\b`).exec(t)
    || new RegExp(`\\b(${MONTH_RE})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`).exec(t);
  if (m) {
    const [day, name] = /^\d/.test(m[1]) ? [+m[1], m[2]] : [+m[2], m[1]];
    const d = new Date(b.getFullYear(), monthIndex(name), day);
    if (d < b) d.setFullYear(d.getFullYear() + 1);
    return d;
  }
  // "on Friday", "next Friday", "sexta(-feira)", "el viernes"
  m = new RegExp(`\\b(${WEEKDAY_RE})(?:-feira| feira)?\\b`).exec(t);
  if (m) {
    let diff = (weekdayIndex(m[1]) - b.getDay() + 7) % 7;
    if (diff === 0) diff = 7; // "Friday" said on a Friday means the next one
    return new Date(b.getTime() + diff * DAY);
  }
  // "dia 12", "el día 12", "on the 12th"
  m = /\b(?:dia|on the)\s+(\d{1,2})(?:st|nd|rd|th)?\b/.exec(t);
  if (m && +m[1] >= 1 && +m[1] <= 31) {
    const d = new Date(b.getFullYear(), b.getMonth(), +m[1]);
    if (d < b) d.setMonth(d.getMonth() + 1);
    return d;
  }
  return null;
}

/** The day a message talks about, relative to when it was sent. */
function findDate(t, base) {
  const b = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  // Explicit dates win over "today/tomorrow": "BBQ on Saturday? tell me by tomorrow" is on Saturday.
  const explicit = explicitDate(t, b);
  if (explicit) return explicit;
  if (/\b(day after tomorrow|depois de amanha|pasado manana)\b/.test(t)) return new Date(b.getTime() + 2 * DAY);
  // "mañana" is also "morning" ("por la mañana"), so drop those first.
  if (/\b(tomorrow|tmrw|amanha)\b/.test(t) || /\bmanana\b/.test(t.replace(/\b(la|esta)\s+manana\b/g, ''))) return new Date(b.getTime() + DAY);
  if (/\b(today|tonight|hoje|hj|hoy|esta noche|esta tarde)\b/.test(t)) return b;
  return null;
}

/** { at, allDay, title } for a plan mentioned in a message, or null. */
export function mentionedPlan(text, ts) {
  if (!text || text.length > 800) return null;
  const t = fold(text);
  const date = findDate(t, new Date(ts));
  if (!date) return null;
  const time = findTime(t);
  if (!time && !PLAN.test(t)) return null;
  const at = new Date(date);
  if (time) at.setHours(time[0], time[1], 0, 0); else at.setHours(9, 0, 0, 0);
  if (at.getTime() < Date.now() - 3600e3) return null; // only what's still ahead
  return { at: at.getTime(), allDay: !time, title: text.replace(/\s+/g, ' ').trim().slice(0, 80) };
}

// ---------- Facts ----------

/** The raw material: plain facts gathered from the chats (no AI). */
export function gatherFacts(client, items) {
  const me = client.getUserId();
  const live = items.filter((r) => !r.invite && !r.archived && !isStatusRoom(r.room));
  const reply = [];
  const waiting = [];
  for (const r of live) {
    const t = triageOf(r, me);
    if (!t) continue;
    const entry = {
      id: r.id, name: r.name, group: r.group, reason: t.reason, since: t.since,
      who: first(senderName(r.room, r.last.getSender())), text: stripReplyFallback(r.last.getContent()?.body || '').slice(0, 140),
    };
    (t.status === 'reply' ? reply : waiting).push(entry);
  }
  reply.sort((a, b) => a.since - b.since);
  waiting.sort((a, b) => a.since - b.since);

  // Plans mentioned in the last 10 days that fall today or in the next 7.
  const now = Date.now();
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const until = startToday.getTime() + 8 * DAY;
  const agenda = [];
  const seen = new Set();
  for (const r of live) {
    if (r.muted) continue;
    const evs = r.room.getLiveTimeline().getEvents();
    for (let i = evs.length - 1, n = 0; i >= 0 && n < 120; i--, n++) {
      const ev = evs[i];
      if (ev.getTs() < now - 10 * DAY) break;
      if (ev.getType() !== EventType.RoomMessage || !isDisplayable(ev) || ev.isRedacted()) continue;
      const plan = mentionedPlan(stripReplyFallback(ev.getContent()?.body || ''), ev.getTs());
      if (!plan || plan.at < startToday.getTime() || plan.at > until) continue;
      const k = `${r.id}:${plan.at}`;
      if (seen.has(k)) continue;
      seen.add(k);
      agenda.push({ ...plan, id: r.id, name: r.name, text: plan.title, who: ev.getSender() === me ? 'You' : first(senderName(r.room, ev.getSender())) });
    }
  }
  agenda.sort((a, b) => a.at - b.at);

  const unread = live.filter((r) => !r.muted && (r.unread || r.markedUnread));
  const mentions = unread.filter((r) => r.highlight > 0);
  const groups = unread.filter((r) => r.group).sort((a, b) => b.unread - a.unread);
  return {
    reply: reply.slice(0, 8), waiting: waiting.slice(0, 6), agenda: agenda.slice(0, 6),
    unreadChats: unread.length, mentions: mentions.map((r) => ({ id: r.id, name: r.name })).slice(0, 5),
    busyGroups: groups.slice(0, 4).map((r) => ({ id: r.id, name: r.name, unread: r.unread })),
  };
}

/** "today", "tomorrow", "Friday", with " at 19:00" when there's a time. */
export function agendaWhen(a) {
  const d = new Date(a.at);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(a.at).setHours(0, 0, 0, 0) - today) / DAY);
  // Day names in English, like the rest of the sentence; the time in this computer's format.
  const day = diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : d.toLocaleDateString('en-US', { weekday: 'long' });
  return a.allDay ? day : `${day} at ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}
const isToday = (a) => new Date(a.at).toDateString() === new Date().toDateString();
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** One short line for the notification. */
export function headline(f) {
  const parts = [];
  if (f.reply.length) parts.push(`${plural(f.reply.length, 'chat', 'chats')} waiting for you`);
  const today = f.agenda.filter(isToday);
  if (today.length) parts.push(`${plural(today.length, 'plan', 'plans')} today`);
  else if (f.agenda.length) parts.push(`next: ${f.agenda[0].text.slice(0, 40)} (${agendaWhen(f.agenda[0])})`);
  if (f.mentions.length) parts.push(plural(f.mentions.length, 'mention', 'mentions'));
  if (!parts.length) parts.push(f.unreadChats ? `${plural(f.unreadChats, 'chat', 'chats')} with new messages` : 'All caught up');
  return parts.join(' · ');
}

/** Plain version, used when the AI is off or doesn't answer: a short overview (the lists come below it). */
export function plainText(f) {
  const parts = [];
  if (f.reply.length === 1) parts.push(`**${f.reply[0].name}** is waiting for your reply (${ago(f.reply[0].since)}).`);
  else if (f.reply.length) parts.push(`**${f.reply.length} chats are waiting for your reply**, the oldest from ${f.reply[0].name} (${ago(f.reply[0].since)}).`);
  const today = f.agenda.filter(isToday);
  if (today.length) parts.push(`${plural(today.length, 'plan', 'plans')} for today, starting ${agendaWhen(today[0]).replace(/^today /, '')}.`);
  else if (f.agenda.length) parts.push(`Next up: “${f.agenda[0].text.slice(0, 60)}”, ${agendaWhen(f.agenda[0])}.`);
  if (f.waiting.length) parts.push(`You’re waiting to hear back from ${plural(f.waiting.length, 'chat', 'chats')}.`);
  if (f.mentions.length) parts.push(`You were mentioned in ${f.mentions.map((x) => x.name).join(', ')}.`);
  if (!parts.length) parts.push(f.unreadChats ? `Nothing is waiting on you. ${plural(f.unreadChats, 'chat has', 'chats have')} new messages.` : 'Nothing is waiting on you. All caught up.');
  return parts.join(' ');
}

function prompt(client, f) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });
  const myName = first(client.getUser(client.getUserId())?.displayName || '');
  const facts = [
    `Today is ${today}.${myName && myName !== 'me' && !myName.startsWith('@') ? ` The user’s name is ${myName}.` : ''}`,
    f.reply.length && `Chats waiting for the user’s reply:\n${f.reply.map((x) => `- ${x.name}${x.group ? ' (group)' : ''}, ${ago(x.since)}: ${x.reason || `${x.who}: "${x.text}"`}`).join('\n')}`,
    f.agenda.length && `Plans mentioned in chats:\n${f.agenda.map((a) => `- ${agendaWhen(a)}: "${a.text}" (${a.who}, in ${a.name})`).join('\n')}`,
    f.waiting.length && `The user is waiting for an answer from:\n${f.waiting.map((x) => `- ${x.name}, ${ago(x.since)}: ${x.reason || `"${x.text}"`}`).join('\n')}`,
    f.mentions.length && `The user was mentioned in: ${f.mentions.map((x) => x.name).join(', ')}.`,
    f.busyGroups.length && `Busiest groups: ${f.busyGroups.map((x) => `${x.name} (${x.unread} new)`).join(', ')}.`,
    `In total, ${f.unreadChats} chats have unread messages.`,
  ].filter(Boolean).join('\n\n');
  // Write in the language the chats are in (like the summaries), English when unsure.
  const lang = guessLanguage([...f.reply, ...f.waiting].map((x) => `: ${x.reason || x.text}`).concat(f.agenda.map((a) => `: ${a.text}`)).join('\n')) || 'English';
  return [
    {
      role: 'system',
      content: [
        `You are Relay, the user’s messaging app, writing their morning briefing in ${lang}, in a warm, friendly tone without overdoing it.`,
        'Use only the facts you are given, never make anything up. Format: one short opening sentence (greet them and mention the day), then up to 3 short sections with a bold title, in this order:',
        '**Priorities**: ONLY the chats waiting for the user’s reply (what each person wants from them).',
        '**Plans**: the plans, with day and time, without repeating the same one.',
        '**Keep an eye on**: chats where the user is waiting for an answer, mentions and busy groups.',
        `One line per bullet, starting with the person’s or chat’s name. Skip a section when there is nothing for it. At most 9 bullets in total. No sign-off. Translate the section titles into ${lang}.`,
      ].join('\n'),
    },
    { role: 'user', content: facts },
  ];
}

let current = null; // the briefing being written right now (a promise)

/**
 * Write today's briefing (or reuse it). onText streams the AI text.
 * Resolves { date, at, facts, text, ai }.
 */
export function makeBriefing(client, items, { force = false, onText } = {}) {
  const prev = lastBriefing();
  if (!force && prev?.date === dayKey()) return Promise.resolve(prev);
  if (current) return current;
  current = (async () => {
    const facts = gatherFacts(client, items);
    let text = null;
    if (aiAvailable() && aiPrefs().aiEnabled && getPrefs().briefingAI !== false) {
      const st = await aiStatus().catch(() => null);
      if (st?.ok) {
        const job = streamChat({ task: 'briefing', messages: prompt(client, facts), maxTokens: 700, temperature: 0.4, onText });
        const res = await job.done;
        if (res.ok && visibleText(res.text).trim()) text = visibleText(res.text).trim();
      }
    }
    const b = { date: dayKey(), at: Date.now(), facts, text: text || plainText(facts), ai: !!text };
    keep(b);
    return b;
  })().finally(() => { current = null; });
  return current;
}

/** In the morning (from prefs.briefingHour until 2pm), the first time Relay is running: write it and announce it. */
export function useMorningBriefing(client, roomsRef) {
  useEffect(() => {
    const check = async () => {
      const p = getPrefs();
      if (p.briefing === false || p.briefingNotify === false) return;
      const now = new Date();
      if (now.getHours() < (p.briefingHour ?? 7) || now.getHours() >= 14) return; // a "good morning" after lunch is just odd
      if (lastBriefing()?.date === dayKey()) return;
      if (!client.isInitialSyncComplete() || !(roomsRef.current || []).length) return;
      const b = await makeBriefing(client, roomsRef.current);
      if (p.notifications) {
        if (p.notifSound) notificationSound();
        window.relay?.notify({ title: 'Good morning', body: headline(b.facts), roomId: BRIEFING_NOTIFICATION, silent: true });
      }
    };
    const firstCheck = setTimeout(check, 45000);
    const every = setInterval(check, 5 * 60000);
    return () => { clearTimeout(firstCheck); clearInterval(every); };
  }, [client, roomsRef]);
}
