interface InstallCardProps {
  canPrompt: boolean;
  showIosHint: boolean;
  onInstall: () => void | Promise<void>;
}

export function InstallCard({ canPrompt, showIosHint, onInstall }: InstallCardProps) {
  if (!canPrompt && !showIosHint) {
    return null;
  }

  return (
    <section className="install-card card">
      <div>
        <p className="eyebrow">Install target</p>
        <h2>Put Zaya on your Home Screen</h2>
        <p>
          The app works best once installed, because the shell and local chat data stay right on the device.
        </p>
      </div>
      {canPrompt ? (
        <button className="button button--secondary" onClick={() => void onInstall()}>
          Install now
        </button>
      ) : (
        <p className="install-card__hint">
          On iPhone Safari, tap <strong>Share</strong> then <strong>Add to Home Screen</strong>.
        </p>
      )}
    </section>
  );
}
