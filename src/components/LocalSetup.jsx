import { useEffect, useRef, useState } from 'react';
import { local, cleanError } from '../local.js';
import { loginWithPassword } from '../matrix.js';

const STEPS = [
  { id: 'synapse', label: 'Install the Matrix server' },
  { id: 'whatsapp', label: 'Download the WhatsApp bridge' },
  { id: 'telegram', label: 'Download the Telegram bridge' },
  { id: 'discord', label: 'Download the Discord bridge' },
  { id: 'config', label: 'Configure everything' },
  { id: 'start', label: 'Start your server' },
];

export default function LocalSetup({ onDone, onBack }) {
  const [current, setCurrent] = useState(null);
  const [message, setMessage] = useState('Preparing…');
  const [error, setError] = useState(null);
  const started = useRef(false);

  const runInstall = async () => {
    setError(null);
    try {
      const creds = await local().install();
      setCurrent('done');
      setMessage('Signing in…');
      const session = await loginWithPassword({ homeserver: creds.homeserver, user: creds.user, password: creds.password });
      await onDone({ ...session, local: true });
    } catch (err) {
      setError(cleanError(err));
    }
  };

  useEffect(() => {
    const off = local().on('progress', ({ step, message }) => { setCurrent(step); setMessage(message); });
    if (!started.current) { started.current = true; runInstall(); }
    return off;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const idx = STEPS.findIndex((s) => s.id === current);
  const doneIdx = current === 'done' ? STEPS.length : idx;

  return (
    <div className="setup">
      <h2>Setting up Relay on this Mac</h2>
      <p className="muted small">
        Relay is installing its own private chat server and the WhatsApp, Telegram and Discord bridges.
        Everything stays on this Mac, in Relay’s app data folder. This only happens once.
      </p>
      <ol className="steps">
        {STEPS.map((s, i) => (
          <li key={s.id} className={i < doneIdx ? 'done' : i === doneIdx && !error ? 'active' : i === doneIdx && error ? 'failed' : ''}>
            <span className="step-dot">{i < doneIdx ? '✓' : i === doneIdx && error ? '!' : i + 1}</span>
            <span>{s.label}</span>
            {i === doneIdx && !error && <span className="spinner small" />}
          </li>
        ))}
      </ol>
      {!error && <div className="setup-msg muted small">{message}</div>}
      {error && (
        <>
          <div className="error setup-error">{error}</div>
          <div className="row">
            <button type="button" className="ghost" onClick={onBack}>Back</button>
            <button type="button" className="primary" onClick={runInstall}>Try again</button>
          </div>
        </>
      )}
    </div>
  );
}
