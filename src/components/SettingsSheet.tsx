import { ModelPanel } from '@/components/ModelPanel';
import type { EngineState } from '@/types/chat';
import type { RuntimeSupport } from '@/lib/runtime';

interface SettingsSheetProps {
  selectedModelId: string;
  onSelectModel: (modelId: string) => void;
  onWarmupModel: () => void | Promise<void>;
  onDeleteCache: () => void | Promise<void>;
  onClearLocalData: () => void | Promise<void>;
  progressText: string;
  progressValue: number;
  cachedModel: boolean;
  busy: boolean;
  support: RuntimeSupport;
  engineState: EngineState;
  online: boolean;
  isStandalone: boolean;
  canPromptInstall: boolean;
  showIosHint: boolean;
  onInstall: () => void | Promise<void>;
}

function getSetupHeadline(support: RuntimeSupport, cachedModel: boolean, engineState: EngineState) {
  if (!support.hasSecureContext) return 'Secure connection required';
  if (!support.hasWebGpu) return 'WebGPU not available';
  if (engineState === 'loading') return 'Setting up offline chat';
  if (engineState === 'ready') return 'Offline chat is ready';
  if (cachedModel) return 'Offline chat is downloaded';
  return 'Finish offline setup';
}

export function SettingsSheet({
  selectedModelId,
  onSelectModel,
  onWarmupModel,
  onDeleteCache,
  onClearLocalData,
  progressText,
  progressValue,
  cachedModel,
  busy,
  support,
  engineState,
  online,
  isStandalone,
  canPromptInstall,
  showIosHint,
  onInstall,
}: SettingsSheetProps) {
  return (
    <section className="settings-panel stack-lg">
      <section className="panel-section stack-md">
        <div>
          <p className="eyebrow">Setup</p>
          <h2>{getSetupHeadline(support, cachedModel, engineState)}</h2>
          <p>
            {support.supported
              ? 'Complete the first download and your core chat can run locally on this device.'
              : 'Use Safari over HTTPS and make sure this device exposes WebGPU, workers, and local storage.'}
          </p>
        </div>

        <div className="status-list" role="list">
          <div className="status-row" role="listitem">
            <span>Network</span>
            <strong>{online ? 'Online' : 'Offline'}</strong>
          </div>
          <div className="status-row" role="listitem">
            <span>Installed</span>
            <strong>{isStandalone ? 'Home Screen app' : 'Browser tab'}</strong>
          </div>
          <div className="status-row" role="listitem">
            <span>Secure connection</span>
            <strong>{support.hasSecureContext ? 'Ready' : 'Required'}</strong>
          </div>
          <div className="status-row" role="listitem">
            <span>WebGPU</span>
            <strong>{support.hasWebGpu ? 'Available' : 'Unavailable'}</strong>
          </div>
        </div>
      </section>

      {!isStandalone || showIosHint ? (
        <section className="panel-section stack-md">
          <div>
            <p className="eyebrow">Install</p>
            <h2>Add Zaya to Home Screen</h2>
            <p>That gives you the app feel, cleaner launches, and a better offline path on iPhone.</p>
          </div>
          {canPromptInstall ? (
            <button type="button" className="button button--secondary" onClick={() => void onInstall()}>
              Install now
            </button>
          ) : (
            <p className="panel-note">On iPhone Safari, tap Share and choose Add to Home Screen.</p>
          )}
        </section>
      ) : null}

      <ModelPanel
        selectedModelId={selectedModelId}
        onSelect={onSelectModel}
        onWarmup={onWarmupModel}
        onDeleteCache={onDeleteCache}
        progressText={progressText}
        progressValue={progressValue}
        cached={cachedModel}
        busy={busy}
        supported={support.supported}
        engineState={engineState}
      />

      <section className="panel-section stack-md">
        <div>
          <p className="eyebrow">Storage</p>
          <h2>Local data</h2>
          <p>Clear chats and settings from this device whenever you want a clean restart.</p>
        </div>
        <button type="button" className="button button--ghost" onClick={() => void onClearLocalData()}>
          Clear local data
        </button>
      </section>
    </section>
  );
}
