// Settings → Import history: years of WhatsApp history from an iPhone backup (made in Finder on
// macOS, or over USB on Linux) or from an exported .zip, kept on this computer and shown at the top
// of each chat.
import { useEffect, useMemo, useState } from 'react';
import { useImports, matchRoom, channelMap, yearSpan, plural } from '../imports.js';
import { cleanName } from '../matrix.js';

const api = () => window.relay.imports;
const Svg = ({ d, size = 18 }) => <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" d={d} /></svg>;
const PHONE = 'M16 1H8a3 3 0 0 0-3 3v16a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3V4a3 3 0 0 0-3-3Zm1 19a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h1.5l.5 1h4l.5-1H16a1 1 0 0 1 1 1v16Zm-5-3a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z';
const ZIP = 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm-2 2h1v1h-1V4Zm-1 1h1v1h-1V5Zm1 1h1v1h-1V6Zm-1 1h1v1h-1V7Zm1 1h1v1h-1V8Zm-1 1h1v1h-1V9Zm2 4h-3v-2h1v-1h1v1h1v2Zm1-5V3.5L18.5 8H14Z';
const CHECK = 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z';
const LOCK = 'M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V11a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5Zm-3 5a3 3 0 1 1 6 0v3H9V6Zm3 8a2 2 0 0 1 1 3.73V20h-2v-2.27A2 2 0 0 1 12 14Z';
const SHIELD = 'M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Zm-1 14-4-4 1.41-1.41L11 13.17l5.59-5.59L18 9l-7 7Z';
const IMPORT = 'M5 20h14v-2H5v2Zm7-18-5.5 5.5 1.41 1.41L11 5.83V16h2V5.83l3.09 3.08 1.41-1.41L12 2Z';
const TRASH = 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12ZM8 9h8v10H8V9Zm7.5-5-1-1h-5l-1 1H5v2h14V4h-3.5Z';
const keyOf = (c) => (c.jid || `chat${c.pk}`).replace(/[^A-Za-z0-9_.-]/g, '_');
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const longDate = (ts) => new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function Steps({ steps, at }) {
  return (
    <ol className="im-steps">
      {steps.map((s, i) => <li key={s} className={i < at ? 'done' : i === at ? 'on' : ''}><span>{i < at ? <Svg d={CHECK} size={12} /> : i + 1}</span>{s}</li>)}
    </ol>
  );
}

