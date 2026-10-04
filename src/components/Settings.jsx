import { useEffect, useState } from 'react';
import Avatar from './Avatar.jsx';
import Logo from './Logo.jsx';
import Accounts from './Accounts.jsx';
import { encryptionStatus, recoverWithKey, mediaUrl } from '../matrix.js';
import { usePrefs, setPref, ACCENTS } from '../prefs.js';
import { local, cleanError } from '../local.js';
import { NOTIFICATION_SOUNDS, notificationSound, uiSound } from '../sounds.js';
import { player } from '../player.js';
import VolumeSlider from './VolumeSlider.jsx';
import { useUpdate } from '../update.js';
import { notice } from '../dialogs.jsx';
import AutomationsSettings from './AutomationsSettings.jsx';
import PresetPicker from './PresetPicker.jsx';
import { DefaultWallpaperPicker } from './Wallpaper.jsx';
import { RemindersPane } from './Reminders.jsx';
import { QuickRepliesPane } from './QuickReplies.jsx';
import { ScheduledPane } from './Scheduled.jsx';
import PrivacySettings from './PrivacySettings.jsx';
import HealthPanel from './HealthPanel.jsx';
import BackupPanel from './BackupPanel.jsx';
import ImportSettings from './ImportSettings.jsx';

export const SECTIONS = [
  { id: 'general', label: 'General', icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 2a7 7 0 1 1 0 14 7 7 0 0 1 0-14Zm-1 3v5.4l4.3 2.6 1-1.7-3.3-2V8h-2Z' },
  { id: 'accounts', label: 'Accounts', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4 0-7 2-7 4.5V20h14v-1.5C19 16 16 14 12 14Z', localOnly: true },
  { id: 'notifications', label: 'Notifications', icon: 'M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3a1.5 1.5 0 0 0-3 0v1.16A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z' },
  { id: 'appearance', label: 'Appearance', icon: 'M12 3a9 9 0 0 0 0 18c.8 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1-.3-.3-.4-.6-.4-1 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.4-4-8-9-8Zm-5.5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z' },
  { id: 'automations', label: 'Automations', icon: 'M7 2v11h3v9l7-12h-4l4-8H7Z' },
  { id: 'quickreplies', label: 'Quick replies', icon: 'M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Zm-2 12H6v-2h12v2Zm0-3H6V9h12v2Zm0-3H6V6h12v2Z' },
  { id: 'scheduled', label: 'Scheduled', icon: 'M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6v-2H5V9h14v2h2V6a2 2 0 0 0-2-2Zm-1.5 9a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Zm1.6 6.4-2.1-1.3V15h1v2.5l1.6 1-.5.9Z' },
  { id: 'reminders', label: 'Reminders', icon: 'M15 1H9v2h6V1Zm-4 13h2V8h-2v6Zm8.03-6.61 1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42A8.96 8.96 0 0 0 12 4a9 9 0 1 0 9 9c0-2.12-.74-4.07-1.97-5.61ZM12 20a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z' },
  { id: 'privacy', label: 'Privacy & security', icon: 'M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Zm0 10h6c-.5 4-3 7.4-6 8.4V12H6V6.3l6-2.2V12Z' },
  { id: 'health', label: 'Health', localOnly: true, icon: 'M12 21.4 10.6 20C5.4 15.4 2 12.3 2 8.5 2 5.4 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1A6 6 0 0 1 16.5 3C19.6 3 22 5.4 22 8.5c0 3.8-3.4 6.9-8.6 11.5L12 21.4ZM8 12h2.2l1.3-2.6 2 5 1.5-2.4H17v-2h-3.1l-.6 1-2-5L9 10H8v2Z' },
  { id: 'backup', label: 'Backup', icon: 'M19.4 10A7.5 7.5 0 0 0 12 4a7.5 7.5 0 0 0-6.7 4A6 6 0 0 0 6 20h13a5 5 0 0 0 .4-10ZM14 13v4h-4v-4H7l5-5 5 5h-3Z' },
  { id: 'imports', label: 'Import history', icon: 'M5 20h14v-2H5v2Zm7-18-5.5 5.5 1.41 1.41L11 5.83V16h2V5.83l3.09 3.08 1.41-1.41L12 2Z', needsImports: true },
  { id: 'advanced', label: 'Advanced', icon: 'M8.6 15.4 5.2 12l3.4-3.4L7.2 7.2 2.4 12l4.8 4.8 1.4-1.4Zm6.8 0L18.8 12l-3.4-3.4 1.4-1.4 4.8 4.8-4.8 4.8-1.4-1.4Z' },
  { id: 'about', label: 'About', icon: 'M11 7h2v2h-2V7Zm0 4h2v6h-2v-6Zm1-9a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z' },
];

function Icon({ d }) {
  return <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d={d} /></svg>;
}

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

function Volume({ label, value, onChange, onPreview, disabled }) {
  return (
    <label className={`setting volume-setting ${disabled ? 'disabled' : ''}`}>
      <span className="setting-label">{label}</span>
      <VolumeSlider value={value} disabled={disabled} onChange={onChange} onCommit={onPreview} />
    </label>
  );
}

function Choice({ label, hint, value, options, onChange }) {
  return (
    <div className="setting">
      <span className="setting-text">
        <span className="setting-label">{label}</span>
        {hint && <span className="setting-hint">{hint}</span>}
      </span>
      <div className="seg">
        {options.map(([v, text]) => (
          <button key={v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{text}</button>
        ))}
      </div>
    </div>
  );
}

function Group({ title, children }) {
  return (
    <section className="group">
      {title && <h3>{title}</h3>}
      <div className="group-body">{children}</div>
    </section>
  );
}

// ---------- Panes ----------

function General({ client, isLocal }) {
  const p = usePrefs();
  const me = client.getUser(client.getUserId());
  const [name, setName] = useState(me?.displayName && me.displayName !== 'me' ? me.displayName : '');
  const [openAtLogin, setOpenAtLogin] = useState(false);
  useEffect(() => { window.relay.getOpenAtLogin?.().then(setOpenAtLogin); }, []);

  return (
    <>
      <h2 className="pane-title">General</h2>
      <Group title="Profile">
        <div className="setting profile-row">
          <Avatar src={me?.avatarUrl ? mediaUrl(client, me.avatarUrl, 120) : null} name={name || 'You'} id={client.getUserId()} size={52} />
          <div className="profile-fields">
            <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && client.setDisplayName(name.trim())} placeholder="Your name" />
            <span className="setting-hint">{isLocal ? 'Shown inside Relay. Your name on the networks doesn’t change.' : client.getUserId()}</span>
          </div>
        </div>
      </Group>
      <Group title="Chats">
        <Toggle label="Send with Enter" hint={p.enterToSend ? 'Shift+Enter adds a new line.' : 'Use ⌘+Enter to send.'} checked={p.enterToSend} onChange={(v) => setPref('enterToSend', v)} />
        <Toggle label="Show message previews in the chat list" checked={p.showPreviews} onChange={(v) => setPref('showPreviews', v)} />
        <Toggle label="Important on top" hint="Unread one-to-one chats and messages that mention you get their own group at the top of the list."
          checked={p.importantSection !== false} onChange={(v) => setPref('importantSection', v)} />
        <Toggle label="Groups in their own tab" hint="“Main” keeps one-to-one chats and the groups you flag ⭐ (right-click a group); “Groups” has every group, archived or not."
          checked={p.splitGroups} onChange={(v) => setPref('splitGroups', v)} />
        <Toggle label="Quiet groups" hint="Groups not flagged ⭐ only notify you when they mention you." disabled={!p.splitGroups}
          checked={p.quietGroups} onChange={(v) => setPref('quietGroups', v)} />
        <Toggle label="Link previews" hint="A card with the page’s title, description and picture under messages with a link. Your local server fetches the page; it never reaches your local network."
          checked={p.linkPreviews !== false} onChange={(v) => setPref('linkPreviews', v)} />
        <Toggle label="Smart cards" hint="Pix, verification codes, parcel tracking, dates and addresses get a card with a one-tap action."
          checked={p.smartCards !== false} onChange={(v) => setPref('smartCards', v)} />
        <Toggle label="Move archived chats back to the inbox on new messages" hint="Muted chats always stay archived." checked={p.autoUnarchive} onChange={(v) => setPref('autoUnarchive', v)} />
      </Group>
      {isLocal && (
        <Group title="This Mac">
          <Toggle label="Open Relay when I log in" hint="Keeps your accounts connected. Messages only arrive while Relay is running." checked={openAtLogin}
            onChange={(v) => { setOpenAtLogin(v); window.relay.setOpenAtLogin(v); }} />
        </Group>
      )}
    </>
  );
}

/** Warns when macOS is blocking Relay's notifications (they're off in System Settings). */
function NotificationCheck() {
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    let t;
    const check = () => window.relay.notificationsBlocked?.().then(setBlocked);
    check();
    // Back from System Settings: try again (a test notification confirms it's fixed).
    const onFocus = () => window.relay.notificationsBlocked?.().then((b) => {
      if (!b) return;
      window.relay.testNotification?.();
      t = setTimeout(check, 1500);
    });
    window.addEventListener('focus', onFocus);
    return () => { clearTimeout(t); window.removeEventListener('focus', onFocus); };
  }, []);
  if (!blocked) return null;
  return (
    <div className="notif-blocked">
      <span>macOS is blocking Relay’s notifications. Turn on <b>Allow notifications</b> for Relay in System Settings.</span>
      <button className="primary" onClick={() => window.relay.openNotificationSettings?.()}>Open System Settings</button>
    </div>
  );
}

