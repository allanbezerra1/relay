import { useEffect, useReducer } from 'react';
import { ClientEvent, RoomEvent, RoomMemberEvent, RoomStateEvent, MatrixEventEvent } from 'matrix-js-sdk';

const EVENTS = [
  ClientEvent.Sync,
  ClientEvent.Room,
  ClientEvent.DeleteRoom,
  ClientEvent.AccountData,
  RoomEvent.Timeline,
  RoomEvent.TimelineReset,
  RoomEvent.Redaction,
  RoomEvent.Receipt,
  RoomEvent.Tags,
  RoomEvent.Name,
  RoomEvent.MyMembership,
  RoomEvent.LocalEchoUpdated,
  RoomEvent.UnreadNotifications,
  RoomStateEvent.Events,
  RoomMemberEvent.Typing,
  MatrixEventEvent.Decrypted,
  MatrixEventEvent.Replaced,
  MatrixEventEvent.RelationsCreated,
];

/**
 * Re-render whenever the Matrix client state changes. Updates are batched to
 * one per animation frame, so bursts of sync events stay cheap.
 */
export function useClientTick(client) {
  const [tick, bump] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    if (!client) return;
    let frame = 0;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; bump(); });
    };
    for (const e of EVENTS) client.on(e, schedule);
    return () => {
      for (const e of EVENTS) client.off(e, schedule);
      cancelAnimationFrame(frame);
    };
  }, [client]);
  return tick;
}

export function useWindowFocus() {
  const [focused, setFocused] = useReducer((_, v) => v, document.hasFocus());
  useEffect(() => {
    const off = window.relay?.onFocusChange(setFocused);
    const on = () => setFocused(true);
    const blur = () => setFocused(false);
    window.addEventListener('focus', on);
    window.addEventListener('blur', blur);
    return () => { off?.(); window.removeEventListener('focus', on); window.removeEventListener('blur', blur); };
  }, []);
  return focused;
}
