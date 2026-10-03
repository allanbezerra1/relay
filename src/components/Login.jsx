import { useState } from 'react';
import { loginWithPassword, loginWithToken } from '../matrix.js';
import { NETWORKS } from '../networks.js';
import { hasLocal } from '../local.js';
import LocalSetup from './LocalSetup.jsx';
import Logo from './Logo.jsx';
import NetIcon from './NetIcon.jsx';

export default function Login({ onLogin, initialError }) {
  const [mode, setMode] = useState('password');
  const [view, setView] = useState('choose'); // choose | local | matrix
  const [homeserver, setHomeserver] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = mode === 'password'
        ? await loginWithPassword({ homeserver, user, password })
        : await loginWithToken({ homeserver, accessToken: token });
      await onLogin(session);
    } catch (err) {
      const msg = err?.data?.error || err.message || String(err);
      setError(err?.errcode === 'M_FORBIDDEN' ? 'Wrong username or password.' : msg);
      setBusy(false);
    }
  };

  const showcase = ['whatsapp', 'telegram', 'discord'];

  if (view === 'local') {
    return (
      <div className="login">
        <div className="drag-region" />
        <div className="login-card wide"><LocalSetup onDone={onLogin} onBack={() => setView('choose')} /></div>
      </div>
    );
  }

  return (
    <div className="login">
      <div className="drag-region" />
      <div className="login-card">
        <Logo size={76} className="logo-hero" />
        <h1>Relay</h1>
        <p className="muted">All your chats in one inbox.</p>

        <div className="net-strip">
          {['whatsapp', 'whatsappBusiness', 'telegram', 'discord'].map((id) => <NetIcon key={id} id={id} variant="tile" size={30} />)}
        </div>

        {view === 'choose' && hasLocal() && (
          <div className="choices">
            <button type="button" className="choice primary-choice" onClick={() => setView('local')}>
              <strong>Set up on this Mac</strong>
              <span>Connect your own WhatsApp, Telegram, Signal, Discord and other accounts. Relay runs everything locally, with no servers or accounts to create.</span>
            </button>
            <button type="button" className="choice" onClick={() => setView('matrix')}>
              <strong>Use an existing Matrix account</strong>
              <span>Sign in to a homeserver you already have, with its own bridges.</span>
            </button>
          </div>
        )}

        {(view === 'matrix' || !hasLocal()) && <>
        <div className="segmented">
          <button type="button" className={mode === 'password' ? 'on' : ''} onClick={() => setMode('password')}>Password</button>
          <button type="button" className={mode === 'token' ? 'on' : ''} onClick={() => setMode('token')}>Access token</button>
        </div>

        <form onSubmit={submit}>
          {mode === 'password' ? (
            <>
              <label>
                Username or Matrix ID
                <input autoFocus value={user} onChange={(e) => setUser(e.target.value)} placeholder="@you:example.com" required />
              </label>
              <label>
                Password
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </label>
              <label>
                Homeserver <span className="muted">(optional with a full Matrix ID)</span>
                <input value={homeserver} onChange={(e) => setHomeserver(e.target.value)} placeholder="matrix.example.com" />
              </label>
            </>
          ) : (
            <>
              <label>
                Homeserver
                <input autoFocus value={homeserver} onChange={(e) => setHomeserver(e.target.value)} placeholder="matrix.example.com" required />
              </label>
              <label>
                Access token
                <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="syt_…" required />
              </label>
              <p className="hint">
                For servers that only support single sign-on. Create a token by signing in to a fresh
                session in another client (e.g. Element → Settings → Help &amp; About → Access token),
                and don’t sign that session out.
              </p>
            </>
          )}

          {error && <div className="error">{error}</div>}
          <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          {hasLocal() && <button type="button" className="ghost" onClick={() => setView('choose')}>Back</button>}
        </form>
        </>}
      </div>
    </div>
  );
}
