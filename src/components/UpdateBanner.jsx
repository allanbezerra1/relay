import { useUpdate } from '../update.js';

/** "Update ready" pill at the bottom of the chat list. */
export default function UpdateBanner() {
  const u = useUpdate();
  if (u.status !== 'ready') return null;
  return (
    <div className="update-banner">
      <span className="update-dot" />
      <span className="update-text">Relay {u.version} is ready</span>
      <button className="primary small" onClick={() => u.install()}>Restart</button>
    </div>
  );
}
