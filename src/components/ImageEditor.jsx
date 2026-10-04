import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as E from '../editor/engine.js';
import { CATEGORIES } from './EmojiPicker.jsx';

// Full-window photo editor: crop, adjustments + filters, drawing, text, emoji, blur.
// Interactive preview runs on a downscaled bitmap; the full-resolution render only
// happens on "Done".

const IS_MAC = window.relay?.platform === 'darwin';
/** "⌘Z" / "Ctrl+Z", "⇧⌘Z" / "Ctrl+Shift+Z" */
const combo = (key, shift = false) => (IS_MAC ? `${shift ? '⇧' : ''}⌘${key}` : `Ctrl+${shift ? 'Shift+' : ''}${key}`);
const SHIFT = IS_MAC ? '⇧' : 'Shift+';

const P = {
  crop: 'M17 15h2V7a2 2 0 0 0-2-2H9v2h8v8ZM7 17V1H5v4H1v2h4v10a2 2 0 0 0 2 2h10v4h2v-4h4v-2H7Z',
  tune: 'M3 17v2h6v-2H3ZM3 5v2h10V5H3Zm10 16v-2h8v-2h-8v-2h-2v6h2ZM7 9v2H3v2h4v2h2V9H7Zm14 4v-2H11v2h10Zm-6-4h2V7h4V5h-4V3h-2v6Z',
  brush: 'M7 14c-1.66 0-3 1.34-3 3 0 1.31-1.16 2-2 2 .92 1.22 2.49 2 4 2 2.21 0 4-1.79 4-4 0-1.66-1.34-3-3-3Zm13.71-9.37-1.34-1.34a1 1 0 0 0-1.41 0L9 12.25 11.75 15l8.96-8.96a1 1 0 0 0 0-1.41Z',
  text: 'M2.5 4v3h5v12h3V7h5V4h-13Zm19 5h-9v3h3v7h3v-7h3V9Z',
  smile: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm-3.5-9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm7 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM12 17.5c2.3 0 4.3-1.4 5.1-3.5H6.9c.8 2.1 2.8 3.5 5.1 3.5Z',
  undo: 'M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8Z',
  redo: 'M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6Z',
  rotl: 'M7.11 8.53 5.7 7.11C4.8 8.27 4.24 9.61 4.07 11h2.02c.14-.87.49-1.72 1.02-2.47ZM6.09 13H4.07c.17 1.39.72 2.73 1.62 3.89l1.41-1.42c-.52-.75-.87-1.59-1.01-2.47Zm1.01 5.32c1.16.9 2.51 1.44 3.9 1.61V17.9c-.87-.15-1.71-.49-2.46-1.03L7.1 18.32ZM13 4.07V1L8.45 5.55 13 10V6.09c2.84.48 5 2.94 5 5.91s-2.16 5.43-5 5.91v2.02c3.95-.49 7-3.85 7-7.93s-3.05-7.44-7-7.93Z',
  flip: 'M15 21h2v-2h-2v2Zm4-12h2V7h-2v2ZM3 5v14c0 1.1.9 2 2 2h4v-2H5V5h4V3H5c-1.1 0-2 .9-2 2Zm16-2v2h2c0-1.1-.9-2-2-2Zm-8 20h2V1h-2v22Zm8-6h2v-2h-2v2ZM15 5h2V3h-2v2Zm4 8h2v-2h-2v2Zm0 8c1.1 0 2-.9 2-2h-2v2Z',
  restore: 'M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18Z',
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  pen: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z',
  eraser: 'M16.24 3.56l4.95 4.94c.78.79.78 2.05 0 2.84L12 20.53a4 4 0 0 1-5.66 0L2.81 17c-.78-.79-.78-2.05 0-2.84l10.6-10.6c.79-.78 2.05-.78 2.83 0ZM4.22 15.58l3.54 3.53c.78.79 2.04.79 2.83 0l3.53-3.53-4.95-4.95-4.95 4.95Z',
  hl: 'M6 14l3 3v5h6v-5l3-3V9H6v5Zm5-12h2v3h-2V2ZM3.5 5.88 4.91 4.46 7.05 6.6 5.63 8 3.5 5.88Zm13.46.71 2.13-2.12 1.42 1.41L18.38 8l-1.42-1.41Z',
  neon: 'M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9Zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5ZM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15Z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
  trash: 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z',
  fit: 'M3 5v4h2V5h4V3H5a2 2 0 0 0-2 2Zm2 10H3v4a2 2 0 0 0 2 2h4v-2H5v-4Zm14 4h-4v2h4a2 2 0 0 0 2-2v-4h-2v4Zm0-16h-4v2h4v4h2V5a2 2 0 0 0-2-2Z',
};

function Ico({ d, size = 20, style }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" style={style}><path fill="currentColor" d={d} /></svg>;
}
function BlurIco({ size = 20 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      {[[6, 6, 1.2], [12, 6, 1.6], [18, 6, 1.2], [6, 12, 1.6], [12, 12, 2.4], [18, 12, 1.6], [6, 18, 1.2], [12, 18, 1.6], [18, 18, 1.2]].map(([x, y, r]) => <circle key={`${x}${y}`} cx={x} cy={y} r={r} fill="currentColor" />)}
    </svg>
  );
}

const TOOLS = [
  { id: 'crop', label: 'Crop', key: 'C', icon: <Ico d={P.crop} /> },
  { id: 'adjust', label: 'Adjust', key: 'A', icon: <Ico d={P.tune} /> },
  { id: 'draw', label: 'Draw', key: 'D', icon: <Ico d={P.brush} /> },
  { id: 'text', label: 'Text', key: 'T', icon: <Ico d={P.text} /> },
  { id: 'emoji', label: 'Emoji', key: 'E', icon: <Ico d={P.smile} /> },
  { id: 'blur', label: 'Blur', key: 'B', icon: <BlurIco /> },
];

