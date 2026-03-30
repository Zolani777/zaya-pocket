import { StatusPill } from '@/components/StatusPill';
import type { EngineState } from '@/types/chat';

interface HeaderProps {
  engineState: EngineState;
  cachedModel: boolean;
  panelOpen: boolean;
  onTogglePanel: () => void;
  onOpenSettings: () => void;
}

function getAppStateLabel(engineState: EngineState, cachedModel: boolean): { label: string; tone: 'default' | 'success' | 'warning' | 'danger' } {
  if (engineState === 'loading') {
    return { label: 'setting up', tone: 'warning' };
  }

  if (engineState === 'ready') {
    return { label: 'local ready', tone: 'success' };
  }

  if (engineState === 'error') {
    return { label: 'needs attention', tone: 'danger' };
  }

  if (cachedModel) {
    return { label: 'downloaded', tone: 'success' };
  }

  return { label: 'setup needed', tone: 'default' };
}

export function Header({
  engineState,
  cachedModel,
  panelOpen,
  onTogglePanel,
  onOpenSettings,
}: HeaderProps) {
  const appState = getAppStateLabel(engineState, cachedModel);

  return (
    <header className="appbar">
      <div className="appbar__group appbar__group--brand">
        <button
          type="button"
          className="icon-button"
          onClick={onTogglePanel}
          aria-label={panelOpen ? 'Close sidebar' : 'Open sidebar'}
          aria-expanded={panelOpen}
        >
          {panelOpen ? '×' : '☰'}
        </button>

        <div className="brand brand--compact">
          <img className="brand__logo brand__logo--compact" src="/icons/icon-192.png" alt="Zaya Pocket logo" />
          <div>
            <p className="eyebrow">Zaya Pocket</p>
            <h1>Local chat</h1>
          </div>
        </div>
      </div>

      <div className="appbar__group appbar__group--end" aria-live="polite">
        <StatusPill label={appState.label} tone={appState.tone} />
        <button type="button" className="icon-button" onClick={onOpenSettings} aria-label="Open offline setup">
          ⚙
        </button>
      </div>
    </header>
  );
}
