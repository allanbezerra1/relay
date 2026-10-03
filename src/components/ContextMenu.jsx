import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Right-click menu. `items` is a list of
 *   { label, run, danger?, icon?, disabled? } | 'separator' | { reactions: [...], onReact }
 */
export default function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Open towards the side with room, like native menus: flip up/left near the edges.
    const left = x + r.width + 8 > window.innerWidth ? x - r.width : x;
    const top = y + r.height + 8 > window.innerHeight ? y - r.height : y;
    setPos({
      left: Math.max(8, Math.min(left, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(top, window.innerHeight - r.height - 8)),
      maxHeight: window.innerHeight - 16,
    });
  }, [x, y]);

  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  // Rendered at the top of the page: inside a message, transforms (swipe-to-reply) and the
  // chat card's rounded clipping would otherwise trap and cut the menu.
  return createPortal(
    <div ref={ref} className="menu" style={pos} onContextMenu={(e) => e.preventDefault()}>
      {items.filter(Boolean).map((it, i) => {
        if (it === 'separator') return <div key={i} className="menu-sep" />;
        if (it.reactions) {
          return (
            <div key={i} className="menu-reactions">
              {it.reactions.map((k) => (
                <button key={k} onClick={() => { onClose(); it.onReact(k); }}>{k}</button>
              ))}
            </div>
          );
        }
        return (
          <button key={i} className={it.danger ? 'danger' : ''} disabled={it.disabled} onClick={() => { onClose(); it.run(); }}>
            {it.icon && <span className="menu-icon">{it.icon}</span>}
            {it.label}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

/** Hook: const [menu, open, close] = useContextMenu(); then <div onContextMenu={(e) => open(e, items)}> */
export function useContextMenu() {
  const [menu, setMenu] = useState(null);
  const open = (e, items) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  };
  const close = () => setMenu(null);
  const element = menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={close} /> : null;
  return [element, open, close];
}
