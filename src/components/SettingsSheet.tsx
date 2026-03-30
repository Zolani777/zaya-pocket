import { ConversationList } from '@/components/ConversationList';
import { ModelPanel } from '@/components/ModelPanel';
import type { ConversationRecord, EngineState } from '@/types/chat';

interface SettingsSheetProps {
  open: boolean;
  onClose: () => void;
  selectedModelId: string;
  onSelectModel: (modelId: string) => void;
  onWarmup: () => void | Promise<void>;
  onDeleteCache: () => void | Promise<void>;
  progressText: string;
  progressValue: number;
  cachedModel: boolean;
  busy: boolean;
  conversations: ConversationRecord[];
  activeConversationId: string;
  onSelectConversation: (id: string) => void;
  onCreateConversation: () => void | Promise<void>;
  onDeleteConversation: (id: string) => void | Promise<void>;
  onClearLocalData: () => void | Promise<void>;
  online: boolean;
  isStandalone: boolean;
  engineState: EngineState;
}

export function SettingsSheet({
  open,
  onClose,
  selectedModelId,
  onSelectModel,
  onWarmup,
  onDeleteCache,
  progressText,
  progressValue,
  cachedModel,
  busy,
  conversations,
  activeConversationId,
  onSelectConversation,
  onCreateConversation,
  onDeleteConversation,
  onClearLocalData,
  online,
  isStandalone,
  engineState,
}: SettingsSheetProps) {
  if (!open) return null;

  return (
    <div className="settings-sheet__backdrop" onClick={onClose}>
      <aside className="settings-sheet" onClick={(event) => event.stopPropagation()} aria-label="Settings">
        <div className="settings-sheet__header">
          <div>
            <p className="eyebrow">Settings</p>
            <h2>Offline setup</h2>
          </div>
          <button type="button" className="header-icon-button" aria-label="Close settings" onClick={onClose}>
            ×
          </button>
        </div>

        <section className="settings-summary card-lite">
          <div className="settings-summary__row"><span>Network</span><strong>{online ? 'Online' : 'Offline'}</strong></div>
          <div className="settings-summary__row"><span>App mode</span><strong>{isStandalone ? 'Home Screen app' : 'Browser'}</strong></div>
          <div className="settings-summary__row"><span>Model</span><strong>{cachedModel ? 'Cached' : 'Not cached'}</strong></div>
          <div className="settings-summary__row"><span>State</span><strong>{engineState === 'ready' ? 'Ready' : engineState === 'loading' ? 'Setting up' : engineState === 'error' ? 'Attention needed' : 'Idle'}</strong></div>
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
        />

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

        <section className="card stack-md">
          <div>
            <p className="eyebrow">Storage</p>
            <h2>Local data</h2>
            <p>Clear chats and settings on this device whenever you want a clean restart.</p>
          </div>
          <button className="button button--ghost" onClick={() => void onClearLocalData()}>
            Clear local data
          </button>
        </section>
      </aside>
    </div>
  );
}
