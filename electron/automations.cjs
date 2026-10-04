// Automations (src/automations.js): POST a matching message to the user's webhook (n8n, Zapier…).
// From the main process rather than the page so CORS doesn't get in the way.

const { ipcMain } = require('electron');

async function webhook(url, payload) {
  if (!/^https?:\/\//.test(String(url))) return { ok: false, error: 'Invalid URL' };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Relay' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: String(err?.cause?.code || err?.message || err) };
  }
}

function init() {
  ipcMain.handle('auto:webhook', (_e, url, payload) => webhook(url, payload));
}

module.exports = { init };
