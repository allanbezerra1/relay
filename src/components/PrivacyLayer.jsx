// Mounted once next to <App /> (src/main.jsx):
//  - the lock screen (frosted glass over a blurred, unreachable app),
//  - Ctrl/⌘+L to lock, and activity pings for the idle timer (electron/applock.cjs),
//  - "Hide chats when Relay isn't in focus": blurs previews and messages.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Logo from './Logo.jsx';
import Avatar from './Avatar.jsx';
import { lockApi, useLockState } from '../applock.js';
import { usePrefs } from '../prefs.js';
import { useWindowFocus } from '../hooks.js';
import { mediaUrl } from '../matrix.js';

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 10000); return () => clearInterval(t); }, []);
  return (
    <div className="lk-clock">
      <b>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b>
      <span>{now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, (c) => c.toUpperCase())}</span>
    </div>
  );
}

function me() {
  const c = window.__relayClient;
  if (!c) return { name: 'Relay', avatar: null, id: 'relay' };
  const u = c.getUser(c.getUserId());
  const name = u?.displayName && u.displayName !== 'me' && !u.displayName.startsWith('@') ? u.displayName : 'You';
  return { name, avatar: u?.avatarUrl ? mediaUrl(c, u.avatarUrl, 160) : null, id: c.getUserId() };
}

