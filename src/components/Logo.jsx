// The Relay mark: a chat bubble carrying three conversations at once,
// with a second bubble behind it (many chats, one inbox).
// Kept in sync with build/icon.svg, which is the app icon.

export default function Logo({ size = 36, flat = false, className = '' }) {
  const id = `relay-g-${size}`;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-label="Relay" className={`logo ${className}`}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9a8cff" />
          <stop offset="0.55" stopColor="#5b4ee0" />
          <stop offset="1" stopColor="#2f7bff" />
        </linearGradient>
      </defs>
      {!flat && <rect x="0" y="0" width="100" height="100" rx="24" fill={`url(#${id})`} />}
      <rect x="40" y="17" width="45" height="33" rx="16.5" fill="#fff" opacity="0.38" />
      <path
        d="M36 29h28a20 20 0 0 1 20 20v2a20 20 0 0 1-20 20H45l-19 13 4.5-15A20 20 0 0 1 16 51v-2a20 20 0 0 1 20-20Z"
        fill="#fff"
      />
      <circle cx="36" cy="50" r="5.2" fill="#25c26e" />
      <circle cx="50" cy="50" r="5.2" fill="#2aa3ee" />
      <circle cx="64" cy="50" r="5.2" fill="#6a5cf5" />
    </svg>
  );
}
