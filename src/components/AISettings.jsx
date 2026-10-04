// Settings → AI: where LM Studio is, which model, and what uses it.
import { useEffect, useState } from 'react';
import { usePrefs, setPref } from '../prefs.js';
import { aiPrefs, aiAvailable, aiStatus, aiErrorText } from '../ai.js';
import { Spark } from './SummaryCard.jsx';
import { langName } from '../translate.js';
import { askAvailable, updateIndex, useAskStatus } from '../ask.js';

const ASK_KEYS = window.relay?.platform === 'darwin' ? '⌘⇧A' : 'Ctrl+Shift+A';

/** Settings → AI → Ask Relay: on/off, embedding model, and the index on this computer. */
function AskSettings({ client, p, status, off }) {
  const st = useAskStatus();
  const [embedModels, setEmbedModels] = useState(null); // null = not asked yet
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => {
    if (!status?.ok) return;
    window.relay.ask.models(status.host).then((r) => setEmbedModels(r.ok ? r.models : [])).catch(() => setEmbedModels([]));
  }, [status?.ok, status?.host]); // eslint-disable-line react-hooks/exhaustive-deps
  const disabled = off || !p.aiAsk;
  const list = [...(embedModels || [])];
  if (p.aiEmbedModel && !list.some((m) => m.id === p.aiEmbedModel)) list.unshift({ id: p.aiEmbedModel, name: embedModels ? `${p.aiEmbedModel} (not found)` : p.aiEmbedModel });
  const first = embedModels?.[0]?.id;
  const working = st?.reading || st?.busy;
  const pct = st?.busy?.total ? Math.round((st.busy.done / st.busy.total) * 100) : null;

  return (
    <Group title="Ask Relay">
      <Toggle label="Ask Relay" hint={`Ask anything about your chats and get an answer that cites the messages. Open it with ${ASK_KEYS} or from the chat list search.`}
        checked={p.aiAsk} disabled={off} onChange={(v) => setPref('aiAsk', v)} />
      <div className={`setting ${disabled ? 'disabled' : ''}`}>
        <span className="setting-text">
          <span className="setting-label">Embedding model</span>
          <span className="setting-hint">
            {embedModels && !embedModels.length
              ? 'LM Studio has no embedding model, so Ask Relay searches by keywords. Download one in LM Studio (search for “embed”) to search by meaning.'
              : <>{first && !p.aiEmbedModel ? <>Automatic uses <b>{first.split('/').pop()}</b>, the first embedding model in LM Studio. </> : null}
                  Turns your messages into vectors so Ask Relay can search by meaning. Changing it rebuilds the index.</>}
          </span>
        </span>
        <select className="ai-select" value={p.aiEmbedModel} disabled={disabled} onChange={(e) => { setPref('aiEmbedModel', e.target.value); updateIndex(client).catch(() => {}); }}>
          <option value="">Automatic</option>
          {list.map((m) => <option key={m.id} value={m.id}>{m.name}{m.loaded ? ' — loaded' : ''}</option>)}
        </select>
      </div>
      <div className={`setting ${disabled ? 'disabled' : ''}`}>
        <span className="setting-text">
          <span className="setting-label">Index on this computer</span>
          <span className="ask-settings-status">
            {!st ? '…'
              : st.reading ? `Reading your chats… ${st.reading.done} of ${st.reading.total}`
              : st.busy ? `Indexing… ${pct}%`
              : st.ready ? <><b>{st.messages.toLocaleString()}</b> messages from <b>{st.rooms}</b> {st.rooms === 1 ? 'chat' : 'chats'}
                  {st.embedded < st.chunks ? ` · ${st.embedded ? `${Math.round((st.embedded / st.chunks) * 100)}% searchable by meaning` : 'keywords only'}` : ''}</>
              : 'Not built yet. It builds on its own shortly after Relay starts.'}
          </span>
        </span>
        <span className="ask-settings-actions">
          <button className="ai-ghost" disabled={disabled || !!working} onClick={() => updateIndex(client).catch(() => {})}>Update now</button>
          {confirmClear
            ? <button className="ai-ghost" onClick={() => { window.relay.ask.clear(); setConfirmClear(false); }}>Delete index?</button>
            : <button className="ai-ghost" disabled={!st?.ready || !!working} onClick={() => setConfirmClear(true)}>Delete</button>}
        </span>
      </div>
    </Group>
  );
}