function Notifications() {
  const p = usePrefs();
  return (
    <>
      <h2 className="pane-title">Notifications</h2>
      <NotificationCheck />
      <Group>
        <Toggle label="Show notifications" hint="macOS may also need permission in System Settings → Notifications → Relay." checked={p.notifications} onChange={(v) => setPref('notifications', v)} />
        <Toggle label="Show message text" hint="Turn off to only show who wrote." checked={p.notifPreview} disabled={!p.notifications} onChange={(v) => setPref('notifPreview', v)} />
        <Toggle label="Play sound" checked={p.notifSound} disabled={!p.notifications} onChange={(v) => setPref('notifSound', v)} />
        <Volume label="Notification volume" value={p.notifVolume} disabled={!p.notifications || !p.notifSound}
          onChange={(v) => setPref('notifVolume', v)} onPreview={() => notificationSound()} />
      </Group>
      <Group title="Notification sound">
        <div className="sound-grid">
          {NOTIFICATION_SOUNDS.map(([id, name]) => (
            <button key={id} className={`sound-opt ${p.notifSoundName === id ? 'on' : ''}`} disabled={!p.notifSound}
              onClick={() => { setPref('notifSoundName', id); notificationSound(id); }}>
              <span className="sound-ico">{id === 'none' ? '🔕' : '♪'}</span>{name}
            </button>
          ))}
        </div>
      </Group>
      <Group title="Interface sounds">
        <Toggle label="Play sounds when sending, receiving and reacting" hint="Soft sounds while you use Relay."
          checked={p.interfaceSounds} onChange={(v) => { setPref('interfaceSounds', v); if (v) setTimeout(() => uiSound('send'), 50); }} />
        <Volume label="Interface volume" value={p.interfaceVolume} disabled={!p.interfaceSounds}
          onChange={(v) => setPref('interfaceVolume', v)} onPreview={() => uiSound('send')} />
      </Group>
      <Group title="Voice messages">
        <Volume label="Playback volume" value={p.voiceVolume} onChange={(v) => player.setVolume(v)} />
      </Group>
      <Group title="Groups">
        <Choice label="Notify me for group messages" value={p.notifGroups} onChange={(v) => setPref('notifGroups', v)}
          options={[['all', 'All messages'], ['mentions', 'Mentions only']]} />
      </Group>
      <Group title="Dock">
        <Choice label="Badge on the Relay icon" value={p.badge} onChange={(v) => setPref('badge', v)}
          options={[['messages', 'Unread messages'], ['chats', 'Unread chats'], ['off', 'Off']]} />
      </Group>
    </>
  );
}

