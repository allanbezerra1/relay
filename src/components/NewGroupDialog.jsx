import { useEffect, useMemo, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import NetIcon from './NetIcon.jsx';
import { memberAvatar, cleanName } from '../matrix.js';
import { local, cleanError } from '../local.js';

// Networks whose bridges can create groups.
const GROUP_NETS = new Set(['whatsapp', 'telegram', 'signal']);

/**
 * New group: pick the account, a name, an optional photo and the people (from your one-to-one
 * chats on that account). The bridge creates the group on the network and its chat here.
 */
export default function NewGroupDialog({ client, profiles, onClose, onCreated }) {
  const accounts = profiles.filter((p) => GROUP_NETS.has(p.net) && p.state !== 'logged_out');
  const [accountKey, setAccountKey] = useState(accounts[0]?.key || null);
  const account = accounts.find((a) => a.key === accountKey);
  const [name, setName] = useState('');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(() => new Map()); // userId -> contact
  const [photo, setPhoto] = useState(null); // { file, preview }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const photoInput = useRef(null);

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose, busy]);

  // People you have one-to-one chats with on this account.
  const contacts = useMemo(() => {
    if (!account?.children) return [];
    const direct = client.getAccountData('m.direct')?.getContent() || {};
    const out = [];
    for (const [userId, roomIds] of Object.entries(direct)) {
      if (userId === account.ghost || !/^@[a-z]+_/.test(userId)) continue;
      const roomId = (roomIds || []).find((id) => account.children.has(id) && client.getRoom(id)?.getMyMembership() === 'join');
      if (!roomId) continue;
      const room = client.getRoom(roomId);
      const last = room.getLiveTimeline().getEvents().at(-1)?.getTs() || 0;
      out.push({ userId, roomId, name: cleanName(room.name || userId), avatar: memberAvatar(client, room, userId, 64), last });
    }
    return out.sort((a, b) => b.last - a.last);
  }, [client, account]);

  const query = q.trim().toLowerCase();
  const shown = (query ? contacts.filter((c) => c.name.toLowerCase().includes(query)) : contacts).slice(0, 120);

  const toggle = (c) => setPicked((m) => { const n = new Map(m); n.has(c.userId) ? n.delete(c.userId) : n.set(c.userId, c); return n; });
  const switchAccount = (key) => { setAccountKey(key); setPicked(new Map()); };

  const pickPhoto = (file) => {
    if (!file?.type.startsWith('image/')) return;
    if (photo?.preview) URL.revokeObjectURL(photo.preview);
    setPhoto({ file, preview: URL.createObjectURL(file) });
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      let avatar = null;
      if (photo) ({ content_uri: avatar } = await client.uploadContent(photo.file, { name: photo.file.name, type: photo.file.type }));
      const { roomId, failed } = await local().createGroup(account.net, account.id, { name: name.trim(), participants: [...picked.keys()], avatar });
      // The bridge creates the room and invites you; join it as soon as it arrives.
      for (let i = 0; i < 40 && client.getRoom(roomId)?.getMyMembership() !== 'join'; i++) {
        if (client.getRoom(roomId)?.getMyMembership() === 'invite') await client.joinRoom(roomId).catch(() => {});
        await new Promise((r) => setTimeout(r, 250));
      }
      onCreated(roomId, failed.length ? `${failed.length} ${failed.length > 1 ? 'people' : 'person'} couldn’t be added` : null);
    } catch (err) {
      setError(cleanError(err));
      setBusy(false);
    }
  };

  if (!accounts.length) {
    return (
      <div className="overlay" onMouseDown={onClose}>
        <div className="dialog new-group" onMouseDown={(e) => e.stopPropagation()}>
          <header><h2>New group</h2><button className="ghost" onClick={onClose}>✕</button></header>
          <p className="ip-empty">Connect a WhatsApp, Telegram or Signal account to create groups.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay" onMouseDown={() => !busy && onClose()}>
      <div className="dialog new-group" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>New group</h2>
          <button className="ghost" onClick={onClose} disabled={busy}>✕</button>
        </header>

        {accounts.length > 1 && (
          <div className="ng-accounts">
            {accounts.map((a) => (
              <button key={a.key} className={`ng-account ${a.key === accountKey ? 'on' : ''}`} onClick={() => switchAccount(a.key)}>
                <NetIcon id={a.badgeNet} variant="tile" size={20} />
                <span>{a.business ? 'WhatsApp Business' : a.net === 'whatsapp' ? 'WhatsApp' : a.net[0].toUpperCase() + a.net.slice(1)}</span>
                <small>{cleanName(a.detail || a.name || '')}</small>
              </button>
            ))}
          </div>
        )}

        <div className="ng-head">
          <button className="ng-photo" onClick={() => photoInput.current?.click()} title="Group photo">
            {photo ? <img src={photo.preview} alt="" /> : (
              <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M9 4 7.2 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.2L15 4H9Zm3 4.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z" /></svg>
            )}
          </button>
          <input ref={photoInput} type="file" accept="image/*" hidden onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ''; }} />
          <input className="ng-name" autoFocus value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Group name" />
        </div>

        {picked.size > 0 && (
          <div className="ng-chips">
            {[...picked.values()].map((c) => (
              <button key={c.userId} className="ng-chip" onClick={() => toggle(c)} title="Remove">
                <Avatar src={c.avatar} name={c.name} id={c.userId} size={20} />{c.name.split(' ')[0]}<span>✕</span>
              </button>
            ))}
          </div>
        )}

        <input className="fw-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" />
        <div className="fw-list">
          {shown.map((c) => (
            <button key={c.userId} className={`fw-row ${picked.has(c.userId) ? 'on' : ''}`} onClick={() => toggle(c)}>
              <Avatar src={c.avatar} name={c.name} id={c.userId} size={34} />
              <span className="fw-name">{c.name}</span>
              <span className={`sel-check static ${picked.has(c.userId) ? 'on' : ''}`}>{picked.has(c.userId) ? '✓' : ''}</span>
            </button>
          ))}
          {!shown.length && <div className="ip-empty">{query ? 'Nobody found.' : 'No one-to-one chats on this account yet.'}</div>}
        </div>

        {error && <div className="error">{error}</div>}
        <footer>
          <span className="muted small">{picked.size ? `${picked.size} ${picked.size > 1 ? 'people' : 'person'} selected` : 'Pick at least one person'}</span>
          <button className="primary" disabled={!name.trim() || !picked.size || busy} onClick={create}>{busy ? 'Creating…' : 'Create group'}</button>
        </footer>
      </div>
    </div>
  );
}