// Same markup as Settings' own rows, so they look identical.
function Toggle({ label, hint, checked, onChange, disabled }) {
  return (
    <label className={`setting ${disabled ? 'disabled' : ''}`}>
      <span className="setting-text">
        <span className="setting-label">{label}</span>
        {hint && <span className="setting-hint">{hint}</span>}
      </span>
      <span className={`switch ${checked ? 'on' : ''}`}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <i />
      </span>
    </label>
  );
}

const Group = ({ title, children }) => (
  <section className="group">{title && <h3>{title}</h3>}<div className="group-body">{children}</div></section>
);

const THRESHOLDS = [5, 10, 15, 30, 50];
// Languages to translate into ("" = the system language).
const LANGUAGES = ['en', 'es', 'pt-BR', 'pt-PT', 'fr', 'de', 'it', 'nl', 'pl', 'tr', 'ru', 'uk', 'ar', 'he', 'hi', 'ja', 'ko', 'zh-CN', 'zh-TW'];

export default function AISettings({ client }) {
  const all = usePrefs();
  const p = aiPrefs(all);
  const [hostDraft, setHostDraft] = useState(p.aiHost === 'auto' ? '' : p.aiHost);
  const [status, setStatus] = useState(null); // null | 'testing' | result of ai:status
  const [models, setModels] = useState([]);

  const test = async () => {
    setStatus('testing');
    const s = await aiStatus({ fresh: true }).catch(() => ({ ok: false, error: 'unreachable' }));
    setStatus(s);
    if (s.ok) setModels(s.models);
  };
  useEffect(() => { if (aiAvailable()) test(); }, [p.aiHost]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!aiAvailable()) {
    return (<><h2 className="pane-title">AI</h2><p className="pane-text muted">Local AI is only available in the Relay desktop app.</p></>);
  }

  const commitHost = () => setPref('aiHost', hostDraft.trim() || 'auto');
  const loaded = status?.ok ? status.loaded : [];
  const firstLoaded = loaded[0] || (status?.ok ? status.models[0]?.id : null);
  const modelList = [...models];
  if (p.aiModel && !modelList.some((m) => m.id === p.aiModel)) {
    modelList.unshift({ id: p.aiModel, name: status?.ok ? `${p.aiModel} (not found)` : p.aiModel, loaded: false });
  }
  const off = !p.aiEnabled;

  return (
    <>
      <h2 className="pane-title">AI</h2>
      <div className="ai-hero">
        <span className="ai-orb big"><Spark size={22} /></span>
        <div>
          <b>Summaries and translations from your local AI</b>
          <p>
            Relay can use <a href="https://lmstudio.ai" target="_blank" rel="noreferrer">LM Studio</a> to answer “What did I miss?”,
            to put together a daily digest of your busiest groups, to translate messages, and to answer questions about your chats with Ask Relay. Messages go straight to LM Studio, on this computer or one you
            choose on your network. Nothing is sent to the cloud.
          </p>
        </div>
      </div>

      <Group>
        <Toggle label="Use local AI" hint="Shows the Summarize button in chats once LM Studio answers."
          checked={p.aiEnabled} onChange={(v) => setPref('aiEnabled', v)} />
      </Group>

      <Group title="Connection">
        <div className={`setting ai-host-row ${off ? 'disabled' : ''}`}>
          <span className="setting-text">
            <span className="setting-label">LM Studio address</span>
            <span className="setting-hint">Leave empty to use LM Studio on this computer (localhost:1234). Start its server in LM Studio’s Developer tab.</span>
          </span>
          <input className="ai-host-input" value={hostDraft} placeholder="localhost:1234" spellCheck={false} disabled={off}
            onChange={(e) => setHostDraft(e.target.value)} onBlur={commitHost} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
        </div>
        <div className={`setting ai-test-row ${off ? 'disabled' : ''}`}>
          <span className="setting-text">
            {status === 'testing' && <span className="ai-status wait"><i />Testing the connection…</span>}
            {status && status !== 'testing' && status.ok && (
              <span className="ai-status ok"><i />Connected to <b>{status.host.replace(/^https?:\/\//, '')}</b> · {status.latency} ms
                {loaded.length ? <> · loaded: <b>{loaded.join(', ')}</b></> : ' · no model loaded'}</span>
            )}
            {status && status !== 'testing' && !status.ok && <span className="ai-status bad"><i />{aiErrorText(status.error, status.host)}</span>}
          </span>
          <button className="ai-ghost" onClick={test} disabled={status === 'testing' || off}>Test</button>
        </div>
      </Group>

      <Group title="Model">
        <div className={`setting ${off ? 'disabled' : ''}`}>
          <span className="setting-text">
            <span className="setting-label">Model for summaries</span>
            <span className="setting-hint">
              {firstLoaded && !p.aiModel ? <>Automatic uses <b>{firstLoaded.split('/').pop()}</b>, the first model loaded in LM Studio. </> : null}
              A loaded model answers right away; others load on first use.
            </span>
          </span>
          <select className="ai-select" value={p.aiModel} disabled={off} onChange={(e) => setPref('aiModel', e.target.value)}>
            <option value="">Automatic</option>
            {modelList.map((m) => (
              <option key={m.id} value={m.id}>{m.name}{m.loaded ? ' — loaded' : ''}</option>
            ))}
          </select>
        </div>
      </Group>

      <Group title="Where to use it">
        <div className={`setting ${off ? 'disabled' : ''}`}>
          <span className="setting-text">
            <span className="setting-label">Offer summaries after</span>
            <span className="setting-hint">With this many unread messages, the chat header shows a “Summarize” button with the count.</span>
          </span>
          <div className="seg">
            {THRESHOLDS.map((n) => (
              <button key={n} className={p.aiThreshold === n ? 'on' : ''} disabled={off} onClick={() => setPref('aiThreshold', n)}>{n}</button>
            ))}
          </div>
        </div>
        <Toggle label="Daily digest" hint="Summarizes, one by one, the groups with the most unread messages (from the Good morning panel, or its own button when that’s off)."
          checked={p.aiDigest} disabled={off} onChange={(v) => setPref('aiDigest', v)} />
        <Toggle label="Check Reply and Waiting" hint="Double-checks which chats need an answer and writes a one-line reason under each."
          checked={all.triageAI !== false} disabled={off || all.triage === false} onChange={(v) => setPref('triageAI', v)} />
        <Toggle label="Write the Good morning briefing" hint="Otherwise the briefing is a plain list."
          checked={all.briefingAI !== false} disabled={off || all.briefing === false} onChange={(v) => setPref('briefingAI', v)} />
      </Group>

      <Group title="Translation">
        <Toggle label="Offer translations" hint="A “Translate” button under messages written in another language, and “Translate” and “Auto” at the top of the chat."
          checked={p.aiTranslate} disabled={off} onChange={(v) => setPref('aiTranslate', v)} />
        <div className={`setting ${off ? 'disabled' : ''}`}>
          <span className="setting-text">
            <span className="setting-label">Translate into</span>
            <span className="setting-hint">
              The language you read in{p.aiTranslateTo ? '' : <>: <b>{langName(navigator.language || 'en')}</b>, from your system</>}.
              With “Auto” on in a chat, what you write there is sent in that chat’s language.
            </span>
          </span>
          <select className="ai-select" value={p.aiTranslateTo} disabled={off} onChange={(e) => setPref('aiTranslateTo', e.target.value)}>
            <option value="">System language</option>
            {LANGUAGES.map((l) => <option key={l} value={l}>{langName(l)}</option>)}
          </select>
        </div>
      </Group>

      {askAvailable() && client && <AskSettings client={client} p={p} status={status && status !== 'testing' ? status : null} off={off} />}
    </>
  );
}
