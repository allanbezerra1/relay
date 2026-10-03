import { useEffect, useState } from 'react';
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

function Item({ client, content, onCopy, copied }) {
  const { url, error } = useMedia(client, content);
  const name = content.filename || content.body || (content.msgtype === MsgType.Video ? 'video' : 'image');
  const video = content.msgtype === MsgType.Video;
  return (
    <>
      <div className="lightbox-media" onClick={(e) => e.stopPropagation()}>
        {error ? <div className="lightbox-error">Couldn’t load this {video ? 'video' : 'photo'}.</div>
          : !url ? <div className="spinner" />
          : video ? <video key={url} src={url} controls autoPlay playsInline />
          : <img key={url} src={url} alt={name} />}
      </div>
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span className="lightbox-name">{name}</span>
        {!video && url && <button onClick={() => onCopy(url)}>{copied ? 'Copied ✓' : 'Copy'}</button>}
        {url && <a href={url} download={name}>Save</a>}
      </div>
    </>
  );
}

/**
 * Full-screen viewer. With `items` (from roomGallery) it pages through the chat's photos and
 * videos with the arrows or ← →; with just `src` it shows that one image.
 */
export default function Lightbox({ client, items: startItems, index: start = 0, src, name, onClose, loadOlder }) {
  const [items, setItems] = useState(startItems);
  const [index, setIndex] = useState(start);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [noMore, setNoMore] = useState(false);
  const list = items?.length ? items : null;

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

  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose, list]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setCopied(false), [index]);

  const copy = (url) => copyImage(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });

  return (
    <div className="lightbox" onClick={onClose}>
      {list ? (
        <>
          <Item key={list[index].eventId} client={client} content={list[index].content} onCopy={copy} copied={copied} />
          {(list.length > 1 || loading) && <div className="lightbox-count">{loading && index === 0 ? 'Loading older…' : `${index + 1} / ${list.length}`}</div>}
          {index > 0 && (
            <button className="lightbox-nav prev" title="Previous (←)" onClick={(e) => { e.stopPropagation(); go(-1); }}>
              <svg viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z" /></svg>
            </button>
          )}
          {index < list.length - 1 && (
            <button className="lightbox-nav next" title="Next (→)" onClick={(e) => { e.stopPropagation(); go(1); }}>
              <svg viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z" /></svg>
            </button>
          )}
        </>
      ) : (
        <>
          <div className="lightbox-media" onClick={(e) => e.stopPropagation()}><img src={src} alt={name || ''} /></div>
          <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
            <span className="lightbox-name">{name}</span>
            <button onClick={() => copy(src)}>{copied ? 'Copied ✓' : 'Copy'}</button>
            <a href={src} download={name || 'image'}>Save</a>
          </div>
        </>
      )}
      <button className="lightbox-close" title="Close (Esc)" onClick={onClose}>✕</button>
    </div>
  );
}
