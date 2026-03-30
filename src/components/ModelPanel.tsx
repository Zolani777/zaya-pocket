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

function getPrimaryLabel(cached: boolean, engineState: EngineState) {
  if (engineState === 'loading') return 'Preparing…';
  if (cached) return 'Load downloaded brain';
  return 'Enable offline chat';
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
  return (
    <section className="panel-section stack-md">
      <div>
        <p className="eyebrow">Offline setup</p>
        <h2>Choose your local brain</h2>
        <p>Starter is the best first setup. You can upgrade later once the device proves stable.</p>
      </div>

      <div className="model-grid" role="radiogroup" aria-label="Available models">
        {MODEL_OPTIONS.map((model) => {
          const selected = selectedModelId === model.id;
          return (
            <button
              key={model.id}
              type="button"
              className={`model-card ${selected ? 'model-card--selected' : ''}`}
              onClick={() => onSelect(model.id)}
              aria-pressed={selected}
            >
              <div className="model-card__topline">
                <strong>{model.name}</strong>
                {model.recommended ? <span className="model-badge">Best first</span> : null}
              </div>
              <div className="model-subline">
                <span>{model.sizeLabel}</span>
                <span>{model.memoryLabel}</span>
              </div>
              <p>{model.description}</p>
              {model.caution ? <p className="model-caution">{model.caution}</p> : null}
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
        <button className="button" onClick={() => void onWarmup()} disabled={busy || !supported}>
          {getPrimaryLabel(cached, engineState)}
        </button>
        <button className="button button--ghost" onClick={() => void onDeleteCache()} disabled={busy || !cached}>
          Remove downloaded brain
        </button>
      </div>
    </section>
  );
}
