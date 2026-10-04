// Cards under a message for what you'd do something with: pay a Pix, type a code, track a parcel,
// save a date, find an address (detection in src/smart.js).
import { useEffect, useMemo, useState } from 'react';
import { smartItems, trackUrl, calendarUrl, mapsUrl, brl } from '../smart.js';

const Svg = ({ d, size = 18 }) => <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" d={d} /></svg>;
const I = {
  pix: 'M12 2.6 9.1 5.5l2.3 2.3a.85.85 0 0 0 1.2 0l2.3-2.3L12 2.6Zm-5 5L4.6 10a2.8 2.8 0 0 0 0 4l2.4 2.4h1.2a2 2 0 0 0 1.4-.6l1.8-1.8a.85.85 0 0 1 1.2 0l1.8 1.8a2 2 0 0 0 1.4.6h1.2l2.4-2.4a2.8 2.8 0 0 0 0-4L17 7.6h-1.2a2 2 0 0 0-1.4.6l-1.8 1.8a.85.85 0 0 1-1.2 0L9.6 8.2a2 2 0 0 0-1.4-.6H7Zm5 8.6a.85.85 0 0 0-.6.2l-2.3 2.3 2.9 2.9 2.9-2.9-2.3-2.3a.85.85 0 0 0-.6-.2Z',
  key: 'M7 14a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm5.65-4A6 6 0 1 0 12.65 14H17v4h4v-4h2v-4H12.65Z',
  shield: 'M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4Zm-1 15-4-4 1.41-1.41L11 13.17l6.59-6.59L19 8l-8 8Z',
  box: 'M21 16.5c0 .38-.21.71-.53.88l-7.9 4.44a1 1 0 0 1-1.14 0l-7.9-4.44A1 1 0 0 1 3 16.5v-9c0-.38.21-.71.53-.88l7.9-4.44a1 1 0 0 1 1.14 0l7.9 4.44c.32.17.53.5.53.88v9ZM12 4.15 6.04 7.5 12 10.85l5.96-3.35L12 4.15ZM5 15.91l6 3.38v-6.71L5 9.21v6.7Zm14 0v-6.7l-6 3.37v6.71l6-3.38Z',
  pin: 'M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z',
  copy: 'M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z',
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z',
  open: 'M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7Zm5 16H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7Z',
  cal: 'M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 16H5V10h14v10Z',
};

const open = (url) => window.open(url, '_blank');

function useCopy() {
  const [done, setDone] = useState(false);
  const copy = async (text, { forgetAfter } = {}) => {
    try { await navigator.clipboard.writeText(text); } catch { return; }
    setDone(true);
    setTimeout(() => setDone(false), 1800);
    // Codes don't linger: clear the clipboard later if it still holds the code.
    if (forgetAfter) setTimeout(async () => { try { if ((await navigator.clipboard.readText()) === text) await navigator.clipboard.writeText(''); } catch {} }, forgetAfter);
  };
  return [done, copy];
}

function CopyBtn({ text, label = 'Copy', forgetAfter, primary }) {
  const [done, copy] = useCopy();
  return (
    <button className={`sc-btn${primary ? ' sc-go' : ''}${done ? ' done' : ''}`} onClick={(e) => { e.stopPropagation(); copy(text, { forgetAfter }); }}>
      <Svg d={done ? I.check : I.copy} size={15} />{done ? 'Copied' : label}
    </button>
  );
}

function Pix({ it }) {
  return (
    <div className="sc sc-pix">
      <div className="sc-ico"><Svg d={I.pix} size={20} /></div>
      <div className="sc-main">
        <div className="sc-kicker">Pix copy & paste{!it.valid && <span className="sc-warn"> · incomplete code</span>}</div>
        {it.amount != null ? <div className="sc-big">{brl(it.amount)}</div> : <div className="sc-title">Any amount</div>}
        {(it.name || it.city) && <div className="sc-sub">{[it.name, it.city].filter(Boolean).join(' · ')}</div>}
        <div className="sc-actions"><CopyBtn text={it.code} label="Copy Pix code" primary /></div>
      </div>
    </div>
  );
}

function PixKey({ it }) {
  return (
    <div className="sc sc-pix">
      <div className="sc-ico"><Svg d={I.key} size={19} /></div>
      <div className="sc-main">
        <div className="sc-kicker">Pix key · {it.kind}</div>
        <div className="sc-title mono">{it.key}</div>
        <div className="sc-actions"><CopyBtn text={it.key} label="Copy key" primary /></div>
      </div>
    </div>
  );
}

