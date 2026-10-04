// Settings → Automations: "when a message like this arrives, do that" (engine in src/automations.js).
import { useMemo, useState } from 'react';
import { usePrefs } from '../prefs.js';
import { getRules, saveRules, newRule, fromTemplate, TEMPLATES, KINDS, ruleHits } from '../automations.js';
import { getFolders } from '../organize.js';
import { NETWORKS, detectNetwork } from '../networks.js';
import { cleanName, peopleCount } from '../matrix.js';
import NetIcon from './NetIcon.jsx';
import { ask } from '../dialogs.jsx';

const Svg = ({ d, size = 16 }) => <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" d={d} /></svg>;
const BOLT = 'M7 2v11h3v9l7-12h-4l4-8H7Z';
const TRASH = 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12ZM8 9h8v10H8V9Zm7.5-5-1-1h-5l-1 1H5v2h14V4h-3.5Z';
const EDIT = 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z';

const SCOPES = [['any', 'Any chat'], ['dm', 'Private chats'], ['group', 'Groups'], ['rooms', 'Chosen chats']];
const NOTIFY = [['normal', 'Normal'], ['urgent', '⚡ Urgent'], ['silent', '🔕 Silent']];

/** One readable sentence: "When a boleto arrives in groups → folder Bills, mark as read". */
function describe(rule, roomName, folderName) {
  const w = rule.when || {}, t = rule.then || {};
  const what = KINDS.find((k) => k.id === w.kind && k.id !== 'any')?.label.toLowerCase();
  const parts = [];
  parts.push(what ? `a ${what} arrives` : 'a message arrives');
  if (w.words?.trim()) parts.push(`with “${w.words.split(',').map((x) => x.trim()).filter(Boolean).join('” or “')}”`);
  if (w.sender?.trim()) parts.push(`from ${w.sender.trim()}`);
  if (w.scope === 'dm') parts.push('in private chats');
  if (w.scope === 'group') parts.push('in groups');
  if (w.scope === 'rooms') parts.push(w.rooms?.length ? `in ${w.rooms.map(roomName).join(', ')}` : 'in (no chat chosen yet)');
  if (w.networks?.length) parts.push(`on ${w.networks.map((n) => NETWORKS[n]?.name || n).join(' or ')}`);
  const acts = [];
  if (t.notify === 'urgent') acts.push('notify as urgent');
  if (t.notify === 'silent') acts.push('don’t notify');
  if (t.folder) acts.push(`folder ${t.folder === '__bills' ? 'Bills' : folderName(t.folder)}`);
  if (t.important) acts.push('⭐ important group');
  if (t.markRead) acts.push('mark as read');
  if (t.webhook && t.webhook !== 'https://') acts.push('webhook');
  if (t.reply?.trim()) acts.push('auto-reply');
  return { when: `When ${parts.join(' ')}`, then: acts.length ? acts.join(' · ') : 'nothing yet' };
}

function RoomPicker({ client, value, onChange }) {
  const [q, setQ] = useState('');
  const rooms = useMemo(() => client.getRooms()
    .filter((r) => r.getMyMembership() === 'join')
    .map((r) => ({ id: r.roomId, name: cleanName(r.name || ''), net: detectNetwork(r), group: peopleCount(r) > 2 }))
    .filter((r) => r.name)
    .sort((a, b) => a.name.localeCompare(b.name)), [client]);
  const fq = q.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const shown = rooms.filter((r) => !fq || r.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(fq)).slice(0, 60);
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="au-rooms">
      {value.length > 0 && (
        <div className="au-picked">
          {value.map((id) => <button key={id} onClick={() => toggle(id)}>{rooms.find((r) => r.id === id)?.name || 'Chat'} ✕</button>)}
        </div>
      )}
      <input className="au-input" placeholder="Find a chat…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="au-room-list">
        {shown.map((r) => (
          <label key={r.id} className={value.includes(r.id) ? 'on' : ''}>
            <input type="checkbox" checked={value.includes(r.id)} onChange={() => toggle(r.id)} />
            <NetIcon id={r.net} variant="plain" size={14} />
            <span>{r.name}</span>{r.group && <small>group</small>}
          </label>
        ))}
      </div>
    </div>
  );
}