const COLORS = ['#ffffff', '#111318', '#ff3b5c', '#ff8a00', '#ffd60a', '#34c759', '#00c7be', '#2f80ed', '#7c5cff', '#ff4fd8', '#b07a52', '#8e8e93'];
const BRUSHES = [
  { id: 'pen', label: 'Pen', icon: P.pen },
  { id: 'hl', label: 'Highlighter', icon: P.hl },
  { id: 'neon', label: 'Neon', icon: P.neon },
];
const HINTS = {
  crop: 'Drag the corners to crop · scroll to zoom · drag inside to move',
  adjust: 'Pick a filter, then fine-tune the details',
  draw: 'Draw on the photo · [ and ] change the size',
  text: 'Click the photo to type · drag to move · use the handle to rotate',
  emoji: 'Pick an emoji · drag to move · use the handle to rotate and resize',
  blur: 'Paint over faces or details you want to hide',
};
const PAD = 56;
const DOCK = 104;

function Slider({ label, value, min, max, step = 1, onChange, onCommit, format = (v) => (v > 0 ? `+${v}` : `${v}`), onReset }) {
  const pct = ((value - min) / (max - min)) * 100;
  const zero = min < 0 ? ((0 - min) / (max - min)) * 100 : 0;
  return (
    <label className="ied-slider" onDoubleClick={onReset}>
      <span className="ied-slider-top"><span>{label}</span><b className={value ? 'on' : ''}>{format(value)}</b></span>
      <input type="range" min={min} max={max} step={step} value={value}
        style={{ '--a': `${Math.min(pct, zero)}%`, '--b': `${Math.max(pct, zero)}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit} onKeyUp={onCommit} onBlur={onCommit} />
    </label>
  );
}

export default function ImageEditor({ file, initialDoc = null, onCancel, onDone }) {
  const [src, setSrc] = useState(null);
  const [error, setError] = useState(null);
  const [hist, setHist] = useState(null);
  const [tool, setTool] = useState('crop');
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState({ z: 1, x: 0, y: 0 });
  const [brush, setBrush] = useState({ kind: 'pen', erase: false, color: '#ff3b5c', size: 8 });
  const [blurOpt, setBlurOpt] = useState({ kind: 'blur', size: 44 });
  const [textStyle, setTextStyle] = useState({ font: 'classic', color: '#ffffff', bg: false });
  const [sel, setSel] = useState(null);
  const [textEdit, setTextEdit] = useState(null); // { id, x, y, text }
  const [emojiCat, setEmojiCat] = useState(1);
  const [thumbs, setThumbs] = useState({});
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cropDragging, setCropDragging] = useState(false);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const cursorRef = useRef(null);
  const cacheRef = useRef({});
  const drag = useRef(null);
  const space = useRef(false);
  const commitTimer = useRef(0);
  const textRef = useRef(null);
  const rootRef = useRef(null);
  // Take the focus from the composer (its textarea would swallow the shortcuts) and give it back after.
  useEffect(() => {
    const prev = document.activeElement;
    rootRef.current?.focus();
    return () => prev?.focus?.();
  }, []);
  const bgUrl = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(bgUrl), [bgUrl]);

  // ----- Load -----
  useEffect(() => {
    let alive = true;
    E.loadSource(file).then((s) => {
      if (!alive) { s.preview.close?.(); return; }
      setSrc(s);
      const d = initialDoc || E.initialDoc(s.W, s.H);
      setHist({ doc: d, base: d, past: [], future: [], opened: d });
    }).catch((err) => alive && setError(err.message || 'Couldn’t open this image.'));
    return () => { alive = false; };
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => src?.preview.close?.(), [src]);

  const doc = hist?.doc;
  const W = src?.W, H = src?.H;
  const [fw, fh] = doc ? E.frameSize(doc.geom, W, H) : [1, 1];

  // ----- History -----
  const resolve = (h, d) => (typeof d === 'function' ? d(h.doc) : d);
  const live = (d) => setHist((h) => ({ ...h, doc: resolve(h, d) }));
  const commit = (d) => setHist((h) => {
    const next = d === undefined ? h.doc : resolve(h, d);
    if (next === h.base) return h.doc === next ? h : { ...h, doc: next };
    return { ...h, doc: next, base: next, past: [...h.past, h.base].slice(-100), future: [] };
  });
  const commitSoon = () => { clearTimeout(commitTimer.current); commitTimer.current = setTimeout(() => commit(), 350); };
  const undo = () => setHist((h) => {
    if (!h) return h;
    if (h.doc !== h.base) return { ...h, doc: h.base };
    if (!h.past.length) return h;
    const prev = h.past[h.past.length - 1];
    return { ...h, doc: prev, base: prev, past: h.past.slice(0, -1), future: [h.base, ...h.future] };
  });
  const redo = () => setHist((h) => {
    if (!h?.future.length) return h;
    const n = h.future[0];
    return { ...h, doc: n, base: n, past: [...h.past, h.base], future: h.future.slice(1) };
  });
  const canUndo = !!hist && (hist.past.length > 0 || hist.doc !== hist.base);
  const canRedo = !!hist?.future.length;
  const pristine = doc && src ? E.isPristine(doc, W, H) : true;
  const dirty = hist && JSON.stringify(hist.doc) !== JSON.stringify(hist.opened);

  // ----- Stage size & view -----
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const view = useMemo(() => {
    if (!doc || !size.w) return null;
    const r = tool === 'crop' ? { x: 0, y: 0, w: fw, h: fh } : doc.crop;
    const availW = Math.max(40, size.w - PAD * 2), availH = Math.max(40, size.h - PAD - DOCK);
    const fit = Math.min(availW / r.w, availH / r.h);
    const z = tool === 'crop' ? 1 : zoom.z;
    const cx = size.w / 2 + (tool === 'crop' ? 0 : zoom.x);
    const cy = PAD / 2 + (size.h - DOCK) / 2 + (tool === 'crop' ? 0 : zoom.y);
    return E.mul(E.mul(E.T(cx, cy), E.S(fit * z)), E.T(-(r.x + r.w / 2), -(r.y + r.h / 2)));
  }, [doc?.crop, doc?.geom, fw, fh, size, tool, zoom]); // eslint-disable-line react-hooks/exhaustive-deps
  const vk = view ? E.scaleOf(view) : 1;

  // ----- Render -----
  useEffect(() => {
    if (!src || !view || !doc) return undefined;
    const id = requestAnimationFrame(() => {
      const c = canvasRef.current;
      if (!c) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(size.w * dpr), h = Math.round(size.h * dpr);
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      E.renderDoc(c.getContext('2d'), {
        src: src.preview, W, H, doc, view: E.mul(E.S(dpr), view), w, h,
        clip: tool !== 'crop', cache: cacheRef.current, hideItem: textEdit?.id,
      });
    });
    return () => cancelAnimationFrame(id);
  }, [src, view, doc, size, tool, textEdit?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filter thumbnails for the Ajustes panel.
  const thumbKey = doc && tool === 'adjust' ? JSON.stringify([doc.geom, doc.crop, doc.adjust]) : null;
  useEffect(() => {
    if (!thumbKey || !src) return undefined;
    const t = setTimeout(() => {
      const out = {};
      const n = 132;
      const c = document.createElement('canvas');
      c.width = c.height = n;
      const ctx = c.getContext('2d');
      const { crop } = doc;
      const f = n / Math.min(crop.w, crop.h);
      const v = E.mul(E.mul(E.T(n / 2, n / 2), E.S(f)), E.T(-(crop.x + crop.w / 2), -(crop.y + crop.h / 2)));
      for (const p of E.PRESETS) {
        const d = { ...doc, filter: p.id, intensity: 100, strokes: [], items: [], adjust: { ...doc.adjust, clarity: 0 } };
        E.renderDoc(ctx, { src: src.preview, W, H, doc: d, view: v, w: n, h: n, clip: true, fast: true });
        out[p.id] = c.toDataURL('image/jpeg', 0.8);
      }
      setThumbs(out);
    }, 60);
    return () => clearTimeout(t);
  }, [thumbKey, src]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- Helpers -----
  const stagePoint = (e) => {
    const r = stageRef.current.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const toFrame = (e) => E.apply(E.inv(view), ...stagePoint(e));
  const selItem = doc?.items.find((i) => i.id === sel) || null;
  const updateItem = (id, patch, how = commit) => how((d) => ({ ...d, items: d.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  const removeItem = (id) => { commit((d) => ({ ...d, items: d.items.filter((i) => i.id !== id) })); setSel(null); };
  const newId = () => Math.random().toString(36).slice(2, 9);
  const baseSize = () => Math.min(doc.crop.w, doc.crop.h);

  const switchTool = (t) => {
    if (textEdit) finishText();
    setTool(t);
    if (t !== 'text' && t !== 'emoji') setSel(null);
    if (t === 'crop') setZoom({ z: 1, x: 0, y: 0 });
  };

  const beginDrag = (e, handlers) => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = handlers;
  };

  // ----- Text entry -----
  const openText = (x, y, item = null) => {
    if (item) {
      setTextStyle({ font: item.font, color: item.color, bg: item.bg });
      setTextEdit({ id: item.id, x: item.x, y: item.y, text: item.text });
    } else {
      setTextEdit({ id: null, x, y, text: '' });
    }
    setSel(item?.id || null);
    requestAnimationFrame(() => textRef.current?.focus());
  };
  function finishText(cancel = false) {
    const t = textEdit;
    if (!t) return;
    setTextEdit(null);
    if (cancel) return;
    const text = t.text.replace(/\s+$/, '');
    if (!text.trim()) { if (t.id) removeItem(t.id); return; }
    if (t.id) {
      updateItem(t.id, { text, ...textStyle });
    } else {
      const id = newId();
      commit((d) => ({ ...d, items: [...d.items, { id, kind: 'text', text, ...textStyle, x: t.x, y: t.y, size: baseSize() * 0.075, rot: 0 }] }));
      setSel(id);
    }
  }
  const setStyle = (patch) => {
    setTextStyle((s) => ({ ...s, ...patch }));
    if (textEdit) requestAnimationFrame(() => textRef.current?.focus());
    else if (selItem?.kind === 'text') updateItem(selItem.id, patch);
  };

  const addEmoji = (ch) => {
    const id = newId();
    const c = doc.crop;
    const jitter = () => (Math.random() - 0.5) * c.w * 0.12;
    commit((d) => ({ ...d, items: [...d.items, { id, kind: 'emoji', text: ch, x: c.x + c.w / 2 + jitter(), y: c.y + c.h / 2 + jitter(), size: baseSize() * 0.2, rot: 0 }] }));
    setSel(id);
  };

  // ----- Pointer on the stage -----
  const onPointerDown = (e) => {
    if (!view || busy) return;
    if (textEdit) { if (!e.target.closest('.ied-textedit')) finishText(); return; }
    const panning = e.button === 1 || (e.button === 0 && space.current);
    if (panning && tool !== 'crop') {
      const [sx, sy] = stagePoint(e);
      const z0 = zoom;
      beginDrag(e, { move: (ev) => { const [x, y] = stagePoint(ev); setZoom({ ...z0, x: z0.x + x - sx, y: z0.y + y - sy }); } });
      return;
    }
    if (e.button !== 0) return;
    if (tool === 'draw' || tool === 'blur') {
      const [x, y] = toFrame(e);
      const s = tool === 'blur'
        ? { kind: blurOpt.kind, size: blurOpt.size / vk, pts: [x, y] }
        : { kind: brush.erase ? 'erase' : brush.kind, color: brush.color, size: (brush.erase ? brush.size * 2.2 : brush.kind === 'hl' ? brush.size * 2.6 : brush.size) / vk, pts: [x, y] };
      live((d) => ({ ...d, strokes: [...d.strokes, s] }));
      const minD = 1.5 / vk;
      beginDrag(e, {
        move: (ev) => {
          const list = ev.getCoalescedEvents?.() || [ev];
          live((d) => {
            const last = d.strokes[d.strokes.length - 1];
            const pts = last.pts.slice();
            for (const ce of list) {
              const [px, py] = toFrame(ce);
              if (Math.hypot(px - pts[pts.length - 2], py - pts[pts.length - 1]) >= minD) pts.push(px, py);
            }
            return { ...d, strokes: [...d.strokes.slice(0, -1), { ...last, pts }] };
          });
        },
        up: () => commit(),
      });
      return;
    }
    if (tool === 'text' || tool === 'emoji') {
      const [x, y] = toFrame(e);
      const hit = E.hitItem(doc.items, x, y);
      if (hit) {
        setSel(hit.id);
        if (hit.kind === 'text') setTextStyle({ font: hit.font, color: hit.color, bg: hit.bg });
        const start = { x: hit.x, y: hit.y };
        let moved = false;
        beginDrag(e, {
          move: (ev) => {
            const [nx, ny] = toFrame(ev);
            if (!moved && Math.hypot(nx - x, ny - y) * vk < 3) return;
            moved = true;
            updateItem(hit.id, { x: start.x + nx - x, y: start.y + ny - y }, live);
          },
          up: () => (moved ? commit() : undefined),
        });
        return;
      }
      if (sel) { setSel(null); return; }
      if (tool === 'text') {
        const c = doc.crop;
        if (x >= c.x && y >= c.y && x <= c.x + c.w && y <= c.y + c.h) openText(x, y);
      }
    }
  };
  const onPointerMove = (e) => {
    if (cursorRef.current) {
      const [x, y] = stagePoint(e);
      cursorRef.current.style.transform = `translate(${x}px, ${y}px)`;
    }
    if (drag.current && e.buttons === 0 && e.pointerType === 'mouse') { onPointerUp(e); return; } // missed release
    drag.current?.move?.(e);
  };
  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    d?.up?.(e);
  };
  const onDoubleClick = (e) => {
    if (tool !== 'text' && tool !== 'emoji') return;
    const [x, y] = toFrame(e);
    const hit = E.hitItem(doc.items, x, y);
    if (hit?.kind === 'text') { setTool('text'); openText(0, 0, hit); }
  };

  // Wheel: zoom (mouse wheel / pinch) or pan (two-finger scroll); scale an item under the pointer.
  const wheelState = useRef({});
  wheelState.current = { view, tool, doc, sel, zoom, fw, fh, size };
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      const { view: v, tool: t, doc: d, sel: s, zoom: z, fw: FW, fh: FH } = wheelState.current;
      if (!v || !d) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const [fx, fy] = E.apply(E.inv(v), sx, sy);
      const k = E.scaleOf(v);
      const mouseWheel = e.deltaMode === 1 || (!e.ctrlKey && e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 40);
      const isZoom = e.ctrlKey || mouseWheel;
      const factor = Math.exp(-(e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY) * (e.ctrlKey ? 0.01 : 0.0018));
      if ((t === 'text' || t === 'emoji') && s) {
        const it = d.items.find((i) => i.id === s);
        if (it && E.hitItem([it], fx, fy)) {
          if (e.shiftKey) updateItem(s, { rot: it.rot + Math.sign(e.deltaY || e.deltaX) * 0.08 }, live);
          else updateItem(s, { size: Math.max(6, it.size * (isZoom ? factor : Math.exp(-e.deltaY * 0.004))) }, live);
          commitSoon();
          return;
        }
      }
      if (t === 'crop') {
        if (isZoom) live((dd) => ({ ...dd, crop: E.zoomCrop(dd.crop, 1 / factor, fx, fy, FW, FH) }));
        else live((dd) => ({ ...dd, crop: E.clampCrop({ ...dd.crop, x: dd.crop.x + e.deltaX / k, y: dd.crop.y + e.deltaY / k }, FW, FH) }));
        commitSoon();
        return;
      }
      if (isZoom) {
        const nz = Math.min(8, Math.max(1, z.z * factor));
        if (nz === 1) { setZoom({ z: 1, x: 0, y: 0 }); return; }
        const fit = k / z.z;
        const c = d.crop;
        const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
        const { size: sz } = wheelState.current;
        const ox = sz.w / 2, oy = PAD / 2 + (sz.h - DOCK) / 2;
        setZoom({ z: nz, x: sx - ox - fit * nz * (fx - cx), y: sy - oy - fit * nz * (fy - cy) });
      } else if (z.z > 1) {
        setZoom({ ...z, x: z.x - e.deltaX, y: z.y - e.deltaY });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- Geometry actions -----
  const geom = (patch) => commit((d) => E.changeGeom(d, typeof patch === 'function' ? patch(d.geom) : patch, W, H));
  const rotate = (dir) => geom((g) => ({ rot: g.rot + dir * g.fx * g.fy }));
  const flip = (axis) => geom((g) => (axis === 'h' ? { fx: -g.fx } : { fy: -g.fy }));
  const setAspect = (id) => commit((d) => {
    const [FW, FH] = E.frameSize(d.geom, W, H);
    const r = E.aspectRatio(id, FW, FH);
    return { ...d, aspect: id, crop: r ? E.cropForAspect(d.crop, r, FW, FH) : d.crop };
  });
  const resetCrop = () => commit((d) => {
    const fresh = E.initialDoc(W, H);
    const back = E.changeGeom(d, fresh.geom, W, H);
    return { ...back, crop: fresh.crop, aspect: 'free' };
  });

  // ----- Finish -----
  const done = async () => {
    if (textEdit) finishText();
    if (!doc || busy) return;
    if (pristine) { onDone(null); return; }
    setBusy(true);
    try {
      const out = await E.exportDoc(file, doc, { alpha: src.alpha });
      onDone({ file: out, doc });
    } catch (err) {
      setError(`Couldn’t save the image: ${err.message}`);
      setBusy(false);
    }
  };
  const cancel = () => { if (dirty && !confirmCancel) setConfirmCancel(true); else onCancel(); };

  // ----- Keyboard -----
  const keyState = useRef({});
  keyState.current = { undo, redo, done, cancel, switchTool, textEdit, finishText, sel, removeItem, tool, rotate, setBrush, setBlurOpt, confirmCancel, setConfirmCancel, setZoom };
  useEffect(() => {
    const onKey = (e) => {
      const k = keyState.current;
      e.stopPropagation(); // the editor owns the keyboard while open
      if (e.key === ' ' && !k.textEdit) { space.current = true; if (!e.target.closest?.('input, textarea, button')) e.preventDefault(); return; }
      const mod = e.ctrlKey || e.metaKey;
      if (k.textEdit) {
        if (e.key === 'Escape') { e.preventDefault(); k.finishText(true); }
        else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); k.finishText(); }
        return;
      }
      if (e.target.closest?.('input[type="text"], input[type="color"], textarea')) return;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) k.redo(); else k.undo(); return; }
      if (mod && key === 'y') { e.preventDefault(); k.redo(); return; }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (k.confirmCancel) k.setConfirmCancel(false);
        else if (k.sel) keyState.current.setSel?.(null);
        else k.cancel();
        return;
      }
      if (e.key === 'Enter') { if (e.target.closest?.('button')) return; e.preventDefault(); k.done(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && k.sel) { e.preventDefault(); k.removeItem(k.sel); return; }
      if (mod || e.altKey) return;
      const t = TOOLS.find((x) => x.key.toLowerCase() === key);
      if (t) { e.preventDefault(); k.switchTool(t.id); return; }
      if (key === 'r' && k.tool === 'crop') { k.rotate(e.shiftKey ? -1 : 1); return; }
      if (key === '0') { k.setZoom({ z: 1, x: 0, y: 0 }); return; }
      if (e.key === '[' || e.key === ']') {
        const d = e.key === ']' ? 1 : -1;
        if (k.tool === 'draw') k.setBrush((b) => ({ ...b, size: Math.min(48, Math.max(2, b.size + d * 2)) }));
        if (k.tool === 'blur') k.setBlurOpt((b) => ({ ...b, size: Math.min(140, Math.max(12, b.size + d * 8)) }));
      }
    };
    const onUp = (e) => { if (e.key === ' ') space.current = false; e.stopPropagation(); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onUp, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onUp, true); };
  }, []);
  keyState.current.setSel = setSel;

  // ----- Overlays -----
  const cropBox = () => {
    if (!view) return null;
    const [x1, y1] = E.apply(view, doc.crop.x, doc.crop.y);
    const [x2, y2] = E.apply(view, doc.crop.x + doc.crop.w, doc.crop.y + doc.crop.h);
    const r = E.aspectRatio(doc.aspect, fw, fh);
    const start = (handle) => (e) => {
      const p0 = toFrame(e);
      const c0 = doc.crop;
      setCropDragging(true);
      beginDrag(e, {
        move: (ev) => {
          const [x, y] = toFrame(ev);
          live((d) => ({ ...d, crop: E.dragCrop(c0, handle, x - p0[0], y - p0[1], r, fw, fh) }));
        },
        up: () => { setCropDragging(false); commit(); },
      });
    };
    return (
      <div className={`ied-crop ${cropDragging ? 'dragging' : ''}`} style={{ left: x1, top: y1, width: x2 - x1, height: y2 - y1 }} onPointerDown={start('move')}>
        <i className="g v1" /><i className="g v2" /><i className="g h1" /><i className="g h2" />
        {['tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r'].map((h) => <span key={h} className={`ied-h ${h}`} onPointerDown={start(h)} />)}
        <span className="ied-crop-size">{Math.round(doc.crop.w)} × {Math.round(doc.crop.h)}</span>
      </div>
    );
  };

  const selectionBox = () => {
    if (!selItem || textEdit?.id === selItem.id || !(tool === 'text' || tool === 'emoji')) return null;
    const b = E.itemBox(selItem);
    const [cx, cy] = E.apply(view, selItem.x, selItem.y);
    const w = b.w * vk + 16, h = b.h * vk + 16;
    const xform = (e) => {
      const it = selItem;
      const [px, py] = stagePoint(e);
      const a0 = Math.atan2(py - cy, px - cx), d0 = Math.hypot(px - cx, py - cy);
      beginDrag(e, {
        move: (ev) => {
          const [x, y] = stagePoint(ev);
          const a = Math.atan2(y - cy, x - cx), dd = Math.hypot(x - cx, y - cy);
          let rot = it.rot + a - a0;
          const snap = Math.round(rot / (Math.PI / 4)) * (Math.PI / 4);
          if (Math.abs(rot - snap) < 0.05) rot = snap; // gentle snap to 0/45/90°
          updateItem(it.id, { rot, size: Math.max(6, it.size * dd / Math.max(4, d0)) }, live);
        },
        up: () => commit(),
      });
    };
    return (
      <div className="ied-sel" style={{ left: cx, top: cy, width: w, height: h, transform: `translate(-50%, -50%) rotate(${selItem.rot}rad)` }}>
        <button className="ied-sel-x" title="Remove (Delete)" onPointerDown={(e) => { e.stopPropagation(); removeItem(selItem.id); }}><Ico d={P.close} size={14} /></button>
        {selItem.kind === 'text' && <button className="ied-sel-edit" title="Edit text (double-click)" onPointerDown={(e) => { e.stopPropagation(); setTool('text'); openText(0, 0, selItem); }}><Ico d={P.pen} size={13} /></button>}
        <span className="ied-sel-h" title="Drag to rotate and resize" onPointerDown={xform}><Ico d={P.rotl} size={14} style={{ transform: 'scaleX(-1)' }} /></span>
      </div>
    );
  };

  const textOverlay = () => {
    if (!textEdit) return null;
    const f = E.fontOf(textStyle.font);
    const px = Math.max(20, Math.min(56, (selItem && textEdit.id ? selItem.size : baseSize() * 0.075) * vk));
    const css = f.css(px);
    const style = {
      font: css,
      color: textStyle.bg ? E.contrastOn(textStyle.color) : f.glow ? '#fff' : textStyle.color,
      background: textStyle.bg ? textStyle.color : 'transparent',
      textShadow: f.glow && !textStyle.bg ? `0 0 ${px * 0.3}px ${textStyle.color}, 0 0 ${px * 0.7}px ${textStyle.color}` : textStyle.bg ? 'none' : '0 2px 8px rgba(0,0,0,.45)',
    };
    const rows = Math.max(1, textEdit.text.split('\n').length);
    return (
      <div className="ied-textedit" onPointerDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) finishText(); }}>
        <textarea ref={textRef} value={textEdit.text} rows={rows} spellCheck={false} placeholder="Type something…" style={style}
          onChange={(e) => setTextEdit((t) => ({ ...t, text: e.target.value }))} />
        <div className="ied-textedit-hint">Enter to finish · Shift+Enter for a new line · Esc to cancel</div>
      </div>
    );
  };

  // ----- Panels -----
  const swatches = (value, set) => (
    <div className="ied-swatches">
      {COLORS.map((c) => <button key={c} className={`ied-sw ${value === c ? 'on' : ''}`} style={{ '--c': c }} onClick={() => set(c)} title={c} />)}
      <label className={`ied-sw custom ${COLORS.includes(value) ? '' : 'on'}`} title="Custom color" style={COLORS.includes(value) ? undefined : { '--c': value }}>
        <input type="color" value={value} onChange={(e) => set(e.target.value)} />
      </label>
    </div>
  );

  const panel = () => {
    if (!doc) return null;
    switch (tool) {
      case 'crop': return (
        <>
          <section>
            <h4>Aspect ratio</h4>
            <div className="ied-chips aspects">
              {E.ASPECTS.map((a) => {
                const r = E.aspectRatio(a.id, fw, fh);
                const box = r ? (r >= 1 ? { width: 18, height: 18 / r } : { width: 18 * r, height: 18 }) : null;
                return (
                  <button key={a.id} className={doc.aspect === a.id ? 'on' : ''} onClick={() => setAspect(a.id)}>
                    <i className={`ar ${box ? '' : 'free'}`} style={box || undefined} />{a.label}
                  </button>
                );
              })}
            </div>
          </section>
          <section>
            <h4>Rotate and flip</h4>
            <div className="ied-iconrow">
              <button onClick={() => rotate(-1)} title={`Rotate left (${SHIFT}R)`}><Ico d={P.rotl} /><span>Left</span></button>
              <button onClick={() => rotate(1)} title="Rotate right (R)"><Ico d={P.rotl} style={{ transform: 'scaleX(-1)' }} /><span>Right</span></button>
              <button className={doc.geom.fx < 0 ? 'on' : ''} onClick={() => flip('h')} title="Flip horizontally"><Ico d={P.flip} /><span>Horizontal</span></button>
              <button className={doc.geom.fy < 0 ? 'on' : ''} onClick={() => flip('v')} title="Flip vertically"><Ico d={P.flip} style={{ transform: 'rotate(90deg)' }} /><span>Vertical</span></button>
            </div>
          </section>
          <section>
            <Slider label="Straighten" min={-45} max={45} step={0.5} value={doc.geom.angle}
              format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.0', '')}°`}
              onChange={(v) => live((d) => E.changeGeom(d, { angle: v }, W, H))} onCommit={() => commit()}
              onReset={() => geom({ angle: 0 })} />
            <div className="ied-ruler" aria-hidden="true">{Array.from({ length: 19 }, (_, i) => <i key={i} className={i % 3 === 0 ? 'big' : ''} />)}</div>
          </section>
          <button className="ied-wide ghost" onClick={resetCrop}><Ico d={P.restore} size={16} />Reset crop and rotation</button>
        </>
      );
      case 'adjust': return (
        <>
          <section>
            <h4>Filters</h4>
            <div className="ied-filters">
              {E.PRESETS.map((p) => (
                <button key={p.id} className={doc.filter === p.id ? 'on' : ''} onClick={() => commit((d) => ({ ...d, filter: p.id, intensity: d.filter === p.id ? d.intensity : 100 }))}>
                  <span className="ied-fthumb">{thumbs[p.id] ? <img src={thumbs[p.id]} alt="" /> : <i />}</span>
                  <span>{p.name}</span>
                </button>
              ))}
            </div>
            {doc.filter !== 'none' && (
              <Slider label="Intensity" min={0} max={100} value={doc.intensity} format={(v) => `${v}%`}
                onChange={(v) => live((d) => ({ ...d, intensity: v }))} onCommit={() => commit()} onReset={() => commit((d) => ({ ...d, intensity: 100 }))} />
            )}
          </section>
          <section>
            <h4>Adjustments <button className="ied-link" onClick={() => commit((d) => ({ ...d, adjust: E.initialDoc(1, 1).adjust }))}>Reset</button></h4>
            {E.ADJUSTMENTS.map((a) => (
              <Slider key={a.id} label={a.label} min={a.min} max={a.max} value={doc.adjust[a.id]} format={a.min < 0 ? undefined : (v) => `${v}`}
                onChange={(v) => live((d) => ({ ...d, adjust: { ...d.adjust, [a.id]: v } }))}
                onCommit={() => commit()} onReset={() => commit((d) => ({ ...d, adjust: { ...d.adjust, [a.id]: 0 } }))} />
            ))}
            <p className="ied-note">Tip: double-click a slider to reset it.</p>
          </section>
        </>
      );
      case 'draw': return (
        <>
          <section>
            <h4>Brush</h4>
            <div className="ied-brushes">
              {BRUSHES.map((b) => (
                <button key={b.id} className={!brush.erase && brush.kind === b.id ? 'on' : ''} onClick={() => setBrush((s) => ({ ...s, kind: b.id, erase: false }))}>
                  <Ico d={b.icon} size={22} /><span>{b.label}</span>
                </button>
              ))}
              <button className={brush.erase ? 'on' : ''} onClick={() => setBrush((s) => ({ ...s, erase: !s.erase }))}><Ico d={P.eraser} size={22} /><span>Eraser</span></button>
            </div>
          </section>
          <section className={brush.erase ? 'dim' : ''}>
            <h4>Color</h4>
            {swatches(brush.color, (c) => setBrush((s) => ({ ...s, color: c, erase: false })))}
          </section>
          <section>
            <Slider label="Size" min={2} max={48} value={brush.size} format={(v) => `${v}px`} onChange={(v) => setBrush((s) => ({ ...s, size: v }))} />
            <div className="ied-brush-preview">
              <svg viewBox="0 0 220 60" preserveAspectRatio="none">
                <path d="M12 40 C 50 8, 90 8, 110 30 S 170 54, 208 20" fill="none" strokeLinecap="round"
                  stroke={brush.erase ? 'var(--text-3)' : brush.color} strokeWidth={Math.min(30, brush.erase ? brush.size * 2.2 : brush.kind === 'hl' ? brush.size * 2.6 : brush.size)}
                  opacity={brush.kind === 'hl' && !brush.erase ? 0.45 : 1} strokeDasharray={brush.erase ? '2 6' : undefined}
                  style={brush.kind === 'neon' && !brush.erase ? { filter: `drop-shadow(0 0 6px ${brush.color}) drop-shadow(0 0 2px ${brush.color})` } : undefined} />
              </svg>
            </div>
          </section>
        </>
      );
      case 'text': return (
        <>
          <button className="ied-wide accent" onClick={() => { const c = doc.crop; openText(c.x + c.w / 2, c.y + c.h / 2); }}><Ico d={P.plus} size={18} />Add text</button>
          <section>
            <h4>Style</h4>
            <div className="ied-fonts">
              {E.FONTS.map((f) => (
                <button key={f.id} className={`${textStyle.font === f.id ? 'on' : ''} f-${f.id}`} onClick={() => setStyle({ font: f.id })}>
                  <span style={{ font: f.css(19) }}>Aa</span><small>{f.label}</small>
                </button>
              ))}
            </div>
          </section>
          <section>
            <h4>Color</h4>
            {swatches(textStyle.color, (c) => setStyle({ color: c }))}
          </section>
          <section>
            <label className="ied-toggle">
              <span><b>Background</b><small>Puts the text on a rounded label</small></span>
              <input type="checkbox" checked={textStyle.bg} onChange={(e) => setStyle({ bg: e.target.checked })} />
              <i />
            </label>
          </section>
          {selItem?.kind === 'text' && (
            <button className="ied-wide ghost danger" onClick={() => removeItem(selItem.id)}><Ico d={P.trash} size={16} />Remove text</button>
          )}
        </>
      );
      case 'emoji': return (
        <>
          <div className="ied-emoji-tabs">
            {CATEGORIES.slice(1).map(([name, icon], i) => (
              <button key={name} className={emojiCat === i + 1 ? 'on' : ''} onClick={() => setEmojiCat(i + 1)} title={name}>{icon}</button>
            ))}
          </div>
          <div className="ied-emoji-grid">
            {CATEGORIES[emojiCat][2].split(' ').map((em) => <button key={em} onClick={() => addEmoji(em)}>{em}</button>)}
          </div>
          {selItem?.kind === 'emoji' && (
            <button className="ied-wide ghost danger" onClick={() => removeItem(selItem.id)}><Ico d={P.trash} size={16} />Remove emoji</button>
          )}
        </>
      );
      case 'blur': return (
        <>
          <section>
            <h4>Effect</h4>
            <div className="ied-brushes two">
              <button className={blurOpt.kind === 'blur' ? 'on' : ''} onClick={() => setBlurOpt((b) => ({ ...b, kind: 'blur' }))}><span className="ied-fx blur" /><span>Blur</span></button>
              <button className={blurOpt.kind === 'pixel' ? 'on' : ''} onClick={() => setBlurOpt((b) => ({ ...b, kind: 'pixel' }))}><span className="ied-fx pixel" /><span>Pixelate</span></button>
            </div>
          </section>
          <section>
            <Slider label="Brush size" min={12} max={140} value={blurOpt.size} format={(v) => `${v}px`} onChange={(v) => setBlurOpt((b) => ({ ...b, size: v }))} />
          </section>
          <button className="ied-wide ghost" disabled={!doc.strokes.some((s) => s.kind === 'blur' || s.kind === 'pixel')}
            onClick={() => commit((d) => ({ ...d, strokes: d.strokes.filter((s) => s.kind !== 'blur' && s.kind !== 'pixel') }))}>
            <Ico d={P.restore} size={16} />Remove all blur
          </button>
        </>
      );
      default: return null;
    }
  };

  const brushCursor = (tool === 'draw' || tool === 'blur') && !busy;
  const cursorSize = tool === 'blur' ? blurOpt.size : brush.erase ? brush.size * 2.2 : brush.kind === 'hl' ? brush.size * 2.6 : brush.size;
  const activeTool = TOOLS.find((t) => t.id === tool);

  return createPortal(
    <div ref={rootRef} className="ied" role="dialog" aria-label="Edit photo" tabIndex={-1}>
      <div className="ied-ambient" style={{ backgroundImage: `url("${bgUrl}")` }} />
      <header className="ied-top">
        <button className="ied-btn ghost" onClick={cancel} title="Cancel (Esc)"><Ico d={P.close} size={18} /><span>Cancel</span></button>
        <div className="ied-title">
          <b>Edit photo</b>
          {src && <span>{doc ? `${Math.round(doc.crop.w)} × ${Math.round(doc.crop.h)}` : ''}{file.name ? ` · ${file.name}` : ''}</span>}
        </div>
        <div className="ied-actions">
          <button className="ied-icon" onClick={undo} disabled={!canUndo} title={`Undo (${combo('Z')})`}><Ico d={P.undo} size={19} /></button>
          <button className="ied-icon" onClick={redo} disabled={!canRedo} title={`Redo (${combo('Z', true)})`}><Ico d={P.redo} size={19} /></button>
          <button className="ied-btn ghost" onClick={() => { setSel(null); commit(E.initialDoc(W, H)); }} disabled={pristine} title="Undo every edit"><Ico d={P.restore} size={17} /><span>Revert to original</span></button>
          <button className="ied-done" onClick={done} disabled={!doc || busy} title="Done (Enter)">
            {busy ? <span className="spinner small light" /> : <Ico d={P.check} size={18} />}<span>Done</span>
          </button>
        </div>
      </header>

      <div className="ied-main">
        <div ref={stageRef} className={`ied-stage tool-${tool} ${brushCursor ? 'brush' : ''} ${space.current ? 'pan' : ''}`}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onLostPointerCapture={onPointerUp}
          onDoubleClick={onDoubleClick} onContextMenu={(e) => e.preventDefault()}>
          <canvas ref={canvasRef} className={src ? 'ready' : ''} style={{ width: size.w, height: size.h }} />
          {!src && !error && <div className="ied-loading"><span className="spinner" />Opening photo…</div>}
          {error && <div className="ied-error">{error}</div>}
          {doc && tool === 'crop' && cropBox()}
          {doc && selectionBox()}
          {textOverlay()}
          {brushCursor && (
            <div ref={cursorRef} className="ied-cursor">
              <i style={{ width: cursorSize, height: cursorSize, borderColor: tool === 'draw' && !brush.erase ? brush.color : undefined }} />
            </div>
          )}
          {doc && <div key={tool} className="ied-hint">{HINTS[tool]}</div>}
          {tool !== 'crop' && zoom.z > 1.01 && (
            <button className="ied-zoom" onClick={() => setZoom({ z: 1, x: 0, y: 0 })} title="Fit to screen (0)"><Ico d={P.fit} size={14} />{Math.round(zoom.z * 100)}%</button>
          )}
          <nav className="ied-dock" onPointerDown={(e) => e.stopPropagation()}>
            {TOOLS.map((t) => (
              <button key={t.id} className={tool === t.id ? 'on' : ''} onClick={() => switchTool(t.id)} title={`${t.label} (${t.key})`}>
                {t.icon}<span>{t.label}</span>
              </button>
            ))}
          </nav>
          {busy && <div className="ied-busy"><span className="spinner" />Saving at full resolution…</div>}
        </div>

        <aside className="ied-panel" key={tool}>
          <div className="ied-panel-head">{activeTool.icon}<b>{activeTool.label}</b></div>
          {panel()}
        </aside>
      </div>

      {confirmCancel && (
        <div className="ied-confirm" onPointerDown={(e) => e.target === e.currentTarget && setConfirmCancel(false)}>
          <div className="ied-confirm-card">
            <b>Discard your changes?</b>
            <p>The edits you made to this photo will be lost.</p>
            <div>
              <button className="ied-btn ghost" onClick={() => setConfirmCancel(false)} autoFocus>Keep editing</button>
              <button className="ied-btn danger" onClick={onCancel}>Discard</button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
