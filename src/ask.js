// Ask Relay: ask anything about your chats. The main process keeps the search index
// (electron/semantic.cjs); this side reads the history to feed it, searches, and has the local
// model answer from the best stretches of conversation, citing them as [1], [2]…
import { useEffect, useState, useSyncExternalStore } from 'react';
import { KnownMembership, Method } from 'matrix-js-sdk';
import { streamChat, aiStatus, aiAvailable, aiPrefs, aiErrorText, useAiReady, guessLanguage } from './ai.js';
import { usePrefs } from './prefs.js';
import { cleanName, stripReplyFallback } from './matrix.js';

const api = () => window.relay?.ask || null;
export const askAvailable = () => !!api() && aiAvailable();

/** True when Ask Relay should be offered: local AI is reachable and Ask Relay is on. */
export function useAskReady() {
  const aiReady = useAiReady();
  const p = aiPrefs(usePrefs());
  return aiReady && p.aiAsk && askAvailable();
}

// ---------- Reading history into the index ----------

const PER_ROOM = 1500;              // messages per chat on the first pass…
const MAX_AGE = 2 * 365 * 864e5;    // …and none older than two years
const REFRESH = 15 * 60 * 1000;     // then look for new messages every 15 minutes

// What the window is doing (reading chats); the main process reports embedding progress itself.
let crawl = null; // { done, total } while reading chats
const crawlListeners = new Set();
const setCrawl = (c) => { crawl = c; crawlListeners.forEach((l) => l()); };
let running = null;

