import { useEffect, useMemo, useRef, useState } from 'react';
import ImageEditor from './ImageEditor.jsx';
import { EDITABLE } from '../editor/engine.js';
import { formatBytes } from '../matrix.js';

// The media tray above the composer: a large preview of the selected item, a strip of
// thumbnails (drag to reorder, edit, remove), and the send options.

const kindOf = (file) => /^(image|video|audio)\//.exec(file?.type || '')?.[1] || null;
const fmtDur = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '');
const ext = (name) => (name.split('.').pop() || 'FILE').slice(0, 4).toUpperCase();
const SLOT = 84; // thumbnail width + gap, keep in sync with media.css

const ICO = {
  pen: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z',
  x: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
  play: 'M8 5v14l11-7z',
  doc: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm2 16H8v-2h8v2Zm0-4H8v-2h8v2Zm-3-5V3.5L18.5 9H13Z',
  mic: 'M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z',
  caption: 'M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Z',
};
const Svg = ({ d, size = 16 }) => <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" d={d} /></svg>;

function Thumb({ item, selected, dragging, offset, onSelect, onEdit, onRemove, onDragStart }) {
  const [dur, setDur] = useState(null);
  const kind = kindOf(item.file);
  const isImg = kind === 'image' && item.preview;
  const isVid = kind === 'video' && item.preview;
  const editable = EDITABLE.test(item.file.type);
  const hasCaption = !!item.caption?.trim() && !selected;
  return (
    <div className={`mt-thumb ${selected ? 'sel' : ''} ${dragging ? 'dragging' : ''}`}
      style={dragging ? { transform: `translateX(${offset}px) scale(1.06)` } : undefined}
      onPointerDown={onDragStart} onClick={onSelect} onDoubleClick={editable ? onEdit : undefined}
      title={item.file.name}>
      <div className="mt-media">
        {isImg ? <img src={item.preview} alt="" draggable={false} />
          : isVid ? <video src={item.preview} muted preload="metadata" onLoadedMetadata={(e) => setDur(e.currentTarget.duration)} />
          : <div className="mt-file">{kind === 'audio' ? <Svg d={ICO.mic} size={22} /> : <span>{ext(item.file.name)}</span>}</div>}
      </div>
      {isVid && <span className="mt-dur"><Svg d={ICO.play} size={10} />{fmtDur(dur)}</span>}
      {(item.edit || hasCaption) && (
        <span className="mt-badges">
          {item.edit && <span className="mt-edited" title="Edited"><Svg d={ICO.pen} size={9} /></span>}
          {hasCaption && <span title={`Caption: ${item.caption}`}><Svg d={ICO.caption} size={9} /></span>}
        </span>
      )}
      <div className="mt-thumb-tools">
        {editable && <button className="mt-tt" onClick={(e) => { e.stopPropagation(); onEdit(); }} title="Edit"><Svg d={ICO.pen} size={12} /></button>}
        <button className="mt-tt x" onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Remove"><Svg d={ICO.x} size={12} /></button>
      </div>
    </div>
  );
}

function Hero({ item, viewOnce, onEdit }) {
  const kind = kindOf(item.file);
  const editable = EDITABLE.test(item.file.type);
  const audioUrl = useMemo(() => (kind === 'audio' ? URL.createObjectURL(item.file) : null), [item.file, kind]);
  useEffect(() => () => audioUrl && URL.revokeObjectURL(audioUrl), [audioUrl]);
  const [dims, setDims] = useState(null);
  return (
    <div className={`mt-hero ${kind || 'file'}`}>
      {kind === 'image' && item.preview && (
        <>
          <div className="mt-hero-blur" style={{ backgroundImage: `url("${item.preview}")` }} />
          <img key={item.preview} src={item.preview} alt="" draggable={false} onLoad={(e) => setDims([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])}
            onDoubleClick={editable ? onEdit : undefined} className={editable ? 'editable' : ''} />
        </>
      )}
      {kind === 'video' && item.preview && <video key={item.preview} src={item.preview} controls preload="metadata" />}
      {kind === 'audio' && (
        <div className="mt-hero-file"><span className="mt-hero-ico"><Svg d={ICO.mic} size={30} /></span><b>{item.file.name}</b><audio src={audioUrl} controls /></div>
      )}
      {!kind && (
        <div className="mt-hero-file"><span className="mt-hero-ico doc"><Svg d={ICO.doc} size={30} /><i>{ext(item.file.name)}</i></span><b>{item.file.name}</b><small>{formatBytes(item.file.size)}</small></div>
      )}
      {editable && (
        <div className="mt-hero-tools">
          <button className="mt-hero-btn" onClick={onEdit} title="Crop, adjust, draw, add text…"><Svg d={ICO.pen} size={15} /><span>Edit</span></button>
        </div>
      )}
      {(kind === 'image' || kind === 'video') && (
        <div className="mt-hero-meta">
          {viewOnce && <span className="mt-vo-chip"><span className="vo-circle small">1</span>View once</span>}
          <span>{kind === 'image' && dims ? `${dims[0]} × ${dims[1]} · ` : ''}{formatBytes(item.file.size)}</span>
        </div>
      )}
    </div>
  );
}

