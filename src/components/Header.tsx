import type { EngineState } from '@/types/chat';

interface HeaderProps {
  engineState: EngineState;
  cachedModel: boolean;
  onOpenSettings: () => void;
}

function getStatusLabel(engineState: EngineState, cachedModel: boolean): string {
  if (engineState === 'loading') return 'setting up';
  if (engineState === 'ready' && cachedModel) return 'ready';
  if (engineState === 'error') return 'needs attention';
  if (cachedModel) return 'ready';
  return 'setup needed';
}

function getStatusTone(engineState: EngineState, cachedModel: boolean): 'default' | 'success' | 'warning' | 'danger' {
  if (engineState === 'loading') return 'warning';
  if (engineState === 'ready' && cachedModel) return 'success';
  if (engineState === 'error') return 'danger';
  if (cachedModel) return 'success';
  return 'default';
}

export function Header({ engineState, cachedModel, onOpenSettings }: HeaderProps) {
  const label = getStatusLabel(engineState, cachedModel);
  const tone = getStatusTone(engineState, cachedModel);

  return (
    <header className="header-bar" aria-label="Zaya Pocket header">
      <div className="header-bar__brand">
        <img className="header-bar__logo" src="/icons/icon-192.png" alt="Zaya Pocket" />
        <div className="header-bar__copy">
          <p className="eyebrow">Zaya Pocket</p>
          <h1>Zaya Pocket</h1>
        </div>
      </div>

      <div className="header-bar__actions">
        <span className={`header-status header-status--${tone}`}>{label}</span>
        <button
          type="button"
          className="header-icon-button"
          aria-label="Open settings"
          onClick={onOpenSettings}
        >
          ⚙
        </button>
      </div>
    </header>
  );
}
