// Settings → Backup: one encrypted file with your local server, bridge logins and settings,
// to move Relay to another computer without scanning QR codes again (electron/backup-core.cjs).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import NetIcon from './NetIcon.jsx';
import { backup, fmtBytes, cleanIpcError } from '../reliability.js';

const PHASE = {
  waiting: 'Waiting for the setup in progress to finish…',
  stopping: 'Pausing the local server…',
  scan: 'Listing the files…',
  write: 'Encrypting and saving',
  restarting: 'Resuming the local server…',
  verify: 'Checking integrity',
  extract: 'Restoring the files',
  finishing: 'Adjusting for this computer…',
  repair: 'Preparing the local server…',
  relaunch: 'Done! Restarting Relay…',
};

const NET_NAMES = { whatsapp: 'WhatsApp', telegram: 'Telegram', discord: 'Discord', signal: 'Signal', gmessages: 'Google Messages', instagram: 'Instagram', facebook: 'Messenger', slack: 'Slack', linkedin: 'LinkedIn', twitter: 'X', bluesky: 'Bluesky', gvoice: 'Google Voice' };

function useProgress() {
  const [p, setP] = useState(null);
  useEffect(() => backup()?.onProgress((v) => setP(v.phase === 'idle' ? null : v)), []);
  return [p, setP];
}

function strength(pw) {
  if (!pw) return 0;
  let s = Math.min(2, Math.floor(pw.length / 6));
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw) || pw.length >= 16) s++;
  return Math.min(4, s);
}
const STRENGTH = ['', 'Weak', 'Fair', 'Good', 'Strong'];

function Progress({ p, onCancel }) {
  const pct = p.total ? Math.min(100, (100 * p.done) / p.total) : null;
  return (
    <div className="bk-progress">
      <div className="bk-progress-top">
        <span>{PHASE[p.phase] || 'Working…'}{p.message && p.phase === 'repair' ? <small>{p.message}</small> : null}</span>
        {pct != null && <b>{Math.floor(pct)}%</b>}
      </div>
      <div className={`hp-bar big ${pct == null ? 'indeterminate' : ''}`}><i style={{ width: `${pct ?? 30}%` }} /></div>
      {p.total > 0 && <div className="bk-progress-sub">{fmtBytes(p.done)} of {fmtBytes(p.total)}</div>}
      {onCancel && <button className="hp-btn" onClick={onCancel}>Cancel</button>}
    </div>
  );
}

function Passphrase({ value, onChange, confirm, onConfirm, autoFocus, placeholder = 'Backup password' }) {
  const [show, setShow] = useState(false);
  const st = strength(value);
  return (
    <div className="bk-pass">
      <div className="bk-field">
        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M17 9V7A5 5 0 0 0 7 7v2a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2ZM9 7a3 3 0 0 1 6 0v2H9V7Z" /></svg>
        <input type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} spellCheck={false} />
        <button type="button" className="bk-eye" onClick={() => setShow(!show)} title={show ? 'Hide password' : 'Show password'}>{show ? 'Hide' : 'Show'}</button>
      </div>
      {onConfirm && (
        <>
          <div className="bk-field">
            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="m9 16.2-3.5-3.5L4 14.2l5 5 11-11-1.4-1.4z" /></svg>
            <input type={show ? 'text' : 'password'} value={confirm} onChange={(e) => onConfirm(e.target.value)} placeholder="Repeat the password" spellCheck={false} />
          </div>
          <div className="bk-strength" data-s={st}><i /><i /><i /><i /><span>{value ? STRENGTH[st] : 'At least 8 characters'}</span></div>
        </>
      )}
    </div>
  );
}

