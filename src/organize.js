// Smart folders ("Pastas"), snooze ("Lembrar depois") and the "Importantes" group.
// Folders and snoozes live in your Matrix account data, so every Aurora you sign in to sees them.

export const FOLDERS_TYPE = 'dev.relay.folders';
export const SNOOZED_TYPE = 'dev.relay.snoozed';

// ---------- Folders ----------
//
// { id, name, icon, rules: { networks, accounts, type, labels, unread, muted, noReplyDays }, include, exclude }
// Rules combine with AND. Chats added by hand (include) always show; removed ones (exclude) never do.
// A folder with no rules at all only shows the chats added by hand.

export const EMPTY_RULES = { networks: [], accounts: [], type: null, labels: [], unread: false, muted: 'include', noReplyDays: 0 };

export const FOLDER_ICONS = ['💼', '👪', '👥', '💬', '⭐', '🔥', '📌', '🏠', '❤️', '🎓', '💰', '🛒', '⚽', '🎮', '✈️', '🧪', '📚', '🔔', '🌙', '🚀'];

export const PRESETS = [
  { key: 'work', name: 'Work', icon: '💼', rules: { labels: ['@Work'] }, hint: 'The “Work” label' },
  { key: 'people', name: 'People', icon: '👪', rules: { type: 'dm' }, hint: 'One-to-one chats only' },
  { key: 'groups', name: 'Groups', icon: '👥', rules: { type: 'group' }, hint: 'Groups and channels' },
  { key: 'unread', name: 'Unread', icon: '🔔', rules: { unread: true, muted: 'exclude' }, hint: 'Unread, without the muted ones' },
];

export const newFolderId = () => `f${Math.random().toString(36).slice(2, 9)}`;

export function getFolders(client) {
  const list = client.getAccountData(FOLDERS_TYPE)?.getContent()?.folders;
  return Array.isArray(list) ? list.map(normalizeFolder) : [];
}

export const saveFolders = (client, folders) => client.setAccountData(FOLDERS_TYPE, { folders });

export function normalizeFolder(f) {
  return { id: f.id, name: f.name || 'Folder', icon: f.icon || '📁', rules: { ...EMPTY_RULES, ...(f.rules || {}) }, include: f.include || [], exclude: f.exclude || [] };
}

export function hasRules(rules) {
  const r = { ...EMPTY_RULES, ...rules };
  return !!(r.networks.length || r.accounts.length || r.type || r.labels.length || r.unread || r.muted !== 'include' || r.noReplyDays > 0);
}

const DAY = 86400000;

/** Does a chat (an entry from Inbox's collectRooms) belong in the folder? */
export function inFolder(f, r, me, now = Date.now()) {
  if (f.exclude.includes(r.id)) return false;
  if (f.include.includes(r.id)) return true;
  const x = f.rules;
  if (!hasRules(x)) return false;
  if (x.networks.length && !x.networks.includes(r.baseNetwork || r.network) && !x.networks.includes(r.network)) return false;
  if (x.accounts.length && !x.accounts.includes(r.account?.key)) return false;
  if (x.type === 'dm' && r.group) return false;
  if (x.type === 'group' && !r.group) return false;
  if (x.labels.length && !r.labels.some((l) => x.labels.includes(l.id))) return false;
  if (x.unread && !(r.unread || r.markedUnread)) return false;
  if (x.muted === 'exclude' && r.muted) return false;
  if (x.muted === 'only' && !r.muted) return false;
  if (x.noReplyDays > 0) {
    // Waiting on me: the last message is someone else's and it's been sitting there for X days.
    if (!r.last || r.last.getSender() === me || now - r.ts < x.noReplyDays * DAY) return false;
  }
  return true;
}

// ---------- Snooze ----------
// { roomId: wakeTs }. The renderer wakes them (Relay keeps running in the menu bar).

export function getSnoozed(client) {
  const c = client.getAccountData(SNOOZED_TYPE)?.getContent() || {};
  return Object.fromEntries(Object.entries(c).filter(([, ts]) => typeof ts === 'number'));
}

export const saveSnoozed = (client, map) => client.setAccountData(SNOOZED_TYPE, map);

const at = (d, h, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x.getTime(); };

/** The quick choices, computed for "now". */
export function snoozeOptions(now = new Date()) {
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const monday = new Date(now); monday.setDate(now.getDate() + (((8 - now.getDay()) % 7) || 7));
  return [
    { key: '1h', label: 'In 1 hour', ts: now.getTime() + 3600000 },
    now.getHours() < 17 && { key: 'today', label: 'This evening', ts: at(now, 18) },
    { key: 'tomorrow', label: 'Tomorrow morning', ts: at(tomorrow, 9) },
    { key: 'monday', label: 'Next Monday', ts: at(monday, 9) },
  ].filter(Boolean);
}

/** "today 18:00", "tomorrow 09:00", "Mon 09:00", "Oct 12 09:00" (time and dates in the system locale) */
export function wakeLabel(ts, now = new Date()) {
  const d = new Date(ts);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((at(d, 0) - at(now, 0)) / DAY);
  if (days <= 0) return `today ${time}`;
  if (days === 1) return `tomorrow ${time}`;
  if (days < 7) return `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
}

// ---------- Important ----------
// Unread one-to-one chats and anything that mentions you, so they don't drown among groups.

export const isImportant = (r) => !r.archived && !r.pinned && !r.invite && !r.muted
  && ((!r.group && (r.unread > 0 || r.markedUnread)) || r.highlight > 0);