function Appearance() {
  const p = usePrefs();
  return (
    <>
      <h2 className="pane-title">Appearance</h2>
      <Group title="Style">
        <PresetPicker />
      </Group>
      <Group title="Theme">
        <div className={`themes ${p.preset === 'oled' || p.preset === 'paper' ? 'locked' : ''}`}>
          {[['system', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']].map(([v, label]) => (
            <button key={v} className={`theme-card ${p.theme === v ? 'on' : ''}`} onClick={() => setPref('theme', v)}>
              <span className={`theme-preview ${v}`}><i /><i /><i /></span>
              {label}
            </button>
          ))}
        </div>
        {(p.preset === 'oled' || p.preset === 'paper') && <p className="theme-lock-note">The {p.preset === 'oled' ? 'OLED' : 'Paper'} style is always {p.preset === 'oled' ? 'dark' : 'light'}.</p>}
      </Group>
      <Group title="Accent color">
        <div className="swatches">
          {Object.entries(ACCENTS).map(([k, a]) => (
            <button key={k} className={`swatch ${p.accent === k ? 'on' : ''}`} style={{ '--a': a.a, '--b': a.b }} title={a.name} onClick={() => setPref('accent', k)} />
          ))}
        </div>
      </Group>
      <Group title="Layout">
        <Choice label="Chat list density" value={p.density} onChange={(v) => setPref('density', v)} options={[['comfortable', 'Comfortable'], ['compact', 'Compact']]} />
        <Choice label="Text size" value={p.textSize} onChange={(v) => setPref('textSize', v)} options={[['sm', 'Small'], ['md', 'Default'], ['lg', 'Large']]} />
      </Group>
      <Group title="Chat wallpaper">
        <p className="pane-text muted">Applies to every chat. To change just one, open that chat’s details.</p>
        <DefaultWallpaperPicker />
      </Group>
      <Group title="Details">
        <Toggle label="Animations" hint="Reactions, new messages and switching chats move smoothly. If your system asks for reduced motion, they stay off."
          checked={p.motion !== false} onChange={(v) => setPref('motion', v)} />
      </Group>
    </>
  );
}

