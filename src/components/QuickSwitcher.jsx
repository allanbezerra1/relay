// Command palette (⌘K / Ctrl+K): one search box over chats, actions on the open chat,
// app-wide actions, settings sections and a "search messages for …" fallback.
// Typing ">" first shows only commands.
import { useMemo, useState, useEffect, useRef } from 'react';
import Avatar from './Avatar.jsx';
import { SECTIONS } from './Settings.jsx';
import { networkInfo } from '../networks.js';
import { roomAvatar, memberAvatar, cleanName } from '../matrix.js';
import { fold, bestScore } from '../fuzzy.js';
import { combo, MOD } from '../platform.js';
import { usePrefs, setPref } from '../prefs.js';
import { BRIDGE_BOT } from '../local.js';
import { schedulingAvailable } from '../scheduled.js';
import { emit } from '../bus.js';

const P = {
  archive: 'M20.54 5.23 19.15 3.55A1.45 1.45 0 0 0 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23A1.98 1.98 0 0 0 3 6.5V19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.5c0-.48-.17-.93-.46-1.27ZM6.24 5h11.52l.81.97H5.44l.8-.97ZM5 19V8h14v11H5Zm8.45-9h-2.9v3H8l4 4 4-4h-2.55v-3Z',
  pin: 'M16 3v2h-1v5l2 3v2h-4v6l-1 1-1-1v-6H7v-2l2-3V5H8V3h8Z',
  mute: 'M20 18.69 7.84 6.14 5.27 3.49 4 4.76l2.8 2.8v.01A6.96 6.96 0 0 0 6 11v5l-2 2v1h13.73l2 2L21 19.72l-1-1.03ZM12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm6-7.32V11a6.99 6.99 0 0 0-5.5-6.84V3a1.5 1.5 0 0 0-3 0v1.16c-.47.1-.92.26-1.34.46L18 14.68Z',
  bell: 'M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3a1.5 1.5 0 0 0-3 0v1.16A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z',
  read: 'M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7Zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41ZM.41 13.41 6 19l1.41-1.41L1.83 12 .41 13.41Z',
  unread: 'M20 6.54v10.91c0 .3-.24.55-.55.55H4.55A.55.55 0 0 1 4 17.45V6.55c0-.3.25-.55.55-.55h10.03a4 4 0 0 0 5.42.54ZM18 1a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  info: 'M11 7h2v2h-2V7Zm0 4h2v6h-2v-6Zm1-9a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z',
  compose: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z',
  readAll: 'M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7Zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41ZM.41 13.41 6 19l1.41-1.41L1.83 12 .41 13.41Z',
  inbox: 'M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm0 12h-4a3 3 0 0 1-6 0H5V5h14v10Z',
  gear: 'M19.43 12.98a7.8 7.8 0 0 0 0-1.96l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.3 7.3 0 0 0-1.69-.98l-.38-2.65A.49.49 0 0 0 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.49.49 0 0 0 .12.64l2.11 1.65a7.9 7.9 0 0 0 0 1.96l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM11 1h2v3h-2V1Zm0 19h2v3h-2v-3ZM1 11h3v2H1v-2Zm19 0h3v2h-3v-2ZM4.22 5.64l1.42-1.42 2.12 2.12-1.42 1.42-2.12-2.12Zm12.02 12.02 1.42-1.42 2.12 2.12-1.42 1.42-2.12-2.12ZM4.22 18.36l2.12-2.12 1.42 1.42-2.12 2.12-1.42-1.42ZM16.24 6.34l2.12-2.12 1.42 1.42-2.12 2.12-1.42-1.42Z',
  moon: 'M12.3 22A10 10 0 0 1 9.06 2.53a.75.75 0 0 1 .95.93 8 8 0 0 0 10.53 10.53.75.75 0 0 1 .93.95A10 10 0 0 1 12.3 22Z',
  monitor: 'M21 3H3a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h7v2H8v2h8v-2h-2v-2h7a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm0 13H3V5h18v11Z',
  search: 'M10 2a8 8 0 0 1 6.32 12.9l5.39 5.4-1.42 1.4-5.39-5.38A8 8 0 1 1 10 2Zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z',
  bolt: 'M7 2v11h3v9l7-12h-4l4-8H7Z',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7Z',
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2Z',
  enter: 'M19 7v4H5.83l3.58-3.59L8 6l-6 6 6 6 1.41-1.41L5.83 13H21V7h-2Z',
};

const Svg = ({ d, size = 17 }) => <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" d={d} /></svg>;

