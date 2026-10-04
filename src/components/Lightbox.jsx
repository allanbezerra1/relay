import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MsgType } from 'matrix-js-sdk';
import { copyImage, useMedia } from '../media.js';
import { effectiveContent } from '../matrix.js';

/** The photos and videos of a room, oldest first, for the viewer. */
export function roomGallery(room) {
  return room.getLiveTimeline().getEvents()
    .filter((e) => !e.isRedacted() && e.getType() === 'm.room.message')
    .filter((e) => [MsgType.Image, MsgType.Video].includes(effectiveContent(e).msgtype))
    .map((e) => ({ eventId: e.getId(), content: effectiveContent(e) }));
}

const Svg = ({ d, size = 18 }) => <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" d={d} /></svg>;
const I = {
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z',
  zoomIn: 'M15.5 14h-.79l-.28-.27A6.5 6.5 0 1 0 9.5 16a6.47 6.47 0 0 0 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9ZM10 7H9v2H7v1h2v2h1v-2h2V9h-2V7Z',
  zoomOut: 'M15.5 14h-.79l-.28-.27A6.5 6.5 0 1 0 9.5 16a6.47 6.47 0 0 0 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9ZM7 9h5v1H7V9Z',
  rotate: 'M7.11 8.53 5.7 7.11A8.9 8.9 0 0 0 3.08 12H5.1c.14-1.27.62-2.48 1.99-3.47ZM5.1 14H3.08a8.93 8.93 0 0 0 2.62 4.89l1.41-1.42A6.94 6.94 0 0 1 5.1 14Zm1.99 6.32A8.93 8.93 0 0 0 11 22v-2.02a6.93 6.93 0 0 1-2.49-1.07l-1.42 1.41ZM13 4.07V1L8.45 5.55 13 10V6.09A6.99 6.99 0 0 1 19 13a6.99 6.99 0 0 1-6 6.91v2.02A8.99 8.99 0 0 0 21 13a8.99 8.99 0 0 0-8-8.93Z',
  save: 'M19 9h-4V3H9v6H5l7 7 7-7ZM5 18v2h14v-2H5Z',
  copy: 'M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z',
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  fit: 'M3 5v4h2V5h4V3H5a2 2 0 0 0-2 2Zm2 10H3v4a2 2 0 0 0 2 2h4v-2H5v-4Zm14 4h-4v2h4a2 2 0 0 0 2-2v-4h-2v4Zm0-16h-4v2h4v4h2V5a2 2 0 0 0-2-2Z',
  prev: 'M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z',
  next: 'M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z',
};

const MIN = 1;
const MAX = 8;
const SWIPE = 70; // px of horizontal drag that pages to the next/previous item

/** One gallery item: resolves (and decrypts) the media, then hands it to the viewer. */
function GalleryItem({ client, content, children }) {
  const { url, error } = useMedia(client, content);
  const video = content.msgtype === MsgType.Video;
  const name = content.filename || content.body || (video ? 'video' : 'image');
  return children({ url, error, name, video });
}

/**
 * Full-window viewer, rendered into <body> so no ancestor's transform or backdrop-filter can
 * crop it. With `items` (from roomGallery) it pages through the chat's photos and videos (arrows,
 * ← →, a sideways swipe); with just `src` it shows that one image. Photos zoom at the cursor
 * (wheel, pinch, double-click, + −), pan by dragging when zoomed in, rotate (R), copy and save.
 */