function ChatSelect({ client, value, onChange }) {
  const rooms = useMemo(() => client.getRooms().filter((r) => r.getMyMembership() === 'join').map((r) => ({ id: r.roomId, name: cleanName(r.name || '') }))
    .filter((r) => r.name).sort((a, b) => a.name.localeCompare(b.name)), [client]);
  return (
    <select className="im-input" value={value || ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Not linked to a chat</option>
      {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
    </select>
  );
}

function Progress({ title, prog }) {
  const p = prog || {};
  const line = p.hint || (p.phase === 'chat' ? p.name : p.phase === 'messages' ? `${(p.done || 0).toLocaleString()} of ${plural(p.total, 'message')}` : 'One moment…');
  return (
    <div className="im-card">
      <b>{title}</b>
      <p>{line}</p>
      <div className="im-bar"><b className={p.total ? '' : 'indeterminate'} style={p.total ? { width: `${Math.round((p.done / p.total) * 100)}%` } : {}} /></div>
    </div>
  );
}

/**
 * Reading a backup and importing from it, the same whichever way the backup was made:
 * scan → choose chats → import → done. `backupId` picks one of Finder's backups (macOS).
 */
function useBackupImport(client, { onNoAccess } = {}) {
  const [phase, setPhase] = useState(null); // null | password | scanning | choose | importing | done
  const [prog, setProg] = useState(null);
  const [error, setError] = useState(null);
  const [backupId, setBackupId] = useState(null);
  const [password, setPassword] = useState('');
  const [chats, setChats] = useState([]);
  const [links, setLinks] = useState({});
  const [result, setResult] = useState(null);
  useEffect(() => api().onProgress(setProg), []);

  const scan = async (id = backupId, pw = password) => {
    setError(null); setProg(null); setBackupId(id); setPhase('scanning');
    const r = await api().scan({ backupId: id, password: pw || undefined });
    if (!r.ok) {
      if (r.error === 'no_access' && onNoAccess) { setPhase(null); onNoAccess(); return r; }
      if (r.error === 'needs_password' || r.error === 'bad_password') { setError(r.error === 'bad_password' ? 'That password didn’t open the backup. Try again.' : null); setPhase('password'); return r; }
      setError(r.message || 'Couldn’t read the backup.'); setPhase(null); return r;
    }
    const lidmap = await api().lidmap().catch(() => ({}));
    const channels = channelMap(client);
    const l = {};
    for (const c of r.chats) l[keyOf(c)] = matchRoom(client, c, { channels, lidmap });
    setLinks(l); setChats(r.chats); setPhase('choose');
    return r;
  };
  const importChats = async (picked, media) => {
    setError(null); setProg(null); setPhase('importing');
    const sel = chats.filter((c) => picked.has(c.pk));
    const roomIds = Object.fromEntries(sel.map((c) => [keyOf(c), links[keyOf(c)] || null]));
    const r = await api().extract({ backupId, chats: sel.map((c) => c.pk), password: password || undefined, media, roomIds });
    if (!r.ok) { setError(r.message); setPhase('choose'); return; }
    setResult(r.chats); setPhase('done');
  };
  return { phase, setPhase, prog, setProg, error, setError, setBackupId, password, setPassword, chats, links, result, scan, importChats };
}

function PasswordStep({ flow }) {
  return (
    <form className="im-card" onSubmit={(e) => { e.preventDefault(); flow.scan(undefined, flow.password); }}>
      <span className="im-card-title"><span className="im-badge-ico"><Svg d={LOCK} size={16} /></span><b>Backup password</b></span>
      <p>This backup is encrypted. Enter the password you chose for <i>Encrypt local backup</i>; it isn’t your iPhone passcode. Relay uses it only to read the backup and doesn’t keep it.</p>
      <input className="im-input" type="password" autoFocus value={flow.password} onChange={(e) => flow.setPassword(e.target.value)} placeholder="Backup password" />
      <button className="im-btn im-primary" disabled={!flow.password}>Open the backup</button>
    </form>
  );
}

function ChooseChats({ client, flow }) {
  const { chats, links } = flow;
  const [picked, setPicked] = useState(() => new Set(chats.map((c) => c.pk)));
  const [media, setMedia] = useState(true);
  const [filter, setFilter] = useState('');
  const shown = chats.filter((c) => !filter || fold(c.name).includes(fold(filter)));
  const total = chats.filter((c) => picked.has(c.pk)).reduce((n, c) => n + c.count, 0);
  return (
    <div className="im-card">
      <b>{plural(chats.length, 'chat')} in this backup’s WhatsApp</b>
      <p>Choose what to import. Each one shows up at the top of its chat in Relay; the ones it could match are linked already, and you can change that later.</p>
      <div className="im-row">
        <input className="im-input" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="im-btn" onClick={() => setPicked(new Set(chats.map((c) => c.pk)))}>All</button>
        <button className="im-btn" onClick={() => setPicked(new Set())}>None</button>
      </div>
      <div className="im-chats">
        {shown.map((c) => {
          const room = links[keyOf(c)] && client.getRoom(links[keyOf(c)]);
          return (
            <label key={c.pk} className={picked.has(c.pk) ? 'on' : ''}>
              <input type="checkbox" checked={picked.has(c.pk)} onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(c.pk)) n.delete(c.pk); else n.add(c.pk); return n; })} />
              <span className="im-chat-main"><b>{c.name}</b><small>{plural(c.count, 'message')} · {yearSpan(c)}{c.group ? ' · group' : ''}</small></span>
              <span className={`im-link ${room ? 'ok' : ''}`}>{room ? `→ ${cleanName(room.name)}` : 'No matching chat'}</span>
            </label>
          );
        })}
        {!shown.length && <p className="im-empty">No chats match “{filter}”.</p>}
      </div>
      <label className="im-check"><input type="checkbox" checked={media} onChange={(e) => setMedia(e.target.checked)} /> Include photos, videos, voice messages and files</label>
      <div className="im-row end">
        <span className="muted">{plural(picked.size, 'chat')} · {plural(total, 'message')}</span>
        <button className="im-btn im-primary" disabled={!picked.size} onClick={() => flow.importChats(picked, media)}>Import</button>
      </div>
    </div>
  );
}

