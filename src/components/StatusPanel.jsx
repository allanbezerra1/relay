import { useEffect, useMemo, useRef, useState } from 'react';
import { MsgType } from 'matrix-js-sdk';
import Avatar from './Avatar.jsx';
import { memberAvatar, senderName, effectiveContent } from '../matrix.js';
import { useMedia } from '../media.js';

const DAY = 24 * 60 * 60 * 1000;
const SEEN_KEY = 'relay.statusSeen';
const IMAGE_MS = 5000;

const seenSet = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { return new Set(); } };
function markSeen(id) {
  const s = seenSet();
  if (s.has(id)) return;
  s.add(id);
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-2000))); } catch {}
}

/** The bridges' status rooms (WhatsApp's status@broadcast, one per account). */
export function statusRooms(client) {
  return client.getRooms().filter((r) => r.getMyMembership() === 'join'
    && r.currentState.getStateEvents('m.bridge').some((e) => e.getContent()?.channel?.id === 'status@broadcast'));
}

function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h === 1 ? '1 hour ago' : `${h} hours ago`;
}

/** Statuses from the last 24 h, grouped by person, newest people first. */
function collect(client, rooms) {
  const me = client.getUserId();
  const since = Date.now() - DAY;
  const byPerson = new Map();
  for (const room of rooms) {
    for (const ev of room.getLiveTimeline().getEvents()) {
      if (ev.getType() !== 'm.room.message' || ev.isRedacted() || ev.getTs() < since) continue;
      const c = effectiveContent(ev);
      if (![MsgType.Image, MsgType.Video, MsgType.Text].includes(c.msgtype)) continue;
      const who = ev.getSender();
      if (!byPerson.has(who)) byPerson.set(who, { userId: who, mine: who === me, room, name: senderName(room, who), avatar: memberAvatar(client, room, who, 96), items: [] });
      byPerson.get(who).items.push({ id: ev.getId(), ev, content: c, ts: ev.getTs() });
    }
  }
  const seen = seenSet();
  const people = [...byPerson.values()].map((p) => {
    p.items.sort((a, b) => a.ts - b.ts);
    p.last = p.items.at(-1).ts;
    p.unseen = p.items.filter((i) => !seen.has(i.id)).length;
    return p;
  });
  people.sort((a, b) => b.last - a.last);
  return people;
}

/** Ring around the avatar: one arc per status, coloured until seen. */
function Ring({ total, unseen, size = 52, children }) {
  const r = size / 2 - 2;
  const circ = 2 * Math.PI * r;
  const gap = total > 1 ? 4 : 0;
  const seg = circ / total;
  return (
    <span className="st-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {Array.from({ length: total }, (_, i) => (
          <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="2.5"
            className={i >= total - unseen ? 'unseen' : 'seen'}
            strokeDasharray={`${seg - gap} ${circ - seg + gap}`} strokeDashoffset={-i * seg}
            transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        ))}
      </svg>
      <span className="st-ring-in">{children}</span>
    </span>
  );
}

function Row({ p, onOpen }) {
  const lastItem = p.items.at(-1);
  return (
    <button className="st-row" onClick={onOpen}>
      <Ring total={p.items.length} unseen={p.unseen}><Avatar src={p.avatar} name={p.name} id={p.userId} size={44} /></Ring>
      <span className="st-meta">
        <span className="st-name">{p.mine ? 'My status' : p.name}</span>
        <span className="st-time">{ago(lastItem.ts)}{p.items.length > 1 ? ` · ${p.items.length} updates` : ''}</span>
      </span>
    </button>
  );
}

