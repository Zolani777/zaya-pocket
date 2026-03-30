interface HeaderProps {
  online: boolean;
  chatUnlocked: boolean;
  onOpenSettings: () => void;
}

export function Header({ online, chatUnlocked, onOpenSettings }: HeaderProps) {
  return (
    <header className="mobile-header glass-panel">
      <div className="mobile-header__brand">
        <img className="mobile-header__logo" src="/icons/icon-192.png" alt="Zaya Pocket" />
        <div className="mobile-header__text">
          <p className="eyebrow">Zaya Pocket</p>
          <h1>Zaya Pocket</h1>
        </div>
      </div>

      <div className={`status-pill ${chatUnlocked ? 'status-pill--ready' : online ? '' : 'status-pill--offline'}`}>
        {chatUnlocked ? 'ready' : online ? 'setup needed' : 'offline'}
      </div>

      <button className="icon-button" type="button" aria-label="Open settings" onClick={onOpenSettings}>
        ⚙️
      </button>
    </header>
  );
}