function Summary({ s, file }) {
  const cats = s.categories || {};
  const created = s.created ? new Date(s.created) : null;
  return (
    <div className="bk-summary">
      <div className="bk-sum-head">
        <span className="bk-file-ico">
          <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Zm-1.2 14.6-3.5-3.5 1.4-1.4 2.1 2.1 4.9-4.9 1.4 1.4-6.3 6.3Z" /></svg>
        </span>
        <span>
          <b>Backup verified</b>
          <small>{file?.name}{created ? ` · ${created.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })}, ${created.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}{s.host ? ` · made on “${s.host}”` : ''}</small>
        </span>
      </div>
      <div className="bk-sum-grid">
        <div><span>Chats</span><b>{fmtBytes(cats.database?.bytes || 0)}</b></div>
        <div><span>Photos &amp; files</span><b>{s.includesMedia ? fmtBytes(cats.media?.bytes || 0) : 'Not included'}</b></div>
        <div><span>Total</span><b>{fmtBytes(s.bytes)}</b></div>
        <div><span>Files</span><b>{s.files.toLocaleString()}</b></div>
      </div>
      {s.bridges?.length > 0 && (
        <div className="bk-nets">
          {s.bridges.map((b) => <span key={b} title={NET_NAMES[b] || b}><NetIcon id={b} variant="tile" size={26} />{NET_NAMES[b] || b}</span>)}
        </div>
      )}
      {!s.hasServer && <div className="hp-note bad">This backup has no local server in it. Restoring it won’t bring back any chats.</div>}
    </div>
  );
}

/** Pick → passphrase → verify → summary → restore + relaunch. Also used from the welcome screen. */
export function RestoreFlow({ onDone, supported = true }) {
  const api = backup();
  const [file, setFile] = useState(null);
  const [pass, setPass] = useState('');
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(null); // 'verify' | 'restore'
  const [err, setErr] = useState(null);
  const [p] = useProgress();

  const pick = async () => {
    setErr(null);
    const f = await api.pick();
    if (f) { setFile(f); setSummary(null); setPass(''); }
  };
  const verify = async (e) => {
    e?.preventDefault();
    setErr(null);
    setBusy('verify');
    try { setSummary(await api.inspect(file.path, pass)); } catch (x) { setErr(cleanIpcError(x)); }
    setBusy(null);
  };
  const restore = async () => {
    setErr(null);
    setBusy('restore');
    try { await api.restore(file.path, pass); } catch (x) { setErr(cleanIpcError(x)); setBusy(null); }
  };

  if (!supported) {
    return <p className="pane-text muted">Restoring a backup sets up local mode, which needs a Mac with Apple silicon.</p>;
  }

  if (!file) {
    return (
      <div className="bk-drop" onClick={pick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && pick()}>
        <span className="bk-drop-ico"><svg viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A6 6 0 0 0 6 20h13a5 5 0 0 0 .35-9.96ZM14 13v4h-4v-4H7l5-5 5 5h-3Z" /></svg></span>
        <b>Choose a backup file</b>
        <small>A <code>.relaybackup</code> file made on another computer, or before reinstalling.</small>
      </div>
    );
  }

  return (
    <div className="bk-restore">
      <div className="bk-file">
        <span className="bk-file-ico small"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm7 1.5V9h5.5L13 3.5Z" /></svg></span>
        <span><b>{file.name}</b><small>{fmtBytes(file.size)}</small></span>
        {!busy && <button className="hp-btn" onClick={pick}>Change</button>}
      </div>
      {!summary ? (
        busy === 'verify' && p ? <Progress p={p} onCancel={() => api.cancel()} /> : (
          <form onSubmit={verify} className="bk-form">
            <Passphrase value={pass} onChange={setPass} autoFocus placeholder="The password used when creating the backup" />
            <button className="primary" disabled={!pass || !!busy}>{busy ? 'Checking…' : 'Check backup'}</button>
          </form>
        )
      ) : (
        <>
          <Summary s={summary} file={file} />
          {busy === 'restore' ? (p ? <Progress p={p} /> : <Progress p={{ phase: 'extract' }} />) : (
            <>
              <div className="bk-warn">
                <b>What happens next</b>
                <span>This computer’s local server pauses for a moment. Your current data isn’t deleted: it’s kept aside in a <code>local.before-restore-…</code> folder. Then Relay restarts with the chats and accounts from the backup, no QR codes to scan.</span>
              </div>
              <div className="bk-row end">
                {onDone && <button className="hp-btn" onClick={onDone}>Cancel</button>}
                <button className="primary" onClick={restore}>Restore and restart</button>
              </div>
            </>
          )}
        </>
      )}
      {err && <div className="error">{err}</div>}
    </div>
  );
}

/** Modal version of the restore flow (welcome screen). */
export function RestoreDialog({ onClose }) {
  const [supported, setSupported] = useState(true);
  useEffect(() => { backup()?.info().then((i) => setSupported(i?.supported !== false)).catch(() => {}); }, []);
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return createPortal(
    <div className="overlay bk-overlay" onMouseDown={onClose}>
      <div className="bk-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose} title="Close">✕</button>
        <h2>Restore a backup</h2>
        <p className="bk-lead">Bring your chats and accounts over from another computer.</p>
        <RestoreFlow onDone={onClose} supported={supported} />
      </div>
    </div>,
    document.body,
  );
}

export default function BackupPanel({ isLocal }) {
  const api = backup();
  const [info, setInfo] = useState(null);
  const [media, setMedia] = useState(true);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  const [p] = useProgress();

  useEffect(() => { api?.info().then(setInfo).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!api) return <><h2 className="pane-title">Backup</h2><p className="pane-text muted">Only available in the desktop app.</p></>;

  const canCreate = isLocal && info?.hasLocal;
  const ok = pass.length >= 8 && pass === pass2;
  const create = async (e) => {
    e.preventDefault();
    setErr(null);
    setResult(null);
    setBusy(true);
    try {
      const r = await api.create({ passphrase: pass, includeMedia: media });
      if (!r.cancelled) { setResult(r); setPass(''); setPass2(''); api.info().then(setInfo); }
    } catch (x) { setErr(cleanIpcError(x)); }
    setBusy(false);
  };
  const size = info ? (media ? info.total : info.withoutMedia) : null;

  return (
    <div className="backup">
      <h2 className="pane-title">Backup</h2>
      <div className="bk-hero">
        <div className="bk-hero-art"><span /><span /><span /></div>
        <div>
          <h3>Take Relay to another computer</h3>
          <p>One encrypted file with your chats, contacts and your WhatsApp, Telegram and other network logins. Restore it on another computer and pick up where you left off, without scanning a QR code.</p>
          {info?.last && <p className="bk-last">Last backup: {new Date(info.last.at).toLocaleString([], { dateStyle: 'long', timeStyle: 'short' })} · {fmtBytes(info.last.size)}</p>}
        </div>
      </div>

      <h4 className="hp-section">Create a backup</h4>
      <div className="hp-card bk-card">
        {!canCreate ? (
          <p className="pane-text muted">{!isLocal
            ? 'A backup copies Relay’s local server, so it’s only available in local mode (accounts linked on this computer).'
            : !info ? 'Looking for the local server…' : 'There’s no local server data on this computer yet.'}</p>
        ) : result ? (
          <div className="bk-done">
            <span className="hp-orb ok small"><svg viewBox="0 0 24 24" width="22" height="22"><path fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" d="m5.5 12.5 4.2 4.2L18.5 7.8" /></svg></span>
            <div>
              <b>Backup created</b>
              <small>{result.file.split(/[\\/]/).pop()} · {fmtBytes(result.size)}</small>
              <small>Keep the password safe: without it, nobody (not even you) can open the file.</small>
            </div>
            <div className="bk-row">
              <button className="hp-btn" onClick={() => api.showFile(result.file)}>{window.relay?.platform === 'darwin' ? 'Show in Finder' : 'Show in folder'}</button>
              <button className="hp-btn" onClick={() => setResult(null)}>Create another</button>
            </div>
          </div>
        ) : busy && p ? (
          <Progress p={p} onCancel={p.phase === 'write' || p.phase === 'scan' ? () => api.cancel() : null} />
        ) : (
          <form onSubmit={create} className="bk-form">
            <label className="bk-toggle">
              <span>
                <b>Include photos, videos and files</b>
                <small>{info ? `${fmtBytes(info.media)} of media. Without it the backup is ${fmtBytes(info.withoutMedia)}, and older media shows as unavailable.` : 'Measuring…'}</small>
              </span>
              <span className={`switch ${media ? 'on' : ''}`}><input type="checkbox" checked={media} onChange={(e) => setMedia(e.target.checked)} /><i /></span>
            </label>
            <Passphrase value={pass} onChange={setPass} confirm={pass2} onConfirm={setPass2} />
            {pass2 && pass !== pass2 && <div className="hp-hint bad">The passwords don’t match.</div>}
            <div className="bk-warn">
              <b>Chats pause for a few seconds</b>
              <span>To copy the database safely, Relay pauses the local server during the backup. Messages that arrive meanwhile show up right after.</span>
            </div>
            <div className="bk-row end">
              <span className="hp-hint">Estimated size: <b>{fmtBytes(size)}</b> (before compression)</span>
              <button className="primary" disabled={!ok || busy}>{busy ? 'Please wait…' : 'Create backup'}</button>
            </div>
          </form>
        )}
        {err && <div className="error">{err}</div>}
      </div>

      <h4 className="hp-section">Restore a backup</h4>
      <div className="hp-card bk-card">
        <RestoreFlow supported={info?.supported !== false} />
      </div>
    </div>
  );
}
