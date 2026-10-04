// Runs inside Relay's WhatsApp Web window (see calls.cjs). It only watches the page and presses
// buttons on request; WhatsApp Web itself does the calling. WhatsApp's markup has no stable ids,
// so everything goes by accessible labels (aria-label / title / text), in English and Portuguese.

const { ipcRenderer, contextBridge, webFrame } = require('electron');

// ---------- Notifications: forwarded to Relay instead of shown ----------
// Runs in the page's own world so WhatsApp's `new Notification()` hits it.
function pageHook() {
  const send = (title, opts) => window.postMessage({ __relayWa: 'notification', title: String(title || ''), body: String(opts?.body || '') }, location.origin);
  class RelayNotification extends EventTarget {
    constructor(title, opts = {}) { super(); this.title = title; this.body = opts.body || ''; this.tag = opts.tag || ''; send(title, opts); }
    close() {}
    set onclick(_) {} set onclose(_) {} set onerror(_) {} set onshow(_) {}
    static get permission() { return 'granted'; }
    static requestPermission(cb) { cb?.('granted'); return Promise.resolve('granted'); }
  }
  Object.defineProperty(window, 'Notification', { value: RelayNotification, configurable: true, writable: true });
  if (window.ServiceWorkerRegistration) {
    ServiceWorkerRegistration.prototype.showNotification = function (title, opts) { send(title, opts); return Promise.resolve(); };
  }
}
try {
  if (contextBridge.executeInMainWorld) contextBridge.executeInMainWorld({ func: pageHook });
  else webFrame.executeJavaScript(`(${pageHook})()`);
} catch {
  try { webFrame.executeJavaScript(`(${pageHook})()`); } catch {}
}
window.addEventListener('message', (e) => {
  if (e.source !== window || e.data?.__relayWa !== 'notification') return;
  ipcRenderer.send('wa:notification', { title: e.data.title, body: e.data.body });
});

// ---------- Reading the page ----------

const ACCEPT = /^(aceitar|atender|accept|answer)\b/i;
const DECLINE = /^(recusar|rejeitar|decline|ignorar|ignore|reject)\b/i;
const HANGUP = /^(encerrar|desligar|finalizar|sair da chamada|end call|end|leave call|leave|hang up)\b/i;
const VIDEO_CALL = /(chamada de v[ií]deo|liga[cç][aã]o de v[ií]deo|video call|^v[ií]deo$)/i;
const VOICE_CALL = /(chamada de voz|liga[cç][aã]o de voz|voice call|^voz$|^[aá]udio$)/i;
const CALL_MENU = /^(ligar|chamar|chamada|call|liga[cç][aã]o)$/i;
// Our own outgoing call that the other side hasn't picked up yet.
const CONNECTING = /\b(chamando|tocando|conectando|calling|ringing|connecting)\b/i;

const label = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim().replace(/\s+/g, ' ');
const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
const buttons = (root = document) => [...root.querySelectorAll('button, [role="button"], [role="menuitem"], li[tabindex]')].filter(visible);
const find = (re, root) => buttons(root).find((b) => re.test(label(b)));

function press(el) {
  if (!el) return false;
  const opts = { bubbles: true, cancelable: true, view: window };
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) el.dispatchEvent(new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, opts));
  el.click();
  return true;
}

function callerName(acceptBtn) {
  // Walk up from the answer button to the call card and take its first line that isn't a button.
  let node = acceptBtn;
  for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
    const lines = (node.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean)
      .filter((l) => !ACCEPT.test(l) && !DECLINE.test(l) && !/^(chamada|liga[cç][aã]o|whatsapp|call)/i.test(l));
    if (buttons(node).length >= 2 && lines.length) return lines[0].slice(0, 60);
  }
  return null;
}

function read() {
  const accept = find(ACCEPT);
  const decline = accept && find(DECLINE);
  const incoming = !!(accept && decline);
  const status = document.querySelector('#side, #pane-side') ? 'ready'
    : document.querySelector('[data-ref], canvas[aria-label]') ? 'qr' : 'loading';
  let video = false;
  if (incoming) {
    let node = accept;
    for (let i = 0; i < 6 && node; i++, node = node.parentElement) if (/v[ií]deo/i.test(node.innerText || '')) { video = true; break; }
  }
  const hangup = !incoming && find(HANGUP);
  return { status, incoming, video, name: incoming ? callerName(accept) : null, inCall: !!hangup, connecting: !!hangup && connectingNear(hangup) };
}

function connectingNear(hangupBtn) {
  // The call screen around the hang-up button says "Calling…" / "Ringing…" until it's answered.
  let node = hangupBtn;
  for (let i = 0; i < 6 && node; i++, node = node.parentElement) {
    const text = node.innerText || '';
    if (text.length > 400) break; // reached the whole page, not the call card
    if (CONNECTING.test(text)) return true;
  }
  return false;
}

