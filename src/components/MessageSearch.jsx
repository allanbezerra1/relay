// Message search across every chat. Bridged rooms aren't end-to-end encrypted, so the homeserver
// can search them (POST /search); on top of that we scan the history already loaded here, which
// also catches partial words, accents typed differently and encrypted chats the server can't read.
import { useEffect, useMemo, useRef, useState } from 'react';
import { EventType } from 'matrix-js-sdk';
import Avatar from './Avatar.jsx';
import { roomAvatar, memberAvatar, senderName, mediaUrl, isDisplayable, effectiveContent, stripReplyFallback } from '../matrix.js';
import { fold, bestScore, highlight, snippet } from '../fuzzy.js';
import { networkInfo } from '../networks.js';

const P = {
  search: 'M10 2a8 8 0 0 1 6.32 12.9l5.39 5.4-1.42 1.4-5.39-5.38A8 8 0 1 1 10 2Zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z',
  chat: 'M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Z',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4 0-7 2-7 4.5V20h14v-1.5C19 16 16 14 12 14Z',
  chevron: 'M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6 1.4-1.4Z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z',
  photo: 'M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2ZM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5l3.5-4.5Z',
  video: 'M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4Z',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm2 16H8v-2h8v2Zm0-4H8v-2h8v2Zm-3-5V3.5L18.5 9H13Z',
  link: 'M3.9 12a3.1 3.1 0 0 1 3.1-3.1h4V7H7a5 5 0 0 0 0 10h4v-1.9H7A3.1 3.1 0 0 1 3.9 12ZM8 13h8v-2H8v2Zm9-6h-4v1.9h4a3.1 3.1 0 0 1 0 6.2h-4V17h4a5 5 0 0 0 0-10Z',
  audio: 'M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z',
};
const Svg = ({ d, size = 16 }) => <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" d={d} /></svg>;

const TYPES = [['all', 'All'], ['text', 'Text'], ['image', 'Photos'], ['video', 'Videos'], ['file', 'Files'], ['link', 'Links']];
const PERIODS = [['all', 'Any time'], ['today', 'Today'], ['7d', '7 days'], ['30d', '30 days']];
const LINK = /https?:\/\/\S+/i;
const PAGE = 50;

function since(period) {
  if (period === 'today') { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
  if (period === '7d') return Date.now() - 7 * 86400000;
  if (period === '30d') return Date.now() - 30 * 86400000;
  return 0;
}

function matchesType(r, type) {
  switch (type) {
    case 'text': return r.msgtype === 'm.text' || r.msgtype === 'm.notice' || r.msgtype === 'm.emote';
    case 'image': return r.msgtype === 'm.image' || r.sticker;
    case 'video': return r.msgtype === 'm.video';
    case 'file': return r.msgtype === 'm.file' || r.msgtype === 'm.audio';
    case 'link': return LINK.test(r.body);
    default: return true;
  }
}

/** Normalized result from either a timeline event or a raw server event. */
function toResult(raw) {
  const c = raw.content || {};
  return {
    id: raw.event_id, roomId: raw.room_id, sender: raw.sender, ts: raw.origin_server_ts,
    msgtype: c.msgtype, sticker: raw.type === EventType.Sticker,
    body: stripReplyFallback(c.body || ''), url: c.info?.thumbnail_url || c.url || null,
  };
}

function scanLoaded(rooms, { words, roomId, sender }) {
  const out = [];
  for (const r of rooms) {
    if (roomId && r.id !== roomId) continue;
    for (const ev of r.room.getLiveTimeline().getEvents()) {
      if (!isDisplayable(ev) || ev.isRedacted() || ev.getType() === EventType.RoomMessageEncrypted) continue;
      if (sender && ev.getSender() !== sender) continue;
      const res = toResult({ ...ev.event, content: effectiveContent(ev), room_id: r.id });
      if (words.length) {
        const hay = fold(res.body);
        if (!words.every((w) => hay.includes(w))) continue;
      }
      out.push(res);
    }
  }
  return out;
}

const dateLabel = (ts) => {
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  if (d.toDateString() === new Date(now - 86400000).toDateString()) return `Yesterday ${time}`;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
};

function Hl({ text, query }) {
  return highlight(text, query).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : p.text));
}

