import { MODEL_OPTIONS } from '@/constants/models';

interface ModelPanelProps {
  selectedModelId: string;
  onSelect: (modelId: string) => void;
  onWarmup: () => void | Promise<void>;
  onDeleteCache: () => void | Promise<void>;
  progressText: string;
  progressValue: number;
  cached: boolean;
  busy: boolean;
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
}: ModelPanelProps) {
  return (
    <section className="card stack-lg">
      <div>
        <p className="eyebrow">Model lane</p>
        <h2>Choose the local brain</h2>
        <p>
          Start with the 1B model. It is the safest first ship for mobile-class WebGPU.
        </p>
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
                {model.recommended ? <span className="model-badge">recommended</span> : null}
              </div>
              <p>{model.description}</p>
              <div className="model-meta">
                <span>{model.sizeLabel}</span>
                <span>{model.memoryLabel}</span>
              </div>
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
        <button className="button" onClick={() => void onWarmup()} disabled={busy}>
          {cached ? 'Load cached model' : 'Download and load model'}
        </button>
        <button className="button button--ghost" onClick={() => void onDeleteCache()} disabled={busy || !cached}>
          Remove cache
        </button>
      </div>
    </section>
  );
}
