// Create / edit a smart folder: icon, name, rules (AND) and hand-picked chats, with a live preview.
import { useEffect, useMemo, useState } from 'react';
import Avatar from './Avatar.jsx';
import NetIcon from './NetIcon.jsx';
import { networkInfo, NETWORKS } from '../networks.js';
import { roomAvatar } from '../matrix.js';
import { createLabel } from '../chatmeta.js';
import { EMPTY_RULES, FOLDER_ICONS, PRESETS, newFolderId, normalizeFolder, inFolder, hasRules } from '../organize.js';
import { notice } from '../dialogs.jsx';

const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export default function FolderDialog({ client, folder, include, rooms, profiles = [], labels = [], me, onSave, onDelete, onClose }) {
  const editing = !!folder;
  const [draft, setDraft] = useState(() => (folder ? normalizeFolder(folder) : { ...normalizeFolder({ id: newFolderId(), icon: '💬', include: include || [] }), name: '' }));
  const [pendingLabel, setPendingLabel] = useState(null); // preset "Work" when there's no such label yet
  const [iconsOpen, setIconsOpen] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const rules = draft.rules;
  const setRules = (patch) => setDraft((d) => ({ ...d, rules: { ...d.rules, ...patch } }));

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const applyPreset = (p) => {
    const next = { ...EMPTY_RULES, ...p.rules };
    setPendingLabel(null);
    if (p.rules.labels?.[0] === '@Work') {
      const work = labels.find((l) => /trabalho|work/i.test(l.name));
      if (work) next.labels = [work.id];
      else { next.labels = []; setPendingLabel('Work'); }
    }
    setDraft((d) => ({ ...d, name: d.name && !PRESETS.some((x) => x.name === d.name) ? d.name : p.name, icon: p.icon, rules: next }));
  };

  const networks = useMemo(() => {
    const order = Object.keys(NETWORKS);
    return [...new Set(rooms.map((r) => r.baseNetwork || r.network))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }, [rooms]);

  // Live preview. A pending "Work" label matches nothing yet, so the preview says so.
  const matches = useMemo(() => rooms.filter((r) => inFolder(draft, r, me)), [rooms, draft, me]);
  const byId = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);
  const addResults = addQuery.trim()
    ? rooms.filter((r) => r.name.toLowerCase().includes(addQuery.trim().toLowerCase()) && !draft.include.includes(r.id)).slice(0, 6)
    : [];

  const valid = draft.name.trim() && (hasRules(rules) || draft.include.length || pendingLabel);
  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    let f = { ...draft, name: draft.name.trim() };
    try {
      if (pendingLabel) {
        const label = await createLabel(client, pendingLabel);
        f = { ...f, rules: { ...f.rules, labels: [...f.rules.labels, label.id] } };
      }
      onSave(f);
    } catch (err) {
      notice({ title: 'Couldn’t save the folder', body: err.message });
      setSaving(false);
    }
  };

  return (
    <div className="overlay folder-overlay" onMouseDown={onClose}>
      <div className="folder-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <header className="fd-head">
          <div className="fd-icon-wrap">
            <button className="fd-icon" onClick={() => setIconsOpen(!iconsOpen)} title="Choose an icon">{draft.icon}</button>
            {iconsOpen && (
              <div className="fd-icons">
                {FOLDER_ICONS.map((i) => <button key={i} className={draft.icon === i ? 'on' : ''} onClick={() => { setDraft((d) => ({ ...d, icon: i })); setIconsOpen(false); }}>{i}</button>)}
              </div>
            )}
          </div>
          <input className="fd-name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="Folder name" autoFocus={!editing} maxLength={32} onKeyDown={(e) => e.key === 'Enter' && save()} />
          <button className="close-btn fd-close" onClick={onClose} title="Close (Esc)">✕</button>
        </header>

        {!editing && (
          <div className="fd-presets">
            <span className="fd-presets-label">Suggestions</span>
            {PRESETS.map((p) => (
              <button key={p.key} className="fd-preset" onClick={() => applyPreset(p)} title={p.hint}>
                <span>{p.icon}</span>{p.name}
              </button>
            ))}
          </div>
        )}

        <div className="fd-body">
          <p className="fd-lead">Show chats that match <b>all</b> the rules below.</p>

          {networks.length > 1 && (
            <FdRow title="Network">
              <div className="fd-chips">
                {networks.map((n) => (
                  <button key={n} className={rules.networks.includes(n) ? 'on' : ''} onClick={() => setRules({ networks: toggle(rules.networks, n) })}>
                    <NetIcon id={n} size={18} variant="tile" />{networkInfo(n).name}
                  </button>
                ))}
              </div>
            </FdRow>
          )}

          {profiles.length > 1 && (
            <FdRow title="Account">
              <div className="fd-chips">
                {profiles.map((p) => (
                  <button key={p.key} className={rules.accounts.includes(p.key) ? 'on' : ''} onClick={() => setRules({ accounts: toggle(rules.accounts, p.key) })}>
                    <NetIcon id={p.badgeNet || p.net} size={18} variant="tile" />{p.name}
                  </button>
                ))}
              </div>
            </FdRow>
          )}

          <FdRow title="Type">
            <div className="seg fd-seg">
              {[[null, 'All'], ['dm', 'People'], ['group', 'Groups']].map(([v, t]) => (
                <button key={t} className={rules.type === v ? 'on' : ''} onClick={() => setRules({ type: v })}>{t}</button>
              ))}
            </div>
          </FdRow>

          <FdRow title="Labels">
            <div className="fd-chips">
              {labels.map((l) => (
                <button key={l.id} className={`fd-label ${rules.labels.includes(l.id) ? 'on' : ''}`} style={{ '--c': l.color }} onClick={() => setRules({ labels: toggle(rules.labels, l.id) })}>
                  <span className="label-dot" style={{ background: l.color }} />{l.name}
                </button>
              ))}
              {pendingLabel && <span className="fd-chip-note"><span className="label-dot" /> “{pendingLabel}” (will be created)</span>}
              {!labels.length && !pendingLabel && <span className="fd-muted">No labels yet. Create one from a chat’s details panel.</span>}
            </div>
          </FdRow>

          <FdRow title="Unread">
            <label className={`switch ${rules.unread ? 'on' : ''}`}>
              <input type="checkbox" checked={rules.unread} onChange={(e) => setRules({ unread: e.target.checked })} /><i />
            </label>
            <span className="fd-muted">Only chats with unread messages</span>
          </FdRow>

          <FdRow title="Muted">
            <div className="seg fd-seg">
              {[['include', 'Include'], ['exclude', 'Exclude'], ['only', 'Only']].map(([v, t]) => (
                <button key={v} className={rules.muted === v ? 'on' : ''} onClick={() => setRules({ muted: v })}>{t}</button>
              ))}
            </div>
          </FdRow>

          <FdRow title="Not answered">
            <label className={`switch ${rules.noReplyDays > 0 ? 'on' : ''}`}>
              <input type="checkbox" checked={rules.noReplyDays > 0} onChange={(e) => setRules({ noReplyDays: e.target.checked ? 2 : 0 })} /><i />
            </label>
            <span className={`fd-muted ${rules.noReplyDays > 0 ? 'on' : ''}`}>
              My reply has been pending for more than
              <input type="number" min={1} max={60} value={rules.noReplyDays || 2} disabled={!rules.noReplyDays}
                onChange={(e) => setRules({ noReplyDays: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} />
              day{(rules.noReplyDays || 2) > 1 ? 's' : ''}
            </span>
          </FdRow>

          <FdRow title="Always include" top>
            <div className="fd-manual">
              {draft.include.map((id) => byId.get(id)).filter(Boolean).map((r) => (
                <span key={r.id} className="fd-pill">
                  <Avatar src={roomAvatar(client, r.room, 40)} name={r.name} id={r.id} size={18} />{r.name}
                  <button onClick={() => setDraft((d) => ({ ...d, include: d.include.filter((x) => x !== r.id) }))} title="Remove">✕</button>
                </span>
              ))}
              <div className="fd-add">
                <input value={addQuery} onChange={(e) => setAddQuery(e.target.value)} placeholder="＋ Add a chat…"
                  onKeyDown={(e) => { if (e.key === 'Enter' && addResults[0]) { setDraft((d) => ({ ...d, include: [...d.include, addResults[0].id], exclude: d.exclude.filter((x) => x !== addResults[0].id) })); setAddQuery(''); } }} />
                {addResults.length > 0 && (
                  <div className="fd-add-list">
                    {addResults.map((r) => (
                      <button key={r.id} onClick={() => { setDraft((d) => ({ ...d, include: [...d.include, r.id], exclude: d.exclude.filter((x) => x !== r.id) })); setAddQuery(''); }}>
                        <Avatar src={roomAvatar(client, r.room, 40)} name={r.name} id={r.id} size={22} network={r.network} />{r.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </FdRow>

          {draft.exclude.length > 0 && (
            <FdRow title="Never include" top>
              <div className="fd-manual">
                {draft.exclude.map((id) => byId.get(id)).filter(Boolean).map((r) => (
                  <span key={r.id} className="fd-pill out">
                    <Avatar src={roomAvatar(client, r.room, 40)} name={r.name} id={r.id} size={18} />{r.name}
                    <button onClick={() => setDraft((d) => ({ ...d, exclude: d.exclude.filter((x) => x !== r.id) }))} title="Include again">✕</button>
                  </span>
                ))}
              </div>
            </FdRow>
          )}
        </div>

        <footer className="fd-foot">
          <div className="fd-preview" title={matches.slice(0, 12).map((r) => r.name).join(', ')}>
            <div className="fd-stack">
              {matches.slice(0, 5).map((r) => <Avatar key={r.id} src={roomAvatar(client, r.room, 48)} name={r.name} id={r.id} size={26} />)}
            </div>
            <span className="fd-count" key={matches.length}>
              <b>{matches.length}</b> chat{matches.length === 1 ? '' : 's'}
              {pendingLabel && <small> + the ones you label</small>}
            </span>
          </div>
          {onDelete && <button className="ghost danger-tool" onClick={onDelete}>Delete</button>}
          <button className="primary" disabled={!valid || saving} onClick={save}>{editing ? 'Save' : 'Create folder'}</button>
        </footer>
      </div>
    </div>
  );
}

function FdRow({ title, top, children }) {
  return (
    <div className={`fd-row ${top ? 'top' : ''}`}>
      <span className="fd-row-title">{title}</span>
      <div className="fd-row-body">{children}</div>
    </div>
  );
}
