import { useMemo, useState } from 'react';
import Avatar from './Avatar.jsx';
import { roomAvatar, cleanName, formatTime } from '../matrix.js';

/**
 * WhatsApp communities: the bridge makes each one a Matrix space whose children are the
 * community's groups you're in (including its announcements group).
 */
function useCommunities(client, rooms, tick) {
  return useMemo(() => {
    const byId = new Map(rooms.map((r) => [r.id, r]));
    return client.getRooms()
      .filter((r) => r.isSpaceRoom() && r.getMyMembership() === 'join')
      .filter((r) => /@g\.us$/.test(r.currentState.getStateEvents('m.bridge')[0]?.getContent()?.channel?.id || ''))
      .map((space) => {
        const groups = space.currentState.getStateEvents('m.space.child')
          .filter((e) => e.getContent()?.via)
          .map((e) => byId.get(e.getStateKey()))
          .filter(Boolean)
          .sort((a, b) => b.ts - a.ts);
        return {
          space,
          id: space.roomId,
          name: cleanName(space.name || 'Community'),
          groups,
          unread: groups.reduce((n, g) => n + (g.muted ? 0 : g.unread), 0),
          ts: groups[0]?.ts || 0,
        };
      })
      .sort((a, b) => b.ts - a.ts);
  }, [client, rooms, tick]); // eslint-disable-line react-hooks/exhaustive-deps
}

export default function CommunitiesPanel({ client, rooms, tick, activeId, onOpen }) {
  const communities = useCommunities(client, rooms, tick);
  const [open, setOpen] = useState(() => new Set());
  const toggle = (id) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <aside className="sidebar communities-panel">
      <header className="sidebar-head">
        <div className="drag-region" />
        <div className="sidebar-title"><h2>Communities</h2></div>
      </header>
      <div className="room-list">
        {!communities.length && <div className="list-empty muted">You aren’t in any WhatsApp communities.</div>}
        {communities.map((c) => {
          const expanded = open.has(c.id) || c.groups.some((g) => g.id === activeId);
          return (
            <div key={c.id} className={`cm-block ${expanded ? 'open' : ''}`}>
              <button className="cm-head" onClick={() => toggle(c.id)}>
                <span className="cm-avatar"><Avatar src={roomAvatar(client, c.space, 96)} name={c.name} id={c.id} size={42} /></span>
                <span className="cm-meta">
                  <span className="cm-name">{c.name}</span>
                  <span className="cm-sub">{c.groups.length} {c.groups.length === 1 ? 'group' : 'groups'}{c.ts ? ` · ${formatTime(c.ts)}` : ''}</span>
                </span>
                {c.unread > 0 && <span className="count">{c.unread > 99 ? '99+' : c.unread}</span>}
                <svg className="cm-chevron" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z" /></svg>
              </button>
              {expanded && (
                <div className="cm-groups">
                  {c.groups.map((g) => (
                    <button key={g.id} className={`cm-group ${g.id === activeId ? 'active' : ''} ${g.unread ? 'unread' : ''}`} onClick={() => onOpen(g.id)}>
                      <Avatar src={roomAvatar(client, g.room, 64)} name={g.name} id={g.id} size={32} />
                      <span className="cm-meta">
                        <span className="cm-gname">{g.name}</span>
                        <span className="cm-preview">{g.preview || ' '}</span>
                      </span>
                      {g.unread > 0 && <span className={`count ${g.muted ? 'muted' : ''}`}>{g.unread}</span>}
                    </button>
                  ))}
                  {!c.groups.length && <div className="cm-empty muted small">You haven’t joined any of its groups here.</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
