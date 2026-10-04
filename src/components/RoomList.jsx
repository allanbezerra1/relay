import { useEffect, useRef, useState } from 'react';
import ContextMenu from './ContextMenu.jsx';
import Avatar from './Avatar.jsx';
import SyncBar from './SyncBar.jsx';
import MiniPlayer from './MiniPlayer.jsx';
import UpdateBanner from './UpdateBanner.jsx';
import { roomAvatar, formatTime, memberAvatar, senderName, cleanName } from '../matrix.js';
import { toggleLabel } from '../chatmeta.js';
import { combo } from '../platform.js';

const ICONS = {
  newGroup: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.3 0-7 1.6-7 4v2h11.3a6 6 0 0 1-.3-2 6 6 0 0 1 1.5-4A12 12 0 0 0 9 13Zm10 0v3h3v2h-3v3h-2v-3h-3v-2h3v-3h2Z',
  select: 'M3 5h2V3a2 2 0 0 0-2 2Zm0 8h2v-2H3v2Zm4 8h2v-2H7v2ZM3 9h2V7H3v2Zm10-6h-2v2h2V3Zm6 0v2h2a2 2 0 0 0-2-2ZM5 21v-2H3a2 2 0 0 0 2 2Zm-2-4h2v-2H3v2ZM9 3H7v2h2V3Zm2 18h2v-2h-2v2Zm8-8h2v-2h-2v2Zm0 8a2 2 0 0 0 2-2h-2v2Zm0-12h2V7h-2v2Zm0 8h2v-2h-2v2Zm-4 4h2v-2h-2v2Zm0-16h2V3h-2v2ZM7 17h10V7H7v10Zm2-8h6v6H9V9Z',
  read: 'M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7Zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41ZM.41 13.41 6 19l1.41-1.41L1.83 12 .41 13.41Z',
  archive: 'M20.54 5.23 19.15 3.55A1.45 1.45 0 0 0 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23A1.98 1.98 0 0 0 3 6.5V19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.5c0-.48-.17-.93-.46-1.27ZM12 17.5 6.5 12H10v-2h4v2h3.5L12 17.5ZM5.12 5l.81-1h12l.94 1H5.12Z',
  mute: 'M20 18.69 7.84 6.14 5.27 3.49 4 4.76l2.8 2.8v.01A6.96 6.96 0 0 0 6 11v5l-2 2v1h13.73l2 2L21 19.72l-1-1.03ZM12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm6-7.32V11a6.99 6.99 0 0 0-5.5-6.84V3a1.5 1.5 0 0 0-3 0v1.16c-.47.1-.92.26-1.34.46L18 14.68Z',
  pin: 'M16 3v2h-1v5l2 3v2h-4v6l-1 1-1-1v-6H7v-2l2-3V5H8V3h8Z',
  label: 'M17.63 5.84A2 2 0 0 0 16 5L5 5.01A2 2 0 0 0 3 7v10a2 2 0 0 0 2 2h11c.67 0 1.27-.33 1.63-.84L22 12l-4.37-6.16Z',
  filter: 'M3 6h18v2H3V6Zm3 5h12v2H6v-2Zm4 5h4v2h-4v-2Z',
  search: 'M10 2a8 8 0 0 1 6.32 12.9l5.39 5.4-1.42 1.4-5.39-5.38A8 8 0 1 1 10 2Zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z',
  open: 'M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7ZM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7Z',
  unread: 'M20 6.54v10.91c0 .3-.24.55-.55.55H4.55A.55.55 0 0 1 4 17.45V6.55c0-.3.25-.55.55-.55h10.03a4 4 0 0 0 5.42.54ZM18 1a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  copy: 'M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z',
  leave: 'M10.09 15.59 11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59ZM19 3H5a2 2 0 0 0-2 2v4h2V5h14v14H5v-4H3v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Z',
};
const Ico = ({ d, size = 17 }) => <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" d={d} /></svg>;

/**
 * "typing…" / "recording audio…" per chat, for the list. Recording (WhatsApp) arrives as typing;
 * the bridge says which typists are actually recording, asked only while someone is typing.
 */