function Done({ flow, children }) {
  return (
    <div className="im-card success">
      <span className="im-card-title"><span className="im-badge-ico ok"><Svg d={CHECK} size={16} /></span><b>Done: {plural(flow.result?.length, 'chat')} imported</b></span>
      <p>Open a chat and scroll to the top: the old history is waiting there.</p>
      {children}
    </div>
  );
}

// ---------- macOS: a backup made in Finder ----------

function FinderWizard({ client }) {
  const [list, setList] = useState(null); // null = loading | { ok, backups } | { ok: false, error }
  const flow = useBackupImport(client, { onNoAccess: () => setList({ ok: false, error: 'no_access' }) });
  const [howto, setHowto] = useState(false);
  const [picked, setPicked] = useState(null);

  const look = async () => {
    setList(null); flow.setError(null);
    const r = await api().finderBackups();
    setList(r);
    if (r.ok && !r.backups.length) setHowto(true);
  };
  useEffect(() => { look(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (b) => {
    setPicked(b); flow.setPassword(''); flow.setBackupId(b.id);
    if (b.encrypted) { flow.setError(null); flow.setPhase('password'); } else flow.scan(b.id, '');
  };
  const noAccess = list && !list.ok && list.error === 'no_access';
  const listError = !!list && !list.ok && !noAccess;

  const phase = flow.phase;
  const at = phase === 'done' ? 5 : phase === 'importing' ? 4 : phase === 'choose' ? 3 : phase === 'scanning' ? (picked?.encrypted ? 3 : 2) : phase === 'password' ? 2 : howto || (list?.ok && !list.backups.length) ? 0 : 1;
  const back = () => { flow.setPhase(null); flow.setError(null); };

  return (
    <div className="im-wizard">
      <Steps steps={['Back up in Finder', 'Choose backup', 'Password', 'Chats', 'Import']} at={at} />
      {flow.error && <div className="im-error">{flow.error}</div>}

      {!phase && noAccess && (
        <div className="im-card im-fda">
          <span className="im-card-title"><span className="im-badge-ico warn"><Svg d={SHIELD} size={16} /></span><b>Relay needs Full Disk Access</b></span>
          <p>macOS keeps iPhone backups in a protected folder. To let Relay read yours:</p>
          <ol className="im-howto">
            <li>Open <b>System Settings → Privacy &amp; Security → Full Disk Access</b>.</li>
            <li>Turn on <b>Relay</b> (use <b>+</b> to add it if it isn’t listed).</li>
            <li>If macOS asks, choose <b>Quit &amp; Reopen</b>, then come back here and try again.</li>
          </ol>
          <div className="im-row">
            <button className="im-btn im-primary" onClick={() => api().openFullDiskAccess()}>Open System Settings</button>
            <button className="im-btn" onClick={look}>Try again</button>
          </div>
          <p className="im-note">Relay only reads WhatsApp’s files from the backup, and never changes the backup.</p>
        </div>
      )}

      {!phase && !noAccess && (howto || (list?.ok && !list.backups.length)) && (
        <div className="im-card">
          <b>Make a backup of your iPhone in Finder</b>
          <p>WhatsApp keeps every chat on the iPhone itself. A backup on this Mac lets Relay read them.</p>
          <ol className="im-howto">
            <li>Connect the iPhone to this Mac with a cable and unlock it. If it asks <i>Trust This Computer?</i>, tap <b>Trust</b>.</li>
            <li>Open <b>Finder</b> and select the iPhone in the sidebar, under Locations.</li>
            <li>In <b>General</b>, choose <b>Back up all of the data on your iPhone to this Mac</b>.</li>
            <li>Turn on <b>Encrypt local backup</b> (Apple recommends it, and it keeps more data). Remember the password: Relay will ask for it.</li>
            <li>Click <b>Back Up Now</b> and wait until it finishes.</li>
          </ol>
          <div className="im-row">
            <button className="im-btn im-primary" onClick={() => { setHowto(false); look(); }}>I’ve made a backup</button>
            {list?.ok && list.backups.length > 0 && <button className="im-btn im-ghost" onClick={() => setHowto(false)}>Back to the backups</button>}
          </div>
        </div>
      )}

      {!phase && !noAccess && !howto && (list === null || list.backups?.length > 0 || listError) && (
        <div className="im-card">
          <b>Choose a backup</b>
          {list === null ? <p className="muted">Looking for backups…</p> : listError ? (
            <div className="im-error">{list.message || 'Couldn’t list the backups.'}</div>
          ) : (
            <>
              <p>These are the iPhone backups Finder made on this Mac. Pick the most recent one of the iPhone with your WhatsApp.</p>
              <div className="im-devices">
                {list.backups.map((b) => {
                  const off = !b.complete;
                  return (
                    <button key={b.id} className="im-device" disabled={off} onClick={() => choose(b)}>
                      <span className="im-device-ico"><Svg d={PHONE} size={20} /></span>
                      <span className="im-device-main">
                        <b>{b.name}</b>
                        <small>{b.date ? `Backed up ${longDate(b.date)}` : 'Date unknown'}{b.product ? ` · ${b.product}` : ''}{b.version ? ` · iOS ${b.version}` : ''}</small>
                        {b.whatsapp === false && <small className="im-warn">WhatsApp wasn’t installed when this backup was made</small>}
                        {off && <small className="im-warn">Incomplete backup</small>}
                      </span>
                      {b.encrypted && <span className="im-tag"><Svg d={LOCK} size={12} />Encrypted</span>}
                      <span className="im-chev">›</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <div className="im-row">
            <button className="im-btn" onClick={look}>Look again</button>
            <button className="im-btn im-ghost" onClick={() => setHowto(true)}>How to make a new backup</button>
          </div>
        </div>
      )}

      {phase && phase !== 'done' && phase !== 'importing' && phase !== 'scanning' && <button className="im-back" onClick={back}>← Other backup</button>}
      {phase === 'password' && <PasswordStep flow={flow} />}
      {phase === 'scanning' && <Progress title={`Reading WhatsApp from ${picked?.name || 'the backup'}…`} prog={flow.prog} />}
      {phase === 'choose' && <ChooseChats client={client} flow={flow} />}
      {phase === 'importing' && <Progress title="Importing…" prog={flow.prog} />}
      {phase === 'done' && (
        <Done flow={flow}>
          <p className="im-note">The backup itself is untouched. If you don’t need it anymore, delete it in Finder → Manage Backups.</p>
          <button className="im-btn" onClick={back}>Import more chats</button>
        </Done>
      )}
    </div>
  );
}

// ---------- Linux: Relay makes the backup over USB (libimobiledevice) ----------

function UsbWizard({ client, info, onRecheck }) {
  const flow = useBackupImport(client);
  const [step, setStep] = useState(info.idevice ? 'device' : 'tools'); // tools | device | backup
  const [devices, setDevices] = useState(null);
  const [device, setDevice] = useState(null);
  const [error, setError] = useState(null);

  const findDevices = async () => { setError(null); setDevices(null); const d = await api().devices(); setDevices(d); if (d.length === 1 && d[0].paired) setDevice(d[0]); };
  useEffect(() => { if (info.idevice) setStep('device'); }, [info.idevice]);
  useEffect(() => { if (step === 'device') findDevices(); }, [step]);

  const runBackup = async () => {
    setError(null); flow.setProg(null); setStep('backup');
    const r = await api().backup(device.udid);
    setStep('device');
    if (!r.ok) { setError(r.message); return; }
    if (device?.encrypted) flow.setPhase('password'); else flow.scan(null, '');
  };

  const phase = flow.phase;
  const at = phase === 'done' ? 5 : phase === 'importing' ? 4 : phase === 'choose' || phase === 'scanning' ? 3 : phase === 'password' || step === 'backup' ? 2 : step === 'device' ? 1 : 0;
  const shownError = error || flow.error;

  return (
    <div className="im-wizard">
      <Steps steps={['Tool', 'iPhone', 'Backup', 'Chats', 'Import']} at={at} />
      {shownError && <div className="im-error">{shownError}</div>}

      {!phase && step === 'tools' && (
        <div className="im-card">
          <b>Install the tool that talks to the iPhone</b>
          <p>It’s <code>libimobiledevice</code>. Run this in a terminal, then come back:</p>
          <div className="im-cmd"><code>{info.install}</code><button className="im-btn" onClick={() => navigator.clipboard.writeText(info.install)}>Copy</button></div>
          <button className="im-btn im-primary" onClick={onRecheck}>I’ve installed it</button>
        </div>
      )}

      {!phase && step === 'device' && (
        <div className="im-card">
          <b>Connect the iPhone with a USB cable</b>
          <p>Unlock the iPhone. If it asks <i>Trust This Computer?</i>, tap <b>Trust</b> and enter its passcode.</p>
          {devices === null ? <p className="muted">Looking…</p> : devices.length === 0 ? (
            <p className="muted">No iPhone found.</p>
          ) : (
            <div className="im-devices">
              {devices.map((d) => (
                <button key={d.udid} className={`im-device ${device?.udid === d.udid ? 'on' : ''}`} onClick={() => d.paired && setDevice(d)}>
                  <span className="im-device-ico"><Svg d={PHONE} size={20} /></span>
                  <span className="im-device-main"><b>{d.name || 'iPhone'}</b><small>{d.paired ? (d.encrypted ? 'Encrypted backups: Relay will ask for the password' : 'Ready') : 'Tap Trust on the iPhone'}</small></span>
                  {!d.paired && <span className="im-btn" role="button" tabIndex={0} onClick={async (e) => { e.stopPropagation(); await api().pair(d.udid); findDevices(); }}>Pair</span>}
                </button>
              ))}
            </div>
          )}
          <div className="im-row">
            <button className="im-btn" onClick={findDevices}>Look again</button>
            {info.backup && <button className="im-btn" onClick={() => flow.scan(null, '')}>Use the backup already here</button>}
            <button className="im-btn im-primary" disabled={!device} onClick={runBackup}>Back up the iPhone</button>
          </div>
          <p className="im-note">The backup stays on this computer, in Relay’s data folder. The first one can take a while (it copies the whole iPhone); later ones only copy what changed. You can delete it when you’re done.</p>
        </div>
      )}

      {!phase && step === 'backup' && (
        <div className="im-card">
          <b>Backing up the iPhone…</b>
          <p>Keep the iPhone connected and unlocked. {flow.prog?.hint || ''}</p>
          <div className="im-bar"><b style={{ width: `${flow.prog?.pct || 2}%` }} /></div>
          <div className="im-row"><span className="muted">{flow.prog?.pct != null ? `${flow.prog.pct}%` : 'Starting…'}</span><button className="im-btn im-ghost" onClick={() => api().cancelBackup()}>Cancel</button></div>
        </div>
      )}

      {phase === 'password' && <PasswordStep flow={flow} />}
      {phase === 'scanning' && <Progress title="Reading WhatsApp from the backup…" prog={flow.prog} />}
      {phase === 'choose' && <ChooseChats client={client} flow={flow} />}
      {phase === 'importing' && <Progress title="Importing…" prog={flow.prog} />}
      {phase === 'done' && (
        <Done flow={flow}>
          <button className="im-btn" onClick={async () => {
            // eslint-disable-next-line no-alert
            if (window.confirm('Delete the iPhone backup from this computer?\n\nThe imported history stays in Relay. Only the copy of the iPhone is deleted.')) { await api().deleteBackup(); onRecheck(); }
          }}>Delete the iPhone backup from this computer</button>
        </Done>
      )}
    </div>
  );
}

// ---------- WhatsApp's "Export chat" .zip ----------

function ZipImport({ client }) {
  const [look, setLook] = useState(null);
  const [me, setMe] = useState('');
  const [roomId, setRoomId] = useState(null);
  const [state, setState] = useState(null); // null | 'importing' | 'done' | error text
  const pick = async () => {
    setState(null);
    const r = await api().zipPick();
    if (!r.ok) { if (r.error !== 'cancelled') setState(r.message); return; }
    setLook(r);
    const myName = fold(client.getUser(client.getUserId())?.displayName || '');
    const first = (s) => s.split(' ')[0];
    const mine = myName && r.senders.find(([n]) => fold(n).includes(first(myName)) || myName.includes(first(fold(n))));
    setMe(mine ? mine[0] : (r.senders[1] || r.senders[0])[0]);
    setRoomId(matchRoom(client, { name: r.name }));
  };
  const go = async () => {
    setState('importing');
    const r = await api().zipImport({ file: look.file, me, roomId });
    setState(r.ok ? 'done' : r.message);
    if (r.ok) setLook(null);
  };
  return (
    <div className="im-card">
      {!look ? (
        <>
          <b>Import a chat export</b>
          <p>On your phone, open the chat, tap its name (on Android: ⋮ → More), choose <b>Export chat</b> → <b>Attach media</b>, send the .zip to this computer and pick it here.</p>
          <button className="im-btn im-primary" onClick={pick}>Choose a .zip…</button>
          {state === 'done' && <p className="im-ok">✓ Imported. It shows up at the top of the chat.</p>}
          {state && state !== 'done' && state !== 'importing' && <div className="im-error">{state}</div>}
        </>
      ) : (
        <>
          <b>{look.name} · {plural(look.count, 'message')} · {yearSpan(look)}</b>
          <div className="im-field"><span>Which one is you?</span>
            <div className="im-senders">
              {look.senders.slice(0, 12).map(([n, k]) => <button key={n} className={me === n ? 'on' : ''} onClick={() => setMe(n)}>{n} <small>{k}</small></button>)}
            </div>
          </div>
          <label className="im-field"><span>Show it at the top of which chat?</span><ChatSelect client={client} value={roomId} onChange={setRoomId} /></label>
          <div className="im-row end">
            <button className="im-btn im-ghost" onClick={() => setLook(null)}>Cancel</button>
            <button className="im-btn im-primary" disabled={state === 'importing'} onClick={go}>{state === 'importing' ? 'Importing…' : 'Import'}</button>
          </div>
        </>
      )}
    </div>
  );
}

export default function ImportSettings({ client }) {
  const list = useImports();
  const [info, setInfo] = useState(null);
  const [mode, setMode] = useState(null); // null | 'iphone' | 'zip'
  const recheck = () => api().info().then(setInfo);
  useEffect(() => { recheck(); }, []);
  const finder = info?.mode === 'finder';
  const remove = (c) => {
    // eslint-disable-next-line no-alert
    if (window.confirm(`Remove the imported history of “${c.name}”?\n\nIt’s removed from Relay only. Nothing changes in WhatsApp.`)) api().remove(c.key);
  };
  return (
    <>
      <h2 className="pane-title">Import history</h2>
      {!mode && <div className="im-hero">
        <span className="im-orb"><Svg d={IMPORT} size={22} /></span>
        <div><b>Years of chats, back in Relay</b><p>The WhatsApp bridge only brings recent messages. Bring back older history, with photos and voice messages. It stays on this computer and shows up at the top of each chat.</p></div>
      </div>}

      {!mode && (
        <div className="im-modes">
          {info && info.mode !== 'none' && (
            <button onClick={() => setMode('iphone')}>
              <span className="im-mode-ico"><Svg d={PHONE} size={24} /></span>
              <b>{finder ? 'From an iPhone backup' : 'iPhone over USB'}</b>
              <small>{finder ? 'Every chat at once, with photos and voice messages, from a backup made in Finder. Recommended.' : 'Every chat at once, with photos and voice messages. Recommended.'}</small>
            </button>
          )}
          <button onClick={() => setMode('zip')}>
            <span className="im-mode-ico zip"><Svg d={ZIP} size={24} /></span>
            <b>Chat export (.zip)</b><small>One chat exported from WhatsApp with “Export chat”, from an iPhone or Android phone.</small>
          </button>
        </div>
      )}
      {mode && <button className="im-back" onClick={() => setMode(null)}>← Back</button>}
      {mode === 'iphone' && finder && <FinderWizard client={client} />}
      {mode === 'iphone' && info?.mode === 'usb' && <UsbWizard client={client} info={info} onRecheck={recheck} />}
      {mode === 'zip' && <ZipImport client={client} />}
      <p className="im-note">About iCloud: WhatsApp’s own iCloud backup can only be read by WhatsApp on the iPhone, so the history has to come from a backup on this computer or from an export.</p>

      {list.length > 0 && (
        <>
          <h3 className="im-sub">Imported</h3>
          <div className="im-list">
            {list.map((c) => (
              <div key={c.key} className="im-item">
                <div className="im-item-main">
                  <b>{c.name}</b>
                  <span className="im-when">{plural(c.count, 'message')} · {yearSpan(c)} · {c.source === 'zip' ? 'chat export' : 'iPhone backup'}</span>
                  <ChatSelect client={client} value={c.roomId} onChange={(id) => api().link(c.key, id)} />
                </div>
                <button className="im-icon im-del" title="Remove" onClick={() => remove(c)}><Svg d={TRASH} size={17} /></button>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
