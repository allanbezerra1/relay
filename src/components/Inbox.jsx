import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { RoomEvent, KnownMembership, ReceiptType } from 'matrix-js-sdk';
import { useClientTick, useWindowFocus } from '../hooks.js';
import { detectNetwork, networkInfo, NETWORKS } from '../networks.js';
import { lastMessage, previewText, isDisplayable, senderName, mediaUrl, cleanName, peopleCount } from '../matrix.js';
import { local, BRIDGE_BOT, BRIDGE_PUPPET } from '../local.js';
import { usePrefs, getPrefs } from '../prefs.js';
import { uiSound, notificationSound } from '../sounds.js';
import { isMuted, setMuted, getLabels, labelTag } from '../chatmeta.js';
import RoomList from './RoomList.jsx';
import ChatView from './ChatView.jsx';
import QuickSwitcher from './QuickSwitcher.jsx';
import Settings from './Settings.jsx';
import Avatar from './Avatar.jsx';
import Logo from './Logo.jsx';
import NetIcon from './NetIcon.jsx';
import { useContextMenu } from './ContextMenu.jsx';
import { importWhatsAppFavorites } from '../stickers.js';
import NewGroupDialog from './NewGroupDialog.jsx';
import StatusPanel from './StatusPanel.jsx';
import CommunitiesPanel from './CommunitiesPanel.jsx';
import { useHealthLevel } from '../reliability.js';

export const TAG_PINNED = 'm.favourite';
export const TAG_ARCHIVED = 'm.lowpriority';

/** Management rooms / DMs with a bridge bot, which have no m.bridge marker (real chats do). */
function isBridgeInternal(room) {
  const bridged = room.currentState.getStateEvents('m.bridge').length || room.currentState.getStateEvents('uk.half-shot.bridge').length;
  if (bridged) return false;
  const members = room.getJoinedMembers().map((m) => m.userId);
  return members.length <= 2 && members.some((id) => BRIDGE_BOT.test(id));
}

function collectRooms(client, isLocal) {
  const labels = getLabels(client);
  // Bridges mark one-to-one chats in m.direct; everything else is a group/channel.
  const direct = new Set(Object.values(client.getAccountData('m.direct')?.getContent() || {}).flat());
  return client.getRooms()
    .filter((r) => !r.isSpaceRoom())
    .filter((r) => !(isLocal && isBridgeInternal(r)))
    .filter((r) => [KnownMembership.Join, KnownMembership.Invite].includes(r.getMyMembership()))
    .map((room) => {
      const tags = room.tags || {};
      const last = lastMessage(room);
      return {
        room,
        id: room.roomId,
        name: cleanName(room.name || 'Empty chat'),
        network: detectNetwork(room),
        invite: room.getMyMembership() === KnownMembership.Invite,
        pinned: !!tags[TAG_PINNED],
        archived: !!tags[TAG_ARCHIVED],
        muted: isMuted(client, room.roomId),
        group: !direct.has(room.roomId), // groups and channels
        labels: labels.filter((l) => tags[labelTag(l.id)]),
        unread: room.getUnreadNotificationCount('total') || 0,
        highlight: room.getUnreadNotificationCount('highlight') || 0,
        markedUnread: !!(room.getAccountData('m.marked_unread') || room.getAccountData('com.famedly.marked_unread'))?.getContent()?.unread,
        // Only real messages count for ordering: bridges touch rooms with member/profile
        // updates (e.g. a contact rename) and those shouldn't float a chat to the top.
        ts: last?.getTs() || 0,
        last,
        preview: previewText(room, last, client.getUserId()),
      };
    })
    .sort((a, b) => (b.pinned - a.pinned) || (b.ts - a.ts));
}

/**
 * Local mode: the accounts you connected (your "profiles"), with the chats that
 * belong to each. Bridges put every account's chats in a per-account space.
 */
