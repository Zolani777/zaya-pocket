import { StatusPill } from '@/components/StatusPill';
import type { EngineState } from '@/types/chat';

interface HeaderProps {
  engineState: EngineState;
  online: boolean;
  cachedModel: boolean;
}

function getEngineLabel(engineState: EngineState): { label: string; tone: 'default' | 'success' | 'warning' | 'danger' } {
  switch (engineState) {
    case 'ready':
      return { label: 'local model ready', tone: 'success' };
    case 'loading':
      return { label: 'loading model', tone: 'warning' };
    case 'error':
      return { label: 'model error', tone: 'danger' };
    default:
      return { label: 'model idle', tone: 'default' };
  }
}

export function Header({ engineState, online, cachedModel }: HeaderProps) {
  const engine = getEngineLabel(engineState);

  return (
    <header className="topbar card">
      <div className="brand">
        <img className="brand__logo" src="/icons/icon-192.png" alt="Zaya Pocket logo" />
        <div>
          <p className="eyebrow">Offline-first pocket AI</p>
          <h1>Zaya Pocket</h1>
        </div>
      </div>
      <div className="topbar__status" aria-live="polite">
        <StatusPill label={online ? 'online' : 'offline'} tone={online ? 'success' : 'warning'} />
        <StatusPill label={cachedModel ? 'model cached' : 'model not cached'} tone={cachedModel ? 'success' : 'default'} />
        <StatusPill label={engine.label} tone={engine.tone} />
      </div>
    </header>
  );
}