function Editor({ client, rule: initial, onSave, onCancel }) {
  const [r, setR] = useState(initial);
  const [test, setTest] = useState(null);
  const folders = getFolders(client);
  const setW = (patch) => setR((x) => ({ ...x, when: { ...x.when, ...patch } }));
  const setT = (patch) => setR((x) => ({ ...x, then: { ...x.then, ...patch } }));
  const usedNets = useMemo(() => [...new Set(client.getRooms().map((x) => detectNetwork(x)))].filter((n) => NETWORKS[n]), [client]);
  const webhookOk = /^https?:\/\/.+\..+/.test(r.then.webhook || '');
  const testWebhook = async () => {
    setTest('…');
    const res = await window.relay?.auto?.webhook(r.then.webhook, { test: true, rule: r.name || 'Automation', text: 'Test message from Relay', ts: Date.now() });
    setTest(res?.ok ? `✓ Answered ${res.status}` : `✕ ${res?.error || `HTTP ${res?.status}`}`);
  };

  return (
    <div className="au-editor">
      <input className="au-input au-name" placeholder="Automation name" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} autoFocus />

      <div className="au-block">
        <div className="au-block-title"><span className="au-step">IF</span> a message arrives…</div>
        <div className="au-field">
          <span>Where</span>
          <div className="segmented">{SCOPES.map(([id, label]) => <button key={id} className={r.when.scope === id ? 'on' : ''} onClick={() => setW({ scope: id })}>{label}</button>)}</div>
        </div>
        {r.when.scope === 'rooms' && <RoomPicker client={client} value={r.when.rooms || []} onChange={(rooms) => setW({ rooms })} />}
        <div className="au-field">
          <span>Networks</span>
          <div className="au-nets">
            {usedNets.map((n) => (
              <button key={n} className={(r.when.networks || []).includes(n) ? 'on' : ''} title={NETWORKS[n].name}
                onClick={() => setW({ networks: (r.when.networks || []).includes(n) ? r.when.networks.filter((x) => x !== n) : [...(r.when.networks || []), n] })}>
                <NetIcon id={n} variant="plain" size={15} />{NETWORKS[n].name}
              </button>
            ))}
            {!r.when.networks?.length && <small className="muted">all</small>}
          </div>
        </div>
        <label className="au-field"><span>Containing</span>
          <input className="au-input" placeholder="urgent, emergency (comma-separated; empty = any text)" value={r.when.words} onChange={(e) => setW({ words: e.target.value })} /></label>
        <label className="au-field"><span>From</span>
          <input className="au-input" placeholder="Sender’s name (empty = anyone)" value={r.when.sender} onChange={(e) => setW({ sender: e.target.value })} /></label>
        <label className="au-field"><span>Kind</span>
          <select className="au-input" value={r.when.kind} onChange={(e) => setW({ kind: e.target.value })}>
            {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select></label>
      </div>

      <div className="au-block">
        <div className="au-block-title"><span className="au-step then">THEN</span> Relay…</div>
        <div className="au-field">
          <span>Notification</span>
          <div className="segmented">{NOTIFY.map(([id, label]) => <button key={id} className={r.then.notify === id ? 'on' : ''} onClick={() => setT({ notify: id })}>{label}</button>)}</div>
        </div>
        {r.then.notify === 'urgent' && <p className="au-note">Notifies even in a muted or archived chat.</p>}
        <label className="au-field"><span>Move to folder</span>
          <select className="au-input" value={r.then.folder} onChange={(e) => setT({ folder: e.target.value })}>
            <option value="">— none —</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.icon} {f.name}</option>)}
            {!folders.some((f) => f.name === 'Bills') && <option value="__bills">💰 Bills (create)</option>}
          </select></label>
        <label className="au-check"><input type="checkbox" checked={!!r.then.markRead} onChange={(e) => setT({ markRead: e.target.checked })} /> Mark as read</label>
        <label className="au-check"><input type="checkbox" checked={!!r.then.important} onChange={(e) => setT({ important: e.target.checked })} /> Flag the group as ⭐ important</label>
        <label className="au-field"><span>Webhook</span>
          <div className="au-inline">
            <input className="au-input" placeholder="https://… (n8n, Zapier, Home Assistant)" value={r.then.webhook} onChange={(e) => { setT({ webhook: e.target.value }); setTest(null); }} />
            <button className="au-btn" disabled={!webhookOk} onClick={testWebhook}>Test</button>
          </div>
          {test && <small className={`au-test ${test.startsWith('✓') ? 'ok' : ''}`}>{test}</small>}</label>
        <label className="au-field"><span>Reply automatically</span>
          <textarea className="au-input" rows={2} placeholder="E.g. Driving, I’ll answer soon 🚗 (at most once every 6 h per chat)" value={r.then.reply} onChange={(e) => setT({ reply: e.target.value })} /></label>
      </div>

      <div className="au-actions">
        <button className="au-btn ghost" onClick={onCancel}>Cancel</button>
        <button className="au-btn au-save" onClick={() => onSave({ ...r, name: r.name.trim() || 'Automation' })}>Save automation</button>
      </div>
    </div>
  );
}

