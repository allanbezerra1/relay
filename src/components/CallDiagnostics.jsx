// Settings → Calls: check what the hidden WhatsApp Web can see (so you know whether answering
// and calling from Relay will work), and preview the ringing window with a fake call.
import { useState } from 'react';
import { diagnoseCalls, simulateCall } from '../calls.js';
import { PHONE_D, VIDEO_D } from './CallUI.jsx';

const Svg = ({ d, size = 16 }) => <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" d={d} /></svg>;
const CHECK = 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z';
const WARN = 'M1 21h22L12 2 1 21Zm12-3h-2v-2h2v2Zm0-4h-2v-4h2v4Z';
const INFO = 'M11 7h2v2h-2V7Zm0 4h2v6h-2v-6Zm1-9a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z';
const ICON = { ok: CHECK, warn: WARN, info: INFO };

const q = (s) => `“${s}”`;

/** Diagnosis → a short verdict and one line per thing Relay depends on. */
function readDiagnosis(d) {
  const p = d.page;
  const rows = [];
  if (d.media) {
    const want = Object.entries(d.media).filter(([, s]) => s !== 'granted').map(([k]) => k);
    const denied = Object.entries(d.media).some(([, s]) => s === 'denied' || s === 'restricted');
    rows.push(!want.length ? ['ok', 'Microphone & camera', 'Relay is allowed to use them.']
      : denied ? ['warn', 'Microphone & camera', `No access to the ${want.join(' and ')}. Allow Relay in System Settings → Privacy & Security.`]
      : ['info', 'Microphone & camera', 'macOS asks the first time you call or answer.']);
  }
  if (!d.window) {
    rows.push(['warn', 'WhatsApp Web', d.linked ? 'Off. Turn on “Receive calls on this computer” above.' : 'Not linked yet. Click “Link WhatsApp Web” above.']);
  } else if (!p) {
    rows.push(['warn', 'WhatsApp Web', 'The page didn’t answer. Wait for it to load and test again.']);
  } else {
    rows.push(p.status === 'ready' ? ['ok', 'WhatsApp Web', 'Linked and ready for calls.']
      : p.status === 'qr' ? ['warn', 'WhatsApp Web', 'Waiting for the QR code. Scan it with your phone.']
      : ['warn', 'WhatsApp Web', 'Still loading. Test again in a few seconds.']);
  }
  if (p && p.status === 'ready') {
    rows.push(p.chat ? ['ok', 'Open chat', p.chat] : ['info', 'Open chat', 'None. Open a chat in WhatsApp Web to check the call buttons.']);
    const btn = (found, kind) => (found ? ['ok', kind, `Found: ${q(found)}`]
      : p.menu ? ['ok', kind, `Inside the ${q(p.menu)} menu`]
      : p.chat ? ['warn', kind, 'Not found in the chat header. Calling from Relay may not work.']
      : ['info', kind, 'Open a chat to check.']);
    rows.push(btn(p.voice, 'Voice call button'));
    rows.push(btn(p.video, 'Video call button'));
    rows.push(p.now.accept && p.now.decline ? ['ok', 'Answer / decline', 'The incoming-call buttons are on screen now.']
      : ['info', 'Answer / decline', 'Can only be checked while a call rings: ask someone to call you and test then.']);
    rows.push(p.inCall ? (p.now.hangup ? ['ok', 'Hang up', 'Found the end-call button.'] : ['warn', 'Hang up', 'In a call, but the end-call button didn’t show up.'])
      : ['info', 'Hang up', 'Checked during a call.']);
  }
  const ready = p?.status === 'ready';
  const callable = ready && (p.voice || p.video || p.menu);
  const bad = rows.some(([t]) => t === 'warn');
  const verdict = callable && !bad ? ['ok', 'All good', 'Answering and calling from Relay should work.']
    : ready && !bad ? ['info', 'Linked', 'Open a chat in WhatsApp Web and test again to check the call buttons.']
    : ['warn', 'Needs attention', ready ? 'Some pieces weren’t found; calls may have to be made from WhatsApp Web itself.' : 'WhatsApp Web isn’t ready, so Relay can’t answer or place calls yet.'];
  return { rows, verdict };
}