const RECENT_KEY = 'relay.palette.recent';
const loadRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } };
const pushRecent = (key) => {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([key, ...loadRecent().filter((k) => k !== key)].slice(0, 12))); } catch {}
};

const BOT = /bot:/;

/** Everyone you share a chat with (minus bridge bots), for "New conversation". */
function collectPeople(client, rooms) {
  const me = client.getUserId();
  const seen = new Map();
  for (const r of rooms) {
    for (const m of r.room.getJoinedMembers()) {
      if (m.userId === me || BOT.test(m.userId) || BRIDGE_BOT.test(m.userId) || seen.has(m.userId)) continue;
      seen.set(m.userId, { userId: m.userId, name: cleanName(m.name || m.userId), from: r });
      if (seen.size > 4000) return [...seen.values()];
    }
  }
  return [...seen.values()];
}

export default function QuickSwitcher({ client, rooms, active, actions, view, isLocal, onPick, onClose, onSettings, onSearchMessages, onView }) {
  const [q, setQ] = useState('');
  const [mode, setMode] = useState('root'); // 'root' | 'people'
  const [sel, setSel] = useState(0);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const recent = useMemo(loadRecent, []);
  const { theme } = usePrefs();

  // ----- Items -----
  const chatItem = (r) => ({
    key: `room:${r.id}`, kind: 'chat', title: r.name,
    subtitle: r.archived ? `Archived · ${networkInfo(r.network).name}` : networkInfo(r.network).name,
    keywords: [r.account?.name], ts: r.ts, unread: r.unread || r.markedUnread,
    avatar: <Avatar src={roomAvatar(client, r.room, 64)} name={r.name} id={r.id} size={34} network={r.network} />,
    run: () => onPick(r.id),
  });

  const actionItems = useMemo(() => {
    const a = [];
    const add = (key, title, icon, run, extra = {}) => a.push({ key: `act:${key}`, kind: 'action', title, icon, run, ...extra });
    if (active) {
      const r = active;
      const ctx = { group: 'chat', subtitle: r.name };
      add('archive', r.archived ? 'Move chat to inbox' : 'Archive chat', P.archive, () => actions.toggleArchive(r), { ...ctx, keywords: ['archive', 'unarchive', 'inbox'] });
      add('pin', r.pinned ? 'Unpin chat' : 'Pin chat to top', P.pin, () => actions.togglePin(r), { ...ctx, keywords: ['pin', 'favorite', 'top'] });
      add('mute', r.muted ? 'Unmute chat' : 'Mute chat', r.muted ? P.bell : P.mute, () => actions.toggleMute(r), { ...ctx, keywords: ['mute', 'silence', 'notifications'] });
      if (r.unread || r.markedUnread) add('read', 'Mark as read', P.read, () => actions.markRead(r), ctx);
      else add('unread', 'Mark as unread', P.unread, () => actions.markUnread(r), ctx);
      add('info', 'Show chat details', P.info, () => emit('show-info'), { ...ctx, keywords: ['info', 'profile', 'media', 'members', 'participants'] });
      add('search-here', 'Search in this chat', P.search, () => onSearchMessages({ roomId: r.id }), { ...ctx, keywords: ['find', 'messages'] });
      if (schedulingAvailable()) add('schedule-here', 'Schedule a message', P.clock, () => emit('schedule-open'), { ...ctx, keywords: ['send later', 'scheduled', 'timer'] });
    }
    const g = { group: 'app' };
    add('search', 'Search messages', P.search, () => onSearchMessages({}), { ...g, hint: combo('Shift+F'), keywords: ['find', 'lookup'] });
    add('new', 'New conversation', P.compose, () => { setMode('people'); setQ(''); return false; }, { ...g, keywords: ['start', 'contact', 'person', 'message', 'dm'] });
    add('read-all', 'Mark all as read', P.readAll, () => rooms.filter((r) => !r.archived && (r.unread || r.markedUnread)).forEach((r) => actions.markRead(r)), { ...g, keywords: ['clear', 'unread'] });
    if (view === 'inbox') add('archived', 'Go to Archive', P.archive, () => onView('archive'), { ...g, keywords: ['archived'] });
    else add('inbox', 'Go to Inbox', P.inbox, () => onView('inbox'), { ...g, keywords: ['home', 'chats'] });
    if (schedulingAvailable()) add('scheduled', 'Scheduled messages', P.clock, () => onSettings('scheduled'), { ...g, keywords: ['send later', 'schedule'] });
    add('quick', 'Quick replies', P.bolt, () => onSettings('quickreplies'), { ...g, keywords: ['shortcuts', 'templates', 'canned', 'snippets'] });
    const next = theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system';
    const themeName = { system: 'system', dark: 'dark', light: 'light' };
    add('theme', `Switch theme (now: ${themeName[theme]})`, theme === 'dark' ? P.moon : theme === 'light' ? P.sun : P.monitor, () => { setPref('theme', next); return false; },
      { ...g, keywords: ['appearance', 'dark mode', 'light mode'], subtitle: `Next: ${themeName[next]}` });
    for (const [t, label, icon] of [['light', 'Light theme', P.sun], ['dark', 'Dark theme', P.moon], ['system', 'System theme', P.monitor]]) {
      add(`theme-${t}`, label, icon, () => setPref('theme', t), { group: 'theme', keywords: ['appearance', 'mode', t], current: theme === t });
    }
    add('settings', 'Settings', P.gear, () => onSettings('general'), { ...g, hint: combo(','), keywords: ['preferences', 'options'] });
    for (const s of SECTIONS) {
      if (s.id === 'general' || (s.localOnly && !isLocal)) continue;
      add(`settings-${s.id}`, `Settings › ${s.label}`, s.icon, () => onSettings(s.id), { group: 'settings', keywords: [s.label] });
    }
    return a;
  }, [active, actions, rooms, view, theme, isLocal, onSearchMessages, onSettings, onView]); // eslint-disable-line react-hooks/exhaustive-deps

  const people = useMemo(() => (mode === 'people' ? collectPeople(client, rooms) : []), [mode, client, rooms]);

  // ----- Sections -----
  const sections = useMemo(() => {
    // ">" narrows the list to commands, like in code editors.
    const commandsOnly = mode === 'root' && q.trimStart().startsWith('>');
    const query = fold(q.trim().replace(commandsOnly ? /^>\s*/ : /^$/, ''));
    if (mode === 'people') {
      const list = (query
        ? people.map((p) => ({ p, s: bestScore([p.name], query) })).filter((x) => x.s < (query.length > 3 ? Infinity : 3)).sort((a, b) => a.s - b.s)
        : people.map((p) => ({ p, s: 0 }))
      ).slice(0, 40).map(({ p }) => ({
        key: `person:${p.userId}`, kind: 'person', title: p.name, subtitle: networkInfo(p.from.network).name,
        avatar: <Avatar src={memberAvatar(client, p.from.room, p.userId, 64)} name={p.name} id={p.userId} size={34} network={p.from.network} />,
        run: () => actions.openDirect(p.userId, p.from),
      }));
      return [{ title: 'People', items: list }];
    }

    const allActions = actionItems;
    if (commandsOnly) {
      const acts = query
        ? allActions.map((x) => ({ x, s: bestScore([x.title, ...(x.keywords || [])], query) })).filter((y) => y.s < 2.5).sort((a, b) => a.s - b.s).map((y) => y.x)
        : allActions.filter((x) => x.group !== 'theme');
      return [{ title: 'Commands', items: acts }].filter((s) => s.items.length);
    }
    if (!query) {
      const byKey = new Map([...rooms.map((r) => [`room:${r.id}`, r]), ...allActions.map((x) => [x.key, x])]);
      // The open chat is already on screen: no point offering it.
      const rec = recent.map((k) => byKey.get(k)).filter((x) => x && x.id !== active?.id).slice(0, 5)
        .map((x) => (x.room ? chatItem(x) : x));
      const recKeys = new Set(rec.map((x) => x.key));
      const out = [];
      if (rec.length) out.push({ title: 'Recent', items: rec });
      // The section header already names the chat, so its actions drop the subtitle here.
      if (active) out.push({ title: active.name, items: allActions.filter((x) => x.group === 'chat' && !recKeys.has(x.key)).map((x) => ({ ...x, subtitle: null })) });
      out.push({ title: 'Chats', items: rooms.filter((r) => !r.archived && r.id !== active?.id && !recKeys.has(`room:${r.id}`)).slice(0, 6).map(chatItem) });
      out.push({ title: 'Actions', items: allActions.filter((x) => x.group === 'app' && !recKeys.has(x.key)) });
      return out.filter((s) => s.items.length);
    }

    const recentRank = (key) => { const i = recent.indexOf(key); return i < 0 ? 0 : 0.3 - i * 0.02; };
    const chats = rooms
      .map((r) => ({ r, s: bestScore([r.name, r.account?.name], query) - recentRank(`room:${r.id}`) + (r.archived ? 0.2 : 0) }))
      // Scattered letters only count once the query is long enough to mean something.
      .filter((x) => x.s < (query.length > 3 ? Infinity : 3))
      .sort((a, b) => a.s - b.s || b.r.ts - a.r.ts)
      .slice(0, 8)
      .map((x) => chatItem(x.r));
    const acts = allActions
      .map((x) => ({ x, s: bestScore([x.title, ...(x.keywords || [])], query) - recentRank(x.key) }))
      .filter((y) => y.s < 2.5) // loose subsequences of keywords are noise
      .sort((a, b) => a.s - b.s)
      .slice(0, 8)
      .map((y) => y.x);
    const out = [];
    // Whichever kind matches best goes first, so "arch" puts Archive above a chat named Archie.
    const bestChat = chats.length ? bestScore([chats[0].title], query) : Infinity;
    const bestAct = acts.length ? bestScore([acts[0].title, ...(acts[0].keywords || [])], query) : Infinity;
    const chatSec = { title: 'Chats', items: chats };
    const actSec = { title: 'Actions', items: acts };
    if (bestAct < bestChat) out.push(actSec, chatSec); else out.push(chatSec, actSec);
    out.push({
      title: 'Messages',
      items: [{
        key: 'search-msgs', kind: 'search', title: `Search messages for “${q.trim()}”`, icon: P.search,
        subtitle: 'In all chats', hint: combo('Shift+F'), run: () => onSearchMessages({ query: q.trim() }),
      }],
    });
    return out.filter((s) => s.items.length);
  }, [q, mode, rooms, actionItems, people, recent, active]); // eslint-disable-line react-hooks/exhaustive-deps

  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  useEffect(() => setSel(0), [q, mode]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const run = (item) => {
    if (!item) return;
    if (item.kind !== 'person' && item.key !== 'search-msgs') pushRecent(item.key);
    const keepOpen = item.run() === false;
    if (!keepOpen) onClose();
    else inputRef.current?.focus();
  };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % Math.max(1, flat.length)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + flat.length) % Math.max(1, flat.length)); }
    else if (e.key === 'PageDown') { e.preventDefault(); setSel((s) => Math.min(flat.length - 1, s + 6)); }
    else if (e.key === 'PageUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 6)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(flat[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); if (mode !== 'root') { setMode('root'); setQ(''); } else onClose(); }
    else if (e.key === 'Backspace' && !q && mode !== 'root') { e.preventDefault(); setMode('root'); }
  };

  let idx = -1;
  return (
    <div className="overlay palette-overlay" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <div className="palette-input">
          {mode === 'people'
            ? <button className="palette-crumb" onClick={() => { setMode('root'); setQ(''); inputRef.current?.focus(); }} title="Back (Esc)"><Svg d={P.back} size={14} />New conversation</button>
            : <Svg d={P.search} size={18} />}
          <input ref={inputRef} autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} spellCheck={false}
            placeholder={mode === 'people' ? 'Who do you want to talk to?' : 'Search chats, actions and settings…'} />
          <kbd className="palette-esc">Esc</kbd>
        </div>
        <div className="palette-list" ref={listRef}>
          {sections.map((s) => (
            <div key={s.title} className="palette-section">
              <div className="palette-head">{s.title}</div>
              {s.items.map((item) => {
                idx += 1;
                const i = idx;
                return (
                  <div key={item.key} data-idx={i} className={`palette-item ${i === sel ? 'sel' : ''}`}
                    onMouseMove={() => sel !== i && setSel(i)} onClick={() => run(item)}>
                    {item.avatar || <span className={`palette-icon ${item.kind === 'search' ? 'accent' : ''}`}><Svg d={item.icon} /></span>}
                    <span className="palette-text">
                      <span className="palette-title">{item.title}</span>
                      {item.subtitle && <span className="palette-sub">{item.subtitle}</span>}
                    </span>
                    {item.unread ? <i className="palette-dot" /> : null}
                    {item.current && <span className="palette-badge">Current</span>}
                    {item.hint && <kbd className="palette-kbd">{item.hint}</kbd>}
                    {i === sel && <span className="palette-enter"><Svg d={P.enter} size={14} /></span>}
                  </div>
                );
              })}
            </div>
          ))}
          {flat.length === 0 && (
            <div className="palette-empty">
              <Svg d={P.search} size={28} />
              <div>{mode === 'people' ? 'Nobody by that name in your chats' : 'No results'}</div>
            </div>
          )}
        </div>
        <div className="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>Esc</kbd> {mode === 'root' ? 'close' : 'back'}</span>
          {mode === 'root' && <span><kbd>&gt;</kbd> commands only</span>}
          <span className="palette-foot-right"><kbd>{MOD}</kbd><kbd>K</kbd></span>
        </div>
      </div>
    </div>
  );
}
