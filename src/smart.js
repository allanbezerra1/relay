// Smart cards: things in a message you usually do something with — a Pix to pay, a code to
// type, a parcel to track, a date to save, an address to find. smartItems(text, ts) finds them
// (Portuguese and English wording); SmartCards.jsx draws them under the bubble.

// ---------- Pix "copia e cola" (EMV BR Code) ----------

/** Reads EMV TLV fields: "000201" + "26…" → { '00': '01', '26': '…' }. */
function tlv(s) {
  const out = {};
  for (let i = 0; i + 4 <= s.length;) {
    const tag = s.slice(i, i + 2), len = parseInt(s.slice(i + 2, i + 4), 10);
    if (Number.isNaN(len)) break;
    out[tag] = s.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
}

function crc16(s) {
  let crc = 0xffff;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function pixCode(text) {
  // Names inside the code have spaces ("Fulano de Tal"), so only line breaks end it.
  const m = /000201[^\n]*?br\.gov\.bcb\.pix[^\n]*?6304[0-9A-Fa-f]{4}/i.exec(text);
  if (!m) return null;
  const code = m[0];
  const f = tlv(code);
  const acct = tlv(f['26'] || '');
  const amount = f['54'] ? Number(f['54']) : null;
  return {
    type: 'pix', code,
    valid: crc16(code.slice(0, -4)) === code.slice(-4).toUpperCase(),
    name: (f['59'] || '').trim() || null, city: (f['60'] || '').trim() || null,
    key: acct['01'] || null, amount: Number.isFinite(amount) ? amount : null,
  };
}

const PIX_KEY = [
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/, 'email'],
  [/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/, 'CPF'],
  [/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/, 'CNPJ'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, 'random key'],
  [/(?:\+?55\s?)?\(?\d{2}\)?\s?9\d{4}[-\s]?\d{4}\b/, 'phone'],
  [/\b\d{11}\b/, 'CPF / phone'],
];

function pixKey(text) {
  if (!/\bpix\b/i.test(text)) return null;
  // The key usually comes right after "pix" ("meu pix: …", "chave pix …").
  const after = text.slice(text.search(/\bpix\b/i));
  for (const [re, kind] of PIX_KEY) {
    const m = re.exec(after) || re.exec(text);
    if (m) return { type: 'pixkey', key: m[0].trim(), kind };
  }
  return null;
}

// ---------- One-time codes ----------

const OTP_HINT = /(c[óo]digo|code|senha|password|passcode|token|verifica[çc][ãa]o|verification|verify|otp|pin|confirma[çc][ãa]o|confirmation|acesso|login|sign.?in)/i;

function otp(text) {
  if (!OTP_HINT.test(text) || text.length > 600) return null;
  // "G-123456", "123-456", "123 456", "123456" — 4 to 8 digits, near the hint.
  const re = /(?:^|[^\w/.,:-])((?:[A-Z]-)?\d{3}[- ]\d{3}|(?:[A-Z]-)?\d{4,8})(?![\w/.,:]\d)/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[1];
    const digits = raw.replace(/^[A-Z]-/, '').replace(/[- ]/g, '');
    if (/^(19|20)\d{2}$/.test(digits)) continue; // a year
    if (/^0+$/.test(digits)) continue;
    const around = text.slice(Math.max(0, m.index - 80), m.index + raw.length + 80);
    if (!OTP_HINT.test(around)) continue;
    return { type: 'otp', code: digits, shown: raw };
  }
  return null;
}

// ---------- Parcel tracking ----------

function tracking(text) {
  const m = /\b([A-Z]{2}\d{9}[A-Z]{2})\b/.exec(text);
  if (m && /BR$/.test(m[1]) || (m && /rastrei|encomenda|pacote|correios|objeto|envio|pedido|track|parcel|package|shipment|order/i.test(text))) {
    return { type: 'track', code: m[1], carrier: /BR$/.test(m[1]) ? 'Correios' : 'Internacional' };
  }
  const g = /(?:c[óo]digo de rastreio|rastreio|tracking(?: number| code)?)\s*(?:[:é-]|é|is)?\s*([A-Z0-9]{10,30})\b/i.exec(text);
  if (g && /\d/.test(g[1])) return { type: 'track', code: g[1].toUpperCase(), carrier: null };
  return null;
}

