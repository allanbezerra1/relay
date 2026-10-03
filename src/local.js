// Renderer-side helpers for local mode (see electron/local.cjs).

export const local = () => window.relay?.local;
export const hasLocal = () => !!window.relay?.local;

/** IPC errors arrive as "Error invoking remote method 'x': Error: message". */
export function cleanError(err) {
  return String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

// Everything Beeper offers, in the order it shows them. `bridge` is Relay's bridge for it
// (installed on first use); networks without a public bridge are listed as unavailable.
export const LOCAL_NETWORKS = ['whatsapp', 'telegram', 'discord'];
export const CATALOG = [
  { id: 'whatsapp', bridge: 'whatsapp', name: 'WhatsApp' },
  { id: 'twitter', bridge: 'twitter', name: 'X' },
  { id: 'telegram', bridge: 'telegram', name: 'Telegram' },
  { id: 'slack', bridge: 'slack', name: 'Slack' },
  { id: 'discord', bridge: 'discord', name: 'Discord' },
  { id: 'facebook', bridge: 'facebook', name: 'Facebook' },
  { id: 'instagram', bridge: 'instagram', name: 'Instagram' },
  { id: 'linkedin', bridge: 'linkedin', name: 'LinkedIn' },
  { id: 'gmessages', bridge: 'gmessages', name: 'Google Messages' },
  { id: 'signal', bridge: 'signal', name: 'Signal' },
  { id: 'googlechat', bridge: null, name: 'Google Chat', why: 'Its open bridge is no longer maintained.' },
  { id: 'line', bridge: null, name: 'LINE', why: 'Only Beeper’s own servers can connect LINE.' },
  { id: 'gvoice', bridge: 'gvoice', name: 'Google Voice' },
  { id: 'tumblr', bridge: null, name: 'Tumblr', why: 'Only Beeper’s own servers can connect Tumblr.' },
  { id: 'viber', bridge: null, name: 'Viber', why: 'Only Beeper’s own servers can connect Viber.' },
  { id: 'imessage', bridge: null, name: 'iMessage', why: 'Coming later: needs extra macOS permissions.' },
  { id: 'bluesky', bridge: 'bluesky', name: 'Bluesky' },
];

// Rooms the bridges use internally (bot DMs, management rooms) that shouldn't clutter the inbox.
export const BRIDGE_BOT = /^@[a-z]+bot:/;
export const BRIDGE_PUPPET = /^@(whatsapp|telegram|discord|signal|gmessages|instagram|meta|slack|linkedin|twitter|bluesky|gvoice)(bot|_)/;
