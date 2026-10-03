import { useEffect, useRef, useState } from 'react';
import { local, cleanError } from '../local.js';
import { loginWithPassword } from '../matrix.js';
import Logo from './Logo.jsx';
import NetIcon from './NetIcon.jsx';

/**
 * Sets Relay up on this Mac as soon as it's called (installing the server and bridges, or just
 * starting them if they're already there) and signs in. Returns the progress and, once done,
 * the session.
 */
export function useLocalSetup() {
  const [state, setState] = useState({ current: null, message: 'Preparing…', error: null, session: null });
  const started = useRef(false);

  const run = async () => {
    setState((s) => ({ ...s, error: null }));
    try {
      const st = await local().status().catch(() => null);
      let creds;
      if (st?.installed) {
        setState((s) => ({ ...s, current: 'start', message: 'Starting your chat server…' }));
        await local().start();
        creds = await local().credentials();
      } else {
        creds = await local().install();
      }
      setState((s) => ({ ...s, current: 'done', message: 'Signing in…' }));
      const session = await loginWithPassword({ homeserver: creds.homeserver, user: creds.user, password: creds.password });
      setState((s) => ({ ...s, session: { ...session, local: true } }));
    } catch (err) {
      setState((s) => ({ ...s, error: cleanError(err) }));
    }
  };

  useEffect(() => {
    const off = local().on('progress', ({ step, message }) => setState((s) => ({ ...s, current: step, message })));
    if (!started.current) { started.current = true; run(); }
    return off;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { ...state, retry: run };
}

const PHASES = {
  synapse: ['Installing your private chat server…', 0.15],
  whatsapp: ['Downloading the bridges…', 0.45],
  telegram: ['Downloading the bridges…', 0.55],
  discord: ['Downloading the bridges…', 0.65],
  config: ['Configuring everything…', 0.8],
  start: ['Starting up…', 0.92],
  done: ['Ready!', 1],
};
const ORBIT = ['whatsapp', 'telegram', 'signal', 'discord', 'instagram', 'messenger'];

/** Setup progress as a calm animation: the logo, the networks circling it and one status line. */
export default function LocalSetup({ setup }) {
  const { current, error, retry } = setup;
  const [text, progress] = PHASES[current] || ['Getting things ready…', 0.05];

  if (error) {
    return (
      <div className="setup-anim">
        <Logo size={84} />
        <h2>Setup didn’t finish</h2>
        <div className="error setup-error">{error}</div>
        <div className="row">
          <button type="button" className="ghost" onClick={() => local().openLogs?.()}>Show logs</button>
          <button type="button" className="primary" onClick={retry}>Try again</button>
        </div>
      </div>
    );
  }
  return (
    <div className="setup-anim">
      <div className="sa-stage">
        <div className="sa-orbit">
          {ORBIT.map((n, i) => (
            <span key={n} style={{ '--i': i, '--n': ORBIT.length }}><NetIcon id={n} variant="tile" size={30} /></span>
          ))}
        </div>
        <div className="sa-logo"><Logo size={92} /></div>
      </div>
      <h2 key={text} className="sa-text">{text}</h2>
      <p className="muted small">Relay is setting up its own private chat server on this Mac. This only happens once.</p>
      <div className="sa-bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
    </div>
  );
}
