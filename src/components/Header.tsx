interface HeaderProps {
  online: boolean;
  chatUnlocked: boolean;
  statusLabel: string;
  onOpenSettings: () => void;
}

export function Header({ online, chatUnlocked, statusLabel, onOpenSettings }: HeaderProps) {
  return (
    <header className="mobile-header glass-panel">
      <div className="mobile-header__brand">
        <img className="mobile-header__logo" src="/icons/icon-192.png" alt="Zaya Pocket" />
        <div className="mobile-header__text">
          <p className="eyebrow">Zaya Pocket</p>
          <h1>Zaya Pocket</h1>
        </div>
      </div>

      <div className={`status-pill ${chatUnlocked ? 'status-pill--ready' : !online ? 'status-pill--offline' : ''}`}>
        {statusLabel}
      </div>

      <button className="icon-button" type="button" aria-label="Open settings" onClick={onOpenSettings}>
        ⚙️
      </button>
    </header>
  );
}
