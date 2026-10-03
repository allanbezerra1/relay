// Each bridged room is tagged with the network it comes from, the way Beeper
// shows a little badge on every chat. Bridges announce themselves with an
// `m.bridge` state event (MSC2346); older ones use `uk.half-shot.bridge`.
// If neither is present we fall back to the ghost-user prefix of the members.

export const NETWORKS = {
  whatsapp:  { name: 'WhatsApp',        color: '#25d366', glyph: 'W' },
  whatsappBusiness: { name: 'WhatsApp Business', color: '#25d366', glyph: 'B' },
  telegram:  { name: 'Telegram',        color: '#2aabee', glyph: 'T' },
  signal:    { name: 'Signal',          color: '#3a76f0', glyph: 'S' },
  imessage:  { name: 'iMessage',        color: '#34c759', glyph: 'i' },
  gmessages: { name: 'Google Messages', color: '#1a73e8', glyph: 'G' },
  instagram: { name: 'Instagram',       color: '#e1306c', glyph: 'I' },
  messenger: { name: 'Messenger',       color: '#0084ff', glyph: 'M' },
  facebook:  { name: 'Facebook',        color: '#0866ff', glyph: 'f' },
  gvoice:    { name: 'Google Voice',    color: '#34a853', glyph: 'V' },
  line:      { name: 'LINE',            color: '#06c755', glyph: 'L' },
  viber:     { name: 'Viber',           color: '#7360f2', glyph: 'V' },
  tumblr:    { name: 'Tumblr',          color: '#36465d', glyph: 't' },
  discord:   { name: 'Discord',         color: '#5865f2', glyph: 'D' },
  slack:     { name: 'Slack',           color: '#e01e5a', glyph: 'S' },
  linkedin:  { name: 'LinkedIn',        color: '#0a66c2', glyph: 'in' },
  twitter:   { name: 'X',               color: '#a1a1aa', glyph: 'X' },
  googlechat:{ name: 'Google Chat',     color: '#00ac47', glyph: 'C' },
  bluesky:   { name: 'Bluesky',         color: '#1185fe', glyph: 'B' },
  irc:       { name: 'IRC',             color: '#8b8b8b', glyph: '#' },
  matrix:    { name: 'Matrix',          color: '#8b93a7', glyph: 'm' },
};

const PROTOCOL_ALIASES = {
  whatsapp: 'whatsapp', telegram: 'telegram', signal: 'signal',
  imessage: 'imessage', imessagego: 'imessage', bluebubbles: 'imessage',
  gmessages: 'gmessages', googlemessages: 'gmessages', sms: 'gmessages',
  instagram: 'instagram', instagramgo: 'instagram',
  facebook: 'facebook', messenger: 'facebook', facebookgo: 'facebook', meta: 'facebook', facebooktor: 'facebook',
  gvoice: 'gvoice', googlevoice: 'gvoice', line: 'line', viber: 'viber', tumblr: 'tumblr',
  discord: 'discord', discordgo: 'discord',
  slack: 'slack', slackgo: 'slack',
  linkedin: 'linkedin', twitter: 'twitter', x: 'twitter',
  googlechat: 'googlechat', gchat: 'googlechat',
  bluesky: 'bluesky', irc: 'irc',
};

// Prefixes used by mautrix and other bridges for their ghost users, e.g. @whatsapp_123:server
const USER_PREFIX = /^@(whatsapp|telegram|signal|imessage|imessagego|gmessages|instagram|instagramgo|facebook|facebookgo|meta|messenger|discord|slack|linkedin|twitter|googlechat|bluesky|gvoice)(?:bot|_)/i;

const cache = new Map();

function fromProtocol(id) {
  if (!id) return null;
  return PROTOCOL_ALIASES[id.toLowerCase().replace(/[^a-z]/g, '')] || null;
}

export function detectNetwork(room) {
  const cached = cache.get(room.roomId);
  if (cached) return cached;

  let net = null;
  for (const type of ['m.bridge', 'uk.half-shot.bridge']) {
    const evs = room.currentState.getStateEvents(type) || [];
    for (const ev of evs) {
      net = fromProtocol(ev.getContent()?.protocol?.id);
      if (net) break;
    }
    if (net) break;
  }

  if (!net) {
    const ids = [
      ...room.getJoinedMembers().map((m) => m.userId),
      ...(room.getDMInviter() ? [room.getDMInviter()] : []),
    ];
    for (const id of ids) {
      const m = USER_PREFIX.exec(id);
      if (m) { net = fromProtocol(m[1]); break; }
    }
  }

  // Only cache confident answers: members load lazily, so "matrix" may change later.
  if (net) cache.set(room.roomId, net);
  return net || 'matrix';
}

export function networkInfo(id) {
  return NETWORKS[id] || NETWORKS.matrix;
}
