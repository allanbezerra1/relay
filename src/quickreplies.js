// Quick replies: saved replies typed as /shortcut in the composer. They live in your Matrix
// account data, so every device signed in to the account gets the same list.
import { useEffect, useState } from 'react';
import { ClientEvent } from 'matrix-js-sdk';

export const QUICK_REPLIES_TYPE = 'dev.relay.quick_replies';

export function getQuickReplies(client) {
  const list = client?.getAccountData(QUICK_REPLIES_TYPE)?.getContent()?.replies;
  return Array.isArray(list) ? list : [];
}

export function saveQuickReplies(client, replies) {
  return client.setAccountData(QUICK_REPLIES_TYPE, { replies });
}

/** Shortcuts are single words: "/thanks", not "/thanks a lot". */
export function cleanShortcut(s = '') {
  return s.trim().replace(/^\/+/, '').replace(/\s+/g, '-').toLowerCase();
}

export function useQuickReplies(client) {
  const [list, setList] = useState(() => getQuickReplies(client));
  useEffect(() => {
    if (!client) return undefined;
    setList(getQuickReplies(client));
    const onData = (ev) => { if (ev.getType() === QUICK_REPLIES_TYPE) setList(getQuickReplies(client)); };
    client.on(ClientEvent.AccountData, onData);
    return () => client.off(ClientEvent.AccountData, onData);
  }, [client]);
  return list;
}

/** Good morning / Good afternoon / Good evening, for {greeting}. */
export function greeting(date = new Date()) {
  const h = date.getHours();
  return h >= 5 && h < 12 ? 'Good morning' : h >= 12 && h < 18 ? 'Good afternoon' : 'Good evening';
}

/** First name to address someone by: "Maria" from "Maria Souza", nothing for phone numbers. */
export function firstName(name = '') {
  const n = name.trim();
  if (!n || n.startsWith('+') || /^\d/.test(n)) return '';
  return n.split(/\s+/)[0];
}

export const PLACEHOLDERS = [
  ['{name}', 'the person’s first name'],
  ['{greeting}', 'Good morning, Good afternoon or Good evening'],
];

/** Replace {name} and {greeting}; unknown placeholders are left as typed. */
export function fillPlaceholders(text, { name } = {}) {
  const first = firstName(name);
  return text
    // No name to use (a phone number): "Hi {name}, how are you?" → "Hi, how are you?"
    .replace(first ? /\{name\}/gi : / ?\{name\}/gi, first)
    .replace(/\{greeting\}/gi, greeting());
}
