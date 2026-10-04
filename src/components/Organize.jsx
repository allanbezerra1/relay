// Chat list organization: smart folder tabs, snooze ("Remind me later") and the "Important" group.
// Inbox calls useOrganize() once and drops the pieces it returns into the list.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ClientEvent, ReceiptType } from 'matrix-js-sdk';
import Avatar from './Avatar.jsx';
import FolderDialog from './FolderDialog.jsx';
import { useContextMenu } from './ContextMenu.jsx';
import { roomAvatar, formatTime } from '../matrix.js';
import { usePrefs, getPrefs } from '../prefs.js';
import { notificationSound } from '../sounds.js';
import {
  FOLDERS_TYPE, SNOOZED_TYPE, getFolders, saveFolders, getSnoozed, saveSnoozed, inFolder,
  snoozeOptions, wakeLabel, isImportant,
} from '../organize.js';
import { ask, notice } from '../dialogs.jsx';

const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const Ico = ({ d, size = 15 }) => <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" d={d} /></svg>;
export const ORG_ICONS = {
  folder: 'M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2Z',
  snooze: 'M12 4a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 16a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm.5-11H11v6l4.75 2.85.75-1.23-4-2.37V9ZM7.88 3.39 6.6 1.86 2 5.71l1.29 1.53 4.59-3.85ZM22 5.72l-4.6-3.86-1.29 1.53 4.6 3.86L22 5.72Z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z',
  trash: 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z',
  read: 'M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7Zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41ZM.41 13.41 6 19l1.41-1.41L1.83 12 .41 13.41Z',
  chevron: 'M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6 1.4-1.4Z',
};

/** Account data with an optimistic local copy until the server echoes it back. */
function useAccountData(client, type, read) {
  const [local, setLocal] = useState(null);
  useEffect(() => {
    const on = (ev) => { if (ev.getType() === type) setLocal(null); };
    client.on(ClientEvent.AccountData, on);
    return () => client.off(ClientEvent.AccountData, on);
  }, [client, type]);
  return [local ?? read(client), setLocal];
}

/**
 * The folder tab strip: scrolls sideways with the mouse wheel, by dragging, or with the ‹ › that
 * show up at an edge when there are more tabs that way.
 */