export default function AutomationsSettings({ client }) {
  usePrefs();
  const rules = getRules();
  const [editing, setEditing] = useState(null); // rule being edited (new or existing)
  const folders = getFolders(client);
  const roomName = (id) => cleanName(client.getRoom(id)?.name || '') || 'chat';
  const folderName = (id) => folders.find((f) => f.id === id)?.name || 'deleted';

  const save = (rule) => {
    saveRules(rules.some((x) => x.id === rule.id) ? rules.map((x) => (x.id === rule.id ? rule : x)) : [...rules, rule]);
    setEditing(null);
  };
  const remove = async (rule) => {
    if (await ask({ title: `Delete “${rule.name}”?`, body: 'The automation stops working.', ok: 'Delete', danger: true })) saveRules(rules.filter((x) => x.id !== rule.id));
  };

  if (editing) {
    return (
      <>
        <h2 className="pane-title">{rules.some((x) => x.id === editing.id) ? 'Edit automation' : 'New automation'}</h2>
        <Editor client={client} rule={editing} onSave={save} onCancel={() => setEditing(null)} />
      </>
    );
  }

  return (
    <>
      <h2 className="pane-title">Automations</h2>
      <div className="au-hero">
        <span className="au-orb"><Svg d={BOLT} size={22} /></span>
        <div><b>Rules that work for you</b><p>When a message like the one you describe arrives, Relay notifies, silences, organizes, tells another app or replies on its own.</p></div>
      </div>

      {rules.length > 0 && (
        <div className="au-list">
          {rules.map((rule) => {
            const d = describe(rule, roomName, folderName);
            const h = ruleHits(rule.id);
            return (
              <div key={rule.id} className={`au-rule ${rule.enabled === false ? 'off' : ''}`}>
                <div className="au-rule-main" onClick={() => setEditing(rule)}>
                  <b>{rule.name}</b>
                  <span className="au-when">{d.when}</span>
                  <span className="au-then">→ {d.then}</span>
                  {h && <small>Fired {h.n}× · last {new Date(h.at).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small>}
                </div>
                <div className="au-tools">
                  <button className="au-icon" title="Edit" onClick={() => setEditing(rule)}><Svg d={EDIT} size={17} /></button>
                  <button className="au-icon au-del" title="Delete" onClick={() => remove(rule)}><Svg d={TRASH} size={17} /></button>
                </div>
                <span className={`switch ${rule.enabled !== false ? 'on' : ''}`} title={rule.enabled !== false ? 'On' : 'Off'}>
                  <input type="checkbox" checked={rule.enabled !== false} onChange={(e) => saveRules(rules.map((x) => (x.id === rule.id ? { ...x, enabled: e.target.checked } : x)))} />
                  <i />
                </span>
              </div>
            );
          })}
        </div>
      )}

      <button className="au-new" onClick={() => setEditing(newRule())}><Svg d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2Z" size={18} /> New automation</button>

      <h3 className="au-sub">Start from a template</h3>
      <div className="au-templates">
        {TEMPLATES.map((t) => (
          <button key={t.title} onClick={() => setEditing(fromTemplate(t))}>
            <span className="au-emoji">{t.emoji}</span>
            <b>{t.title}</b>
            <small>{t.sub}</small>
          </button>
        ))}
      </div>
    </>
  );
}
