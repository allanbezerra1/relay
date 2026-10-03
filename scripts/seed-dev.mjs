// Fills a local test homeserver with chats that look bridged, so the UI can be
// developed without real WhatsApp/Telegram accounts.
//
//   node scripts/seed-dev.mjs [homeserver] [password]
//
// Expects users alice, bob and carol to exist (scripts/dev-server.sh creates them).
// Log in to Relay as @alice:localhost afterwards.

const HS = process.argv[2] || 'http://127.0.0.1:8008';
const PASSWORD = process.argv[3] || 'testpass123';

async function api(token, method, path, body) {
  const res = await fetch(HS + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, (json.retry_after_ms || 1000) + 50));
    return api(token, method, path, body);
  }
  if (!res.ok) throw new Error(`${method} ${path}: ${JSON.stringify(json)}`);
  return json;
}

async function login(user) {
  const r = await api(null, 'POST', '/_matrix/client/v3/login', {
    type: 'm.login.password', identifier: { type: 'm.id.user', user }, password: PASSWORD,
  });
  return { token: r.access_token, id: r.user_id };
}

let txn = Date.now();
const send = (u, roomId, content, type = 'm.room.message') =>
  api(u.token, 'PUT', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/${type}/${txn++}`, content);
const say = (u, roomId, body, extra = {}) => send(u, roomId, { msgtype: 'm.text', body, ...extra });
const setName = (u, name) => api(u.token, 'PUT', `/_matrix/client/v3/profile/${encodeURIComponent(u.id)}/displayname`, { displayname: name });

function bridgeState(protocol, displayname) {
  return {
    type: 'm.bridge',
    state_key: `relay-dev/${protocol}`,
    content: { bridgebot: '@bot:localhost', protocol: { id: protocol, displayname } },
  };
}

async function room(creator, alice, { name, protocol, protoName, others = [], invite = false, dm = false }) {
  const r = await api(creator.token, 'POST', '/_matrix/client/v3/createRoom', {
    preset: 'private_chat',
    name,
    is_direct: dm,
    invite: [alice.id, ...others.map((o) => o.id)],
    initial_state: protocol ? [bridgeState(protocol, protoName)] : [],
  });
  if (!invite) await api(alice.token, 'POST', `/_matrix/client/v3/join/${encodeURIComponent(r.room_id)}`, {});
  for (const o of others) await api(o.token, 'POST', `/_matrix/client/v3/join/${encodeURIComponent(r.room_id)}`, {});
  return r.room_id;
}

async function uploadPng(u) {
  // A tiny generated gradient PNG, so there is an image message to render.
  const { deflateSync } = await import('node:zlib');
  const w = 240, h = 160;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = 90 + (x * 120) / w; raw[o + 1] = 70 + (y * 100) / h; raw[o + 2] = 230;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  const res = await fetch(`${HS}/_matrix/media/v3/upload?filename=sunset.png`, {
    method: 'POST', headers: { Authorization: `Bearer ${u.token}`, 'Content-Type': 'image/png' }, body: png,
  });
  return { mxc: (await res.json()).content_uri, size: png.length, w, h };
}

const alice = await login('alice');
const bob = await login('bob');
const carol = await login('carol');
await setName(alice, 'Alice');
await setName(bob, 'Bob Martins');
await setName(carol, 'Carol Diaz');

// WhatsApp DM with an image, a reply, a reaction and an edit.
const wa = await room(bob, alice, { name: 'Bob Martins', protocol: 'whatsapp', protoName: 'WhatsApp', dm: true });
await say(bob, wa, 'Hey! Are we still on for Saturday?');
const q = await say(alice, wa, 'Yes! 2pm at the park?');
await say(bob, wa, '> <@alice:localhost> Yes! 2pm at the park?\n\nPerfect, I’ll bring snacks', { 'm.relates_to': { 'm.in_reply_to': { event_id: q.event_id } } });
const img = await uploadPng(bob);
const pic = await send(bob, wa, { msgtype: 'm.image', body: 'sunset.png', url: img.mxc, info: { mimetype: 'image/png', size: img.size, w: img.w, h: img.h } });
await send(alice, wa, { 'm.relates_to': { rel_type: 'm.annotation', event_id: pic.event_id, key: '😍' } }, 'm.reaction');
const typo = await say(bob, wa, 'Look at this sunset from yesterdya');
await say(bob, wa, '* Look at this sunset from yesterday', {
  'm.new_content': { msgtype: 'm.text', body: 'Look at this sunset from yesterday' },
  'm.relates_to': { rel_type: 'm.replace', event_id: typo.event_id },
});

// Telegram group.
const tg = await room(carol, alice, { name: 'Weekend Hiking 🥾', protocol: 'telegram', protoName: 'Telegram', others: [bob] });
await say(carol, tg, 'Trail options for Sunday: https://example.com/trails');
await say(bob, tg, 'The ridge loop looks great');
await say(carol, tg, '🔥');
await say(bob, tg, 'Who’s driving?');

// Signal DM.
const sig = await room(carol, alice, { name: 'Carol Diaz', protocol: 'signal', protoName: 'Signal', dm: true });
await say(carol, sig, 'Can you send me the doc from earlier?');
await say(alice, sig, 'Sure, one sec');

// iMessage DM.
const im = await room(bob, alice, { name: 'Mom', protocol: 'imessage', protoName: 'iMessage', dm: true });
await say(bob, im, 'Call me when you get a chance ❤️');

// Discord channel.
const dc = await room(carol, alice, { name: '#general · Indie Devs', protocol: 'discord', protoName: 'Discord', others: [bob] });
await say(bob, dc, 'Shipped the new build 🚀');
await say(carol, dc, 'Nice! Release notes?');

// Plain Matrix room and a pending invite.
const mx = await room(bob, alice, { name: 'Matrix HQ (test)' });
await say(bob, mx, 'Welcome to a plain Matrix room.');
await room(carol, alice, { name: 'Instagram — design crew', protocol: 'instagram', protoName: 'Instagram', invite: true });

console.log('Seeded. Log in as @alice:localhost with password', PASSWORD);
