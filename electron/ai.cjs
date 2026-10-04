// Local AI: LM Studio (OpenAI-compatible API, port 1234 by default), usually on this computer.
//
// Requests are made here in the main process, not in the page, so the renderer's CSP and
// LM Studio's CORS settings don't matter. Answers stream back token by token over
// `ai:chunk` ({ id, delta } … { id, done } | { id, error }).

const { ipcMain } = require('electron');

// Tried in order when the host is "auto". Anything else (another computer on the
// network) is typed in Settings → AI.
const DEFAULT_HOSTS = ['http://localhost:1234', 'http://127.0.0.1:1234'];
const LIST_TIMEOUT = 4000;
const FIRST_TOKEN_TIMEOUT = 180 * 1000; // a model that isn't loaded yet has to load first
const IDLE_TIMEOUT = 60 * 1000;

const running = new Map(); // request id → AbortController
let autoHost = null; // last host that answered during auto-detect, tried first next time

/** "localhost", "studio.local", "http://studio.local:1234/v1" → "http://host:port" */
function normalize(host) {
  let h = String(host || '').trim().replace(/\/+$/, '').replace(/\/v1$/, '');
  if (!h) return '';
  if (!/^https?:\/\//.test(h)) h = `http://${h}`;
  if (!/:\d+$/.test(h.replace(/^https?:\/\//, ''))) h += ':1234';
  return h;
}

/** Short machine-readable reason; the renderer turns it into a sentence. */
function describe(err) {
  const code = err?.cause?.code || err?.code;
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') return 'timeout';
  if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET'].includes(code)) return 'unreachable';
  if (err?.message === 'fetch failed') return 'unreachable'; // undici's catch-all for "couldn't connect"
  return String(err?.message || err || 'unknown error');
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(LIST_TIMEOUT) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function listModels(host) {
  // LM Studio's own API says which models are loaded; fall back to the OpenAI-style list.
  let native = null;
  try { native = await getJson(`${host}/api/v1/models`); } catch (err) {
    if (['unreachable', 'timeout'].includes(describe(err))) throw err; // nobody there: don't wait twice
  }
  if (Array.isArray(native?.models)) {
    return native.models
      .filter((m) => m.type !== 'embedding')
      .map((m) => ({ id: m.key, name: m.display_name || m.key, loaded: !!m.loaded_instances?.length, params: m.params_string || null }));
  }
  const j = await getJson(`${host}/v1/models`);
  return (j.data || []).filter((m) => !/embed/i.test(m.id)).map((m) => ({ id: m.id, name: m.id, loaded: null, params: null }));
}

/** Find a host that answers (the configured one, or the usual places) and what it has loaded. */
async function status(host) {
  const auto = !host || host === 'auto';
  const hosts = auto ? [...new Set([autoHost, ...DEFAULT_HOSTS].filter(Boolean))] : [normalize(host)];
  let error = 'unreachable';
  for (const h of hosts) {
    const t0 = Date.now();
    try {
      const models = await listModels(h);
      if (auto) autoHost = h;
      return { ok: true, host: h, latency: Date.now() - t0, models, loaded: models.filter((m) => m.loaded).map((m) => m.id) };
    } catch (err) {
      error = describe(err);
    }
  }
  return { ok: false, host: hosts[0], tried: hosts, error };
}

// Defaults per kind of request; the renderer can still override them.
const TASKS = {
  summary: { maxTokens: 900, temperature: 0.3 },
  translate: { maxTokens: 900, temperature: 0.1 },
};

/**
 * Generic streaming chat completion (summaries, translations).
 * `responseFormat` is passed through as OpenAI's `response_format` (LM Studio supports json_schema).
 */
async function complete(sender, { id, host, model, messages, task = 'summary', maxTokens, temperature, responseFormat }) {
  const defaults = TASKS[task] || TASKS.summary;
  maxTokens = maxTokens ?? defaults.maxTokens;
  temperature = temperature ?? defaults.temperature;
  const ctrl = new AbortController();
  running.set(id, ctrl);
  const emit = (payload) => { if (!sender.isDestroyed()) sender.send('ai:chunk', { id, ...payload }); };
  let timer = setTimeout(() => ctrl.abort(), FIRST_TOKEN_TIMEOUT);
  const alive = () => { clearTimeout(timer); timer = setTimeout(() => ctrl.abort(), IDLE_TIMEOUT); };
  let text = '';
  try {
    const res = await fetch(`${normalize(host)}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true, temperature, max_tokens: maxTokens, ...(responseFormat ? { response_format: responseFormat } : {}) }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      let msg = body;
      try { const j = JSON.parse(body); msg = j.error?.message || j.error || body; } catch {}
      throw new Error(`HTTP ${res.status}${msg ? `: ${String(msg).slice(0, 240)}` : ''}`);
    }
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body) {
      alive();
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let j;
        try { j = JSON.parse(data); } catch { continue; }
        if (j.error) throw new Error(j.error.message || String(j.error));
        // Reasoning models also stream `reasoning_content`; only the answer is shown.
        const delta = j.choices?.[0]?.delta?.content;
        if (delta) { text += delta; emit({ delta }); }
      }
    }
    emit({ done: true });
    return { ok: true, text };
  } catch (err) {
    const error = ctrl.cancelled ? 'cancelled' : ctrl.signal.aborted ? 'timeout' : describe(err);
    emit({ error });
    return { ok: false, error, text };
  } finally {
    clearTimeout(timer);
    running.delete(id);
  }
}

function init() {
  ipcMain.handle('ai:status', (_e, host) => status(host));
  ipcMain.handle('ai:complete', (e, opts) => complete(e.sender, opts));
  ipcMain.on('ai:cancel', (_e, id) => {
    const ctrl = running.get(id);
    if (ctrl) { ctrl.cancelled = true; ctrl.abort(); }
  });
}

module.exports = { init, status, normalize, DEFAULT_HOSTS };
