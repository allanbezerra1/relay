import { useMemo, useState, useEffect, useRef } from 'react';
import Avatar from './Avatar.jsx';
import { networkInfo } from '../networks.js';
import { roomAvatar } from '../matrix.js';

/** Subsequence match: "jdoe" matches "John Doe". Lower score is better. */
function score(name, q) {
  const n = name.toLowerCase();
  if (n.startsWith(q)) return 0;
  const idx = n.indexOf(q);
  if (idx >= 0) return 1 + idx / 100;
  let j = 0;
  for (let i = 0; i < n.length && j < q.length; i++) if (n[i] === q[j]) j++;
  return j === q.length ? 3 : Infinity;
}

export default function QuickSwitcher({ rooms, onPick, onClose }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef(null);
  const client = rooms[0]?.room.client;

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return rooms.filter((r) => !r.archived).slice(0, 12);
    return rooms
      .map((r) => ({ r, s: score(r.name, query) }))
      .filter((x) => x.s < Infinity)
      .sort((a, b) => a.s - b.s || b.r.ts - a.r.ts)
      .slice(0, 12)
      .map((x) => x.r);
  }, [rooms, q]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => { listRef.current?.children[sel]?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(results.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === 'Enter' && results[sel]) onPick(results[sel].id);
    else if (e.key === 'Escape') onClose();
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="switcher" onMouseDown={(e) => e.stopPropagation()}>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Jump to a chat…" />
        <div className="switcher-list" ref={listRef}>
          {results.map((r, i) => (
            <div key={r.id} className={`switcher-item ${i === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => onPick(r.id)}>
              <Avatar src={client && roomAvatar(client, r.room, 64)} name={r.name} id={r.id} size={28} network={r.network} />
              <span className="name">{r.name}</span>
              <span className="muted small">{networkInfo(r.network).name}</span>
            </div>
          ))}
          {results.length === 0 && <div className="muted list-empty">No matches</div>}
        </div>
      </div>
    </div>
  );
}