function LockScreen({ state, leaving }) {
  const api = lockApi();
  const [pw, setPw] = useState('');
  const [err, setErr] = useState(null);
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const [fp, setFp] = useState(null); // null | 'waiting' | error text
  const input = useRef(null);
  const [who, setWho] = useState(me);
  // Locked right at startup: the chat client (name, photo) shows up a moment later.
  useEffect(() => {
    if (window.__relayClient) return undefined;
    const t = setInterval(() => { if (window.__relayClient) { setWho(me()); clearInterval(t); } }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    input.current?.focus();
    // Keep the keyboard on the lock screen: nothing may reach the app behind it.
    const onFocus = (e) => { if (!e.target.closest?.('.lock-screen')) input.current?.focus(); };
    document.addEventListener('focusin', onFocus);
    return () => { document.removeEventListener('focusin', onFocus); api.cancelFingerprint?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e) => {
    e.preventDefault();
    if (!pw || busy) return;
    setBusy(true);
    const r = await api.unlock(pw).catch(() => ({ ok: false, error: 'Couldn’t check the password.' }));
    setBusy(false);
    if (r.ok) return;
    setErr(r.blockedFor > 0 ? `Too many attempts. Try again in ${Math.ceil(r.blockedFor / 1000)} s.` : r.error);
    setShake((n) => n + 1);
    setPw('');
    input.current?.focus();
  };

  const finger = async () => {
    setFp('waiting');
    setErr(null);
    const r = await api.fingerprint().catch(() => ({ ok: false, error: 'Not available.' }));
    if (!r.ok) setFp(r.error || 'Not recognized.');
  };

  return (
    <div className={`lock-screen ${leaving ? 'leaving' : ''}`} role="dialog" aria-modal="true" aria-label="Relay is locked">
      <div className="drag-region" />
      <div className="lk-aurora"><i /><i /><i /></div>
      <Clock />
      <div className="lk-card">
        <div className="lk-avatar">
          <Avatar src={who.avatar} name={who.name} id={who.id} size={84} />
          <span className="lk-mini-logo"><Logo size={28} /></span>
        </div>
        <h2>{who.name === 'Relay' ? 'Relay is locked' : who.name}</h2>
        <p className="lk-sub">{who.name === 'Relay' ? 'Enter your password to continue.' : 'Relay is locked. Enter your password.'}</p>
        <form onSubmit={submit} className={`lk-pass ${err ? 'error' : ''}`} key={shake} data-shake={shake > 0 ? '' : undefined}>
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M17 9V7A5 5 0 0 0 7 7v2a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2ZM9 7a3 3 0 0 1 6 0v2H9V7Z" /></svg>
          <input ref={input} type="password" value={pw} onChange={(e) => { setPw(e.target.value); setErr(null); }} placeholder="Password" autoFocus aria-label="Password" />
          <button className="lk-go" disabled={!pw || busy} aria-label="Unlock">
            {busy ? <span className="hp-spin light" /> : <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 4 10.6 5.4 16.2 11H4v2h12.2l-5.6 5.6L12 20l8-8z" /></svg>}
          </button>
        </form>
        <div className="lk-err" aria-live="polite">{err || ' '}</div>
        {state.fingerprint && (
          <button className={`lk-fp ${fp === 'waiting' ? 'waiting' : ''}`} onClick={finger} disabled={fp === 'waiting'}>
            <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M17.8 4.5a.6.6 0 0 1-.3-.1A11.2 11.2 0 0 0 12 3c-2 0-3.8.5-5.5 1.4a.5.5 0 0 1-.7-.2.5.5 0 0 1 .2-.7A12.3 12.3 0 0 1 12 2c2.1 0 4 .5 6 1.5.2.2.3.5.2.7a.5.5 0 0 1-.4.3ZM3.5 9.7a.5.5 0 0 1-.4-.8A10.4 10.4 0 0 1 12 4.5c3.6 0 6.8 1.6 8.9 4.4a.5.5 0 0 1-.8.6A9.4 9.4 0 0 0 12 5.5a9.4 9.4 0 0 0-8.1 4 .5.5 0 0 1-.4.2Zm6.3 12.1a.5.5 0 0 1-.4-.2c-.8-.9-1.3-1.5-2-2.7-.7-1.2-1-2.7-1-4.3 0-3 2.5-5.4 5.6-5.4s5.6 2.4 5.6 5.4a.5.5 0 0 1-1 0c0-2.4-2.1-4.4-4.6-4.4s-4.6 2-4.6 4.4c0 1.4.3 2.8.9 3.8.6 1.1 1 1.6 1.8 2.4a.5.5 0 0 1-.3.9Zm7.2-1.8c-1.2 0-2.2-.3-3.1-.9a5.3 5.3 0 0 1-2.4-4.4.5.5 0 0 1 1 0c0 1.4.7 2.7 1.9 3.6.7.4 1.5.7 2.6.7l.8-.1a.5.5 0 0 1 .2 1l-1 .1Zm-2 2a.5.5 0 0 1-.2 0c-1.6-.5-2.6-1-3.6-2.1a7 7 0 0 1-2.1-5c0-1.2 1-2.2 2.3-2.2 1.3 0 2.3 1 2.3 2.2 0 .8.7 1.4 1.4 1.4.8 0 1.5-.6 1.5-1.4 0-2.8-2.4-5.1-5.3-5.1-2.1 0-4 1.2-4.9 3-.3.6-.4 1.3-.4 2.1 0 .6 0 1.5.5 2.8a.5.5 0 0 1-1 .3c-.4-1-.6-2-.6-3.1 0-1 .2-1.8.6-2.6a6.4 6.4 0 0 1 5.8-3.5c3.4 0 6.3 2.7 6.3 6.1 0 1.3-1.1 2.4-2.5 2.4s-2.4-1.1-2.4-2.4c0-.7-.6-1.2-1.3-1.2-.8 0-1.3.5-1.3 1.2 0 1.7.6 3.2 1.8 4.3.9 1 1.8 1.4 3.2 1.8a.5.5 0 0 1-.1 1Z" /></svg>
            {fp === 'waiting' ? (window.relay?.platform === 'darwin' ? 'Waiting for Touch ID…' : 'Touch the fingerprint reader…') : (window.relay?.platform === 'darwin' ? 'Unlock with Touch ID' : 'Unlock with fingerprint')}
          </button>
        )}
        {fp && fp !== 'waiting' && <div className="lk-err soft">{fp}</div>}
      </div>
      <p className="lk-foot">
        <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Z" /></svg>
        Your accounts stay connected and keep receiving messages.{state.hidePreviews ? ' Notifications don’t show their content.' : ''}
      </p>
    </div>
  );
}

export default function PrivacyLayer() {
  const state = useLockState();
  const prefs = usePrefs();
  const focused = useWindowFocus();
  const [shown, setShown] = useState(false); // lock screen mounted (stays during the unlock animation)
  const [leaving, setLeaving] = useState(false);
  const locked = !!state?.locked;
  const lastPing = useRef(0);

  // Lock screen in/out, with an unlock animation.
  useEffect(() => {
    const root = document.documentElement;
    if (locked) {
      root.dataset.locked = '';
      setLeaving(false);
      setShown(true);
      return undefined;
    }
    delete root.dataset.locked;
    if (!shown) return undefined;
    setLeaving(true);
    const t = setTimeout(() => { setShown(false); setLeaving(false); }, 520);
    return () => clearTimeout(t);
  }, [locked]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl/⌘+L locks; while locked, keys never reach the app behind the lock screen.
  useEffect(() => {
    const api = lockApi();
    if (!api) return undefined;
    const onKey = (e) => {
      if (locked) {
        if (!e.target.closest?.('.lock-screen')) { e.preventDefault(); e.stopPropagation(); }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'l' && state?.enabled) {
        e.preventDefault();
        e.stopPropagation();
        api.lock();
      }
    };
    const ping = () => {
      if (locked) return;
      const now = Date.now();
      if (now - lastPing.current > 15000) { lastPing.current = now; api.activity(); }
    };
    window.addEventListener('keydown', onKey, true);
    for (const ev of ['mousedown', 'keydown', 'wheel', 'mousemove']) window.addEventListener(ev, ping, { passive: true, capture: true });
    return () => {
      window.removeEventListener('keydown', onKey, true);
      for (const ev of ['mousedown', 'keydown', 'wheel', 'mousemove']) window.removeEventListener(ev, ping, { capture: true });
    };
  }, [locked, state?.enabled]);

  // Privacy blur while the window isn't focused.
  useEffect(() => {
    const root = document.documentElement;
    if (prefs.privacyBlur && !focused) root.dataset.privacy = prefs.privacyBlurNames ? 'names' : 'on';
    else delete root.dataset.privacy;
  }, [prefs.privacyBlur, prefs.privacyBlurNames, focused]);

  if (!shown || !state) return null;
  return createPortal(<LockScreen state={state} leaving={leaving} />, document.body);
}
