// Update state from electron/updater.cjs, shared by Settings → About and the sidebar banner.
import { useEffect, useState } from 'react';

export function useUpdate() {
  const api = window.relay?.update;
  const [state, setState] = useState({ status: 'idle' });
  useEffect(() => {
    if (!api) return undefined;
    api.state().then(setState);
    return api.onState(setState);
  }, [api]);
  return {
    ...state,
    supported: !!api,
    check: () => api?.check(),
    install: () => api?.install(),
  };
}
