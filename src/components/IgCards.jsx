import { igParse, igStoryContext, storyLabel } from '../igshare.js';

const IG_D = 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 8.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4ZM17.3 5.6a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4ZM16.5 2h-9A5.5 5.5 0 0 0 2 7.5v9A5.5 5.5 0 0 0 7.5 22h9a5.5 5.5 0 0 0 5.5-5.5v-9A5.5 5.5 0 0 0 16.5 2Zm3.7 14.5a3.7 3.7 0 0 1-3.7 3.7h-9a3.7 3.7 0 0 1-3.7-3.7v-9a3.7 3.7 0 0 1 3.7-3.7h9a3.7 3.7 0 0 1 3.7 3.7v9Z';
const open = (url) => (e) => { e.stopPropagation(); window.open(url, '_blank'); };

/** A shared Instagram post/reel: author, caption and "Open in Instagram", no raw links. */
export function IgShareCard({ p }) {
  return (
    <span className="ig-card">
      <span className="ig-head">
        <span className="ig-badge"><svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d={IG_D} /></svg></span>
        <b>{p.kind === 'reel' ? 'Reel' : 'Post'}{p.author ? <> by <span className="ig-at">@{p.author}</span></> : ' from Instagram'}</b>
      </span>
      {p.caption && <span className="ig-caption">{p.caption}</span>}
      <button className="ig-open" onClick={open(p.url)}>Open in Instagram ↗</button>
    </span>
  );
}

/** Story reply / reaction / mention / share, as one line. */
export function IgStoryLabel({ p, mine, myName, children }) {
  return (
    <span className={`ig-story ${p.available === false ? 'gone' : ''}`}>
      <span className="ig-story-line">
        <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm0 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z" /></svg>
        {storyLabel(p, mine, myName)}
        {p.available === false && <em>· story no longer available</em>}
        {p.url && <button className="ig-story-open" onClick={open(p.url)}>View ↗</button>}
      </span>
      {children}
    </span>
  );
}

/** Body of a text message, or null when it isn't one of the Instagram bridge's formats. */
export function igBody(content, { mine, myName }) {
  const p = igParse(content.body);
  if (p?.type === 'share') return <IgShareCard p={p} />;
  if (p?.type === 'story') return <IgStoryLabel p={p} mine={mine} myName={myName}>{p.text ? <span className="text">{p.text}</span> : null}</IgStoryLabel>;
  const ctx = igStoryContext(content.formatted_body);
  if (ctx) return <IgStoryLabel p={ctx} mine={mine} myName={myName}><span className="text">{content.body}</span></IgStoryLabel>;
  return null;
}

/** Caption under a photo/video that is the bridge's story/share text. */
export function igCaption(caption, { mine, myName }) {
  const p = igParse(caption);
  if (p?.type === 'story') return <div className="caption"><IgStoryLabel p={p} mine={mine} myName={myName}>{p.text ? <span>{p.text}</span> : null}</IgStoryLabel></div>;
  if (p?.type === 'share') return <div className="caption"><IgShareCard p={p} /></div>;
  return null;
}
