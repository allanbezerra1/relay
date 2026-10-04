// Settings → Health: is everything running? Local server, each bridge, WhatsApp accounts,
// history sync, disk usage, versions. "Fix" restarts whatever is down.
import { useEffect, useRef, useState } from 'react';
import Logo from './Logo.jsx';
import NetIcon from './NetIcon.jsx';
import { health, fmtBytes, fmtAgo, fmtDuration, cleanIpcError } from '../reliability.js';

const PROC = {
  ok: ['Running', 'ok'],
  starting: ['Starting', 'wait'],
  restarting: ['Restarting', 'wait'],
  crashed: ['Crashed', 'bad'],
  stuck: ['Not responding', 'bad'],
  stopped: ['Stopped', 'off'],
  setup: ['Needs setup', 'off'],
};

const LOGIN = {
  CONNECTED: ['Connected', 'ok'],
  BACKFILLING: ['Connected · fetching messages', 'ok'],
  CONNECTING: ['Connecting…', 'wait'],
  STARTING: ['Starting…', 'wait'],
  TRANSIENT_DISCONNECT: ['Reconnecting…', 'wait'],
  BRIDGE_UNREACHABLE: ['Bridge not answering', 'bad'],
  BAD_CREDENTIALS: ['Signed out: link it again', 'bad'],
  LOGGED_OUT: ['Signed out', 'bad'],
  UNKNOWN_ERROR: ['Error', 'bad'],
};

const DISK = [
  ['database', 'Chat database', '#7c6cff'],
  ['media', 'Photos & files', '#22b8cf'],
  ['bridges', 'Bridges', '#f0529c'],
  ['programs', 'Programs', '#f59f00'],
  ['logs', 'Logs', '#94a3b8'],
  ['other', 'Other (cache)', '#64748b'],
];

function procState(p) {
  const h = p.health === 'starting' && p.crashes > 0 ? 'restarting' : p.health;
  return PROC[h] || [p.status, 'off'];
}

function Pill({ tone, children }) {
  return <span className={`hp-pill ${tone}`}><i />{children}</span>;
}