export default function Lightbox({ client, items: startItems, index: start = 0, src, name, onClose, loadOlder }) {
  const [items, setItems] = useState(startItems);
  const [index, setIndex] = useState(start);
  const [loading, setLoading] = useState(false);
  const [noMore, setNoMore] = useState(false);
  const list = items?.length ? items : null;

  // Keys belong to the viewer while it's open (not to the composer behind it).
  useEffect(() => {
    const prev = document.activeElement;
    prev?.blur?.();
    return () => prev?.focus?.();
  }, []);

  // At the first item, fetch older history so you can keep going back.
  useEffect(() => {
    if (!list || index > 0 || !loadOlder || loading || noMore) return;
    const current = list[index].eventId;
    setLoading(true);
    loadOlder().then((more) => {
      if (!more || more.length <= list.length) { setNoMore(more === null || !more || more.length <= list.length); return; }
      setItems(more);
      setIndex(Math.max(0, more.findIndex((it) => it.eventId === current)));
    }).finally(() => setLoading(false));
  }, [index, list?.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (d) => list && setIndex((i) => Math.max(0, Math.min(list.length - 1, i + d)));

  const counter = list && (list.length > 1 || loading) ? (loading && index === 0 ? 'Loading older…' : `${index + 1} / ${list.length}`) : null;
  const view = (media) => (
    <Viewer key={list ? list[index].eventId : media.url} {...media} onClose={onClose} counter={counter}
      onPrev={list && index > 0 ? () => go(-1) : null}
      onNext={list && index < list.length - 1 ? () => go(1) : null} />
  );

  return createPortal(
    <div className="lightbox lb-full">
      {list
        ? <GalleryItem key={list[index].eventId} client={client} content={list[index].content}>{view}</GalleryItem>
        : view({ url: src, error: null, name: name || 'image', video: false })}
    </div>,
    document.body,
  );
}

function Viewer({ url, error, name, video, onClose, onPrev, onNext, counter }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rot, setRot] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);
  const stage = useRef(null);
  const swipe = useRef({ x: 0, t: 0 });
  const canZoom = !video && !!url && !error;

  const zoomAt = useCallback((next, cx, cy) => {
    setZoom((z) => {
      const nz = Math.min(MAX, Math.max(MIN, next(z)));
      if (nz === 1) { setPan({ x: 0, y: 0 }); return 1; }
      // Keep the point under the cursor in place.
      const rect = stage.current?.getBoundingClientRect();
      if (rect && cx != null) {
        const ox = cx - (rect.left + rect.width / 2);
        const oy = cy - (rect.top + rect.height / 2);
        setPan((p) => ({ x: ox - ((ox - p.x) * nz) / z, y: oy - ((oy - p.y) * nz) / z }));
      }
      return nz;
    });
  }, []);
  const reset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  const keys = useRef({});
  keys.current = { onClose, onPrev, onNext, canZoom, zoomAt };
  useEffect(() => {
    const onKey = (e) => {
      const k = keys.current;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') { e.stopPropagation(); k.onClose(); }
      else if (e.key === 'ArrowLeft') k.onPrev?.();
      else if (e.key === 'ArrowRight') k.onNext?.();
      else if (!k.canZoom) return;
      else if (e.key === '+' || e.key === '=') k.zoomAt((z) => z * 1.4);
      else if (e.key === '-') k.zoomAt((z) => z / 1.4);
      else if (e.key === '0') reset();
      else if (e.key.toLowerCase() === 'r') setRot((r) => r + 90);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // A mouse wheel or a pinch zooms at the cursor; a trackpad scroll pans when zoomed in,
  // and a sideways two-finger swipe pages to the next/previous item.
  const onWheel = (e) => {
    const mouseWheel = e.deltaMode === 1 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 40);
    if (canZoom && (e.ctrlKey || mouseWheel)) {
      zoomAt((z) => z * Math.exp(-(e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY) * (e.ctrlKey ? 0.01 : 0.0022)), e.clientX, e.clientY);
    } else if (zoom > 1) {
      setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
    } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const s = swipe.current;
      const now = Date.now();
      if (now - s.t > 400) s.x = 0; // a new gesture
      s.t = now;
      if (s.x === null) return; // already paged during this gesture
      s.x += e.deltaX;
      if (Math.abs(s.x) > 120) { (s.x > 0 ? onNext : onPrev)?.(); s.x = null; }
    }
  };

  const onDown = (e) => {
    if (e.button !== 0 || e.target.closest('button, a, video')) return;
    drag.current = { x0: e.clientX, y0: e.clientY, px: pan.x, py: pan.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    if (!d.moved) { d.moved = true; setDragging(true); }
    if (zoom > 1) setPan({ x: d.px + dx, y: d.py + dy });
    else if (onPrev || onNext) setPan({ x: dx * 0.6, y: 0 }); // follow the pointer while swiping
  };
  const onUp = (e) => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (!d) return;
    if (!d.moved) {
      if (zoom === 1 && !e.target.closest('img')) onClose(); // a click beside the photo closes
      return;
    }
    if (zoom === 1) {
      const dx = e.clientX - d.x0;
      setPan({ x: 0, y: 0 });
      if (dx <= -SWIPE) onNext?.();
      else if (dx >= SWIPE) onPrev?.();
    }
  };

  const copy = () => copyImage(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });

  return (
    <div className="lb-body" onWheel={onWheel}>
      <div className="lb-top">
        <span className="lb-name" title={name}>{name}</span>
        {counter && <span className="lb-count">{counter}</span>}
        <div className="lb-tools">
          {canZoom && (
            <>
              <button onClick={() => zoomAt((z) => z / 1.4)} disabled={zoom <= MIN} title="Zoom out (−)"><Svg d={I.zoomOut} /></button>
              <button className="lb-pct" onClick={reset} title="Fit to screen (0)">{Math.round(zoom * 100)}%</button>
              <button onClick={() => zoomAt((z) => z * 1.4)} disabled={zoom >= MAX} title="Zoom in (+)"><Svg d={I.zoomIn} /></button>
              <span className="lb-sep" />
              <button onClick={() => setRot((r) => r + 90)} title="Rotate (R)"><Svg d={I.rotate} /></button>
              <button onClick={copy} title={copied ? 'Copied' : 'Copy image'}><Svg d={copied ? I.check : I.copy} /></button>
            </>
          )}
          {url && <a href={url} download={name} title="Save"><Svg d={I.save} /></a>}
          <span className="lb-sep" />
          <button className="lb-close" onClick={onClose} title="Close (Esc)"><Svg d={I.close} size={20} /></button>
        </div>
      </div>
      <div ref={stage} className={`lb-stage ${zoom > 1 ? 'zoomed' : ''} ${dragging ? 'dragging' : ''}`}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onLostPointerCapture={onUp}>
        {error ? <div className="lightbox-error">Couldn’t load this {video ? 'video' : 'photo'}.</div>
          : !url ? <div className="spinner" />
          : video ? <video key={url} src={url} controls autoPlay playsInline style={pan.x ? { transform: `translateX(${pan.x}px)` } : undefined} />
          : (
            <>
              {!loaded && <div className="spinner" />}
              <img src={url} alt={name} draggable={false} onLoad={() => setLoaded(true)} className={loaded ? 'in' : ''}
                style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rot}deg)` }}
                onDoubleClick={(e) => { if (zoom > 1) reset(); else zoomAt(() => 2.5, e.clientX, e.clientY); }} />
            </>
          )}
        {onPrev && <button className="lightbox-nav prev" title="Previous (←)" onClick={onPrev}><Svg d={I.prev} size={26} /></button>}
        {onNext && <button className="lightbox-nav next" title="Next (→)" onClick={onNext}><Svg d={I.next} size={26} /></button>}
      </div>
    </div>
  );
}
