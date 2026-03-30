import { MODEL_OPTIONS } from '@/constants/models';
import type { EngineState } from '@/types/chat';

interface ModelPanelProps {
  selectedModelId: string;
  onSelect: (modelId: string) => void;
  onWarmup: () => void | Promise<void>;
  onDeleteCache: () => void | Promise<void>;
  progressText: string;
  progressValue: number;
  cached: boolean;
  busy: boolean;
  supported: boolean;
  online: boolean;
  engineState: EngineState;
}

export function ModelPanel({
  selectedModelId,
  onSelect,
  onWarmup,
  onDeleteCache,
  progressText,
  progressValue,
  cached,
  busy,
  supported,
  online,
  engineState,
}: ModelPanelProps) {
  const buttonLabel = busy
    ? cached
      ? 'Loading offline model…'
      : 'Downloading offline model…'
    : cached
      ? engineState === 'ready'
        ? 'Offline model is ready'
        : 'Load downloaded model'
      : online
        ? 'Download offline model'
        : 'Connect to download first';

  return (
    <section className="sheet-card stack-md">
      <div>
        <p className="eyebrow">Offline setup</p>
        <h2>Choose your local brain</h2>
        <p>Start with Starter. The larger model can wait until the device proves stable.</p>
      </div>

      <div className="sheet-models" aria-label="Offline models">
        {MODEL_OPTIONS.map((model) => {
          const selected = selectedModelId === model.id;
          return (
            <button
              key={model.id}
              type="button"
              className={`sheet-model ${selected ? 'sheet-model--selected' : ''}`}
              onClick={() => onSelect(model.id)}
              disabled={busy}
              aria-pressed={selected}
            >
              <div className="sheet-model__topline">
                <strong>{model.name}</strong>
                <span>{model.sizeLabel}</span>
              </div>
              <p>{model.description}</p>
              <small>{model.memoryLabel}</small>
            </button>
          );
        })}
      </div>

      <div className="progress-block" aria-live="polite">
        <div className="progress-block__header">
          <span>{progressText}</span>
          <span>{Math.round(progressValue * 100)}%</span>
        </div>
        <div className="progress-bar" aria-hidden="true">
          <span style={{ width: `${Math.round(progressValue * 100)}%` }} />
        </div>
      </div>

      <div className="button-row">
        <button
          className="button"
          type="button"
          onClick={() => void onWarmup()}
          disabled={busy || !supported || (!cached && !online) || engineState === 'ready'}
        >
          {buttonLabel}
        </button>
        <button className="button button--ghost" type="button" onClick={() => void onDeleteCache()} disabled={busy || !cached}>
          Remove downloaded brain
        </button>
      </div>
    </section>
  );
}