export const trackUrl = (t) => (t.carrier === 'Correios'
  ? `https://rastreamento.correios.com.br/app/index.php?objetos=${t.code}`
  : `https://t.17track.net/pt#nums=${t.code}`);

// ---------- Dates and times ----------

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const WEEKDAYS_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MONTHS_EN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** "às 19h", "19:30", "19h30", "7 da noite", "meio-dia", "at 7pm", "7:30 pm", "noon" → [h, m] or null. */
function findTime(t) {
  const en = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(t);
  if (en) {
    let h = +en[1] % 12;
    if (en[3] === 'pm') h += 12;
    const min = en[2] ? +en[2] : 0;
    return h < 24 && min < 60 ? [h, min] : null;
  }
  if (/\bnoon\b/.test(t)) return [12, 0];
  let m = /\b(?:as|a partir das|pelas|por volta das)\s+(\d{1,2})(?:[:h](\d{2}))?\s*(?:h|hs|horas)?\b(?:\s*da\s*(manha|tarde|noite))?/.exec(t)
    || /\b(\d{1,2})[:h](\d{2})\b/.exec(t)
    || /\b(\d{1,2})\s*(?:h|hs|horas)\b(?:\s*da\s*(manha|tarde|noite))?/.exec(t)
    || /\b(\d{1,2})\s*da\s*(manha|tarde|noite)\b/.exec(t);
  if (/\bmeio[- ]dia\b/.test(t)) return [12, 0];
  if (!m) return null;
  let h = +m[1];
  const min = m[2] && /^\d+$/.test(m[2]) ? +m[2] : 0;
  const period = m.slice(2).find((x) => /manha|tarde|noite/.test(x || ''));
  if ((period === 'tarde' || period === 'noite') && h < 12) h += 12;
  if (h > 23 || min > 59) return null;
  return [h, min];
}

/** Date mentioned in the text, relative to when the message was sent. */
function findDate(t, base) {
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const b = day(base);
  // Explicit dates win over "hoje/amanhã": "churrasco sábado? me diz até amanhã" is on Saturday.
  const explicit = explicitDate(t, b);
  if (explicit) return explicit;
  if (/\bdepois de amanha\b|\bday after tomorrow\b/.test(t)) return new Date(b.getTime() + 2 * 864e5);
  if (/\bamanha\b|\btomorrow\b/.test(t)) return new Date(b.getTime() + 864e5);
  if (/\bhoje\b|\bhj\b|\btoday\b|\btonight\b/.test(t)) return b;
  return null;
}

