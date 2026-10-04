import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import './styles/dialogs.css';
import './styles/organize.css';
import './styles/automations.css';
import { DialogHost } from './dialogs.jsx';
import { applyAppearance } from './prefs.js';
import { loadSoundPack } from './sounds.js';

// Outside Electron (e.g. `npx vite` in a browser) fall back to web APIs.
// Note: media on servers that require authenticated media won't load there.
if (!window.relay) {
  const KEY = 'relay.session';
  window.relay = {
    platform: 'web',
    getSession: async () => JSON.parse(localStorage.getItem(KEY) || 'null'),
    setSession: async (s) => localStorage.setItem(KEY, JSON.stringify(s)),
    clearSession: async () => localStorage.removeItem(KEY),
    isFocused: async () => document.hasFocus(),
    notify: ({ title, body }) => Notification.permission === 'granted' && new Notification(title, { body }),
    setBadge: (n) => { document.title = n ? `(${n}) Relay` : 'Relay'; },
    onFocusChange: () => () => {},
    onNotificationClick: () => () => {},
  };
}

document.documentElement.dataset.platform = window.relay.platform;
applyAppearance();
loadSoundPack();
createRoot(document.getElementById('root')).render(<><App /><DialogHost /></>);
