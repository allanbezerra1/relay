// App-wide UI requests ("open settings at X", "show chat details") between components that
// are far apart in the tree (the composer asking the inbox to open settings, the palette
// asking the chat view to show its details), without threading callbacks through every layer.

const PREFIX = 'relay:';

export function emit(name, detail) {
  window.dispatchEvent(new CustomEvent(PREFIX + name, { detail }));
}

/** Returns an unsubscribe function, so it can be returned from a useEffect. */
export function on(name, cb) {
  const fn = (e) => cb(e.detail);
  window.addEventListener(PREFIX + name, fn);
  return () => window.removeEventListener(PREFIX + name, fn);
}