/**
 * staged: [{ id, file, preview, caption?, edit? }]. `edit` keeps the original file and the
 * editor state, so reopening the editor continues where you left off.
 * canViewOnce: the WhatsApp view-once toggle applies (media only, not as a document).
 */
export default function MediaTray({ staged, onChange, selectedId, onSelect, asDocument, onAsDocument, onClear, onRemove, onAddMore,
  canViewOnce, viewOnce, onViewOnce }) {
  const [editing, setEditing] = useState(null);
  const [drag, setDrag] = useState(null); // { id, offset }
  const suppressClick = useRef(false);
  const sel = staged.find((s) => s.id === selectedId) || staged[0];
  const editItem = staged.find((s) => s.id === editing);
  const once = canViewOnce && viewOnce;

  const patch = (id, p) => onChange((list) => list.map((x) => (x.id === id ? { ...x, ...p } : x)));

  // Drag a thumbnail sideways to change the send order.
  const startDrag = (item) => (e) => {
    if (e.button !== 0 || e.target.closest('button') || staged.length < 2) return;
    const x0 = e.clientX;
    const grabbed = e.currentTarget;
    let started = false;
    let index = staged.findIndex((s) => s.id === item.id);
    let base = x0; // pointer x when the item sat at `index`
    const move = (ev) => {
      const dx = ev.clientX - base;
      if (!started) {
        if (Math.abs(ev.clientX - x0) < 6) return;
        started = true;
        grabbed.setPointerCapture?.(ev.pointerId);
      }
      const to = Math.max(0, Math.min(staged.length - 1, index + Math.round(dx / SLOT)));
      if (to !== index) {
        const from = index;
        onChange((list) => {
          const next = list.slice();
          const [m] = next.splice(from, 1);
          next.splice(to, 0, m);
          return next;
        });
        base += (to - from) * SLOT;
        index = to;
      }
      setDrag({ id: item.id, offset: ev.clientX - base });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (started) { suppressClick.current = true; setTimeout(() => { suppressClick.current = false; }, 0); }
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const finishEdit = (res) => {
    const item = editItem;
    setEditing(null);
    if (!item) return;
    let next;
    if (!res) {
      if (!item.edit) return; // nothing changed
      next = { file: item.edit.source, edit: null }; // reverted to the original
    } else {
      next = { file: res.file, edit: { source: item.edit?.source || item.file, doc: res.doc } };
    }
    next.preview = URL.createObjectURL(next.file);
    if (item.preview) URL.revokeObjectURL(item.preview);
    patch(item.id, next);
  };

  const count = staged.length;
  const media = staged.filter((s) => /^(image|video)\//.test(s.file.type)).length;

  return (
    <div className="stage-tray mt">
      {sel && <Hero item={sel} viewOnce={once} onEdit={() => setEditing(sel.id)} />}
      <div className="mt-strip-wrap">
        <div className="mt-strip">
          {staged.map((s) => (
            <Thumb key={s.id} item={s} selected={s.id === sel?.id} dragging={drag?.id === s.id} offset={drag?.offset || 0}
              onSelect={() => { if (!suppressClick.current) onSelect(s.id); }}
              onEdit={() => setEditing(s.id)} onRemove={() => onRemove(s.id)} onDragStart={startDrag(s)} />
          ))}
          <button className="mt-add" onClick={onAddMore} title="Add more photos or videos"><Svg d={ICO.plus} size={22} /><span>Add</span></button>
        </div>
      </div>
      <div className="mt-foot">
        <span className="mt-count">
          {count} {count === 1 ? 'item' : 'items'}
          {count > 1 && <span className="mt-tip"> · each one has its own caption</span>}
        </span>
        {canViewOnce && (
          <button className={`mt-vo ${viewOnce ? 'on' : ''}`} onClick={() => onViewOnce(!viewOnce)} aria-pressed={viewOnce}
            title={viewOnce ? 'View once: on (they can open it one time)' : 'Send as view once'}>
            <span className="vo-circle small">1</span>View once
          </button>
        )}
        {media > 0 && (
          <label className="mt-switch" title="Sends the original file, without compression">
            <input type="checkbox" checked={asDocument} onChange={(e) => onAsDocument(e.target.checked)} />
            <i />Send as document
          </label>
        )}
        <button className="mt-discard" onClick={onClear}>Discard</button>
      </div>
      {editItem && (
        <ImageEditor file={editItem.edit?.source || editItem.file} initialDoc={editItem.edit?.doc || null}
          onCancel={() => setEditing(null)} onDone={finishEdit} />
      )}
    </div>
  );
}