/** The Status tab: everyone who posted in the last day, then a stories-style viewer. */
export default function StatusPanel({ client, tick, receiptType, onReply }) {
  const rooms = useMemo(() => statusRooms(client), [client, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [loading, setLoading] = useState(true);
  const [viewer, setViewer] = useState(null); // { person index }
  const [, forceSeen] = useState(0);

  // Page back through each status room until we have the whole last day.
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const room of rooms) {
        for (let i = 0; i < 8; i++) {
          const first = room.getLiveTimeline().getEvents()[0];
          if (first && first.getTs() < Date.now() - DAY) break;
          const more = await client.paginateEventTimeline(room.getLiveTimeline(), { backwards: true, limit: 50 }).catch(() => false);
          if (!more) break;
        }
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [rooms.map((r) => r.roomId).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const people = collect(client, rooms);
  const mine = people.filter((p) => p.mine);
  const recent = people.filter((p) => !p.mine && p.unseen > 0);
  const viewed = people.filter((p) => !p.mine && p.unseen === 0);
  const ordered = [...mine, ...recent, ...viewed];

  return (
    <aside className="sidebar status-panel">
      <header className="sidebar-head">
        <div className="drag-region" />
        <div className="sidebar-title"><h2>Status</h2></div>
      </header>
      <div className="room-list">
        {!rooms.length && <div className="list-empty muted">Connect WhatsApp to see status updates.</div>}
        {rooms.length > 0 && !people.length && (
          <div className="list-empty muted">{loading ? 'Loading status updates…' : 'No status updates in the last 24 hours.'}</div>
        )}
        {mine.length > 0 && mine.map((p) => <Row key={p.userId} p={p} onOpen={() => setViewer({ index: ordered.indexOf(p) })} />)}
        {recent.length > 0 && <div className="st-section">Recent updates</div>}
        {recent.map((p) => <Row key={p.userId} p={p} onOpen={() => setViewer({ index: ordered.indexOf(p) })} />)}
        {viewed.length > 0 && <div className="st-section">Viewed updates</div>}
        {viewed.map((p) => <Row key={p.userId} p={p} onOpen={() => setViewer({ index: ordered.indexOf(p) })} />)}
        <p className="st-note muted small">Post a status from your phone. Viewing one here tells its author you saw it, like on the phone{receiptType() === 'm.read.private' ? ' (off: you use private read receipts)' : ''}.</p>
      </div>
      {viewer && (
        <StatusViewer client={client} people={ordered} start={viewer.index} receiptType={receiptType}
          onSeen={() => forceSeen((n) => n + 1)}
          onReply={(p) => { setViewer(null); onReply(p.userId, p.room); }}
          onClose={() => setViewer(null)} />
      )}
    </aside>
  );
}

function StatusMedia({ client, content, paused, onDuration, videoRef }) {
  const { url } = useMedia(client, content);
  if (content.msgtype === MsgType.Text) return <div className="sv-text">{content.body}</div>;
  if (!url) return <div className="spinner" />;
  if (content.msgtype === MsgType.Video) {
    return <video ref={videoRef} key={url} src={url} autoPlay playsInline onLoadedMetadata={(e) => onDuration(e.currentTarget.duration * 1000)} />;
  }
  return <img key={url} src={url} alt="" />;
}

const caption = (c) => (c.msgtype !== MsgType.Text && c.body && c.body !== c.filename && !/^(image|video)\.\w+$/i.test(c.body) ? c.body : '');

/** Full-screen stories viewer: progress bars, auto-advance, ← → / click sides, Space to pause. */
function StatusViewer({ client, people, start, receiptType, onSeen, onReply, onClose }) {
  const [pi, setPi] = useState(start);
  const [ii, setIi] = useState(() => {
    const p = people[start];
    const seen = seenSet();
    const first = p.items.findIndex((i) => !seen.has(i.id));
    return first >= 0 ? first : 0;
  });
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [duration, setDuration] = useState(IMAGE_MS);
  const videoRef = useRef(null);
  const person = people[pi];
  const item = person?.items[ii];

  const next = () => {
    if (ii < person.items.length - 1) setIi(ii + 1);
    else if (pi < people.length - 1) { setPi(pi + 1); setIi(0); }
    else onClose();
  };
  const prev = () => {
    if (ii > 0) setIi(ii - 1);
    else if (pi > 0) { setPi(pi - 1); setIi(people[pi - 1].items.length - 1); }
  };

  // New item: reset the timer, mark it seen and send the receipt (as the phone would).
  useEffect(() => {
    if (!item) return;
    setProgress(0);
    setDuration(item.content.msgtype === MsgType.Video ? (item.content.info?.duration || 15000) : IMAGE_MS);
    if (!person.mine) {
      markSeen(item.id);
      client.sendReadReceipt(item.ev, receiptType()).catch(() => {});
    }
    onSeen();
  }, [pi, ii]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (paused || !item) return undefined;
    const t = setInterval(() => {
      const v = videoRef.current;
      if (v && item.content.msgtype === MsgType.Video && Number.isFinite(v.duration) && v.duration > 0) {
        setProgress(v.currentTime / v.duration);
        if (v.ended) next();
        return;
      }
      setProgress((p) => {
        const n = p + 100 / duration;
        if (n >= 1) { setTimeout(next, 0); return 1; }
        return n;
      });
    }, 100);
    return () => clearInterval(t);
  }, [paused, pi, ii, duration]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const v = videoRef.current;
    if (v) { if (paused) v.pause(); else v.play().catch(() => {}); }
  }, [paused]);

  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === ' ') { e.preventDefault(); setPaused((p) => !p); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  if (!item) return null;
  const cap = caption(item.content);
  return (
    <div className="status-viewer" onClick={onClose}>
      <div className="sv-card" onClick={(e) => e.stopPropagation()}>
        <div className="sv-bars">
          {person.items.map((it, i) => (
            <i key={it.id}><b style={{ width: `${i < ii ? 100 : i === ii ? Math.round(progress * 100) : 0}%` }} /></i>
          ))}
        </div>
        <div className="sv-head">
          <Avatar src={person.avatar} name={person.name} id={person.userId} size={34} />
          <span className="sv-who"><b>{person.mine ? 'My status' : person.name}</b><small>{ago(item.ts)}</small></span>
          <button className="sv-icon" onClick={() => setPaused(!paused)} title={paused ? 'Play (Space)' : 'Pause (Space)'}>
            <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d={paused ? 'M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z' : 'M7 5h4v14H7zM13 5h4v14h-4z'} /></svg>
          </button>
          <button className="sv-icon" onClick={onClose} title="Close (Esc)">✕</button>
        </div>
        <div className="sv-media" onMouseDown={() => setPaused(true)} onMouseUp={() => setPaused(false)}>
          <StatusMedia key={item.id} client={client} content={item.content} paused={paused} videoRef={videoRef} onDuration={setDuration} />
          <button className="sv-tap left" onClick={prev} aria-label="Previous" />
          <button className="sv-tap right" onClick={next} aria-label="Next" />
        </div>
        {cap && <div className="sv-caption">{cap}</div>}
        {!person.mine && (
          <button className="sv-reply" onClick={() => onReply(person)}>
            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11Z" /></svg>
            Reply privately
          </button>
        )}
      </div>
    </div>
  );
}
