import { useEffect, useMemo, useState } from 'react';
import { KnownMembership } from 'matrix-js-sdk';
import Avatar from './Avatar.jsx';
import { roomAvatar, lastMessage, effectiveContent, cleanName } from '../matrix.js';
import { detectNetwork, networkInfo } from '../networks.js';

/** Content to re-send: the latest (edited) version, without reply/edit relations. */
export function forwardContent(ev) {
  const c = { ...effectiveContent(ev) };
  delete c['m.relates_to'];
  delete c['m.new_content'];
  delete c.formatted_body;
  delete c.format;
  delete c['m.mentions'];
  return c;
}

export default function ForwardDialog({ client, events, onClose, onDone }) {
  const [q, setQ] = useState('');
  const [targets, setTargets] = useState(() => new Set());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const rooms = useMemo(() => client.getRooms()
    .filter((r) => r.getMyMembership() === KnownMembership.Join && !r.isSpaceRoom())
    // Skip the bridges' own control rooms (no m.bridge marker, a bridge bot inside).
    .filter((r) => r.currentState.getStateEvents('m.bridge').length || !r.getJoinedMembers().some((m) => /^@[a-z]+bot:/.test(m.userId)))
    .map((r) => ({ room: r, name: cleanName(r.name || ''), ts: lastMessage(r)?.getTs() || 0, net: detectNetwork(r) }))
    .filter((r) => r.ts)
    .sort((a, b) => b.ts - a.ts), [client]);

  const query = q.trim().toLowerCase();
  const shown = (query ? rooms.filter((r) => r.name.toLowerCase().includes(query)) : rooms).slice(0, 80);

  const toggle = (id) => setTargets((t) => { const n = new Set(t); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      for (const roomId of targets) {
        for (const ev of events) await client.sendMessage(roomId, forwardContent(ev));
      }
      onDone(targets.size);
    } catch (err) {
      setError(err.message);
      setSending(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog forward" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>Forward {events.length > 1 ? `${events.length} messages` : 'message'}</h2>
          <button className="ghost" onClick={onClose}>✕</button>
        </header>
        <input className="fw-search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" />
        <div className="fw-list">
          {shown.map((r) => (
            <button key={r.room.roomId} className={`fw-row ${targets.has(r.room.roomId) ? 'on' : ''}`} onClick={() => toggle(r.room.roomId)}>
              <Avatar src={roomAvatar(client, r.room, 64)} name={r.name} id={r.room.roomId} size={34} network={r.net} />
              <span className="fw-name">{r.name}<span className="muted small">{networkInfo(r.net).name}</span></span>
              <span className={`sel-check static ${targets.has(r.room.roomId) ? 'on' : ''}`}>{targets.has(r.room.roomId) ? '✓' : ''}</span>
            </button>
          ))}
          {!shown.length && <div className="ip-empty">No chats found.</div>}
        </div>
        {error && <div className="error">{error}</div>}
        <footer>
          <span className="muted small">{targets.size ? `${targets.size} chat${targets.size > 1 ? 's' : ''} selected` : 'Pick one or more chats'}</span>
          <button className="primary" disabled={!targets.size || sending} onClick={send}>{sending ? 'Sending…' : 'Forward'}</button>
        </footer>
      </div>
    </div>
  );
}