function ScrollTabs({ children }) {
  const ref = useRef(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const drag = useRef(null);
  const measure = () => {
    const el = ref.current;
    if (!el) return;
    const start = el.scrollLeft <= 2, end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
    setEdges((e) => (e.start === start && e.end === end ? e : { start, end }));
  };
  useLayoutEffect(measure);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // A vertical wheel scrolls the strip sideways (plain mice have no horizontal wheel).
    const onWheel = (e) => {
      if (el.scrollWidth <= el.clientWidth) return;
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!d) return;
      e.preventDefault();
      el.scrollLeft += d;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => { ro.disconnect(); el.removeEventListener('wheel', onWheel); };
  }, []);
  const by = (dx) => ref.current?.scrollBy({ left: dx, behavior: 'smooth' });
  // Click-and-drag to scroll; a real drag doesn't count as a click on the tab under it.
  const onPointerDown = (e) => {
    if (e.button !== 0 || e.target.closest('[draggable="true"]')) return;
    drag.current = { x: e.clientX, left: ref.current.scrollLeft, moved: false, id: e.pointerId };
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) > 4) { d.moved = true; ref.current.setPointerCapture?.(d.id); ref.current.classList.add('dragging'); }
    if (d.moved) ref.current.scrollLeft = d.left - dx;
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    ref.current?.classList.remove('dragging');
    if (d?.moved) { const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); }; window.addEventListener('click', stop, { capture: true, once: true }); setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 50); }
  };
  return (
    <div className={`ftabs-wrap ${edges.start ? 'at-start' : ''} ${edges.end ? 'at-end' : ''}`}>
      {!edges.start && <button className="ftabs-arrow left" onClick={() => by(-160)} aria-label="More on the left"><Ico d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z" size={16} /></button>}
      <div className="folder-tabs" role="tablist" ref={ref} onScroll={measure}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={end} onPointerCancel={end}>
        {children}
      </div>
      {!edges.end && <button className="ftabs-arrow right" onClick={() => by(160)} aria-label="More on the right"><Ico d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z" size={16} /></button>}
    </div>
  );
}

export function useOrganize({ client, rooms, profiles, labels, activeId, openRoom, view, setView, query }) {
  const prefs = usePrefs();
  const me = client.getUserId();
  const [folders, setLocalFolders] = useAccountData(client, FOLDERS_TYPE, getFolders);
  const [snoozed, setLocalSnoozed] = useAccountData(client, SNOOZED_TYPE, getSnoozed);
  const [folderId, setFolderIdState] = useState(() => store.get('relay.folder', 'all'));
  const [dialog, setDialog] = useState(null); // { folder?, include? }
  const [pop, setPop] = useState(null); // { kind: 'snooze' | 'folder', r, x, y }
  const [impOpen, setImpOpen] = useState(() => store.get('relay.importantOpen', true));
  const [woke, setWoke] = useState(() => store.get('relay.woke', {})); // roomId → when it woke up, to float it to the top
  const [tabMenu, openTabMenu] = useContextMenu();
  const stickyImportant = useRef(new Set());

  const folder = folders.find((f) => f.id === folderId) || null;
  const setFolderId = (id) => { setFolderIdState(id); store.set('relay.folder', id); if (view !== 'inbox') setView('inbox'); };
  // The folder was deleted (maybe on another device): back to everything.
  useEffect(() => { if (folderId !== 'all' && !folder) setFolderIdState('all'); }, [folderId, folder]);

  const updateFolders = (next) => { setLocalFolders(next); return saveFolders(client, next).catch((err) => { setLocalFolders(null); notice({ title: 'Couldn’t save the folders', body: err.message }); }); };
  const updateSnoozed = (next) => { setLocalSnoozed(next); return saveSnoozed(client, next).catch((err) => { setLocalSnoozed(null); notice({ title: 'Couldn’t snooze', body: err.message }); }); };

  // ----- Snooze -----
  const snooze = (roomId, ts) => {
    updateSnoozed({ ...snoozed, [roomId]: ts });
    if (roomId === activeId) openRoom(null);
  };
  const unsnooze = (roomId) => { const n = { ...snoozed }; delete n[roomId]; updateSnoozed(n); };

  // Wake chats whose time has come: back to the top, marked unread, with a reminder.
  const snoozedRef = useRef(snoozed);
  snoozedRef.current = snoozed;
  const waking = useRef(new Set());
  useEffect(() => {
    const check = () => {
      const now = Date.now();
      const due = Object.entries(snoozedRef.current).filter(([id, ts]) => ts <= now && !waking.current.has(id));
      if (!due.length) return;
      const next = { ...snoozedRef.current };
      for (const [id] of due) { delete next[id]; waking.current.add(id); }
      updateSnoozed(next);
      setWoke((w) => { const n = { ...w }; for (const [id] of due) n[id] = now; store.set('relay.woke', n); return n; });
      for (const [id] of due) {
        const room = client.getRoom(id);
        if (!room || room.getMyMembership() !== 'join') continue;
        client.setRoomAccountData(id, 'm.marked_unread', { unread: true }).catch(() => {});
        const p = getPrefs();
        if (!p.notifications) continue;
        if (p.notifSound) notificationSound();
        window.relay.notify({ title: `Reminder: ${room.name}`, body: 'You asked to be reminded about this chat now.', roomId: id, silent: true });
      }
      setTimeout(() => due.forEach(([id]) => waking.current.delete(id)), 10000);
    };
    check();
    const every = setInterval(check, 15000);
    window.addEventListener('focus', check);
    return () => { clearInterval(every); window.removeEventListener('focus', check); };
  }, [client]); // eslint-disable-line react-hooks/exhaustive-deps

  // A woken chat stays on top until you've read it and moved on.
  useEffect(() => {
    const ids = Object.keys(woke);
    if (!ids.length) return;
    const stale = ids.filter((id) => { const r = rooms.find((x) => x.id === id); return !r || (!r.unread && !r.markedUnread && id !== activeId); });
    if (!stale.length) return;
    setWoke((w) => { const n = { ...w }; stale.forEach((id) => delete n[id]); store.set('relay.woke', n); return n; });
  }, [rooms, activeId, woke]);

  const isSnoozed = (id) => !!snoozed[id];
  const live = rooms.filter((r) => !r.archived && !snoozed[r.id]);
  const snoozedRooms = rooms.filter((r) => snoozed[r.id]);
  const unreadChats = (list) => list.filter((r) => !r.muted && (r.unread || r.markedUnread)).length;

  // ----- Filtering for Inbox -----
  /** Extra filtering for the list (after Inbox's own); null means "no opinion". */
  const filter = (r) => {
    if (view === 'snoozed') return !!snoozed[r.id];
    if (snoozed[r.id]) return false;
    if (folder && !inFolder(folder, r, me)) return false;
    return true;
  };

  const showImportant = prefs.importantSection !== false && view === 'inbox' && !query.trim();
  /** Order and split what's visible: woken chats float up; important ones get their own group. */
  const arrange = (list) => {
    let out = list;
    if (Object.keys(woke).length) {
      const key = (r) => Math.max(r.ts, woke[r.id] || 0);
      out = [...out].sort((a, b) => (b.pinned - a.pinned) || (key(b) - key(a)));
    }
    if (view === 'snoozed') {
      out = out.map((r) => ({ ...r, snoozeLabel: wakeLabel(snoozed[r.id]) })).sort((a, b) => snoozed[a.id] - snoozed[b.id]);
    }
    if (!showImportant) { stickyImportant.current.clear(); return { list: out, important: [] }; }
    // The chat you're reading stays in the group until you leave it, so it doesn't jump away.
    const important = out.filter((r) => isImportant(r) || (r.id === activeId && stickyImportant.current.has(r.id)));
    stickyImportant.current = new Set(important.map((r) => r.id));
    if (!impOpen) return { list: out, important };
    const ids = new Set(important.map((r) => r.id));
    return { list: out.filter((r) => !ids.has(r.id)), important };
  };

  // ----- Tabs -----
  const dragId = useRef(null);
  const [dragOver, setDragOver] = useState(null);
  const tabs = (
    <ScrollTabs>
      <button role="tab" className={`ftab ${!folder && view !== 'snoozed' ? 'on' : ''}`} onClick={() => { setFolderId('all'); }}>
        <span className="ftab-name">All</span>
        {unreadChats(live) > 0 && <span className="ftab-count">{unreadChats(live)}</span>}
      </button>
      {folders.map((f) => {
        const n = unreadChats(live.filter((r) => inFolder(f, r, me)));
        return (
          <button key={f.id} role="tab" draggable
            className={`ftab ${folder?.id === f.id && view !== 'snoozed' ? 'on' : ''} ${dragOver === f.id ? 'drag-over' : ''}`}
            onClick={() => setFolderId(folder?.id === f.id ? 'all' : f.id)}
            onDoubleClick={() => setDialog({ folder: f })}
            onContextMenu={(e) => openTabMenu(e, [
              { label: 'Edit folder…', icon: <Ico d={ORG_ICONS.edit} />, run: () => setDialog({ folder: f }) },
              { label: 'Mark all as read', icon: <Ico d={ORG_ICONS.read} />, run: () => markAllRead(live.filter((r) => inFolder(f, r, me))) },
              'separator',
              { label: 'Delete folder', danger: true, icon: <Ico d={ORG_ICONS.trash} />, run: () => deleteFolder(f) },
            ])}
            onDragStart={(e) => { dragId.current = f.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-aurora-folder', f.id); }}
            onDragOver={(e) => { if (dragId.current && dragId.current !== f.id) { e.preventDefault(); setDragOver(f.id); } }}
            onDragLeave={() => setDragOver((d) => (d === f.id ? null : d))}
            onDrop={(e) => {
              e.preventDefault(); setDragOver(null);
              const from = folders.findIndex((x) => x.id === dragId.current);
              const to = folders.findIndex((x) => x.id === f.id);
              dragId.current = null;
              if (from < 0 || to < 0 || from === to) return;
              const next = [...folders];
              next.splice(to, 0, next.splice(from, 1)[0]);
              updateFolders(next);
            }}
            onDragEnd={() => { dragId.current = null; setDragOver(null); }}
            title={`${f.name} — double-click to edit, drag to reorder`}>
            <span className="ftab-icon">{f.icon}</span>
            <span className="ftab-name">{f.name}</span>
            {n > 0 && <span className="ftab-count">{n}</span>}
          </button>
        );
      })}
      {snoozedRooms.length > 0 && (
        <button role="tab" className={`ftab snoozed ${view === 'snoozed' ? 'on' : ''}`} onClick={() => setView(view === 'snoozed' ? 'inbox' : 'snoozed')} title="Snoozed chats">
          <Ico d={ORG_ICONS.snooze} size={14} />
          <span className="ftab-name">Snoozed</span>
          <span className="ftab-count">{snoozedRooms.length}</span>
        </button>
      )}
      <button className="ftab add" onClick={() => setDialog({})} title="New folder"><Ico d={ORG_ICONS.plus} size={15} /></button>
      {tabMenu}
    </ScrollTabs>
  );

  const markAllRead = (list) => list.filter((r) => r.unread || r.markedUnread).forEach((r) => {
    const last = r.room.getLiveTimeline().getEvents().at(-1);
    if (last) client.sendReadReceipt(last, getPrefs().readReceipts ? ReceiptType.Read : ReceiptType.ReadPrivate).catch(() => {});
    if (r.markedUnread) client.setRoomAccountData(r.id, 'm.marked_unread', { unread: false }).catch(() => {});
  });
  const deleteFolder = async (f) => {
    if (!(await ask({ title: `Delete the folder “${f.name}”?`, body: 'The chats stay where they are.', ok: 'Delete', danger: true }))) return;
    updateFolders(folders.filter((x) => x.id !== f.id));
    if (folderId === f.id) setFolderId('all');
  };
  const saveFolder = (f) => {
    const exists = folders.some((x) => x.id === f.id);
    updateFolders(exists ? folders.map((x) => (x.id === f.id ? f : x)) : [...folders, f]);
    setFolderId(f.id);
    setDialog(null);
  };
  const toggleInFolder = (f, r) => {
    const inIt = inFolder(f, r, me);
    const byRules = inFolder({ ...f, include: [], exclude: [] }, r, me);
    const next = { ...f, include: f.include.filter((id) => id !== r.id), exclude: f.exclude.filter((id) => id !== r.id) };
    if (inIt && byRules) next.exclude.push(r.id);
    if (!inIt && !byRules) next.include.push(r.id);
    updateFolders(folders.map((x) => (x.id === f.id ? next : x)));
  };

  // ----- Context menu entries for a chat -----
  const menuExtras = (r, at) => [
    'separator',
    snoozed[r.id]
      ? { label: `Cancel reminder (${wakeLabel(snoozed[r.id])})`, icon: <Ico d={ORG_ICONS.snooze} />, run: () => unsnooze(r.id) }
      : { label: 'Remind me later…', icon: <Ico d={ORG_ICONS.snooze} />, run: () => setPop({ kind: 'snooze', r, ...at }) },
    { label: 'Add to folder…', icon: <Ico d={ORG_ICONS.folder} />, run: () => setPop({ kind: 'folder', r, ...at }) },
  ];

  // ----- "Important" group -----
  const important = (list) => list.length > 0 && (
    <section className={`important ${impOpen ? 'open' : ''}`}>
      <button className="imp-head" onClick={() => { setImpOpen(!impOpen); store.set('relay.importantOpen', !impOpen); }}>
        <span className="imp-star">★</span>
        <span>Important</span>
        <span className="imp-n">{list.length}</span>
        <span className="imp-chev"><Ico d={ORG_ICONS.chevron} size={16} /></span>
      </button>
      {impOpen && (
        <div className="imp-list">
          {list.map((r) => (
            <button key={r.id} className={`imp-row ${r.id === activeId ? 'active' : ''}`} onClick={() => openRoom(r.id)}
              onContextMenu={(e) => { e.preventDefault(); setPop({ kind: 'snooze', r, x: e.clientX, y: e.clientY }); }}>
              <Avatar src={roomAvatar(client, r.room, 80)} name={r.name} id={r.id} size={34} network={r.network} account={r.account} />
              <span className="imp-body">
                <span className="imp-top">
                  <span className="imp-name">{r.name}</span>
                  <span className="imp-time">{r.ts ? formatTime(r.ts) : ''}</span>
                </span>
                <span className="imp-preview">{r.preview || ' '}</span>
              </span>
              {r.highlight > 0 ? <span className="imp-badge at" title="Mentions you">@{r.unread > 1 ? ` ${r.unread > 99 ? '99+' : r.unread}` : ''}</span>
                : r.unread > 0 ? <span className="imp-badge">{r.unread > 99 ? '99+' : r.unread}</span> : <span className="imp-badge dot" />}
            </button>
          ))}
        </div>
      )}
    </section>
  );

  const overlays = (
    <>
      {dialog && (
        <FolderDialog client={client} folder={dialog.folder} include={dialog.include} rooms={rooms.filter((r) => !r.archived)}
          profiles={profiles} labels={labels} me={me}
          onSave={saveFolder} onDelete={dialog.folder ? () => { deleteFolder(dialog.folder); setDialog(null); } : null} onClose={() => setDialog(null)} />
      )}
      {pop?.kind === 'snooze' && (
        <SnoozePicker at={pop} current={snoozed[pop.r.id]} name={pop.r.name}
          onPick={(ts) => { snooze(pop.r.id, ts); setPop(null); }} onCancelSnooze={() => { unsnooze(pop.r.id); setPop(null); }} onClose={() => setPop(null)} />
      )}
      {pop?.kind === 'folder' && (
        <Popover at={pop} onClose={() => setPop(null)} className="folder-pick">
          <div className="pop-title">Add “{pop.r.name}” to a folder</div>
          {folders.map((f) => {
            const on = inFolder(f, pop.r, me);
            return (
              <button key={f.id} className={on ? 'on' : ''} onClick={() => toggleInFolder(f, pop.r)}>
                <span className="pop-emoji">{f.icon}</span>{f.name}<span className="pop-check">{on ? '✓' : ''}</span>
              </button>
            );
          })}
          {folders.length > 0 && <div className="menu-sep" />}
          <button onClick={() => { setDialog({ include: [pop.r.id] }); setPop(null); }}><span className="pop-emoji">＋</span>New folder with this chat…</button>
        </Popover>
      )}
    </>
  );

  return {
    filter, arrange, isSnoozed, tabs, important, menuExtras, overlays,
    folderActive: !!folder,
    title: view === 'snoozed' ? 'Snoozed' : null,
    emptyText: view === 'snoozed' ? 'No snoozed chats.' : folder ? 'No chats in this folder.' : null,
  };
}

// ---------- Popovers ----------

export function Popover({ at, onClose, className = '', children }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y, opacity: 0 });
  useLayoutEffect(() => {
    const r = ref.current.getBoundingClientRect();
    const left = at.x + r.width + 8 > window.innerWidth ? at.x - r.width : at.x;
    const top = at.y + r.height + 8 > window.innerHeight ? at.y - r.height : at.y;
    setPos({ left: Math.max(8, Math.min(left, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(top, window.innerHeight - r.height - 8)) });
  }, [at.x, at.y, children]);
  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [onClose]);
  return createPortal(<div ref={ref} className={`menu org-pop ${className}`} style={pos}>{children}</div>, document.body);
}

const pad = (n) => String(n).padStart(2, '0');
const localInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function SnoozePicker({ at, current, name, onPick, onCancelSnooze, onClose }) {
  const [custom, setCustom] = useState(!!at.custom);
  const [value, setValue] = useState(() => { const d = new Date(Date.now() + 3 * 3600000); d.setMinutes(0); return localInput(d); });
  const options = useMemo(() => snoozeOptions(), []);
  const ts = new Date(value).getTime();
  return (
    <Popover at={at} onClose={onClose} className="snooze-pick">
      <div className="pop-title"><Ico d={ORG_ICONS.snooze} size={14} /> Remind me about “{name}”</div>
      {current && <div className="pop-note">Snoozed until {wakeLabel(current)}</div>}
      {options.map((o) => (
        <button key={o.key} onClick={() => onPick(o.ts)}>{o.label}<span className="pop-when">{wakeLabel(o.ts)}</span></button>
      ))}
      <div className="menu-sep" />
      {custom ? (
        <div className="snooze-custom">
          <input type="datetime-local" value={value} min={localInput(new Date())} onChange={(e) => setValue(e.target.value)} autoFocus />
          <button className="primary" disabled={!(ts > Date.now())} onClick={() => onPick(ts)}>Snooze</button>
        </div>
      ) : (
        <button onClick={() => setCustom(true)}>Pick a date and time…</button>
      )}
      {current && <><div className="menu-sep" /><button className="danger" onClick={onCancelSnooze}>Cancel reminder</button></>}
    </Popover>
  );
}