let last = '';
function report() {
  const s = read();
  const json = JSON.stringify(s);
  if (json === last) return;
  last = json;
  ipcRenderer.send('wa:state', s);
}
let queued = false;
const schedule = () => { if (queued) return; queued = true; setTimeout(() => { queued = false; report(); }, 250); };
window.addEventListener('DOMContentLoaded', () => {
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'title'] });
  report();
});
setInterval(report, 2000);

// ---------- Commands from Relay ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 10000, every = 250) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(every); }
  return null;
}

function typeInto(box, text) {
  box.focus();
  if (box.tagName === 'INPUT') {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(box, text);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    document.execCommand('selectAll', false);
    document.execCommand('insertText', false, text);
  }
}

const chatOpen = () => document.querySelector('#main header');

const commands = {
  accept: () => press(find(ACCEPT)),
  decline: () => press(find(DECLINE)),
  hangup: () => press(find(HANGUP)),

  // Settings → Calls → "Test detection": everything Relay relies on, as the page sees it now.
  async diagnose() {
    const s = read();
    const header = chatOpen();
    const labels = header ? [...new Set(buttons(header).map(label).filter(Boolean))].slice(0, 14) : [];
    const pick = (re) => labels.find((l) => re.test(l)) || null;
    let waVersion = null;
    try { waVersion = await webFrame.executeJavaScript('(window.Debug && window.Debug.VERSION) || null'); } catch {}
    if (!waVersion) {
      try {
        for (let i = 0; i < localStorage.length && !waVersion; i++) {
          const k = localStorage.key(i);
          if (/version/i.test(k)) waVersion = (/2\.\d{4}\.\d+/.exec(localStorage.getItem(k) || '') || [])[0] || null;
        }
      } catch {}
    }
    const chatName = header ? (header.querySelector('span[title]')?.getAttribute('title') || header.querySelector('span[dir="auto"]')?.textContent || '').trim().slice(0, 60) : null;
    return {
      status: s.status, incoming: s.incoming, inCall: s.inCall,
      chat: header ? (chatName || '(no name)') : null,
      headerButtons: labels,
      voice: pick(VOICE_CALL), video: pick(VIDEO_CALL), menu: pick(CALL_MENU),
      now: { accept: !!find(ACCEPT), decline: !!find(DECLINE), hangup: !!find(HANGUP) },
      patterns: { accept: ACCEPT.source, decline: DECLINE.source, hangup: HANGUP.source, voice: VOICE_CALL.source, video: VIDEO_CALL.source, menu: CALL_MENU.source },
      waVersion, userAgent: navigator.userAgent,
    };
  },

  async openChatByName(name) {
    if (!name) return false;
    await waitFor(() => document.querySelector('#side'), 15000);
    const box = document.querySelector('#side [contenteditable="true"], #side input[type="text"], #side input:not([type])');
    if (!box) return false;
    typeInto(box, name);
    const want = name.toLowerCase();
    const row = await waitFor(() => {
      const rows = [...document.querySelectorAll('#pane-side [role="listitem"], #pane-side [role="row"], [role="grid"] [role="row"], [role="list"] [role="listitem"]')].filter(visible);
      return rows.find((r) => (r.innerText || '').toLowerCase().split('\n')[0].trim() === want)
        || rows.find((r) => (r.innerText || '').toLowerCase().includes(want));
    }, 6000);
    if (!row) return false;
    press(row.querySelector('[role="gridcell"], [tabindex]') || row);
    return !!(await waitFor(chatOpen, 6000));
  },

  async startCall(video) {
    const header = await waitFor(chatOpen, 15000);
    if (!header) return false;
    const direct = video ? VIDEO_CALL : VOICE_CALL;
    let btn = await waitFor(() => find(direct, header), 3000);
    if (!btn) {
      // Newer layout: one "Call" button with a menu of voice / video.
      const menu = find(CALL_MENU, header) || find(/liga|call/i, header);
      if (!menu) return false;
      press(menu);
      btn = await waitFor(() => find(direct), 3000);
    }
    return press(btn);
  },
};

ipcRenderer.on('wa:cmd', async (_e, { id, name, arg }) => {
  let result = null;
  try { result = await commands[name]?.(arg); } catch { result = null; }
  // Plain objects (diagnose) go through as they are; everything else is a yes/no.
  ipcRenderer.send('wa:cmd-result', { id, result: result && typeof result === 'object' ? result : !!result });
});

// After a deep-link reload the chat opens by itself; tell Relay so it can press "call".
if (/[?&]phone=/.test(location.search)) {
  waitFor(chatOpen, 30000).then((h) => { if (h) ipcRenderer.send('wa:chat-opened', location.search); });
}