const two = (n) => String(n).padStart(2, '0');
const stamp = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`; };
const KIND = { 'm.image': '[photo]', 'm.video': '[video]', 'm.audio': '[audio]', 'm.file': '[file]', 'm.location': '[location]' };

function displayName(room, userId) {
  const m = room.getMember(userId);
  const n = m?.rawDisplayName || m?.name;
  return cleanName(n && n !== userId ? n : userId.replace(/^@/, '').split(':')[0]);
}

/** One message as "[2026-10-04 14:03] Name: text", or null for things that aren't worth searching. */
function messageLine(room, ev, me) {
  if (ev.getType() !== 'm.room.message' || ev.isRedacted()) return null;
  const c = ev.getContent();
  if (!c || c.msgtype === 'm.notice' || c['m.relates_to']?.rel_type === 'm.replace') return null;
  const body = stripReplyFallback(String(c.body || '')).replace(/\s*\n\s*/g, ' ').trim();
  const kind = KIND[c.msgtype];
  const isName = !body || body === c.filename || /^[\w\s().-]+\.\w{2,5}$/.test(body);
  const text = kind ? `${kind}${c.msgtype === 'm.file' || !isName ? ` ${body}` : ''}`.trim() : body;
  if (!text) return null;
  const who = ev.getSender() === me ? 'You' : displayName(room, ev.getSender());
  return { id: ev.getId(), ts: ev.getTs(), line: `[${stamp(ev.getTs())}] ${who}: ${text.slice(0, 600)}` };
}

/** Messages newer than `since` (or the last PER_ROOM), oldest first. Decrypts when the chat is encrypted. */
async function fetchRoom(client, room, since) {
  const me = client.getUserId();
  const encrypted = room.hasEncryptionStateEvent();
  const mapper = client.getEventMapper();
  const filter = JSON.stringify({ types: encrypted ? ['m.room.message', 'm.room.encrypted'] : ['m.room.message'], lazy_load_members: true });
  const path = `/rooms/${encodeURIComponent(room.roomId)}/messages`;
  const out = [];
  let from = null;
  for (let page = 0; page < 30 && out.length < PER_ROOM; page++) {
    const params = { dir: 'b', limit: '100', filter };
    if (from) params.from = from;
    // eslint-disable-next-line no-await-in-loop
    const res = await client.http.authedRequest(Method.Get, path, params);
    const evs = (res.chunk || []).map(mapper);
    if (encrypted) await Promise.all(evs.map((e) => client.decryptEventIfNeeded(e).catch(() => {}))); // eslint-disable-line no-await-in-loop
    let stop = false;
    for (const ev of evs) {
      if (ev.getTs() <= since || Date.now() - ev.getTs() > MAX_AGE) { stop = true; break; }
      const m = messageLine(room, ev, me);
      if (m) out.push(m);
    }
    if (stop || !res.end || !(res.chunk || []).length) break;
    from = res.end;
  }
  return out.reverse();
}

const lastTs = (room) => {
  const evs = room.getLiveTimeline().getEvents();
  for (let i = evs.length - 1; i >= 0; i--) if (evs[i].getType() === 'm.room.message') return evs[i].getTs();
  return 0;
};

/** First pass over every chat (most recent first), then only what's new. Embeds as it goes. */
export function updateIndex(client) {
  if (running) return running;
  running = (async () => {
    const status = await aiStatus().catch(() => null);
    const p = aiPrefs();
    const embedOpts = { host: status?.ok ? status.host : null, model: p.aiEmbedModel };
    const known = await api().rooms();
    const list = client.getRooms()
      .filter((r) => !r.isSpaceRoom() && r.getMyMembership() === KnownMembership.Join)
      .map((r) => ({ r, ts: lastTs(r) }))
      .filter(({ r, ts }) => !known[r.roomId] || ts > (known[r.roomId].newest || 0))
      .sort((a, b) => b.ts - a.ts);
    setCrawl({ done: 0, total: list.length });
    let added = 0;
    for (const [i, { r }] of list.entries()) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const msgs = await fetchRoom(client, r, known[r.roomId]?.newest || 0);
        // eslint-disable-next-line no-await-in-loop
        added += await api().add({ roomId: r.roomId, room: cleanName(r.name || ''), messages: msgs, newest: msgs.at(-1)?.ts || 0 });
      } catch (err) {
        console.warn('[ask] could not read', r.roomId, err?.message || err);
      }
      setCrawl({ done: i + 1, total: list.length });
      // Embed in rounds so answers get good early, while the rest is still being read.
      if (embedOpts.host && added >= 200) { added = 0; await api().embed(embedOpts); } // eslint-disable-line no-await-in-loop
    }
    setCrawl(null);
    if (embedOpts.host) await api().embed(embedOpts);
    return api().status();
  })().finally(() => { running = null; setCrawl(null); });
  return running;
}

/** Keeps the index up to date while Ask Relay is available: shortly after start, then every 15 minutes. */
export function useAskIndexer(client) {
  const ready = useAskReady();
  useEffect(() => {
    if (!ready || !client) return undefined;
    const run = () => updateIndex(client).catch((err) => console.warn('[ask] indexing failed', err));
    const first = setTimeout(run, 20000);
    const every = setInterval(run, REFRESH);
    return () => { clearTimeout(first); clearInterval(every); };
  }, [ready, client]);
}

/** Index status from the main process, plus what the window is reading. */
export function useAskStatus() {
  const [st, setSt] = useState(null);
  const reading = useSyncExternalStore((l) => { crawlListeners.add(l); return () => crawlListeners.delete(l); }, () => crawl);
  useEffect(() => {
    if (!api()) return undefined;
    api().status().then(setSt).catch(() => {});
    return api().onProgress(setSt);
  }, []);
  return st && { ...st, reading };
}

// ---------- Asking ----------

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The line (and its event) in a chunk that best matches the question, for the jump. */
export function bestLine(chunk, question) {
  const words = fold(question).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);
  const lines = chunk.text.split('\n');
  let best = 0;
  let score = -1;
  lines.forEach((l, i) => {
    const t = fold(l);
    const s = words.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
    if (s > score) { score = s; best = i; }
  });
  return { index: best, line: lines[best], eventId: chunk.events[best] || chunk.events[0] };
}

/** A sentence for why search fell back to keywords, or null. */
export function fallbackText(note) {
  if (!note) return null;
  if (note === 'no-embed-model') return 'LM Studio has no embedding model, so this is a keyword search. Download one in LM Studio (search for “embed”) for search by meaning.';
  if (note === 'not-embedded') return 'Search by meaning isn’t ready yet, so this is a keyword search.';
  if (note === 'model-changed') return 'The embedding model changed; until the index is rebuilt, this is a keyword search.';
  return 'Search by meaning didn’t answer, so this is a keyword search.';
}

/**
 * Searches and answers. onSources(results, info) once the excerpts are known; onText(text) streams
 * the answer. Returns { cancel, done }; done resolves to { ok, text, sources, error }.
 */
export function askRelay(question, { onText, onSources, before } = {}) {
  let job = null;
  let cancelled = false;
  const done = (async () => {
    await before;
    if (cancelled) return { ok: false, error: 'cancelled', sources: [] };
    const st = await aiStatus().catch(() => null);
    if (!st?.ok) return { ok: false, error: aiErrorText(st?.error || 'unreachable', st?.host), sources: [] };
    let found;
    try { found = await api().search({ query: question, host: st.host, model: aiPrefs().aiEmbedModel, k: 8 }); }
    catch (err) { return { ok: false, error: String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), sources: [] }; }
    const sources = found.results || [];
    if (cancelled) return { ok: false, error: 'cancelled', sources };
    onSources?.(sources, { mode: found.mode, note: found.note });
    if (!sources.length) return { ok: true, text: '', sources, mode: found.mode };
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const context = sources.map((s, i) => `[${i + 1}] Chat “${s.room}”:\n${s.text}`).join('\n\n');
    const lang = guessLanguage(`Q: ${question}`, 2);
    const langRule = lang ? `Answer in ${lang}, the language of the question.` : 'Answer in the same language the question is written in.';
    job = streamChat({
      task: 'summary', maxTokens: 600, temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: [
            `You are Ask Relay, the assistant in the user’s messaging app. Today is ${today}.`,
            'Answer the user’s question using ONLY the numbered excerpts from their chats below. In the excerpts, “You” is the user; other names are the people they talk to.',
            'Be direct: the answer first, in 1 to 4 sentences, with names and dates when they help.',
            'Right after each fact, cite the excerpt it came from with its number in square brackets, like [2] or [1, 3].',
            'If the excerpts don’t contain the answer, say so in one sentence and suggest what to search for instead. Never make anything up.',
            langRule,
          ].join('\n'),
        },
        { role: 'user', content: `Excerpts:\n\n${context}\n\nQuestion: ${question}\n\n(${langRule})` },
      ],
      onText: (t) => onText?.(t),
    });
    const res = await job.done;
    return { ok: res.ok, text: res.text || '', error: res.error, sources, mode: found.mode };
  })();
  return { cancel: () => { cancelled = true; job?.cancel(); }, done };
}
