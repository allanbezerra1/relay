// Renderer side of the app lock (electron/applock.cjs).
import { useEffect, useState } from 'react';

export const lockApi = () => window.relay?.lock;

export const cleanIpcError = (err) => String(err?.message || err).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '');

/** "⌘L" on macOS, "Ctrl+L" elsewhere. */
export const combo = (key) => (window.relay?.platform === 'darwin' ? `⌘${key}` : `Ctrl+${key}`);

/** Live app-lock state from the main process. */
export function useLockState() {
  const [s, setS] = useState(null);
  useEffect(() => {
    const api = lockApi();
    if (!api) { setS({ enabled: false, locked: false }); return undefined; }
    let alive = true;
    api.state().then((v) => alive && setS(v));
    const off = api.onState(setS);
    return () => { alive = false; off(); };
  }, []);
  return s;
}
