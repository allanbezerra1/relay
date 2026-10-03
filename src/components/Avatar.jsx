import { useState, useEffect } from 'react';
import NetIcon from './NetIcon.jsx';
import { networkInfo } from '../networks.js';

function hue(str = '') {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}

function initials(name = '?') {
  const clean = name.replace(/[^\p{L}\p{N}\s]/gu, '').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (!parts.length) return name.trim()[0]?.toUpperCase() || '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

// Bridged contacts without a saved name show up as their phone number.
const PHONE = /^[+\d][\d\s().-]{5,}$/;

function PersonIcon({ size }) {
  return (
    <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4.4 0-8 2.3-8 5.2V21h16v-1.8c0-2.9-3.6-5.2-8-5.2Z" />
    </svg>
  );
}

export default function Avatar({ src, name, id, size = 40, network, account }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const net = network && network !== 'matrix' ? networkInfo(network) : null;

  return (
    <div className="avatar" style={{ width: size, height: size, '--h': hue(id || name) }}>
      {src && !failed ? (
        <img src={src} alt="" draggable={false} onError={() => setFailed(true)} />
      ) : PHONE.test((name || '').trim()) ? (
        <PersonIcon size={size} />
      ) : (
        <span style={{ fontSize: size * 0.38 }}>{initials(name)}</span>
      )}
      {net && (
        <span className="net-badge-wrap" title={net.name}>
          <NetIcon id={network} size={Math.max(16, Math.round(size * 0.36))} />
        </span>
      )}
    </div>
  );
}
