import { useEffect, useRef, useState } from 'react';
import Logo from './Logo.jsx';
import NetIcon from './NetIcon.jsx';
import Login from './Login.jsx';
import LocalSetup, { useLocalSetup } from './LocalSetup.jsx';
import { RestoreDialog } from './BackupPanel.jsx';
import { hasLocal } from '../local.js';
import { usePrefs, setPref, ACCENTS } from '../prefs.js';

const KEY = 'relay.onboarded';
export const hasOnboarded = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const markOnboarded = () => { try { localStorage.setItem(KEY, '1'); } catch {} };

const NETS = ['whatsapp', 'whatsappBusiness', 'telegram', 'discord', 'signal', 'instagram', 'messenger', 'imessage'];

function Dots({ step, total }) {
  return <div className="ob-dots">{Array.from({ length: total }, (_, i) => <i key={i} className={i === step ? 'on' : i < step ? 'done' : ''} />)}</div>;
}

function Welcome({ next }) {
  const [restore, setRestore] = useState(false);
  return (
    <div className="ob-step center">
      <div className="ob-logo"><Logo size={112} /></div>
      <h1>Welcome to Relay</h1>
      <p className="ob-lead">All your chats in one calm inbox.</p>
      <div className="ob-nets">
        {NETS.map((n, i) => <span key={n} style={{ animationDelay: `${0.25 + i * 0.06}s` }}><NetIcon id={n} variant="tile" size={40} /></span>)}
      </div>
      <button className="primary ob-cta" onClick={next}>Get started</button>
      {window.relay?.backup && <button className="ghost ob-restore" onClick={() => setRestore(true)}>Used Relay on another computer? Restore a backup</button>}
      {restore && <RestoreDialog onClose={() => setRestore(false)} />}
    </div>
  );
}

function HowItWorks({ next, back }) {
  const items = [
    ['🖥️', 'Runs on your Mac', 'Relay runs its own small chat server right here. No Beeper, no cloud, no extra account.'],
    ['🔗', 'Your accounts, your numbers', 'Link WhatsApp (also Business), Telegram, Signal, Discord, Instagram and more, each as a linked device, like WhatsApp Web.'],
    ['🔒', 'Private by design', 'Messages, contacts and logins never leave this computer. Voice transcription runs locally too.'],
  ];
  return (
    <div className="ob-step">
      <h2>How Relay works</h2>
      <div className="ob-cards">
        {items.map(([icon, title, text], i) => (
          <div key={title} className="ob-card" style={{ animationDelay: `${i * 0.08}s` }}>
            <span className="ob-card-icon">{icon}</span>
            <div><b>{title}</b><p>{text}</p></div>
          </div>
        ))}
      </div>
      <div className="ob-nav"><button className="ghost" onClick={back}>Back</button><button className="primary" onClick={next}>Continue</button></div>
    </div>
  );
}

function MakeItYours({ next, back }) {
  const p = usePrefs();
  const [openAtLogin, setOpenAtLogin] = useState(false);
  useEffect(() => { window.relay.getOpenAtLogin?.().then(setOpenAtLogin); }, []);
  return (
    <div className="ob-step">
      <h2>Make it yours</h2>
      <p className="ob-sub">You can change all of this later in Settings.</p>
      <div className="ob-label">Appearance</div>
      <div className="themes ob-themes">
        {[['system', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']].map(([v, label]) => (
          <button key={v} className={`theme-card ${p.theme === v ? 'on' : ''}`} onClick={() => setPref('theme', v)}>
            <span className={`theme-preview ${v}`}><i /><i /><i /></span>{label}
          </button>
        ))}
      </div>
      <div className="ob-label">Accent color</div>
      <div className="swatches">
        {Object.entries(ACCENTS).map(([k, a]) => (
          <button key={k} className={`swatch ${p.accent === k ? 'on' : ''}`} style={{ '--a': a.a, '--b': a.b }} title={a.name} onClick={() => setPref('accent', k)} />
        ))}
      </div>
      <div className="ob-label">Keep in touch</div>
      <label className="ob-toggle">
        <span><b>Open Relay when I log in</b><small>Your chats keep syncing while the Mac is on.</small></span>
        <span className={`switch ${openAtLogin ? 'on' : ''}`}><input type="checkbox" checked={openAtLogin} onChange={(e) => { setOpenAtLogin(e.target.checked); window.relay.setOpenAtLogin?.(e.target.checked); }} /><i /></span>
      </label>
      <label className="ob-toggle">
        <span><b>Interface sounds</b><small>Soft sounds when sending, receiving and reacting.</small></span>
        <span className={`switch ${p.interfaceSounds ? 'on' : ''}`}><input type="checkbox" checked={p.interfaceSounds} onChange={(e) => setPref('interfaceSounds', e.target.checked)} /><i /></span>
      </label>
      <div className="ob-nav"><button className="ghost" onClick={back}>Back</button><button className="primary" onClick={next}>Continue</button></div>
    </div>
  );
}

/** Last step: the setup animation; goes in by itself once everything is ready. */
function Finish({ setup, onLogin }) {
  const entered = useRef(false);
  useEffect(() => {
    if (!setup.session || entered.current) return;
    entered.current = true;
    setTimeout(() => onLogin(setup.session), 700); // let "Ready!" show for a moment
  }, [setup.session]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="ob-step center"><LocalSetup setup={setup} /></div>;
}

/** Small "setting up…" line under the intro screens while the install runs in the background. */
function SetupPill({ setup }) {
  if (setup.error) return <div className="ob-pill error-text">Setup hit a problem, see the last step.</div>;
  if (setup.session) return <div className="ob-pill">✓ Relay is ready</div>;
  return <div className="ob-pill"><span className="spinner small" />Setting up in the background…</div>;
}

/** First run: Relay starts setting itself up right away while you go through a few screens. */
export default function Onboarding({ onLogin, initialError }) {
  if (!hasLocal()) return <Login onLogin={onLogin} initialError={initialError} />;
  return <LocalOnboarding onLogin={onLogin} />;
}

function LocalOnboarding({ onLogin }) {
  const returning = hasOnboarded();
  const setup = useLocalSetup();
  const [step, setStep] = useState(returning ? 3 : 0);
  const next = () => setStep((s) => s + 1);
  const back = () => setStep((s) => Math.max(0, s - 1));
  useEffect(() => { if (step >= 3) markOnboarded(); }, [step]);

  return (
    <div className="onboarding">
      <div className="drag-region" />
      <div className="ob-frame" key={step}>
        {step === 0 && <Welcome next={next} />}
        {step === 1 && <HowItWorks next={next} back={back} />}
        {step === 2 && <MakeItYours next={next} back={back} />}
        {step === 3 && <Finish setup={setup} onLogin={onLogin} />}
      </div>
      {step < 3 && <SetupPill setup={setup} />}
      {!returning && <Dots step={step} total={4} />}
    </div>
  );
}
