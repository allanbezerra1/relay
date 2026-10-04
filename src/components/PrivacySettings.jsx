// Settings → Privacy & security: app lock (password, idle timer, Touch ID / fingerprint) and
// hiding chats when Relay isn't in focus.
import { useState } from 'react';
import { usePrefs, setPref } from '../prefs.js';
import { lockApi, useLockState, cleanIpcError, combo } from '../applock.js';

const MINUTES = [[1, '1 min'], [5, '5 min'], [15, '15 min'], [60, '1 hour'], [0, 'Never']];

function Toggle({ label, hint, checked, onChange, disabled }) {
  return (
    <label className={`setting ${disabled ? 'disabled' : ''}`}>
      <span className="setting-text">
        <span className="setting-label">{label}</span>
        {hint && <span className="setting-hint">{hint}</span>}
      </span>
      <span className={`switch ${checked ? 'on' : ''}`}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <i />
      </span>
    </label>
  );
}

/** Inline form: set / change / turn off the password. */
function PasswordForm({ mode, onDone }) {
  const [old, setOld] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [minutes, setMinutes] = useState(5);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const api = lockApi();
  const needNew = mode !== 'disable';
  const valid = (mode === 'enable' || old) && (!needNew || (pw.length >= 4 && pw === pw2));

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      if (mode === 'enable') await api.enable(pw, minutes);
      else if (mode === 'change') await api.change(old, pw);
      else await api.disable(old);
      onDone();
    } catch (x) { setErr(cleanIpcError(x)); }
    setBusy(false);
  };

  return (
    <form className="lk-form" onSubmit={submit}>
      {mode !== 'enable' && <input type="password" value={old} onChange={(e) => setOld(e.target.value)} placeholder="Current password" autoFocus />}
      {needNew && (
        <div className="lk-form-row">
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={mode === 'change' ? 'New password' : 'Choose a password'} autoFocus={mode === 'enable'} />
          <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Repeat it" />
        </div>
      )}
      {mode === 'enable' && (
        <div className="lk-form-mins">
          <span>Lock after</span>
          <div className="seg">{MINUTES.map(([v, t]) => <button type="button" key={v} className={minutes === v ? 'on' : ''} onClick={() => setMinutes(v)}>{t}</button>)}</div>
          <span>idle</span>
        </div>
      )}
      {pw2 && pw !== pw2 && <div className="hp-hint bad">The passwords don’t match.</div>}
      {err && <div className="error">{err}</div>}
      <div className="bk-row end">
        <button type="button" className="hp-btn" onClick={onDone}>Cancel</button>
        <button className={mode === 'disable' ? 'danger' : 'primary'} disabled={!valid || busy}>
          {busy ? 'Please wait…' : mode === 'enable' ? 'Turn on the lock' : mode === 'change' ? 'Change password' : 'Turn off the lock'}
        </button>
      </div>
      {mode === 'enable' && <p className="hp-hint">If you forget it, delete <code>lock.json</code> in Relay’s data folder. Your chats aren’t affected.</p>}
    </form>
  );
}

export default function PrivacySettings() {
  const p = usePrefs();
  const lock = useLockState();
  const [form, setForm] = useState(null); // null | 'enable' | 'change' | 'disable'
  const api = lockApi();

  return (
    <>
      {api && lock && (
        <section className="group">
          <h3>App lock</h3>
          <div className="group-body">
            <div className="setting lk-head">
              <span className={`lk-badge ${lock.enabled ? 'on' : ''}`}>
                <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d={lock.enabled ? 'M17 9V7A5 5 0 0 0 7 7v2a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2ZM9 7a3 3 0 0 1 6 0v2H9V7Zm3 10a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z' : 'M17 9h-7V7a2 2 0 0 1 3.9-.6l1.9-.6A4 4 0 0 0 8 7v2H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2Zm-5 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z'} /></svg>
              </span>
              <span className="setting-text">
                <span className="setting-label">Lock Relay with a password</span>
                <span className="setting-hint">{lock.enabled
                  ? `On. Asks for it when Relay opens, after it sits idle, when your screen locks and with ${combo('L')}.`
                  : 'Asks for a password to open Relay, like a padlock on your chats.'}</span>
              </span>
              {!form && (lock.enabled
                ? <span className="row-btns"><button className="ghost small" onClick={() => setForm('change')}>Change password</button><button className="ghost small" onClick={() => setForm('disable')}>Turn off</button></span>
                : <button className="primary small-btn" onClick={() => setForm('enable')}>Turn on</button>)}
            </div>
            {form && <PasswordForm mode={form} onDone={() => setForm(null)} />}
            {lock.enabled && !form && (
              <>
                <div className="setting">
                  <span className="setting-text"><span className="setting-label">Lock automatically</span><span className="setting-hint">After this long without using Relay.</span></span>
                  <div className="seg">{MINUTES.map(([v, t]) => <button key={v} className={lock.minutes === v ? 'on' : ''} onClick={() => api.setOptions({ minutes: v })}>{t}</button>)}</div>
                </div>
                <Toggle label="Hide notification previews while locked" hint="Notifications only say “New message”, with no name or text."
                  checked={lock.hidePreviews} onChange={(v) => api.setOptions({ hidePreviews: v })} />
                {lock.fingerprint && (
                  <div className="setting">
                    <span className="setting-text"><span className="setting-label">{window.relay?.platform === 'darwin' ? 'Unlock with Touch ID' : 'Unlock with your fingerprint'}</span><span className="setting-hint">{window.relay?.platform === 'darwin' ? 'On the lock screen.' : 'On the lock screen, with the system fingerprint reader (fprintd).'}</span></span>
                    <span className="lk-fp-ok">✓ Available</span>
                  </div>
                )}
                <div className="setting">
                  <span className="setting-text"><span className="setting-label">Lock now</span><span className="setting-hint">Also with {combo('L')}.</span></span>
                  <button className="ghost small" onClick={() => api.lock()}>Lock</button>
                </div>
              </>
            )}
          </div>
        </section>
      )}
      <section className="group">
        <h3>Screen</h3>
        <div className="group-body">
          <Toggle label="Hide chats when Relay isn’t in focus"
            hint="Blurs the list previews and messages when you switch to another window. Hover to peek."
            checked={!!p.privacyBlur} onChange={(v) => setPref('privacyBlur', v)} />
          <Toggle label="Hide names too" hint="Blurs chat names and senders as well." disabled={!p.privacyBlur}
            checked={!!p.privacyBlurNames} onChange={(v) => setPref('privacyBlurNames', v)} />
        </div>
      </section>
    </>
  );
}