function SummaryIcon({ level }) {
  return (
    <span className={`hp-orb ${level}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="34" height="34">
        {level === 'ok'
          ? <path fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" d="m5.5 12.5 4.2 4.2L18.5 7.8" />
          : <path fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" d="M12 6.5v7M12 17.4v.1" />}
      </svg>
    </span>
  );
}

function Stat({ label, value, title }) {
  return <div className="hp-stat" title={title}><span>{label}</span><b>{value}</b></div>;
}

function ProcCard({ icon, name, sub, p, now, children, style }) {
  const [label, tone] = procState(p);
  const up = p.health === 'ok' && p.startedAt ? fmtDuration(now - p.startedAt) : '—';
  return (
    <div className={`hp-card hp-proc ${tone}`} style={style}>
      <div className="hp-card-head">
        <span className="hp-icon">{icon}</span>
        <span className="hp-name"><b>{name}</b>{sub && <small>{sub}</small>}</span>
        <Pill tone={tone}>{label}</Pill>
      </div>
      <div className="hp-stats">
        <Stat label="Uptime" value={up} />
        <Stat label="Restarts" value={p.crashes || 0} title="How many times Relay had to restart this service since it was opened" />
        <Stat label="Last activity" value={fmtAgo(p.lastActivity, now)} title={p.lastActivity ? new Date(p.lastActivity).toLocaleString() : ''} />
      </div>
      {p.error && <div className="hp-note bad">{p.error}</div>}
      {children}
    </div>
  );
}

function Account({ l }) {
  const [label, tone] = LOGIN[l.state] || [l.state, 'off'];
  const s = l.sync;
  const pct = s?.history != null ? Math.round(s.history) : null;
  const chats = s?.chats;
  return (
    <div className="hp-account">
      <div className="hp-acc-row">
        <span className={`hp-dot ${tone}`} />
        <span className="hp-acc-name">{l.name || 'Account'}{l.business && <em>Business</em>}</span>
        <span className={`hp-acc-state ${tone}`}>{label}</span>
      </div>
      {l.error && tone !== 'ok' && <div className="hp-acc-err">{l.error}</div>}
      {s && (
        s.active ? (
          <div className="hp-sync">
            <div className="hp-sync-top">
              <span>{s.waitingForPhone ? 'Waiting for the phone to send the history…' : pct != null && pct < 100 ? 'Syncing the history' : 'Creating the chats'}</span>
              <b>{pct != null && pct < 100 ? `${pct}%` : chats?.total ? `${chats.ready}/${chats.total}` : ''}</b>
            </div>
            <div className={`hp-bar ${pct == null && !chats?.total ? 'indeterminate' : ''}`}>
              <i style={{ width: `${pct != null && pct < 100 ? pct : chats?.total ? (100 * chats.ready) / chats.total : 30}%` }} />
            </div>
          </div>
        ) : (
          <div className="hp-sync-done">✓ History synced{chats?.total ? ` · ${chats.ready} chat${chats.ready === 1 ? '' : 's'}` : ''}</div>
        )
      )}
    </div>
  );
}

function DiskCard({ disk, onClean, cleaning, cleaned }) {
  if (!disk) {
    return (
      <div className="hp-card hp-disk">
        <div className="hp-card-head"><span className="hp-name"><b>Storage</b><small>Measuring the space used…</small></span></div>
        <div className="hp-bar indeterminate"><i /></div>
      </div>
    );
  }
  const total = Math.max(1, disk.total);
  return (
    <div className="hp-card hp-disk">
      <div className="hp-card-head">
        <span className="hp-name"><b>Storage</b><small>{disk.free != null ? `${fmtBytes(disk.free)} free on this disk` : 'Relay’s data folder'}</small></span>
        <span className="hp-big">{fmtBytes(disk.total)}</span>
      </div>
      <div className="hp-seg">
        {DISK.map(([k, , color]) => disk[k] > 0 && (
          <i key={k} style={{ flexGrow: disk[k] / total, background: color }} title={`${fmtBytes(disk[k])}`} />
        ))}
      </div>
      <div className="hp-legend">
        {DISK.map(([k, label, color]) => (
          <span key={k}><i style={{ background: color }} />{label}<b>{fmtBytes(disk[k] || 0)}</b></span>
        ))}
      </div>
      <div className="hp-disk-foot">
        <span className="hp-hint">{cleaned != null ? (cleaned > 0 ? `Done: ${fmtBytes(cleaned)} freed.` : 'The logs were already small.') : 'Old logs only hold technical details. Deleting them doesn’t touch your chats.'}</span>
        <button className="hp-btn" disabled={cleaning} onClick={onClean}>{cleaning ? 'Cleaning…' : 'Clean up old logs'}</button>
      </div>
    </div>
  );
}

function FixSteps({ steps }) {
  return (
    <div className="hp-fix">
      {steps.map((s) => (
        <div key={s.id} className={`hp-fix-step ${s.state}`}>
          <span className="hp-fix-ico">{s.state === 'running' ? <span className="hp-spin" /> : s.state === 'done' ? '✓' : s.state === 'failed' ? '!' : '•'}</span>
          <span>{s.label}{s.error && <small>{s.error}</small>}</span>
        </div>
      ))}
    </div>
  );
}

export default function HealthPanel() {
  const api = health();
  const [h, setH] = useState(null);
  const [err, setErr] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [fixSteps, setFixSteps] = useState(null);
  const [fixing, setFixing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleaned, setCleaned] = useState(null);
  const alive = useRef(true);

  const refresh = () => api?.get().then((v) => { if (alive.current) { setH(v); setErr(null); setNow(Date.now()); } })
    .catch((e) => alive.current && setErr(cleanIpcError(e)));

  useEffect(() => {
    alive.current = true;
    refresh();
    const t = setInterval(() => { if (!document.hidden) refresh(); }, 5000);
    const off = api?.onFixProgress((p) => setFixSteps(p.steps));
    return () => { alive.current = false; clearInterval(t); off?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!api) return <><h2 className="pane-title">Health</h2><p className="pane-text muted">Only available in the desktop app.</p></>;

  const runFix = async () => {
    setFixing(true);
    setFixSteps([]);
    try { const r = await api.fix(); setFixSteps(r.steps); } catch (e) { setErr(cleanIpcError(e)); }
    setFixing(false);
    refresh();
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(await api.diagnostics());
      setCopied(true);
      setTimeout(() => alive.current && setCopied(false), 2600);
    } catch (e) { setErr(cleanIpcError(e)); }
  };
  const clean = async () => {
    setCleaning(true);
    try { const r = await api.cleanLogs(); setCleaned(r.freed); } catch (e) { setErr(cleanIpcError(e)); }
    setCleaning(false);
    refresh();
  };

  const s = h?.summary;
  const level = s?.level || 'ok';
  const running = h ? [h.synapse, ...h.bridges].filter((p) => p?.health === 'ok').length : 0;
  const totalProcs = h ? (h.synapse ? 1 : 0) + h.bridges.length : 0;

  return (
    <div className="health">
      <h2 className="pane-title">Health</h2>
      {!h ? (
        <div className="hp-hero loading"><span className="hp-spin big" /><div><h3>Checking…</h3><p>Looking at the local server and the bridges.</p></div></div>
      ) : (
        <>
          <div className={`hp-hero ${level}`}>
            <SummaryIcon level={level} />
            <div className="hp-hero-text">
              <h3>{s.title}</h3>
              {s.issues.length ? (
                <ul>{s.issues.slice(0, 3).map((i, n) => <li key={n} className={i.level}>{i.text}</li>)}</ul>
              ) : (
                <p>{h.installed ? `${running} of ${totalProcs} service${totalProcs === 1 ? '' : 's'} responding · updated ${fmtAgo(now, Date.now())}` : 'The local server isn’t installed on this computer.'}</p>
              )}
              <div className="hp-actions">
                {h.installed && (
                  <button className={`hp-btn ${level !== 'ok' && s.fixable ? 'primary' : ''}`} disabled={fixing} onClick={runFix}>
                    {fixing ? <><span className="hp-spin" /> Fixing…</> : <><svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M22.7 19.3 13.6 10.2c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3l4.3 4.3-3 3-4.4-4.3C.4 7.4.9 10.4 2.9 12.4c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4Z" /></svg> Fix</>}
                  </button>
                )}
                {h.installed && <button className="hp-btn" onClick={() => api.openLogs()}>Show logs</button>}
                <button className="hp-btn" onClick={copy}>{copied ? '✓ Copied' : 'Copy diagnostics'}</button>
              </div>
              {copied && <p className="hp-hint">No phone numbers, tokens or message contents. Paste it wherever you ask for help.</p>}
            </div>
          </div>
          {fixSteps && fixSteps.length > 0 && <FixSteps steps={fixSteps} />}
          {err && <div className="error">{err}</div>}

          {h.installed && (
            <>
              <h4 className="hp-section">Services</h4>
              <div className="hp-grid">
                <ProcCard icon={<Logo size={30} />} name="Local server" sub="Synapse · 127.0.0.1" p={h.synapse} now={now} style={{ '--i': 0 }} />
                {h.bridges.map((b, i) => (
                  <ProcCard key={b.id} icon={<NetIcon id={b.id} variant="tile" size={30} />} name={b.name} sub={`mautrix-${b.id} bridge`} p={b} now={now} style={{ '--i': i + 1 }}>
                    {b.logins.length > 0 && (
                      <div className="hp-accounts">
                        {b.logins.map((l) => <Account key={l.id} l={l} />)}
                      </div>
                    )}
                    {b.logins.length === 0 && b.health === 'ok' && <div className="hp-note">No accounts linked.</div>}
                  </ProcCard>
                ))}
              </div>
            </>
          )}

          <h4 className="hp-section">This computer</h4>
          <div className="hp-grid two">
            <DiskCard disk={h.disk} onClean={clean} cleaning={cleaning} cleaned={cleaned} />
            <div className="hp-card hp-versions">
              <div className="hp-card-head"><span className="hp-name"><b>Versions</b><small>{h.versions.os} · {h.versions.arch}</small></span></div>
              <div className="hp-stats">
                <Stat label="Relay" value={h.versions.app} />
                <Stat label="Electron" value={h.versions.electron} />
                <Stat label="Chromium" value={h.versions.chrome} title={h.versions.chrome} />
                <Stat label="Node.js" value={h.versions.node} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
