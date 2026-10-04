import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { local, cleanError, CATALOG } from '../local.js';
import NetIcon from './NetIcon.jsx';
import { networkInfo } from '../networks.js';
import { ask, notice as showNotice } from '../dialogs.jsx';

const STATE_LABEL = {
  CONNECTED: 'Connected',
  CONNECTING: 'Connecting…',
  BACKFILLING: 'Syncing history…',
  TRANSIENT_DISCONNECT: 'Reconnecting…',
  BAD_CREDENTIALS: 'Logged out, reconnect it',
  UNKNOWN_ERROR: 'Error',
  LOGGED_OUT: 'Logged out',
};

const PROCESS_LABEL = {
  running: null,
  starting: 'Starting…',
  crashed: 'Restarting…',
  stopped: 'Not running',
  'needs-setup': 'Needs setup',
};


function QR({ data }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(data, { margin: 1, width: 260, errorCorrectionLevel: 'M' }).then((u) => alive && setSrc(u));
    return () => { alive = false; };
  }, [data]);
  return <div className="qr">{src ? <img src={src} alt="QR code" /> : <div className="spinner" />}</div>;
}

// ---------- Generic login for WhatsApp/Telegram (mautrix bridgev2 provisioning API) ----------

// Flows that make no sense for a personal inbox.
const HIDDEN_FLOWS = new Set(['bot', 'manual']);

