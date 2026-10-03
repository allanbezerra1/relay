import { useEffect, useState } from 'react';
import { copyImage } from '../media.js';

export default function Lightbox({ src, name, onClose }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="lightbox" onClick={onClose}>
      <img src={src} alt={name || ''} onClick={(e) => e.stopPropagation()} />
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span>{name}</span>
        <button onClick={() => copyImage(src).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>{copied ? 'Copied ✓' : 'Copy'}</button>
        <a href={src} download={name || 'image'}>Save</a>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
