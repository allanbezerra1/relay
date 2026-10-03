import { useEffect } from 'react';

export default function Lightbox({ src, name, onClose }) {
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
        <a href={src} download={name || 'image'}>Save</a>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