function useChatActivity(client, rooms) {
  const me = client.getUserId();
  const typing = new Map();
  for (const r of rooms) {
    const who = r.room.getMembers().filter((m) => m.typing && m.userId !== me && !/bot:/.test(m.userId));
    if (who.length) typing.set(r.id, { who, group: r.group, wa: /^whatsapp/.test(r.network || '') });
  }
  const key = [...typing.keys()].join(',');
  const [recording, setRecording] = useState({}); // roomId -> [userId]
  useEffect(() => {
    const ask = window.relay?.local?.recording;
    const ids = key ? key.split(',').filter((id) => typing.get(id)?.wa) : [];
    if (!ask || !ids.length) { setRecording({}); return undefined; }
    let alive = true;
    const poll = () => Promise.all(ids.map((id) => ask(id).then((u) => [id, u || []])))
      .then((pairs) => alive && setRecording(Object.fromEntries(pairs)));
    poll();
    const t = setInterval(poll, 1500);
    return () => { alive = false; clearInterval(t); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const out = new Map();
  for (const [id, { who, group }] of typing) {
    const rec = who.filter((m) => (recording[id] || []).includes(m.userId));
    const first = (m) => cleanName(m.rawDisplayName || m.name || '').split(' ')[0];
    const list = rec.length ? rec : who;
    const verb = rec.length ? 'recording audio…' : 'typing…';
    const text = !group ? verb : list.length === 1 ? `${first(list[0])} is ${verb}` : `${list.length} people are ${verb}`;
    out.set(id, { text, recording: rec.length > 0 });
  }
  return out;
}

export default function RoomList({
  client, rooms, activeId, onOpen, query, setQuery, searchRef,
  view, setView, unreadOnly, setUnreadOnly, filterName, archivedCount, actions,
  showPreviews = true, me, onSettings, profiles = [], labels = [], labelFilter, setLabelFilter,
  typeFilter, setTypeFilter, onDropFiles, onNewGroup, onSearchMessages,
}) {
  // Pinned chats sit on top as big tiles (inbox view only).
  const showTiles = view === 'inbox' && !query && !unreadOnly;
  const pinned = showTiles ? rooms.filter((r) => r.pinned) : [];
  const listRooms = showTiles ? rooms.filter((r) => !r.pinned) : rooms;
  const [menu, setMenu] = useState(null);
  const activity = useChatActivity(client, rooms);
  // Drop files on a chat in the list to open it with them ready to send.
  const [dropId, setDropId] = useState(null);
  const dropProps = (r) => onDropFiles ? {
    onDragOver: (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (dropId !== r.id) setDropId(r.id); } },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropId((d) => (d === r.id ? null : d)); },
    onDrop: (e) => { e.preventDefault(); setDropId(null); const files = [...e.dataTransfer.files]; if (files.length) onDropFiles(r.id, files); },
  } : {};
  const [showSearch, setShowSearch] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const filtersActive = unreadOnly || !!typeFilter || !!labelFilter;

  // ----- Multi-select (⌘-click, shift-click, or the Select button) -----
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [labelPick, setLabelPick] = useState(false);
  const lastClicked = useRef(null);
  const selecting = selectMode || selected.size > 0;
  const clearSelection = () => { setSelected(new Set()); setSelectMode(false); setLabelPick(false); };

  useEffect(() => {
    if (!selecting) return;
    const esc = (e) => { if (e.key === 'Escape') clearSelection(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [selecting]);

  const allRows = [...pinned, ...listRooms];
  const clickRow = (e, r) => {
    const toggle = e.metaKey || e.ctrlKey || selecting;
    if (e.shiftKey && lastClicked.current) {
      const ids = allRows.map((x) => x.id);
      const [a, b] = [ids.indexOf(lastClicked.current), ids.indexOf(r.id)].sort((x, y) => x - y);
      if (a >= 0 && b >= 0) {
        setSelected((s) => new Set([...s, ...ids.slice(a, b + 1)]));
        return;
      }
    }
    lastClicked.current = r.id;
    if (toggle) {
      setSelected((s) => {
        const n = new Set(s);
        n.has(r.id) ? n.delete(r.id) : n.add(r.id);
        if (!n.size) setSelectMode(false);
        return n;
      });
      return;
    }
    onOpen(r.id);
    if (query) setQuery('');
  };

  const picked = allRows.filter((r) => selected.has(r.id));
  const bulk = async (fn) => {
    await Promise.all(picked.map((r) => Promise.resolve(fn(r)).catch((err) => console.error(err))));
  };
  const allArchived = picked.length && picked.every((r) => r.archived);
  const allMuted = picked.length && picked.every((r) => r.muted);
  const allPinned = picked.length && picked.every((r) => r.pinned);

  const menuItems = (r) => [
    { label: 'Open', icon: <Ico d={ICONS.open} size={15} />, run: () => onOpen(r.id) },
    'separator',
    { label: r.pinned ? 'Unpin' : 'Pin to top', icon: <Ico d={ICONS.pin} size={15} />, run: () => actions.togglePin(r) },
    { label: r.muted ? 'Unmute' : 'Mute', icon: <Ico d={ICONS.mute} size={15} />, run: () => actions.toggleMute(r) },
    { label: r.archived ? 'Move to inbox' : 'Archive', icon: <Ico d={ICONS.archive} size={15} />, run: () => actions.toggleArchive(r) },
    r.unread || r.markedUnread
      ? { label: 'Mark as read', icon: <Ico d={ICONS.read} size={15} />, run: () => actions.markRead(r) }
      : { label: 'Mark as unread', icon: <Ico d={ICONS.unread} size={15} />, run: () => actions.markUnread(r) },
    { label: selected.has(r.id) ? 'Deselect' : 'Select', icon: <Ico d={ICONS.select} size={15} />, run: () => setSelected((s) => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; }) },
    { label: 'Copy name', icon: <Ico d={ICONS.copy} size={15} />, run: () => navigator.clipboard.writeText(r.name) },
    'separator',
    { label: 'Leave chat', danger: true, icon: <Ico d={ICONS.leave} size={15} />, run: () => actions.leave(r) },
  ];

  return (
    <aside className="sidebar">
      <header className="sidebar-head">
        <div className="drag-region" />
        <div className="sidebar-title">
          <h2>{view === 'archive' ? 'Archive' : filterName}</h2>
          <div className="title-tools">
            {onNewGroup && <button className="icon-btn" title="New group" onClick={onNewGroup}><Ico d={ICONS.newGroup} /></button>}
            <button className={`icon-btn ${showFilters || filtersActive ? 'on' : ''}`} title="Filters" onClick={() => setShowFilters(!showFilters)}><Ico d={ICONS.filter} /></button>
            <button className={`icon-btn ${showSearch || query ? 'on' : ''}`} title="Search (⌘F)" onClick={() => { setShowSearch(true); setTimeout(() => searchRef.current?.focus(), 0); }}><Ico d={ICONS.search} /></button>
            <button className={`icon-btn ${selecting ? 'on' : ''}`} title="Select chats (⌘-click also works)"
              onClick={() => (selecting ? clearSelection() : setSelectMode(true))}><Ico d={ICONS.select} /></button>
          </div>
        </div>
        <div className={`search ${showSearch || query ? '' : 'collapsed'}`}>
          <Ico d={ICONS.search} size={15} />
          <input
            ref={searchRef}
            value={query}
            onFocus={() => setShowSearch(true)}
            onBlur={() => { if (!query) setShowSearch(false); }}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur(); setShowSearch(false); }
              if (e.key === 'Enter' && rooms[0]) { onOpen(rooms[0].id); setQuery(''); }
            }}
            placeholder="Search chats"
          />
        </div>
        {query.trim() && onSearchMessages && (
          <button className="search-msgs" onMouseDown={(e) => e.preventDefault()} onClick={() => onSearchMessages(query.trim())} title={`Search messages (${combo('Shift+F')})`}>
            <Ico d={ICONS.search} size={14} />
            <span>Search messages for “<b>{query.trim()}</b>”</span>
          </button>
        )}
        <div className={`chips ${showFilters || filtersActive ? '' : 'collapsed'}`}>
          <button className={view === 'inbox' && !unreadOnly && !typeFilter && !labelFilter ? 'on' : ''}
            onClick={() => { setView('inbox'); setUnreadOnly(false); setTypeFilter(null); setLabelFilter(null); }}>All</button>
          <button className={unreadOnly ? 'on' : ''} onClick={() => { setView('inbox'); setUnreadOnly(!unreadOnly); }}>Unread</button>
          <button className={typeFilter === 'dm' ? 'on' : ''} onClick={() => setTypeFilter(typeFilter === 'dm' ? null : 'dm')}>People</button>
          <button className={typeFilter === 'group' ? 'on' : ''} onClick={() => setTypeFilter(typeFilter === 'group' ? null : 'group')}>Groups</button>
          <button className={view === 'archive' ? 'on' : ''} onClick={() => { setView(view === 'archive' ? 'inbox' : 'archive'); setUnreadOnly(false); }}>
            Archive{archivedCount ? ` · ${archivedCount}` : ''}
          </button>
          {labels.map((l) => (
            <button key={l.id} className={`label-filter ${labelFilter === l.id ? 'on' : ''}`} style={{ '--c': l.color }}
              onClick={() => setLabelFilter(labelFilter === l.id ? null : l.id)}>
              <span className="label-dot" style={{ background: l.color }} />{l.name}
            </button>
          ))}
        </div>
      </header>

      <SyncBar profiles={profiles} />

      {selecting && (
        <div className="bulk-bar">
          <div className="bulk-top">
            <span className="bulk-count">{selected.size ? `${selected.size} selected` : 'Select chats'}</span>
            <button className="bulk-link" onClick={() => setSelected(new Set(allRows.map((r) => r.id)))}>Select all</button>
            <button className="bulk-link" onClick={clearSelection}>Done</button>
          </div>
          {selected.size > 0 && (
            <div className="bulk-actions">
              <button title="Mark as read" onClick={() => bulk((r) => actions.markRead(r))}><Ico d={ICONS.read} /><span>Read</span></button>
              <button title={allArchived ? 'Move to inbox' : 'Archive'} onClick={async () => { await bulk((r) => (allArchived ? r.archived : !r.archived) && actions.toggleArchive(r)); clearSelection(); }}>
                <Ico d={ICONS.archive} /><span>{allArchived ? 'Unarchive' : 'Archive'}</span></button>
              <button title={allMuted ? 'Unmute' : 'Mute'} onClick={() => bulk((r) => (allMuted ? r.muted : !r.muted) && actions.toggleMute(r))}>
                <Ico d={ICONS.mute} /><span>{allMuted ? 'Unmute' : 'Mute'}</span></button>
              <button title={allPinned ? 'Unpin' : 'Pin'} onClick={() => bulk((r) => (allPinned ? r.pinned : !r.pinned) && actions.togglePin(r))}>
                <Ico d={ICONS.pin} /><span>{allPinned ? 'Unpin' : 'Pin'}</span></button>
              <div className="bulk-label-wrap">
                <button title="Add to a label" onClick={() => setLabelPick(!labelPick)}><Ico d={ICONS.label} /><span>Label</span></button>
                {labelPick && (
                  <div className="label-menu bulk">
                    {labels.length ? labels.map((l) => {
                      const all = picked.every((r) => r.labels.some((x) => x.id === l.id));
                      return (
                        <button key={l.id} onClick={() => bulk((r) => toggleLabel(client, r.room, l, !all))}>
                          <span className="label-dot" style={{ background: l.color }} />{l.name}<span className="label-check">{all ? '✓' : ''}</span>
                        </button>
                      );
                    }) : <div className="ip-empty">Create labels from a chat’s details panel.</div>}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="room-list">
        {pinned.length > 0 && (
          <div className="pinned-tiles">
            {pinned.map((r) => (
              <button key={r.id} className={`pin-tile ${r.id === activeId && !selecting ? 'active' : ''} ${selected.has(r.id) ? 'selected' : ''} ${dropId === r.id ? 'drop-target' : ''}`} onClick={(e) => clickRow(e, r)} {...dropProps(r)}
                onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, r }); }} title={r.name}>
                <Avatar src={roomAvatar(client, r.room, 160)} name={r.name} id={r.id} size={62} network={r.network} account={r.account} />
                {(r.unread > 0 || r.markedUnread) && <span className={`count ${r.muted ? 'muted' : ''}`}>{r.unread || ''}</span>}
                <span className="pin-name">{r.name}</span>
              </button>
            ))}
          </div>
        )}
        {listRooms.length === 0 && pinned.length === 0 && (
          <div className="list-empty muted">
            {query ? 'No chats match your search.' : view === 'archive' ? 'Nothing archived.' : unreadOnly ? 'You’re all caught up ✨' : 'No chats here yet.'}
          </div>
        )}
        {listRooms.map((r) => {
          const unread = r.unread > 0 || r.markedUnread;
          return (
            <div
              key={r.id}
              className={`room ${r.id === activeId && !selecting ? 'active' : ''} ${unread ? 'unread' : ''} ${selected.has(r.id) ? 'selected' : ''} ${dropId === r.id ? 'drop-target' : ''}`}
              onClick={(e) => clickRow(e, r)}
              {...dropProps(r)}
              onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, r }); }}
            >
              <div className="avatar-wrap">
                <Avatar src={roomAvatar(client, r.room)} name={r.name} id={r.id} size={44} network={r.network} account={r.account} />
                {selecting && <span className={`sel-check ${selected.has(r.id) ? 'on' : ''}`}>{selected.has(r.id) ? '✓' : ''}</span>}
              </div>
              <div className="room-body">
                <div className="room-top">
                  <span className="room-name">{r.name}</span>
                  {r.labels.map((l) => <span key={l.id} className="label-dot" style={{ background: l.color }} title={l.name} />)}
                  {r.muted && (
                    <svg className="muted-ico" viewBox="0 0 24 24" width="14" height="14"><title>Muted</title><path fill="currentColor" d="M20 18.69 7.84 6.14 5.27 3.49 4 4.76l2.8 2.8v.01A6.96 6.96 0 0 0 6 11v5l-2 2v1h13.73l2 2L21 19.72l-1-1.03ZM12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm6-7.32V11a6.99 6.99 0 0 0-5.5-6.84V3a1.5 1.5 0 0 0-3 0v1.16c-.47.1-.92.26-1.34.46L18 14.68Z" /></svg>
                  )}
                  {r.pinned && <span className="pin" title="Pinned">📌</span>}
                  <span className="room-time">{r.ts ? formatTime(r.ts) : ''}</span>
                </div>
                <div className="room-bottom">
                  {activity.has(r.id) ? (
                    <span className={`room-preview room-activity ${activity.get(r.id).recording ? 'rec' : ''}`}>
                      {activity.get(r.id).recording && <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2Z" /></svg>}
                      {activity.get(r.id).text}
                    </span>
                  ) : (
                  <span className="room-preview">
                    {showPreviews && r.group && r.last && r.last.getSender() !== client.getUserId() && (
                      <span className="pv-avatar"><Avatar src={memberAvatar(client, r.room, r.last.getSender(), 32)} name={senderName(r.room, r.last.getSender())} id={r.last.getSender()} size={15} /></span>
                    )}
                    {r.invite ? 'Invitation to chat' : showPreviews ? r.preview || '\u00a0' : '\u00a0'}
                  </span>
                  )}
                  {r.unread > 0 ? (
                    <span className={`count ${r.highlight ? 'hl' : r.muted ? 'muted' : ''}`}>{r.unread > 99 ? '99+' : r.unread}</span>
                  ) : r.markedUnread ? <span className="count dot" /> : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>


      <UpdateBanner />
      <MiniPlayer />
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.r)} onClose={() => setMenu(null)} />}
    </aside>
  );
}
