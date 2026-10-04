// Platform-specific wording, so keyboard hints say ⌘ on macOS and Ctrl elsewhere.
const platform = window.relay?.platform || 'web';

export const IS_MAC = platform === 'darwin';
/** Modifier key label: "⌘" on macOS, "Ctrl" elsewhere. */
export const MOD = IS_MAC ? '⌘' : 'Ctrl';
/** "⌘K" / "Ctrl+K" */
export const combo = (key) => (IS_MAC ? `⌘${key}` : `Ctrl+${key}`);