/** Chip that opens a small searchable list (chat or person). */
function FilterPicker({ icon, label, value, options, onChange, allLabel }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const list = useMemo(() => {
    const f = fold(q.trim());
    const items = f ? options.map((o) => ({ o, s: bestScore([o.label], f) })).filter((x) => x.s < Infinity).sort((a, b) => a.s - b.s).map((x) => x.o) : options;
    return [{ value: null, label: allLabel }, ...items.slice(0, 60)];
  }, [q, options, allLabel]);
  useEffect(() => setSel(0), [q]);
  const current = options.find((o) => o.value === value);
  const pick = (v) => { onChange(v); setOpen(false); setQ(''); };
  return (
    <div className="ms-picker" ref={ref}>
      <button className={`ms-chip ${value ? 'on' : ''}`} onClick={() => setOpen(!open)}>
        <Svg d={icon} size={14} />
        <span className="ms-chip-label">{current ? current.label : label}</span>
        {value
          ? <span className="ms-chip-x" onClick={(e) => { e.stopPropagation(); onChange(null); }} title="Clear"><Svg d={P.close} size={12} /></span>
          : <Svg d={P.chevron} size={14} />}
      </button>
      {open && (
        <div className="ms-pop">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(list.length - 1, s + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); pick(list[sel]?.value ?? null); }
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
            }} />
          <div className="ms-pop-list">
            {list.map((o, i) => (
              <button key={o.value || 'all'} className={`${i === sel ? 'sel' : ''} ${o.value === value ? 'cur' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => pick(o.value)}>
                {o.avatar || <span className="ms-pop-all"><Svg d={icon} size={13} /></span>}
                <span>{o.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function MessageSearch({ client, rooms, initial = {}, onJump, onClose }) {
  const [q, setQ] = useState(initial.query || '');
  const [roomId, setRoomId] = useState(initial.roomId || null);
  const [sender, setSender] = useState(null);
  const [type, setType] = useState('all');
  const [period, setPeriod] = useState('all');
  const [server, setServer] = useState({ results: [], next: null, count: 0, error: null, loading: false });
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const reqId = useRef(0);
  const me = client.getUserId();
  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);

  const query = q.trim();
  const words = useMemo(() => fold(query).split(/\s+/).filter(Boolean), [query]);
  const active = !!query || type !== 'all' || !!sender;

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  // ----- Server search (debounced) -----
  const searchBody = (term) => ({
    search_categories: {
      room_events: {
        search_term: term,
        order_by: 'recent',
        keys: ['content.body'],
        filter: {
          limit: PAGE,
          types: [EventType.RoomMessage, EventType.Sticker],
          ...(roomId ? { rooms: [roomId] } : {}),
          ...(sender ? { senders: [sender] } : {}),
          ...(['image', 'video', 'file'].includes(type) ? { contains_url: true } : {}),
        },
      },
    },
  });

  useEffect(() => {
    const id = ++reqId.current;
    if (!query) { setServer({ results: [], next: null, count: 0, error: null, loading: false }); return undefined; }
    setServer((s) => ({ ...s, loading: true }));
    const t = setTimeout(async () => {
      try {
        const res = await client.search({ body: searchBody(query) });
        if (id !== reqId.current) return;
        const re = res.search_categories?.room_events || {};
        setServer({ results: (re.results || []).map((x) => toResult(x.result)), next: re.next_batch || null, count: re.count || 0, error: null, loading: false });
      } catch (err) {
        if (id !== reqId.current) return;
        console.warn('Server search failed', err);
        setServer({ results: [], next: null, count: 0, error: err.message || String(err), loading: false });
      }
    }, 280);
    return () => clearTimeout(t);
  }, [query, roomId, sender, type, client]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = async () => {
    if (!server.next || server.loading) return;
    const id = reqId.current;
    setServer((s) => ({ ...s, loading: true }));
    try {
      const res = await client.search({ body: searchBody(query), next_batch: server.next });
      if (id !== reqId.current) return;
      const re = res.search_categories?.room_events || {};
      setServer((s) => ({ ...s, results: [...s.results, ...(re.results || []).map((x) => toResult(x.result))], next: re.next_batch || null, loading: false }));
    } catch (err) {
      setServer((s) => ({ ...s, loading: false, error: err.message }));
    }
  };

  // ----- Merge, filter, group -----
  const results = useMemo(() => {
    if (!active) return [];
    const local = scanLoaded(rooms, { words, roomId, sender });
    const byId = new Map();
    for (const r of [...local, ...server.results]) if (r.id && !byId.has(r.id) && roomById.has(r.roomId)) byId.set(r.id, r);
    const from = since(period);
    return [...byId.values()]
      .filter((r) => r.ts >= from && matchesType(r, type))
      .sort((a, b) => b.ts - a.ts);
  }, [active, rooms, words, roomId, sender, server.results, period, type, roomById]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const r of results) (map.get(r.roomId) || map.set(r.roomId, []).get(r.roomId)).push(r);
    return [...map.entries()].map(([id, items]) => ({ info: roomById.get(id), items }));
  }, [results, roomById]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => setSel(0), [query, roomId, sender, type, period]);
  useEffect(() => { listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  // ----- Filter options -----
  const roomOptions = useMemo(() => rooms.filter((r) => !r.invite).slice(0, 400).map((r) => ({
    value: r.id, label: r.name,
    avatar: <Avatar src={roomAvatar(client, r.room, 40)} name={r.name} id={r.id} size={20} />,
  })), [rooms, client]);
  const peopleOptions = useMemo(() => {
    const seen = new Map([[me, { value: me, label: 'You', avatar: <Avatar name="You" id={me} size={20} /> }]]);
    for (const r of rooms) {
      if (roomId && r.id !== roomId) continue;
      for (const m of r.room.getJoinedMembers()) {
        if (seen.has(m.userId) || /bot:/.test(m.userId)) continue;
        const name = senderName(r.room, m.userId);
        seen.set(m.userId, { value: m.userId, label: name, avatar: <Avatar src={memberAvatar(client, r.room, m.userId, 40)} name={name} id={m.userId} size={20} /> });
        if (seen.size > 1500) break;
      }
    }
    return [...seen.values()];
  }, [rooms, roomId, me, client]);

  const jump = (r) => { onJump(r.roomId, r.id); onClose(); };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(flat.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === 'Enter' && flat[sel]) { e.preventDefault(); jump(flat[sel]); }
  };

  const kindIcon = (r) => (r.msgtype === 'm.image' || r.sticker ? P.photo : r.msgtype === 'm.video' ? P.video : r.msgtype === 'm.audio' ? P.audio : r.msgtype === 'm.file' ? P.file : null);
  const kindLabel = (r) => (r.sticker ? 'Sticker' : r.msgtype === 'm.image' ? 'Photo' : r.msgtype === 'm.video' ? 'Video' : r.msgtype === 'm.audio' ? 'Audio' : r.msgtype === 'm.file' ? 'File' : '');
  const roomCount = groups.length;
  const more = server.count > server.results.length && server.next;

  let idx = -1;
  return (
    <div className="overlay ms-overlay" onMouseDown={onClose}>
      <div className="ms-panel" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Search messages">
        <div className="ms-top">
          <div className="ms-input">
            <Svg d={P.search} size={18} />
            <input ref={inputRef} autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} spellCheck={false}
              placeholder={roomId ? `Search in ${roomById.get(roomId)?.name || 'this chat'}…` : 'Search messages in all chats…'} />
            {server.loading && <span className="spinner small" />}
            {q && <button className="ms-clear" onClick={() => { setQ(''); inputRef.current?.focus(); }} title="Clear"><Svg d={P.close} size={14} /></button>}
          </div>
          <button className="ms-close" onClick={onClose} title="Close (Esc)"><Svg d={P.close} size={18} /></button>
        </div>

        <div className="ms-filters">
          <FilterPicker icon={P.chat} label="Chat" allLabel="All chats" value={roomId} options={roomOptions} onChange={(v) => { setRoomId(v); setSender(null); }} />
          <FilterPicker icon={P.person} label="Person" allLabel="Anyone" value={sender} options={peopleOptions} onChange={setSender} />
          <span className="ms-sep" />
          <div className="ms-seg" role="group" aria-label="Type">
            {TYPES.map(([v, label]) => <button key={v} className={type === v ? 'on' : ''} onClick={() => setType(v)}>{label}</button>)}
          </div>
        </div>

        <div className="ms-summary">
          {!active ? <span>All chats</span>
            : results.length
              ? <span><b>{results.length}{more ? '+' : ''}</b> result{results.length > 1 ? 's' : ''} in <b>{roomCount}</b> chat{roomCount > 1 ? 's' : ''}</span>
              : <span>{server.loading ? 'Searching…' : 'No results'}</span>}
          {server.error && <span className="ms-note" title={server.error}>Server search unavailable: loaded history only</span>}
          <div className="ms-seg ms-period" role="group" aria-label="Period">
            {PERIODS.map(([v, label]) => <button key={v} className={period === v ? 'on' : ''} onClick={() => setPeriod(v)}>{label}</button>)}
          </div>
        </div>

        <div className="ms-results" ref={listRef}>
          {!active && (
            <div className="ms-empty">
              <div className="ms-empty-icon"><Svg d={P.search} size={30} /></div>
              <h3>Search all your chats</h3>
              <p>Type a word, a name or part of a message. Accents don’t matter.</p>
              <div className="ms-quick">
                <button onClick={() => setType('image')}><Svg d={P.photo} size={14} />Photos</button>
                <button onClick={() => setType('link')}><Svg d={P.link} size={14} />Links</button>
                <button onClick={() => setType('file')}><Svg d={P.file} size={14} />Files</button>
                <button onClick={() => setSender(me)}><Svg d={P.person} size={14} />Sent by you</button>
              </div>
            </div>
          )}
          {active && !results.length && !server.loading && (
            <div className="ms-empty">
              <div className="ms-empty-icon"><Svg d={P.search} size={30} /></div>
              <h3>No messages found</h3>
              <p>Try other words or loosen the filters.{!query && ' Without text, only messages already loaded are searched.'}</p>
            </div>
          )}
          {groups.map((g) => (
            <section key={g.info.id} className="ms-group">
              <header className="ms-group-head">
                <Avatar src={roomAvatar(client, g.info.room, 48)} name={g.info.name} id={g.info.id} size={24} />
                <span className="ms-group-name">{g.info.name}</span>
                <span className="ms-group-net">{networkInfo(g.info.network).name}</span>
                <span className="ms-group-count">{g.items.length}</span>
              </header>
              {g.items.map((r) => {
                idx += 1;
                const i = idx;
                const icon = kindIcon(r);
                const thumb = (r.msgtype === 'm.image' || r.sticker) && r.url ? mediaUrl(client, r.url, 96) : null;
                return (
                  <button key={r.id} data-idx={i} className={`ms-item ${i === sel ? 'sel' : ''}`} onMouseMove={() => sel !== i && setSel(i)} onClick={() => jump(r)}>
                    {thumb ? <img className="ms-thumb" src={thumb} alt="" loading="lazy" /> : icon ? <span className="ms-kind"><Svg d={icon} size={16} /></span> : null}
                    <span className="ms-body">
                      <span className="ms-meta">
                        <span className="ms-sender">{r.sender === me ? 'You' : senderName(g.info.room, r.sender)}</span>
                        <span className="ms-date">{dateLabel(r.ts)}</span>
                      </span>
                      <span className="ms-text">
                        {icon && <span className="ms-kind-label">{kindLabel(r)}{r.body && r.body !== kindLabel(r) ? ' · ' : ''}</span>}
                        <Hl text={snippet(r.body, query)} query={query} />
                      </span>
                    </span>
                  </button>
                );
              })}
            </section>
          ))}
          {more && (
            <button className="ms-more" onClick={loadMore} disabled={server.loading}>
              {server.loading ? 'Loading…' : `Load more results (${server.count - server.results.length} left)`}
            </button>
          )}
        </div>

        <div className="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> go to message</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
