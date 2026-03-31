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
  engineState: EngineState;
}

function getButtonLabel(engineState: EngineState, cached: boolean): string {
  if (engineState === 'downloading') return 'Downloading…';
  if (engineState === 'verifying') return 'Verifying…';
  if (engineState === 'loading') return 'Loading cached model…';
  if (engineState === 'initializing') return 'Initializing…';
  if (engineState === 'interrupted') return cached ? 'Resume loading cached model' : 'Restart offline setup';
  if (engineState === 'failed') return cached ? 'Try loading downloaded model again' : 'Retry offline setup';
  if (engineState === 'downloaded') return 'Load downloaded model';
  if (engineState === 'ready' || engineState === 'generating') return 'Offline model is ready';
  return cached ? 'Load downloaded model' : 'Download offline model';
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
  engineState,
}: ModelPanelProps) {
  const buttonLabel = getButtonLabel(engineState, cached);

  return (
    <section className="sheet-card stack-md">
      <div>
        <p className="eyebrow">Offline setup</p>
        <h2>Choose your local brain</h2>
        <p>Start with Starter. The larger model can wait until the device proves stable.</p>
      </div>

      <div className="sheet-models">
        {MODEL_OPTIONS.map((model) => {
          const selected = selectedModelId === model.id;
          return (
            <button
              key={model.id}
              type="button"
              className={`sheet-model ${selected ? 'sheet-model--selected' : ''}`}
              onClick={() => {
                if (!busy) onSelect(model.id);
              }}
              disabled={busy}
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
        <button className="button" type="button" onClick={() => void onWarmup()} disabled={busy || !supported || engineState === 'ready' || engineState === 'generating'}>
          {buttonLabel}
        </button>
        <button className="button button--ghost" type="button" onClick={() => void onDeleteCache()} disabled={busy || !cached}>
          Remove downloaded brain
        </button>
      </div>
    </section>
  );
}