function explicitDate(t, b) {
  let m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(t);
  if (m && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) {
    let y = m[3] ? +m[3] : b.getFullYear();
    if (y < 100) y += 2000;
    const d = new Date(y, +m[2] - 1, +m[1]);
    if (!m[3] && d < b) d.setFullYear(y + 1);
    return d;
  }
  m = new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${MONTHS.map(fold).join('|')})\\b`).exec(t);
  if (m) {
    const d = new Date(b.getFullYear(), MONTHS.map(fold).indexOf(m[2]), +m[1]);
    if (d < b) d.setFullYear(d.getFullYear() + 1);
    return d;
  }
  m = new RegExp(`\\b(${MONTHS_EN.join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`).exec(t);
  if (m) {
    const d = new Date(b.getFullYear(), MONTHS_EN.indexOf(m[1]), +m[2]);
    if (d < b) d.setFullYear(d.getFullYear() + 1);
    return d;
  }
  m = new RegExp(`\\b(?:na |no |nesta |neste |essa |esse |proxima |proximo |on |next |this )?(${[...WEEKDAYS.map(fold), ...WEEKDAYS_EN].join('|')})(?:-feira)?\\b(\\s+que vem)?`).exec(t);
  if (m) {
    const want = WEEKDAYS_EN.includes(m[1]) ? WEEKDAYS_EN.indexOf(m[1]) : WEEKDAYS.map(fold).indexOf(m[1]);
    let diff = (want - b.getDay() + 7) % 7;
    if (diff === 0) diff = 7; // "sexta" said on a Friday means next Friday
    if (m[2] && diff < 7) diff += 0; // "sexta que vem": the coming one
    return new Date(b.getTime() + diff * 864e5);
  }
  m = /\bdia (\d{1,2})\b/.exec(t);
  if (m && +m[1] >= 1 && +m[1] <= 31) {
    const d = new Date(b.getFullYear(), b.getMonth(), +m[1]);
    if (d < b) d.setMonth(d.getMonth() + 1);
    return d;
  }
  return null;
}

function when(text, ts) {
  if (text.length > 800) return null;
  const t = fold(text);
  // Something has to happen: a plan word, or an explicit date + time.
  const date = findDate(t, new Date(ts));
  const time = findTime(t);
  if (!date || (!time && !/\b(reuniao|consulta|aniversario|festa|evento|jantar|almoco|encontro|prova|entrega|viagem|voo|show|churrasco|vencimento|vence|meeting|appointment|birthday|party|dinner|lunch|exam|flight|trip|deadline|due)/.test(t))) return null;
  const at = new Date(date);
  if (time) at.setHours(time[0], time[1], 0, 0); else at.setHours(9, 0, 0, 0);
  if (at.getTime() < Date.now() - 3600e3) return null; // only what's still ahead
  const title = text.replace(/\s+/g, ' ').trim().slice(0, 80);
  return { type: 'when', at: at.getTime(), allDay: !time, title };
}

const two = (n) => String(n).padStart(2, '0');
const gcal = (d) => `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}T${two(d.getHours())}${two(d.getMinutes())}00`;
const gday = (d) => `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}`;

export function calendarUrl(w, details = '') {
  const s = new Date(w.at);
  const dates = w.allDay
    ? `${gday(s)}/${gday(new Date(s.getTime() + 864e5))}`
    : `${gcal(s)}/${gcal(new Date(s.getTime() + 3600e3))}`;
  const q = new URLSearchParams({ action: 'TEMPLATE', text: w.title, dates, details });
  return `https://calendar.google.com/calendar/render?${q}`;
}

// ---------- Addresses ----------

const STREET = '(?:rua|r\\.|avenida|av\\.?|alameda|al\\.|travessa|tv\\.|rodovia|estrada|praça|praca|largo|viela|servidão)';
const STREET_EN = /\b\d{1,5}\s+[A-Z][\w.' -]{2,40}?\s(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Lane|Ln\.?|Drive|Dr\.?|Way|Place|Pl\.?)\b[^\n]{0,60}/;

function address(text) {
  const m = new RegExp(`\\b${STREET}\\s+[^,\\n]{3,60}?,?\\s*(?:n[º°o.]?\\s*)?\\d{1,5}[^\\n]{0,80}`, 'i').exec(text) || STREET_EN.exec(text);
  const cep = /\b\d{5}-?\d{3}\b/.exec(text);
  if (!m && !(cep && /\bcep\b/i.test(text))) return null;
  let a = (m ? m[0] : text.slice(Math.max(0, cep.index - 60), cep.index + 9)).trim();
  // End at the sentence, but not at the "." of "Av." / "R." near the start.
  const end = a.slice(8).search(/[;!?]|\.(\s|$)/);
  if (end >= 0) a = a.slice(0, end + 8);
  a = a.replace(/\s+/g, ' ').replace(/[,.\s-]+$/, '');
  return { type: 'place', address: a };
}

export const mapsUrl = (a) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a)}`;

// ---------- All of it ----------

const cache = new Map();

/** Everything worth a card in this message text (at most one of each kind). */
export function smartItems(text, ts = Date.now()) {
  if (!text || text.length > 4000) return [];
  const key = `${ts}:${text}`;
  if (cache.has(key)) return cache.get(key);
  const out = [];
  const pix = pixCode(text);
  if (pix) out.push(pix);
  else { const k = pixKey(text); if (k) out.push(k); }
  const code = !pix && otp(text);
  if (code) out.push(code);
  const tr = !pix && tracking(text);
  if (tr) out.push(tr);
  const w = !code && when(text, ts);
  if (w) out.push(w);
  const place = !pix && address(text);
  if (place) out.push(place);
  if (cache.size > 2000) cache.clear();
  cache.set(key, out);
  return out;
}

export const brl = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