function Privacy({ client, isLocal }) {
  const p = usePrefs();
  const [enc, setEnc] = useState(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const refresh = () => encryptionStatus(client).then(setEnc).catch(() => setEnc({ available: false }));
  useEffect(() => { if (!isLocal) refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const recover = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await recoverWithKey(client, key);
      setMsg({ ok: true, text: `Done. This device is verified and ${res?.imported ?? 0} message keys were restored.` });
      setKey('');
      refresh();
    } catch (err) {
      setMsg({ ok: false, text: err.message || String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="pane-title">Privacy &amp; security</h2>
      <Group title="Read receipts">
        <Toggle label="Send read receipts" hint={p.readReceipts
          ? 'People can see when you’ve read their messages (blue ticks on WhatsApp).'
          : 'Chats are marked read in Relay only. Contacts won’t see that you read them.'}
          checked={p.readReceipts} onChange={(v) => setPref('readReceipts', v)} />
      </Group>
      <PrivacySettings />
      {isLocal ? (
        <Group title="Where your data lives">
          <p className="pane-text">
            Your messages, contacts and logins are stored only on this Mac, in Relay’s private chat server. The server only
            accepts connections from this computer, and nothing passes through Relay’s, Beeper’s or anyone else’s servers.
            Each network sees a normal linked device.
          </p>
        </Group>
      ) : (
        <Group title="Encryption">
          {!enc ? <p className="pane-text muted">Checking…</p> : !enc.available ? (
            <p className="pane-text muted">End-to-end encryption failed to start, so encrypted chats can’t be read.</p>
          ) : enc.verified ? (
            <p className="pane-text ok-text">✓ This device is verified. New encrypted messages will decrypt normally.</p>
          ) : (
            <>
              <p className="pane-text muted">Enter your recovery key from Element or Beeper to verify this device and unlock older encrypted messages.</p>
              <form onSubmit={recover} className="row">
                <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="EsT0 abcd efgh …" required />
                <button className="primary" disabled={busy}>{busy ? 'Restoring…' : 'Verify'}</button>
              </form>
            </>
          )}
          {msg && <div className={msg.ok ? 'ok-text' : 'error'}>{msg.text}</div>}
        </Group>
      )}
    </>
  );
}

function Advanced({ isLocal, onSignOut }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(null);
  useEffect(() => { if (isLocal) local().status().then(setStatus).catch(() => {}); }, [isLocal]);

  const restart = async (name) => {
    setBusy(name);
    try { await local().restartBridge(name); } catch (err) { notice(cleanError(err)); }
    setBusy(null);
    local().status().then(setStatus).catch(() => {});
  };

  return (
    <>
      <h2 className="pane-title">Advanced</h2>
      {isLocal && status && (
        <Group title="Local server">
          <div className="setting">
            <span className="setting-text"><span className="setting-label">Chat server</span><span className="setting-hint">Synapse · {status.synapse}</span></span>
            <span className={`dot ${status.synapse === 'running' ? 'ok' : 'warn'}`} />
          </div>
          {Object.entries(status.bridges).map(([id, b]) => (
            <div key={id} className="setting">
              <span className="setting-text"><span className="setting-label">{b.name} bridge</span><span className="setting-hint">{b.status}</span></span>
              <button className="ghost small" disabled={busy === id || b.status === 'needs-setup'} onClick={() => restart(id)}>{busy === id ? 'Restarting…' : 'Restart'}</button>
            </div>
          ))}
          {status.bridges.whatsapp?.logins.length > 0 && (
            <div className="setting">
              <span className="setting-text"><span className="setting-label">Refresh WhatsApp contact names and photos</span><span className="setting-hint">Re-reads names from your phone’s contacts. Takes a few minutes in the background.</span></span>
              <button className="ghost small" disabled={busy === 'contacts'} onClick={async () => {
                setBusy('contacts');
                try { await local().bridgeCommand('whatsapp', 'sync contacts-with-avatars'); } catch (err) { notice(cleanError(err)); }
                setTimeout(() => setBusy(null), 3000);
              }}>{busy === 'contacts' ? 'Started ✓' : 'Refresh'}</button>
            </div>
          )}
          <div className="setting">
            <span className="setting-text"><span className="setting-label">Logs</span><span className="setting-hint">Useful when something isn’t syncing.</span></span>
            <button className="ghost small" onClick={() => local().openLogs()}>Show in Finder</button>
          </div>
        </Group>
      )}
      <Group title="Keyboard shortcuts">
        <dl className="shortcuts">
          <dt><kbd>⌘</kbd><kbd>K</kbd></dt><dd>Jump to chat</dd>
          <dt><kbd>⌘</kbd><kbd>F</kbd></dt><dd>Search chats</dd>
          <dt><kbd>⌥</kbd><kbd>↑</kbd>/<kbd>↓</kbd></dt><dd>Previous / next chat</dd>
          <dt><kbd>⌘</kbd><kbd>1</kbd>–<kbd>9</kbd></dt><dd>All chats / each account</dd>
          <dt><kbd>⌘</kbd><kbd>,</kbd></dt><dd>Settings</dd>
          <dt><kbd>↑</kbd></dt><dd>Edit your last message</dd>
          <dt><kbd>Esc</kbd></dt><dd>Cancel reply or edit</dd>
        </dl>
      </Group>
      <Group title="Session">
        <div className="setting">
          <span className="setting-text">
            <span className="setting-label">Sign out of Relay</span>
            <span className="setting-hint">{isLocal ? 'Your accounts stay connected on this Mac. Remove them in Accounts first to disconnect them.' : 'Signs this device out of your Matrix account.'}</span>
          </span>
          <button className="danger" onClick={onSignOut}>Sign out</button>
        </div>
      </Group>
    </>
  );
}

function UpdateStatus() {
  const u = useUpdate();
  if (!u.supported) return null;
  const line = {
    checking: 'Checking for updates…',
    downloading: `Downloading Relay ${u.version}… ${Math.round((u.progress || 0) * 100)}%`,
    ready: `Relay ${u.version} is ready to install.`,
    uptodate: 'Relay is up to date.',
    error: u.error,
    unsupported: u.error,
  }[u.status] || 'Relay checks for updates automatically.';
  return (
    <div className="update-status">
      <p className={`small ${u.status === 'error' ? 'error-text' : 'muted'}`}>{line}</p>
      {u.status === 'ready'
        ? <button className="primary" onClick={() => u.install()}>Restart to update</button>
        : u.status !== 'unsupported' && (
          <button disabled={u.status === 'checking' || u.status === 'downloading'} onClick={() => u.check()}>Check for updates</button>
        )}
    </div>
  );
}

function About() {
  const [version, setVersion] = useState('');
  useEffect(() => { window.relay.version?.().then(setVersion); }, []);
  return (
    <div className="about">
      <Logo size={88} />
      <h2>Relay</h2>
      <p className="muted">Version {version}</p>
      <UpdateStatus />
      <p className="pane-text muted">
        All your chats in one inbox. Built on the open Matrix protocol, with Synapse and the mautrix bridges
        running on your Mac.
      </p>
      <p className="pane-text muted small">
        <a href="https://github.com/alenkpedro/relay" target="_blank" rel="noreferrer">Source code on GitHub</a>
      </p>
    </div>
  );
}

// ---------- Dialog ----------

export default function Settings({ client, isLocal, section = 'general', onSection, onClose, onSignOut }) {
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const sections = SECTIONS.filter((s) => (!s.localOnly || isLocal) && (!s.needsImports || !!window.relay.imports));
  const current = sections.some((s) => s.id === section) ? section : 'general';

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="settings" onMouseDown={(e) => e.stopPropagation()}>
        <aside className="settings-nav">
          <div className="settings-brand"><Logo size={26} /><span>Settings</span></div>
          {sections.map((s) => (
            <button key={s.id} className={current === s.id ? 'on' : ''} onClick={() => onSection(s.id)}>
              <Icon d={s.icon} />{s.label}
            </button>
          ))}
        </aside>
        <div className="settings-pane">
          <button className="close-btn" onClick={onClose} title="Close (Esc)">✕</button>
          {current === 'general' && <General client={client} isLocal={isLocal} />}
          {current === 'accounts' && <Accounts embedded onClose={onClose} />}
          {current === 'notifications' && <Notifications />}
          {current === 'appearance' && <Appearance />}
          {current === 'automations' && <AutomationsSettings client={client} />}
          {current === 'quickreplies' && <QuickRepliesPane client={client} />}
          {current === 'scheduled' && <ScheduledPane />}
          {current === 'reminders' && <RemindersPane />}
          {current === 'privacy' && <Privacy client={client} isLocal={isLocal} />}
          {current === 'health' && <HealthPanel />}
          {current === 'backup' && <BackupPanel isLocal={isLocal} />}
          {current === 'imports' && <ImportSettings client={client} />}
          {current === 'advanced' && <Advanced isLocal={isLocal} onSignOut={onSignOut} />}
          {current === 'about' && <About />}
        </div>
      </div>
    </div>
  );
}