function V2Login({ network, flows: allFlows, onDone, onCancel }) {
  const flows = allFlows?.filter((f) => !HIDDEN_FLOWS.has(f.id));
  const [step, setStep] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState({});
  const alive = useRef(true);
  const proc = useRef(null);

  useEffect(() => () => {
    alive.current = false;
    if (proc.current) local().loginCancel(network, proc.current);
  }, [network]);

  const begin = async (flowId) => {
    setError(null);
    setBusy(true);
    try {
      const s = await local().loginStart(network, flowId);
      proc.current = s.login_id;
      if (alive.current) setStep(s);
    } catch (err) {
      if (alive.current) setError(cleanError(err));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  // Auto-start when there is only one way to log in.
  useEffect(() => { if (flows?.length === 1) begin(flows[0].id); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // cookies: sign in on the website in a Relay login window, then hand the bridge what it asked for.
  useEffect(() => {
    if (step?.type !== 'cookies') return;
    let cancelled = false;
    local().cookieLogin(step.cookies)
      .then((values) => (cancelled ? null : local().loginStep(network, step.login_id, step.step_id, 'cookies', values)))
      .then((next) => { if (next && alive.current) setStep(next); })
      .catch((err) => { if (alive.current && !cancelled) { proc.current = null; setError(cleanError(err)); setStep(null); } });
    return () => { cancelled = true; };
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // display_and_wait: the bridge answers once something happens (QR scanned, code expired, …).
  useEffect(() => {
    if (!step) return;
    if (step.type === 'complete') { proc.current = null; onDone(); return; }
    if (step.type !== 'display_and_wait') return;
    local().loginStep(network, step.login_id, step.step_id, 'display_and_wait')
      .then((next) => alive.current && setStep(next))
      .catch((err) => { if (alive.current) { proc.current = null; setError(cleanError(err)); setStep(null); } });
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const next = await local().loginStep(network, step.login_id, step.step_id, 'user_input', values);
      setValues({});
      if (alive.current) setStep(next);
    } catch (err) {
      if (alive.current) { setError(cleanError(err)); proc.current = null; setStep(null); }
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  if (!step) {
    return (
      <div className="login-flow">
        {error && <div className="error">{error} Try again.</div>}
        {busy ? <div className="center"><div className="spinner" /></div> : (
          <div className="flow-list">
            {(flows || []).map((f) => (
              <button key={f.id} className="choice" onClick={() => begin(f.id)}>
                <strong>{f.name}</strong>
                {f.description && <span>{f.description}</span>}
              </button>
            ))}
            {!flows?.length && <p className="muted">The bridge is still starting. Wait a moment and try again.</p>}
          </div>
        )}
        <div className="row end"><button className="ghost" onClick={onCancel}>Cancel</button></div>
      </div>
    );
  }

  return (
    <div className="login-flow">
      {step.instructions && <p className="instructions">{step.instructions}</p>}

      {step.type === 'display_and_wait' && (
        <div className="center">
          {step.display_and_wait?.type === 'qr' && <QR data={step.display_and_wait.data} />}
          {step.display_and_wait?.type === 'code' && <div className="pair-code">{step.display_and_wait.data}</div>}
          {step.display_and_wait?.type === 'emoji' && <div className="pair-code">{step.display_and_wait.data}</div>}
          <div className="muted small waiting"><span className="spinner small" /> Waiting…</div>
        </div>
      )}

      {step.type === 'user_input' && (
        <form onSubmit={submit} className="fields">
          {step.user_input.fields.map((f, i) => (
            <label key={f.id}>
              {f.name}
              <input
                autoFocus={i === 0}
                type={f.type === 'password' ? 'password' : f.type === 'phone_number' ? 'tel' : 'text'}
                value={values[f.id] ?? f.default_value ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                placeholder={f.type === 'phone_number' ? '+55 11 91234-5678' : ''}
                required
              />
              {f.description && <span className="hint">{f.description}</span>}
            </label>
          ))}
          <button className="primary" disabled={busy}>{busy ? 'Please wait…' : 'Continue'}</button>
        </form>
      )}

      {step.type === 'cookies' && (
        <div className="center">
          <div className="spinner" />
          <p className="muted small">A login window opened. Sign in there as usual; it closes by itself when you’re in.</p>
        </div>
      )}
      {error && <div className="error">{error}</div>}
      <div className="row end"><button className="ghost" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

// ---------- Discord (older bridge, QR over a WebSocket) ----------

function DiscordLogin({ onDone, onCancel }) {
  const [agreed, setAgreed] = useState(false);
  const [code, setCode] = useState(null);
  const [error, setError] = useState(null);
  const done = useRef(false);

  useEffect(() => {
    if (!agreed) return;
    const off = local().on('discord', (msg) => {
      if (msg.code) setCode(msg.code);
      else if (msg.success) { done.current = true; onDone(); }
      else if (msg.error) setError(msg.error);
      else if (msg.closed && !done.current) setError((e) => e || 'The QR code expired. Try again.');
    });
    local().discordLogin();
    return () => { off(); local().discordCancel(); };
  }, [agreed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!agreed) {
    return (
      <div className="login-flow">
        <p className="instructions">
          Discord doesn’t officially allow connecting personal accounts to other apps. Bans are rare, but
          possible. Only direct messages are synced by default.
        </p>
        <div className="row end">
          <button className="ghost" onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={() => setAgreed(true)}>I understand, continue</button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-flow">
      <p className="instructions">Open Discord on your phone, go to <b>Settings → Scan QR Code</b> and scan this code.</p>
      <div className="center">
        {error ? <div className="error">{error}</div> : code ? <QR data={code} /> : <div className="spinner" />}
        {!error && code && <div className="muted small waiting"><span className="spinner small" /> Waiting for you to approve on your phone…</div>}
      </div>
      <div className="row end">
        {error && <button className="ghost" onClick={() => { setError(null); setCode(null); local().discordLogin(); }}>Try again</button>}
        <button className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ---------- Telegram API keys ----------

function TelegramKeys({ onSaved, onCancel }) {
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await local().setTelegramKeys(apiId, apiHash);
      onSaved();
    } catch (err) {
      setError(cleanError(err));
      setBusy(false);
    }
  };

  return (
    <form className="login-flow fields" onSubmit={save}>
      <p className="instructions">Telegram requires each app to have its own key. It’s free and takes a minute:</p>
      <ol className="howto">
        <li>Open <a href="https://my.telegram.org/apps" target="_blank" rel="noreferrer">my.telegram.org/apps</a> and log in with your phone number.</li>
        <li>Create an app. Any title and short name work, e.g. “Relay”.</li>
        <li>Copy the <b>App api_id</b> and <b>App api_hash</b> here.</li>
      </ol>
      <label>api_id<input value={apiId} onChange={(e) => setApiId(e.target.value)} placeholder="1234567" required autoFocus /></label>
      <label>api_hash<input value={apiHash} onChange={(e) => setApiHash(e.target.value)} placeholder="0123456789abcdef0123456789abcdef" required /></label>
      {error && <div className="error">{error}</div>}
      <div className="row end">
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

// ---------- Dialog ----------

export default function Accounts({ onClose, embedded = false }) {
  const [status, setStatus] = useState(null);
  const [adding, setAdding] = useState(null); // network id
  const [telegramSetup, setTelegramSetup] = useState(false);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [installing, setInstalling] = useState(null); // { id, name, message }
  const [notice, setNotice] = useState(null);

  useEffect(() => local().on('progress', ({ message }) => setInstalling((i) => (i ? { ...i, message } : i))), []);

  // Tap a network: explain if it can't be added, install its bridge the first time, then log in.
  const pick = async (c) => {
    setNotice(null);
    if (!c.bridge) { setNotice(`${c.name}: ${c.why}`); return; }
    const b = status.bridges[c.bridge];
    if (b?.status === 'needs-setup') { setTelegramSetup(true); return; }
    if (c.bridge === 'discord' && b?.logins.length) { setNotice('Discord: one account at a time for now.'); return; }
    if (!b?.installed || b.status !== 'running') {
      setInstalling({ id: c.id, name: c.name, message: null });
      try {
        await local().addNetwork(c.bridge);
        // Wait for the bridge to report its login options.
        for (let i = 0; i < 30; i++) {
          const st = await local().status();
          setStatus(st);
          if (st.bridges[c.bridge]?.status === 'running' && st.bridges[c.bridge]?.flows?.length) break;
          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch (err) {
        setInstalling(null);
        setNotice(`Couldn’t set up ${c.name}: ${cleanError(err)}`);
        return;
      }
      setInstalling(null);
    }
    setAdding(c.bridge);
  };

  const refresh = useCallback(() => {
    local().status().then(setStatus).catch((err) => setError(cleanError(err)));
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    const off = local().on('status', refresh);
    return () => { clearInterval(t); off(); };
  }, [refresh]);

  useEffect(() => {
    if (embedded) return;
    const esc = (e) => e.key === 'Escape' && !adding && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose, adding, embedded]);

  const remove = async (network, login) => {
    if (!(await ask({ title: `Remove ${login.name}?`, body: 'The account leaves Relay and its chats stop updating.', ok: 'Remove', danger: true, icon: 'leave' }))) return;
    try { await local().logout(network, login.id); refresh(); }
    catch (err) { showNotice({ title: 'Couldn’t remove the account', body: cleanError(err) }); }
  };

  const finish = () => { setAdding(null); refresh(); };

  const addingInfo = adding && status?.bridges[adding];

  const title = adding ? `Add ${networkInfo(adding).name}` : telegramSetup ? 'Telegram setup' : 'Accounts';
  const body = (
    <>

        {error && <div className="error">{error}</div>}
        {!status && !error && <div className="center"><div className="spinner" /></div>}

        {status && telegramSetup && (
          <TelegramKeys onSaved={() => { setTelegramSetup(false); refresh(); }} onCancel={() => setTelegramSetup(false)} />
        )}

        {status && adding && (
          adding === 'discord'
            ? <DiscordLogin onDone={finish} onCancel={() => setAdding(null)} />
            : <V2Login network={adding} flows={addingInfo?.flows} onDone={finish} onCancel={() => setAdding(null)} />
        )}

        {status && installing && (
          <div className="login-flow center">
            <NetIcon id={installing.id} variant="tile" size={64} />
            <p className="instructions">{installing.message || `Setting up ${installing.name}…`}</p>
            <div className="spinner" />
            <p className="muted small">First time only: Relay downloads and sets up the {installing.name} bridge on this Mac.</p>
          </div>
        )}

        {status && !adding && !telegramSetup && !installing && (
          <div className="acct-list">
            <div className="net-search">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search networks…" />
            </div>
            <div className="net-grid">
              {CATALOG.filter((c) => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase())).map((c) => {
                const b = c.bridge && status.bridges[c.bridge];
                const logins = b?.logins || [];
                const unavailable = !c.bridge;
                return (
                  <button key={c.id} className={`net-tile ${unavailable ? 'off' : ''}`} onClick={() => pick(c)}
                    title={unavailable ? c.why : logins.length ? `${logins.length} connected · add another` : `Connect ${c.name}`}>
                    <NetIcon id={c.id} variant="tile" size={54} />
                    <span className="net-name">{c.name}</span>
                    <span className="net-sub">
                      {unavailable ? 'Not available'
                        : logins.length ? <span className="net-dots">{logins.slice(0, 3).map((l) => <i key={l.id} className={l.state === 'CONNECTED' ? 'ok' : 'warn'} />)}{logins.length}</span>
                        : b?.status === 'needs-setup' ? 'Needs API key'
                        : ''}
                    </span>
                  </button>
                );
              })}
            </div>
            {notice && <div className="net-notice">{notice}</div>}

            <h3 className="acct-section">Your accounts</h3>
            {Object.entries(status.bridges).flatMap(([id, b]) => b.logins.map((l) => ({ id, b, l }))).length === 0 && (
              <p className="muted small">Nothing connected yet. Pick a network above.</p>
            )}
            {Object.entries(status.bridges).map(([id, b]) => b.logins.map((l) => (
              <div key={`${id}:${l.id}`} className="acct-login">
                <NetIcon id={id === 'whatsapp' && l.business ? 'whatsappBusiness' : id} size={22} />
                <div className="acct-login-body">
                  <span>{l.profileName || l.name}{id === 'whatsapp' && l.business ? ' · Business' : ''}</span>
                  <span className="muted small">{b.name} · {STATE_LABEL[l.state] || l.state}{l.detail && l.detail !== l.name ? ` · ${l.detail}` : ''}</span>
                </div>
                {id === 'telegram' && <button className="ghost small" onClick={() => setTelegramSetup(true)}>API keys</button>}
                <button className="ghost small" onClick={() => remove(id, l)}>Remove</button>
              </div>
            )))}
            {Object.entries(status.bridges).filter(([, b]) => b.status === 'crashed').map(([id, b]) => (
              <div key={id} className="acct-login">
                <NetIcon id={id} size={22} />
                <span className="muted small" style={{ flex: 1 }}>The {b.name} bridge stopped unexpectedly and is restarting.</span>
                <button className="ghost small" onClick={() => local().openLogs()}>Logs</button>
              </div>
            ))}
            <p className="muted small acct-foot">
              Your accounts connect from this Mac. Messages arrive while the Mac is awake, even with Relay’s window closed,
              and catch up when it wakes.
            </p>
          </div>
        )}
    </>
  );

  if (embedded) {
    return (
      <div className="accounts embedded">
        {(adding || telegramSetup) && (
          <button className="back-link" onClick={() => { setAdding(null); setTelegramSetup(false); }}>← Accounts</button>
        )}
        <h2 className="pane-title">{title}</h2>
        {body}
      </div>
    );
  }

  return (
    <div className="overlay" onMouseDown={() => !adding && onClose()}>
      <div className="dialog accounts" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <button className="ghost" onClick={adding ? () => setAdding(null) : onClose}>✕</button>
        </header>
        {body}
      </div>
    </div>
  );
}
