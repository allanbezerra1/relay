import { useEffect, useState, useCallback } from 'react';
import { ClientEvent, HttpApiEvent, SyncState } from 'matrix-js-sdk';
import { startClient, signOut } from './matrix.js';
import Login from './components/Login.jsx';
import Inbox from './components/Inbox.jsx';
import Logo from './components/Logo.jsx';
import Onboarding from './components/Onboarding.jsx';
import { local, cleanError } from './local.js';

export default function App() {
  const [phase, setPhase] = useState('loading'); // loading | login | syncing | ready
  const [client, setClient] = useState(null);
  const [error, setError] = useState(null);
  const [isLocal, setIsLocal] = useState(false);

  const boot = useCallback(async (session) => {
    setError(null);
    setIsLocal(!!session.local);
    try {
      if (session.local) {
        setPhase('starting-local');
        await local().start();
      }
      setPhase('syncing');
      const c = await startClient(session);
      c.on(HttpApiEvent.SessionLoggedOut, async () => {
        c.stopClient();
        await window.relay.clearSession();
        setClient(null);
        setError('Your session expired. Please sign in again.');
        setPhase('login');
      });
      const onSync = (state) => {
        if (state === SyncState.Prepared || state === SyncState.Syncing) {
          setPhase('ready');
          c.off(ClientEvent.Sync, onSync);
        }
      };
      c.on(ClientEvent.Sync, onSync);
      // With a warm IndexedDB cache the first sync may already be done.
      if (c.isInitialSyncComplete()) setPhase('ready');
      window.__relayClient = c; // handy for debugging from DevTools
      setClient(c);
    } catch (err) {
      console.error(err);
      setError(cleanError(err));
      setPhase(session.local ? 'local-error' : 'login');
    }
  }, []);

  useEffect(() => {
    window.relay.getSession().then((s) => (s ? boot(s) : setPhase('login')));
  }, [boot]);

  const handleLogin = async (session) => {
    await window.relay.setSession(session);
    await boot(session);
  };

  const handleSignOut = async () => {
    if (client) await signOut(client);
    await window.relay.clearSession();
    window.relay.setBadge(0);
    setClient(null);
    setPhase('login');
  };

  if (phase === 'local-error') {
    return (
      <div className="splash">
        <div className="drag-region" />
        <Logo size={76} className="logo-pulse" />
        <p>Your local chat server didn’t start.</p>
        <div className="error" style={{ maxWidth: 460 }}>{error}</div>
        <div className="row">
          <button className="ghost" onClick={() => local().openLogs()}>Show logs</button>
          <button className="primary" onClick={() => window.relay.getSession().then(boot)}>Try again</button>
        </div>
      </div>
    );
  }
  if (phase === 'login') return <Onboarding onLogin={handleLogin} initialError={error} />;
  if (phase !== 'ready' || !client) {
    return (
      <div className="splash">
        <div className="drag-region" />
        <Logo size={76} className="logo-pulse" />
        <div className="spinner" />
        <p>{phase === 'starting-local' ? 'Starting your chat server…' : phase === 'syncing' ? 'Syncing your chats…' : 'Starting…'}</p>
      </div>
    );
  }
  return <Inbox client={client} isLocal={isLocal} onSignOut={handleSignOut} />;
}