function useProfiles(client, isLocal, tick) {
  const [status, setStatus] = useState(null);
  const [avatars, setAvatars] = useState({});

  useEffect(() => {
    if (!isLocal) return;
    // Poll often while something is syncing (for the progress bar), rarely otherwise.
    let timer;
    const check = () => local().status().then((st) => {
      setStatus(st);
      const busy = Object.values(st.bridges).some((b) => b.logins.some((l) => l.sync?.active));
      clearTimeout(timer);
      timer = setTimeout(check, busy ? 3000 : 15000);
    }).catch(() => { clearTimeout(timer); timer = setTimeout(check, 15000); });
    check();
    const off = local().on('status', () => { clearTimeout(timer); timer = setTimeout(check, 300); });
    return () => { clearTimeout(timer); off(); };
  }, [isLocal]);

  const profiles = useMemo(() => {
    if (!status) return [];
    return Object.entries(status.bridges).flatMap(([net, b]) => b.logins.map((l) => {
      const space = l.spaceRoom && client.getRoom(l.spaceRoom);
      const children = space ? new Set(space.currentState.getStateEvents('m.space.child').filter((e) => e.getContent()?.via).map((e) => e.getStateKey())) : null;
      return {
        key: `${net}:${l.id}`,
        net,
        id: l.id,
        name: l.profileName || l.name,
        avatarMxc: l.avatarMxc || null,
        sync: l.sync || null,
        business: !!l.business,
        badgeNet: l.business ? 'whatsappBusiness' : net,
        detail: l.detail || l.name,
        state: l.state,
        ghost: `@${net}_${l.id}:${status.serverName}`,
        children,
      };
    }));
  }, [status, client, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Your photo on each network lives on the bridge's "ghost" user for your own account.
  useEffect(() => {
    for (const p of profiles) {
      if (p.avatarMxc || avatars[p.key] !== undefined) continue;
      client.getProfileInfo(p.ghost)
        .then((info) => setAvatars((a) => ({ ...a, [p.key]: info?.avatar_url || null })))
        .catch(() => setAvatars((a) => ({ ...a, [p.key]: null })));
    }
  }, [profiles]); // eslint-disable-line react-hooks/exhaustive-deps

  return { status, profiles: profiles.map((p) => ({ ...p, avatar: p.avatarMxc || avatars[p.key] || null })) };
}

export default function Inbox({ client, isLocal, onSignOut }) {
  const tick = useClientTick(client);
  const focused = useWindowFocus();
  const prefs = usePrefs();
  const [activeId, setActiveId] = useState(() => localStorage.getItem('relay.activeRoom'));
  const [filter, setFilter] = useState('all'); // 'all' | 'net:<id>' | 'acct:<net>:<id>'
  const [view, setView] = useState('inbox'); // 'inbox' | 'archive'
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [labelFilter, setLabelFilter] = useState(null);
  const [typeFilter, setTypeFilter] = useState(null); // null | 'dm' | 'group'
  const [query, setQuery] = useState('');
  const [switcher, setSwitcher] = useState(false);
  const [settings, setSettings] = useState(null); // null | section id
  const [newGroup, setNewGroup] = useState(false);
  const [inboxToast, setInboxToast] = useState(null);

  // WhatsApp favorite stickers (collected by the local bridge) → "My stickers".
  useEffect(() => {
    if (!isLocal) return undefined;
    const run = () => importWhatsAppFavorites(client).catch((err) => console.warn('Sticker import failed', err));
    const first = setTimeout(run, 5000);
    const every = setInterval(run, 2 * 60 * 1000);
    return () => { clearTimeout(first); clearInterval(every); };
  }, [client, isLocal]);
  const searchRef = useRef(null);
  const [railMenu, openRailMenu] = useContextMenu();

  const { status: localStatus, profiles } = useProfiles(client, isLocal, tick);
  const healthLevel = useHealthLevel(isLocal); // amber / red dot on the Settings button when something is down

  // Which account each chat belongs to, shown when a network has several accounts.
  const accountOf = useMemo(() => {
    const map = new Map();
    for (const p of profiles) {
      if (!p.children) continue;
      const acct = { key: p.key, business: p.business, name: p.business ? `${p.name} (Business)` : p.name, detail: cleanName(p.detail || ''), src: p.avatar ? mediaUrl(client, p.avatar, 48) : null };
      for (const id of p.children) map.set(id, acct);
    }
    return map;
  }, [profiles, client]);

  const rooms = useMemo(
    () => collectRooms(client, isLocal).map((r) => {
      const account = accountOf.get(r.id);
      return account ? { ...r, account, network: account.business ? 'whatsappBusiness' : r.network, baseNetwork: r.network } : r;
    }),
    [client, tick, isLocal, accountOf],
  );

  // Chats whose recent history is only profile/member updates have no preview and no
  // time; fetch a little older history for them in the background.
  const backfilled = useRef(new Set());
  useEffect(() => {
    const todo = rooms.filter((r) => !r.last && !r.invite && !backfilled.current.has(r.id)).slice(0, 60);
    if (!todo.length) return;
    let cancelled = false;
    (async () => {
      for (const r of todo) {
        if (cancelled) return;
        backfilled.current.add(r.id);
        try {
          for (let page = 0; page < 3 && !lastMessage(r.room); page++) {
            const more = await client.paginateEventTimeline(r.room.getLiveTimeline(), { backwards: true, limit: 30 });
            if (!more) break;
          }
        } catch {}
      }
    })();
    return () => { cancelled = true; };
  }, [rooms, client]);

  // Local mode: bridges invite you to each chat; join automatically, as Beeper does.
  useEffect(() => {
    if (!isLocal) return;
    for (const r of rooms) {
      if (!r.invite) continue;
      const inviter = r.room.getMember(client.getUserId())?.events.member?.getSender();
      if (inviter && BRIDGE_PUPPET.test(inviter)) client.joinRoom(r.id).catch(() => {});
    }
  }, [rooms, isLocal, client]);

  // Local mode: prompt to connect when nothing is, and borrow your name and photo from your accounts.
  const prompted = useRef(false);
  useEffect(() => {
    if (!isLocal || !localStatus) return;
    const ready = Object.values(localStatus.bridges).every((b) => ['running', 'needs-setup'].includes(b.status));
    if (ready && !prompted.current) {
      prompted.current = true;
      if (!profiles.length) setSettings('accounts');
    }
    // Your name and photo come from your first-connected account, unless you've
    // changed them yourself (we remember what Relay set automatically).
    const me = client.getUser(client.getUserId());
    const primary = profiles[0];
    if (!primary) return;
    const auto = JSON.parse(localStorage.getItem('relay.autoProfile') || '{}');
    const nameIsAuto = !me?.displayName || me.displayName === 'me' || me.displayName.startsWith('@') || me.displayName === auto.name;
    const photoIsAuto = !me?.avatarUrl || me.avatarUrl === auto.avatar || !auto.avatar;
    const wantName = primary.name && !primary.name.startsWith('+') ? primary.name : null;
    if (wantName && nameIsAuto && me?.displayName !== wantName) client.setDisplayName(wantName).catch(() => {});
    if (primary.avatar && photoIsAuto && me?.avatarUrl !== primary.avatar) client.setAvatarUrl(primary.avatar).catch(() => {});
    localStorage.setItem('relay.autoProfile', JSON.stringify({ name: wantName || auto.name, avatar: primary.avatar || auto.avatar }));
  }, [localStatus, profiles, isLocal, client]);

  const syncing = isLocal && profiles.length > 0;

  // Which room belongs to which filter.
  const matchesFilter = useCallback((r, f) => {
    if (f === 'all') return true;
    if (f.startsWith('net:')) return r.network === f.slice(4);
    const p = profiles.find((x) => `acct:${x.key}` === f);
    if (!p) return true;
    if (p.children) return p.children.has(r.id);
    return r.network === p.net;
  }, [profiles]);

  // Rail entries: your accounts in local mode, networks otherwise.
  const railItems = useMemo(() => {
    const unreadIn = (f) => rooms.some((r) => !r.archived && (r.unread || r.markedUnread) && matchesFilter(r, f));
    if (isLocal && profiles.length) {
      return profiles.map((p) => ({ ...p, filter: `acct:${p.key}`, unread: unreadIn(`acct:${p.key}`) }));
    }
    const nets = [...new Set(rooms.map((r) => r.network))];
    const order = Object.keys(NETWORKS);
    return nets.sort((a, b) => order.indexOf(a) - order.indexOf(b))
      .map((id) => ({ key: id, net: id, badgeNet: id, name: networkInfo(id).name, filter: `net:${id}`, unread: unreadIn(`net:${id}`), isNetwork: true }));
  }, [rooms, profiles, isLocal, matchesFilter]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rooms.filter((r) => {
      if (q) return r.name.toLowerCase().includes(q) || r.preview.toLowerCase().includes(q);
      if (!matchesFilter(r, filter)) return false;
      if (view === 'archive' ? !r.archived : r.archived) return false;
      if (unreadOnly && !(r.unread || r.markedUnread || r.id === activeId)) return false;
      if (labelFilter && !r.labels.some((l) => l.id === labelFilter)) return false;
      if (typeFilter === 'dm' && r.group) return false;
      if (typeFilter === 'group' && !r.group) return false;
      return true;
    });
  }, [rooms, query, filter, view, unreadOnly, labelFilter, typeFilter, activeId, matchesFilter]);
  const allLabels = getLabels(client);

  const active = rooms.find((r) => r.id === activeId) || null;
  const filterItem = railItems.find((i) => i.filter === filter);
  const filterName = filter === 'all' ? 'Inbox' : filterItem ? (filterItem.isNetwork ? filterItem.name : `${networkInfo(filterItem.badgeNet).name} · ${filterItem.name}`) : 'Inbox';

  const openRoom = useCallback((id) => {
    setActiveId(id);
    try { localStorage.setItem('relay.activeRoom', id || ''); } catch {}
  }, []);

  // WhatsApp only sends "typing…" to online devices subscribed to the chat. While Relay is in
  // front, stay online and subscribed to the most recent WhatsApp chats so the list can show it.
  const recentWhatsApp = rooms.filter((r) => !r.archived && /^whatsapp/.test(r.network || '')).slice(0, 15).map((r) => r.id).join(',');
  useEffect(() => {
    const viewing = window.relay.local?.viewing;
    if (!isLocal || !focused || !viewing || !recentWhatsApp) return undefined;
    const ping = () => recentWhatsApp.split(',').forEach((id) => viewing(id, true));
    ping();
    const t = setInterval(ping, 60 * 1000);
    return () => clearInterval(t);
  }, [isLocal, focused, recentWhatsApp]);

  // Files dropped on a chat in the list wait here until that chat's view picks them up.
  const [droppedFiles, setDroppedFiles] = useState(null);
  const dropOnRoom = useCallback((id, files) => { setDroppedFiles({ roomId: id, files }); openRoom(id); }, [openRoom]);

  // ----- Dock badge -----
  const badge = prefs.badge === 'off' ? 0
    : prefs.badge === 'chats' ? rooms.filter((r) => !r.archived && !r.muted && (r.unread || r.markedUnread)).length
    : rooms.reduce((n, r) => n + (r.archived || r.muted ? 0 : r.unread), 0);
  useEffect(() => window.relay.setBadge(badge), [badge]);
  const unreadChats = rooms.filter((r) => !r.archived && !r.muted && (r.unread || r.markedUnread)).length;

  // ----- Native notifications -----
  const stateRef = useRef({});
  stateRef.current = { focused, activeId };
  useEffect(() => {
    const onTimeline = async (ev, room, toStart, removed, data) => {
      if (toStart || removed || !data?.liveEvent || !room) return;
      if (!client.isInitialSyncComplete()) return;
      if (ev.getSender() === client.getUserId()) return;
      await client.decryptEventIfNeeded(ev);
      if (!isDisplayable(ev)) return;

      // Muted chats (e.g. WhatsApp status) stay quiet and stay archived.
      const actions = client.getPushActionsForEvent(ev);
      if (!actions?.notify) return;
      const p = getPrefs();

      // Like Beeper: a new message brings an archived chat back to the inbox.
      if (p.autoUnarchive && room.tags?.[TAG_ARCHIVED]) client.deleteRoomTag(room.roomId, TAG_ARCHIVED).catch(() => {});

      const { focused, activeId } = stateRef.current;
      // Chat you're looking at: just the soft "receive" sound.
      if (focused && activeId === room.roomId) { uiSound('receive'); return; }
      if (!p.notifications) return;
      const isDM = peopleCount(room) <= 2;
      if (!isDM && p.notifGroups === 'mentions' && !actions.tweaks?.highlight) return;
      // App in front but another chat: in-app "push" sound; otherwise the notification tone.
      if (p.notifSound && actions.tweaks?.sound !== false) {
        notificationSound();
      }

      const net = networkInfo(detectNetwork(room));
      const sender = senderName(room, ev.getSender());
      const text = previewText(room, ev, client.getUserId()).replace(/^[^:]+: /, '');
      window.relay.notify({
        title: isDM ? cleanName(sender) : `${cleanName(sender)} · ${cleanName(room.name)}`,
        body: p.notifPreview ? text : `New message${net.name !== 'Matrix' ? ` on ${net.name}` : ''}`,
        roomId: room.roomId,
        silent: true, // Relay plays its own notification sound
      });
    };
    client.on(RoomEvent.Timeline, onTimeline);
    const offClick = window.relay.onNotificationClick((roomId) => {
      setQuery('');
      openRoom(roomId);
    });
    return () => { client.off(RoomEvent.Timeline, onTimeline); offClick(); };
  }, [client, openRoom]);

  // ----- Keyboard shortcuts -----
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setSwitcher((s) => !s); }
      else if (mod && e.key.toLowerCase() === 'f' && !e.shiftKey) { e.preventDefault(); searchRef.current?.focus(); }
      else if (mod && e.key === ',') { e.preventDefault(); setSettings('general'); }
      else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const i = visible.findIndex((r) => r.id === activeId);
        const next = visible[Math.max(0, Math.min(visible.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
        if (next) openRoom(next.id);
      } else if (mod && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const f = e.key === '1' ? 'all' : railItems[Number(e.key) - 2]?.filter;
        if (f) setFilter(f);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, activeId, railItems, openRoom]);

  // ----- Room actions -----
  const receiptType = () => (getPrefs().readReceipts ? ReceiptType.Read : ReceiptType.ReadPrivate);
  const actions = useMemo(() => ({
    receiptType,
    togglePin: (r) => r.pinned ? client.deleteRoomTag(r.id, TAG_PINNED) : client.setRoomTag(r.id, TAG_PINNED, { order: 0.5 }),
    toggleArchive: async (r) => {
      if (r.archived) return client.deleteRoomTag(r.id, TAG_ARCHIVED);
      await client.setRoomTag(r.id, TAG_ARCHIVED, { order: 0.5 });
      if (r.id === activeId) {
        const i = visible.findIndex((v) => v.id === r.id);
        const next = visible[i + 1] || visible[i - 1];
        openRoom(next && next.id !== r.id ? next.id : null);
      }
    },
    markRead: async (r) => {
      window.relay.clearNotifications?.(r.id);
      const last = r.room.getLiveTimeline().getEvents().at(-1);
      if (last) await client.sendReadReceipt(last, receiptType());
      if (r.markedUnread) await client.setRoomAccountData(r.id, 'm.marked_unread', { unread: false });
    },
    toggleMute: (r) => setMuted(client, r.id, !r.muted),
    // From a group: jump to (or create) the private chat with someone, on the same account.
    openDirect: async (userId, fromRoom) => {
      if (userId === client.getUserId()) return;
      const direct = client.getAccountData('m.direct')?.getContent() || {};
      const sameAccount = (id) => !fromRoom?.account || accountOf.get(id)?.key === fromRoom.account.key;
      const existing = (direct[userId] || []).find((id) => client.getRoom(id)?.getMyMembership() === 'join' && sameAccount(id));
      if (existing) { setQuery(''); setFilter('all'); setView('inbox'); openRoom(existing); return; }
      if (!isLocal) { alert('Starting new chats is only available with chats bridged on this Mac.'); return; }
      try {
        const loginId = fromRoom?.account?.key?.split(':').slice(1).join(':');
        const roomId = await local().openDirectChat(userId, loginId);
        // The bridge creates the room and joins you; wait for it to arrive over sync.
        for (let i = 0; i < 40 && client.getRoom(roomId)?.getMyMembership() !== 'join'; i++) {
          if (client.getRoom(roomId)?.getMyMembership() === 'invite') await client.joinRoom(roomId).catch(() => {});
          await new Promise((r) => setTimeout(r, 250));
        }
        setQuery(''); setFilter('all'); setView('inbox');
        openRoom(roomId);
      } catch (err) {
        alert(`Couldn’t open a private chat: ${String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`);
      }
    },
    markUnread: (r) => client.setRoomAccountData(r.id, 'm.marked_unread', { unread: true }),
    leave: async (r) => {
      if (!confirm(`Leave “${r.name}”? This can’t be undone from Relay.`)) return;
      await client.leave(r.id);
      if (r.id === activeId) openRoom(null);
    },
  }), [client, activeId, visible, openRoom, accountOf, isLocal]); // eslint-disable-line react-hooks/exhaustive-deps

  const me = client.getUser(client.getUserId());
  const myName = me?.displayName && me.displayName !== 'me' && !me.displayName.startsWith('@') ? me.displayName : 'You';
  const myAvatar = me?.avatarUrl ? mediaUrl(client, me.avatarUrl, 96) : null;
  const subtitle = isLocal
    ? (profiles.length ? `${profiles.length} account${profiles.length > 1 ? 's' : ''} · This Mac` : 'This Mac')
    : client.getUserId();

  return (
    <div className="app">
      <nav className="rail">
        <div className="drag-region rail-drag" />
        <button className={`rail-btn ${filter === 'all' && view === 'inbox' ? 'on' : ''}`} onClick={() => { setFilter('all'); setView('inbox'); }} title="Inbox (⌘1)">
          <svg viewBox="0 0 24 24" width="21" height="21"><path fill="currentColor" d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm0 12h-4a3 3 0 0 1-6 0H5V5h14v10Z" /></svg>
          {unreadChats > 0 && <span className="rail-count">{unreadChats > 99 ? '99+' : unreadChats}</span>}
        </button>
        <button className={`rail-btn ${view === 'archive' ? 'on' : ''}`} onClick={() => setView(view === 'archive' ? 'inbox' : 'archive')} title="Archive">
          <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M20.54 5.23 19.15 3.55A1.45 1.45 0 0 0 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23A1.98 1.98 0 0 0 3 6.5V19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.5c0-.48-.17-.93-.46-1.27ZM6.24 5h11.52l.81.97H5.44l.8-.97ZM5 19V8h14v11H5Zm8.45-9h-2.9v3H8l4 4 4-4h-2.55v-3Z" /></svg>
        </button>
        {isLocal && (
          <>
            <button className={`rail-btn ${view === 'status' ? 'on' : ''}`} onClick={() => setView(view === 'status' ? 'inbox' : 'status')} title="Status">
              <svg viewBox="0 0 24 24" width="21" height="21"><path fill="currentColor" d="M12 2a10 10 0 0 1 9.9 8.6l-2 .3A8 8 0 0 0 12 4V2Zm7.6 13.9 1.8.9A10 10 0 0 1 12 22v-2a8 8 0 0 0 7.6-4.1ZM4.4 7.9 2.6 7A10 10 0 0 1 10 2.1l.3 2A8 8 0 0 0 4.4 7.9ZM4 12a8 8 0 0 0 6 7.7l-.5 2A10 10 0 0 1 2 12h2Zm8-4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z" /></svg>
            </button>
            <button className={`rail-btn ${view === 'communities' ? 'on' : ''}`} onClick={() => setView(view === 'communities' ? 'inbox' : 'communities')} title="Communities">
              <svg viewBox="0 0 24 24" width="21" height="21"><path fill="currentColor" d="M12 12.75c1.63 0 3.07.39 4.24.9A3 3 0 0 1 18 16.4V18H6v-1.6a3 3 0 0 1 1.76-2.75c1.17-.51 2.61-.9 4.24-.9ZM4 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm1.13 1.1A7 7 0 0 0 4 14c-.99 0-1.93.21-2.78.58A2 2 0 0 0 0 16.43V18h4.5v-1.61c0-.83.23-1.61.63-2.29ZM20 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm4 3.43a2 2 0 0 0-1.22-1.85A6.95 6.95 0 0 0 20 14c-.39 0-.76.04-1.13.1.4.68.63 1.46.63 2.29V18H24v-1.57ZM12 6a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z" /></svg>
            </button>
          </>
        )}
        <div className="rail-sep" />
        {railItems.map((item, i) => {
          const net = networkInfo(item.badgeNet || item.net);
          const label = item.isNetwork ? net.name : `${net.name}${item.detail ? ` · ${cleanName(item.detail)}` : ''}`;
          return (
            <button
              key={item.key}
              className={`rail-btn app-tile ${filter === item.filter ? 'on' : ''} ${['BAD_CREDENTIALS', 'UNKNOWN_ERROR', 'LOGGED_OUT'].includes(item.state) ? 'degraded' : ''}`}
              onClick={() => { if (view === 'status' || view === 'communities') setView('inbox'); setFilter(filter === item.filter ? 'all' : item.filter); }}
              onContextMenu={(e) => openRailMenu(e, [
                { label: filter === item.filter ? 'Show all chats' : 'Show only this account', run: () => setFilter(filter === item.filter ? 'all' : item.filter) },
                { label: 'Mark all as read', run: () => rooms.filter((r) => matchesFilter(r, item.filter) && (r.unread || r.markedUnread)).forEach((r) => actions.markRead(r)) },
                !item.isNetwork && 'separator',
                !item.isNetwork && { label: 'Manage accounts…', run: () => setSettings('accounts') },
              ])}
              title={`${label}${i < 8 ? ` (⌘${i + 2})` : ''}`}
            >
              <NetIcon id={item.badgeNet || item.net} variant="tile" size={30} />
              {item.unread && <i className="rail-dot" />}
            </button>
          );
        })}
        {isLocal && (
          <button className="rail-btn" onClick={() => setSettings('accounts')} title="Add an account">
            <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" /></svg>
          </button>
        )}
        <div className="rail-spacer" />
        {railMenu}
        <button className="rail-btn" onClick={() => setSettings(healthLevel !== 'ok' ? 'health' : 'general')} title={healthLevel !== 'ok' ? 'Settings · something needs attention' : 'Settings (⌘,)'}>
          {healthLevel !== 'ok' && <i className={`rail-health-dot ${healthLevel}`} />}
          <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M19.43 12.98a7.8 7.8 0 0 0 0-1.96l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.3 7.3 0 0 0-1.69-.98l-.38-2.65A.49.49 0 0 0 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.49.49 0 0 0 .12.64l2.11 1.65a7.9 7.9 0 0 0 0 1.96l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" /></svg>
        </button>
        <button className="rail-me" onClick={() => setSettings('general')} title={myName}>{(myName[0] || 'R').toUpperCase()}</button>
      </nav>

      {view === 'status' ? (
        <StatusPanel client={client} tick={tick} receiptType={actions.receiptType}
          onReply={(userId, room) => actions.openDirect(userId, { account: accountOf.get(room.roomId) })} />
      ) : view === 'communities' ? (
        <CommunitiesPanel client={client} rooms={rooms} tick={tick} activeId={activeId} onOpen={openRoom} />
      ) : (
        <RoomList
          client={client}
          rooms={visible}
          activeId={activeId}
          onOpen={openRoom}
          query={query}
          setQuery={setQuery}
          searchRef={searchRef}
          view={view}
          setView={setView}
          unreadOnly={unreadOnly}
          setUnreadOnly={setUnreadOnly}
          filterName={filterName}
          archivedCount={rooms.filter((r) => r.archived && matchesFilter(r, filter)).length}
          actions={actions}
          showPreviews={prefs.showPreviews}
          me={{ name: myName, avatar: myAvatar, subtitle, id: client.getUserId() }}
          profiles={profiles}
          labels={allLabels}
          labelFilter={labelFilter}
          setLabelFilter={setLabelFilter}
          typeFilter={typeFilter}
          setTypeFilter={setTypeFilter}
          onSettings={() => setSettings('general')}
          onDropFiles={dropOnRoom}
          onNewGroup={isLocal ? () => setNewGroup(true) : null}
        />
      )}

      {active ? (
        <ChatView key={active.id} client={client} info={active} focused={focused} actions={actions}
          droppedFiles={droppedFiles?.roomId === active.id ? droppedFiles.files : null} onDroppedTaken={() => setDroppedFiles(null)} />
      ) : (
        <div className="empty-chat">
          <div className="drag-region" />
          <Logo size={72} />
          <h2>{myName !== 'You' ? `Hi, ${myName.split(' ')[0]}` : 'Welcome to Relay'}</h2>
          <p className="muted">Pick a chat, or press <kbd>⌘</kbd><kbd>K</kbd> to jump to one.</p>
          {rooms.length === 0 && syncing && (
            <p className="muted small">Importing your chats. The first sync can take a few minutes for big groups.</p>
          )}
          {rooms.length === 0 && !syncing && (
            isLocal
              ? <button className="primary" onClick={() => setSettings('accounts')}>Connect WhatsApp, Telegram or Discord</button>
              : <p className="muted small">No chats yet. Connect a bridge to bring in WhatsApp, Telegram and more. See docs/SELF_HOSTING.md.</p>
          )}
        </div>
      )}

      {switcher && (
        <QuickSwitcher rooms={rooms} onClose={() => setSwitcher(false)} onPick={(id) => { setQuery(''); openRoom(id); setSwitcher(false); }} />
      )}
      {settings && (
        <Settings client={client} isLocal={isLocal} section={settings} onSection={setSettings}
          onClose={() => setSettings(null)} onSignOut={onSignOut} />
      )}
      {newGroup && (
        <NewGroupDialog client={client} profiles={profiles} onClose={() => setNewGroup(false)}
          onCreated={(roomId, warning) => {
            setNewGroup(false);
            setQuery(''); setFilter('all'); setView('inbox'); openRoom(roomId);
            if (warning) { setInboxToast(warning); setTimeout(() => setInboxToast(null), 4000); }
          }} />
      )}
      {inboxToast && <div className="toast">{inboxToast}</div>}
    </div>
  );
}
