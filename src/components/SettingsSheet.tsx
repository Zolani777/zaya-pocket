import { ConversationList } from '@/components/ConversationList';
import { ModelPanel } from '@/components/ModelPanel';
import type { ConversationRecord, EngineState } from '@/types/chat';

interface SettingsSheetProps {
  open: boolean;
  onClose: () => void;
  canClose: boolean;
  selectedModelId: string;
  onSelectModel: (modelId: string) => void;
  onWarmup: () => void | Promise<void>;
  onDeleteCache: () => void | Promise<void>;
  progressText: string;
  progressValue: number;
  cachedModel: boolean;
  engineReady: boolean;
  busy: boolean;
  conversations: ConversationRecord[];
  activeConversationId: string;
  onSelectConversation: (id: string) => void;
  onCreateConversation: () => void | Promise<void>;
  onDeleteConversation: (id: string) => void | Promise<void>;
  onClearAllData: () => void | Promise<void>;
  supported: boolean;
  online: boolean;
  engineState: EngineState;
}

function describeState(engineState: EngineState, cachedModel: boolean, engineReady: boolean): string {
  if (engineState === 'downloading') return 'downloading';
  if (engineState === 'verifying') return 'verifying';
  if (engineState === 'loading') return 'loading';
  if (engineState === 'initializing') return 'initializing';
  if (engineState === 'generating') return 'replying';
  if (engineState === 'error') return 'needs attention';
  if (engineReady || engineState === 'ready') return 'ready';
  return cachedModel ? 'downloaded' : 'idle';
}

function describeModel(engineReady: boolean, cachedModel: boolean): string {
  if (engineReady) return 'Loaded';
  return cachedModel ? 'Downloaded' : 'Not downloaded';
}

export function SettingsSheet({
  open,
  onClose,
  canClose,
  selectedModelId,
  onSelectModel,
  onWarmup,
  onDeleteCache,
  progressText,
  progressValue,
  cachedModel,
  engineReady,
  busy,
  conversations,
  activeConversationId,
  onSelectConversation,
  onCreateConversation,
  onDeleteConversation,
  onClearAllData,
  supported,
  online,
  engineState,
}: SettingsSheetProps) {
  if (!open) return null;

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label="Settings">
      <section className="sheet glass-panel">
        <div className="sheet__header">
          <div>
            <p className="eyebrow">Settings</p>
            <h2>Offline setup</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            disabled={!canClose}
          >
            ×
          </button>
        </div>

        <section className="sheet-card sheet-stats">
          <div className="sheet-stat"><span>Network</span><strong>{online ? 'Online' : 'Offline'}</strong></div>
          <div className="sheet-stat"><span>App mode</span><strong>Home Screen app</strong></div>
          <div className="sheet-stat"><span>Model</span><strong>{describeModel(engineReady, cachedModel)}</strong></div>
          <div className="sheet-stat"><span>State</span><strong>{describeState(engineState, cachedModel, engineReady)}</strong></div>
          {!supported ? <p className="sheet-warning">This browser is missing some features needed for local AI.</p> : null}
        </section>

        <ModelPanel
          selectedModelId={selectedModelId}
          onSelect={onSelectModel}
          onWarmup={onWarmup}
          onDeleteCache={onDeleteCache}
          progressText={progressText}
          progressValue={progressValue}
          cached={cachedModel}
          busy={busy}
          supported={supported}
          engineState={engineState}
        />

        <section className="sheet-card stack-md">
          <div>
            <p className="eyebrow">Chats</p>
            <h2>Local conversations</h2>
          </div>
          <ConversationList
            conversations={conversations}
            activeConversationId={activeConversationId}
            onSelect={(id) => {
              onSelectConversation(id);
              onClose();
            }}
            onCreate={onCreateConversation}
            onDelete={onDeleteConversation}
          />
        </section>

        <section className="sheet-card stack-md">
          <div>
            <p className="eyebrow">Storage</p>
            <h2>Local data</h2>
            <p>Clear chats and setup on this device whenever you need a clean restart.</p>
          </div>
          <button className="button button--ghost" type="button" onClick={() => void onClearAllData()} disabled={busy}>
            Clear local data
          </button>
        </section>
      </section>
    </div>
  );
}
