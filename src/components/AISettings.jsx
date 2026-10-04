// Settings → AI: where LM Studio is, which model, and what uses it.
import { useEffect, useState } from 'react';
import { usePrefs, setPref } from '../prefs.js';
import { aiPrefs, aiAvailable, aiStatus, aiErrorText } from '../ai.js';
import { Spark } from './SummaryCard.jsx';

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

export default function AISettings() {
  const p = aiPrefs(usePrefs());
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
          <b>Summaries from your local AI</b>
          <p>
            Relay can use <a href="https://lmstudio.ai" target="_blank" rel="noreferrer">LM Studio</a> to answer “What did I miss?” and
            to put together a daily digest of your busiest groups. Messages go straight to LM Studio, on this computer or one you
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
        <Toggle label="Daily digest" hint="A button in the chat list that summarizes, one by one, the groups with the most unread messages."
          checked={p.aiDigest} disabled={off} onChange={(v) => setPref('aiDigest', v)} />
      </Group>
    </>
  );
}