export default function CallDiagnostics() {
  const [busy, setBusy] = useState(false);
  const [diag, setDiag] = useState(null);
  const [error, setError] = useState(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await diagnoseCalls();
      if (!d) setError('Couldn’t run the test right now.');
      setDiag(d);
    } catch { setError('Couldn’t run the test right now.'); }
    setBusy(false);
  };

  const result = diag && readDiagnosis(diag);
  const p = diag?.page;
  return (
    <section className="group">
      <h3>Troubleshooting</h3>
      <div className="group-body">
        <div className="setting">
          <span className="setting-text">
            <span className="setting-label">Test detection</span>
            <span className="setting-hint">Checks that Relay can see WhatsApp Web’s login and call buttons, which answering and calling from here rely on.</span>
          </span>
          <button className={`cd-btn ${busy ? 'busy' : ''}`} onClick={run} disabled={busy}>{busy ? 'Testing…' : diag ? 'Test again' : 'Test detection'}</button>
        </div>
        <div className="setting">
          <span className="setting-text">
            <span className="setting-label">Simulate an incoming call <span className="cd-tag">test</span></span>
            <span className="setting-hint">Shows the ringing window with a made-up caller. Answering or declining does nothing.</span>
          </span>
          <span className="cd-row-btns">
            <button className="cd-btn ghosty" onClick={() => simulateCall(false)} title="Simulate a voice call"><Svg d={PHONE_D} size={15} />Voice</button>
            <button className="cd-btn ghosty" onClick={() => simulateCall(true)} title="Simulate a video call"><Svg d={VIDEO_D} size={15} />Video</button>
          </span>
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      {result && (
        <div className={`cd-card ${result.verdict[0]}`} key={diag.at}>
          <div className="cd-verdict">
            <span className={`cd-ico ${result.verdict[0]}`}><Svg d={ICON[result.verdict[0]]} size={18} /></span>
            <span><b>{result.verdict[1]}</b><small>{result.verdict[2]}</small></span>
          </div>
          <ul className="cd-rows">
            {result.rows.map(([tone, title, detail], i) => (
              <li key={title} style={{ '--i': i }}>
                <span className={`cd-ico small ${tone}`}><Svg d={ICON[tone]} size={13} /></span>
                <span className="cd-row-text"><b>{title}</b><small>{detail}</small></span>
              </li>
            ))}
          </ul>
          <details className="cd-more">
            <summary>Technical details</summary>
            {p?.headerButtons?.length > 0 && (
              <div className="cd-sec">
                <span>Buttons in the chat header</span>
                <div className="cd-chips">{p.headerButtons.map((l) => <code key={l}>{l}</code>)}</div>
              </div>
            )}
            {p?.patterns && (
              <div className="cd-sec">
                <span>Detection patterns</span>
                <dl className="cd-kv">
                  {[['Answer', 'accept'], ['Decline', 'decline'], ['Hang up', 'hangup'], ['Voice', 'voice'], ['Video', 'video'], ['Menu', 'menu']].map(([k, id]) => (
                    <div key={id}><dt>{k}</dt><dd><code>{p.patterns[id]}</code></dd></div>
                  ))}
                </dl>
              </div>
            )}
            <div className="cd-sec">
              <span>Versions</span>
              <dl className="cd-kv">
                <div><dt>WhatsApp Web</dt><dd>{p?.waVersion || 'unknown'}</dd></div>
                <div><dt>Relay</dt><dd>{diag.app}</dd></div>
                <div><dt>Chrome</dt><dd>{diag.chrome}</dd></div>
                <div><dt>Electron</dt><dd>{diag.electron}</dd></div>
                <div><dt>Open windows</dt><dd>{diag.pages}</dd></div>
              </dl>
            </div>
          </details>
        </div>
      )}
    </section>
  );
}