function Otp({ it }) {
  return (
    <div className="sc sc-otp">
      <div className="sc-ico"><Svg d={I.shield} size={19} /></div>
      <div className="sc-main">
        <div className="sc-kicker">Verification code</div>
        <div className="sc-code">{it.code.split('').map((c, i) => <span key={i}>{c}</span>)}</div>
        <div className="sc-actions">
          <CopyBtn text={it.code} label="Copy code" forgetAfter={60000} primary />
          <span className="sc-hint">Cleared from the clipboard in 1 min</span>
        </div>
      </div>
    </div>
  );
}

function Track({ it }) {
  return (
    <div className="sc sc-track">
      <div className="sc-ico"><Svg d={I.box} size={19} /></div>
      <div className="sc-main">
        <div className="sc-kicker">Tracking{it.carrier ? ` · ${it.carrier === 'Internacional' ? 'International' : it.carrier}` : ''}</div>
        <div className="sc-title mono">{it.code}</div>
        <div className="sc-actions">
          <button className="sc-btn sc-go" onClick={(e) => { e.stopPropagation(); open(trackUrl(it)); }}><Svg d={I.open} size={15} />Track</button>
          <CopyBtn text={it.code} />
        </div>
      </div>
    </div>
  );
}


function When({ it, ctx }) {
  const d = new Date(it.at);
  const label = d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  const time = it.allDay ? 'All day' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="sc sc-when">
      <div className="sc-date"><b>{d.toLocaleDateString([], { month: 'short' }).replace('.', '').toUpperCase()}</b><span>{d.getDate()}</span></div>
      <div className="sc-main">
        <div className="sc-kicker">Event</div>
        <div className="sc-title">{label[0].toUpperCase() + label.slice(1)}</div>
        <div className="sc-sub">{time}</div>
        <div className="sc-actions">
          <button className="sc-btn sc-go" onClick={(e) => { e.stopPropagation(); open(calendarUrl(it, ctx.roomName ? `Chat: ${ctx.roomName}` : '')); }}><Svg d={I.cal} size={15} />Google Calendar</button>
        </div>
      </div>
    </div>
  );
}

// OpenStreetMap tiles around a point, with the point in the middle.
const Z = 16;
function tileXY(lat, lon) {
  const n = 2 ** Z, r = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
}

function MiniMap({ lat, lon }) {
  const [x, y] = tileXY(lat, lon);
  const tx = Math.floor(x), ty = Math.floor(y);
  const px = (x - tx) * 256, py = (y - ty) * 256;
  const tiles = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) tiles.push([dx, dy]);
  return (
    <div className="sc-map">
      <div className="sc-tiles" style={{ left: `calc(50% - ${256 + px}px)`, top: `calc(50% - ${256 + py}px)` }}>
        {tiles.map(([dx, dy]) => (
          <img key={`${dx},${dy}`} alt="" draggable="false" style={{ left: (dx + 1) * 256, top: (dy + 1) * 256 }}
            src={`https://tile.openstreetmap.org/${Z}/${tx + dx}/${ty + dy}.png`} />
        ))}
      </div>
      <div className="sc-mappin"><Svg d={I.pin} size={30} /></div>
      <span className="sc-osm">© OpenStreetMap</span>
    </div>
  );
}

function Place({ it }) {
  const [geo, setGeo] = useState(undefined);
  useEffect(() => {
    let alive = true;
    window.relay?.smart?.geocode(it.address).then((g) => alive && setGeo(g || null)).catch(() => alive && setGeo(null));
    return () => { alive = false; };
  }, [it.address]);
  return (
    <div className="sc sc-place">
      {geo && <MiniMap lat={geo.lat} lon={geo.lon} />}
      <div className="sc-row">
        <div className="sc-ico"><Svg d={I.pin} size={19} /></div>
        <div className="sc-main">
          <div className="sc-kicker">Address</div>
          <div className="sc-title">{it.address}</div>
          <div className="sc-actions">
            <button className="sc-btn sc-go" onClick={(e) => { e.stopPropagation(); open(mapsUrl(it.address)); }}><Svg d={I.open} size={15} />Open in Maps</button>
            <CopyBtn text={it.address} />
          </div>
        </div>
      </div>
    </div>
  );
}

const CARDS = { pix: Pix, pixkey: PixKey, otp: Otp, track: Track, when: When, place: Place };

/** ctx: { roomName } for the calendar event's description. */
export default function SmartCards({ text, ts, mine, ctx }) {
  const items = useMemo(() => smartItems(text, ts), [text, ts]);
  if (!items.length) return null;
  return (
    <div className={`smart-cards${mine ? ' mine' : ''}`}>
      {items.map((it, i) => { const C = CARDS[it.type]; return <C key={i} it={it} ctx={ctx || {}} />; })}
    </div>
  );
}
