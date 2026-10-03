// Per-chat extras that live in your own Matrix account data (private to you):
// labels, starred messages and mute state.
import { PushRuleKind } from 'matrix-js-sdk';

// ---------- Labels ----------

export const LABEL_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b'];
const LABELS_TYPE = 'dev.relay.labels';
export const labelTag = (id) => `u.relay.label.${id}`;

export function getLabels(client) {
  return client.getAccountData(LABELS_TYPE)?.getContent()?.labels || [];
}

export function saveLabels(client, labels) {
  return client.setAccountData(LABELS_TYPE, { labels });
}

export function roomLabels(room, labels) {
  const tags = room.tags || {};
  return labels.filter((l) => tags[labelTag(l.id)]);
}

export async function createLabel(client, name) {
  const labels = getLabels(client);
  const label = { id: Math.random().toString(36).slice(2, 9), name: name.trim(), color: LABEL_COLORS[labels.length % LABEL_COLORS.length] };
  await saveLabels(client, [...labels, label]);
  return label;
}

export function toggleLabel(client, room, label, on) {
  return on ? client.setRoomTag(room.roomId, labelTag(label.id), { order: 0.5 }) : client.deleteRoomTag(room.roomId, labelTag(label.id));
}

// ---------- Starred messages ----------

const STARRED_TYPE = 'dev.relay.starred';

export function getStarred(room) {
  return room.getAccountData(STARRED_TYPE)?.getContent()?.events || [];
}

export function isStarred(room, eventId) {
  return getStarred(room).some((s) => s.id === eventId);
}

export function toggleStar(client, room, ev) {
  const list = getStarred(room);
  const next = list.some((s) => s.id === ev.getId())
    ? list.filter((s) => s.id !== ev.getId())
    : [{ id: ev.getId(), ts: ev.getTs() }, ...list].slice(0, 200);
  return client.setRoomAccountData(room.roomId, STARRED_TYPE, { events: next });
}

// ---------- Mute ----------
// Same mechanism the bridges use when you mute a chat on your phone:
// a room push rule with no actions.

export function isMuted(client, roomId) {
  const rule = client.pushRules?.global?.room?.find((r) => r.rule_id === roomId);
  if (!rule || rule.enabled === false) return false;
  return !rule.actions?.some((a) => a === 'notify' || a?.set_tweak);
}

export async function setMuted(client, roomId, muted) {
  if (muted) {
    await client.addPushRule('global', PushRuleKind.RoomSpecific, roomId, { actions: [] });
  } else {
    await client.deletePushRule('global', PushRuleKind.RoomSpecific, roomId).catch(() => {});
  }
}
