import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChatCompletionMessageParam, InitProgressReport } from '@mlc-ai/web-llm';
import { Header } from '@/components/Header';
import { ConversationList } from '@/components/ConversationList';
import { MessageList } from '@/components/MessageList';
import { Composer } from '@/components/Composer';
import { SettingsSheet } from '@/components/SettingsSheet';
import { Toast } from '@/components/Toast';
import { buildSystemPrompt } from '@/config/persona';
import { DEFAULT_MODEL_ID } from '@/constants/models';
import { createId } from '@/lib/id';
import { getRuntimeSupport } from '@/lib/runtime';
import {
  clearAllData,
  deleteConversation,
  getSetting,
  listConversations,
  listMessages,
  saveConversation,
  saveMessage,
  saveMessages,
  saveSetting,
} from '@/lib/db';
import { toReadableError } from '@/lib/error';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { usePwaInstall } from '@/hooks/usePwaInstall';
import { zayaEngine } from '@/services/engine';
import type { ChatMessage, ConversationRecord, EngineState, ToastState } from '@/types/chat';
import './styles.css';

const ACTIVE_CONVERSATION_KEY = 'activeConversationId';
const SELECTED_MODEL_KEY = 'selectedModelId';

type SidebarTab = 'chats' | 'settings';

function createConversationRecord(modelId: string): ConversationRecord {
  const now = new Date().toISOString();
  return {
    id: createId('conv'),
    title: 'New chat',
    createdAt: now,
    updatedAt: now,
    modelId,
    lastMessagePreview: '',
  };
}

function isDesktopViewport() {
  return typeof window !== 'undefined' && window.matchMedia('(min-width: 1100px)').matches;
}

export default function App() {
  const support = useMemo(() => getRuntimeSupport(), []);
  const online = useOnlineStatus();
  const { canPrompt, isStandalone, showIosHint, promptInstall } = usePwaInstall();

  const [engineState, setEngineState] = useState<EngineState>('idle');
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [activeConversationId, setActiveConversationId] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [selectedModelId, setSelectedModelId] = useState(DEFAULT_MODEL_ID);
  const [cachedModel, setCachedModel] = useState(false);
  const [progressValue, setProgressValue] = useState(0);
  const [progressText, setProgressText] = useState('Offline chat has not been enabled yet.');
  const [toast, setToast] = useState<ToastState | null>(null);
  const [generating, setGenerating] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('chats');
  const [panelOpen, setPanelOpen] = useState(() => isDesktopViewport());

  const refreshCachedModel = useCallback(async (modelId = selectedModelId) => {
    try {
      const cached = await zayaEngine.isModelCached(modelId);
      setCachedModel(cached);
    } catch {
      setCachedModel(false);
    }
  }, [selectedModelId]);

  const closeMobilePanel = useCallback(() => {
    if (!isDesktopViewport()) {
      setPanelOpen(false);
    }
  }, []);

  const openSidebarTab = useCallback((tab: SidebarTab) => {
    setSidebarTab(tab);
    setPanelOpen(true);
  }, []);

  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      const stored = await listMessages(conversationId);
      setMessages(stored);
    } catch (error) {
      setToast({ id: createId('toast'), tone: 'error', message: toReadableError(error) });
    }
  }, []);

  const bootstrap = useCallback(async () => {
    try {
      const [savedModelId, savedConversationId, savedConversations] = await Promise.all([
        getSetting(SELECTED_MODEL_KEY, DEFAULT_MODEL_ID),
        getSetting(ACTIVE_CONVERSATION_KEY, ''),
        listConversations(),
      ]);

      setSelectedModelId(savedModelId);
      setConversations(savedConversations);
      setActiveConversationId(savedConversationId || savedConversations[0]?.id || '');
      setSidebarTab(savedConversations.length > 0 ? 'chats' : 'settings');
      setBootstrapped(true);
      await refreshCachedModel(savedModelId);
    } catch (error) {
      setToast({ id: createId('toast'), tone: 'error', message: toReadableError(error) });
    }
  }, [refreshCachedModel]);

  useEffect(() => {
    void bootstrap();
    return () => {
      void zayaEngine.unload();
    };
  }, [bootstrap]);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1100px)');
    const syncPanelState = () => setPanelOpen(media.matches);

    syncPanelState();
    media.addEventListener('change', syncPanelState);
    return () => media.removeEventListener('change', syncPanelState);
  }, []);

  useEffect(() => {
    if (!bootstrapped) return;

    void refreshCachedModel();
    void saveSetting(SELECTED_MODEL_KEY, selectedModelId);
  }, [selectedModelId, bootstrapped, refreshCachedModel]);

  useEffect(() => {
    if (!activeConversationId) {
      setMessages([]);
      return;
    }

    void loadMessages(activeConversationId);
    void saveSetting(ACTIVE_CONVERSATION_KEY, activeConversationId);
  }, [activeConversationId, loadMessages]);

  useEffect(() => {
    if (!toast) return;

    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function handleProgress(progress: InitProgressReport) {
    const numeric = typeof progress.progress === 'number' ? progress.progress : 0;
    const clamped = Math.max(0, Math.min(1, numeric));
    setProgressValue(clamped);
    setProgressText(formatProgressText(progress.text, clamped));
  }

  async function warmupModel() {
    if (!support.supported) {
      setToast({ id: createId('toast'), tone: 'error', message: 'This device still needs WebGPU, workers, IndexedDB, and a secure connection.' });
      openSidebarTab('settings');
      return;
    }

    try {
      setEngineState('loading');
      setProgressValue(0);
      setProgressText('Preparing local brain…');
      await zayaEngine.boot(selectedModelId, handleProgress);
      setEngineState('ready');
      setProgressText('Offline chat is ready.');
      await refreshCachedModel();
      setToast({ id: createId('toast'), tone: 'success', message: 'Offline chat is ready.' });
    } catch (error) {
      setEngineState('error');
      setProgressText('Offline setup failed.');
      setToast({ id: createId('toast'), tone: 'error', message: toReadableError(error) });
      throw error;
    }
  }

  async function deleteModelCache() {
    try {
      await zayaEngine.removeCachedModel(selectedModelId);
      setEngineState('idle');
      setProgressValue(0);
      setProgressText('Downloaded brain removed.');
      await refreshCachedModel();
      setToast({ id: createId('toast'), tone: 'success', message: 'Downloaded brain removed from this device.' });
    } catch (error) {
      setToast({ id: createId('toast'), tone: 'error', message: toReadableError(error) });
    }
  }

  async function ensureConversation(): Promise<ConversationRecord> {
    const existing = conversations.find((item) => item.id === activeConversationId);
    if (existing) return existing;

    const created = createConversationRecord(selectedModelId);
    await saveConversation(created);
    const next = [created, ...conversations];
    setConversations(next);
    setActiveConversationId(created.id);
    return created;
  }

  async function createConversation() {
    try {
      const created = createConversationRecord(selectedModelId);
      await saveConversation(created);
      setConversations((current) => [created, ...current]);
      setActiveConversationId(created.id);
      setMessages([]);
      closeMobilePanel();
      setToast({ id: createId('toast'), tone: 'success', message: 'New local chat created.' });
    } catch (error) {
      setToast({ id: createId('toast'), tone: 'error', message: toReadableError(error) });
    }
  }

  async function removeConversation(id: string) {
    try {
      await deleteConversation(id);
      const remaining = conversations.filter((item) => item.id !== id);
      setConversations(remaining);

      if (activeConversationId === id) {
        setActiveConversationId(remaining[0]?.id ?? '');
        setMessages([]);
      }

      setToast({ id: createId('toast'), tone: 'success', message: 'Conversation removed from this device.' });
    } catch (error) {
      setToast({ id: createId('toast'), tone: 'error', message: toReadableError(error) });
    }
  }

  async function sendMessage() {
    const userText = draft.trim();
    if (!userText || generating) return;

    try {
      setGenerating(true);
      setDraft('');

      const conversation = await ensureConversation();

      if (!zayaEngine.isReady()) {
        await warmupModel();
      }

      const now = new Date().toISOString();
      const userMessage: ChatMessage = {
        id: createId('msg'),
        conversationId: conversation.id,
        role: 'user',
        content: userText,
        createdAt: now,
        status: 'complete',
      };

      const assistantMessage: ChatMessage = {
        id: createId('msg'),
        conversationId: conversation.id,
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
        status: 'streaming',
      };

      const nextMessages = [...messages, userMessage, assistantMessage];
      setMessages(nextMessages);
      await saveMessages([userMessage, assistantMessage]);

      const promptMessages: ChatCompletionMessageParam[] = [
        { role: 'system', content: buildSystemPrompt() },
        ...messages.map((message) => ({ role: message.role, content: message.content })),
        { role: 'user', content: userText },
      ];

      let streamedContent = '';

      await zayaEngine.streamReply(promptMessages, (token) => {
        streamedContent += token;
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessage.id
              ? { ...message, content: `${message.content}${token}` }
              : message,
          ),
        );
      });

      const finalAssistant: ChatMessage = {
        ...assistantMessage,
        content: streamedContent.trim() || 'No reply was produced.',
        status: 'complete',
      };

      const conversationPatch: ConversationRecord = {
        ...conversation,
        title: conversation.title === 'New chat' ? createTitleFromText(userText) : conversation.title,
        updatedAt: new Date().toISOString(),
        modelId: selectedModelId,
        lastMessagePreview: finalAssistant.content.slice(0, 80),
      };

      setMessages((current) => current.map((message) => (message.id === assistantMessage.id ? finalAssistant : message)));
      setConversations((current) => {
        const rest = current.filter((item) => item.id !== conversation.id);
        return [conversationPatch, ...rest];
      });
      await saveMessage(finalAssistant);
      await saveConversation(conversationPatch);
      setEngineState('ready');
    } catch (error) {
      setEngineState('error');
      setMessages((current) =>
        current.map((message) =>
          message.status === 'streaming'
            ? {
                ...message,
                status: 'error',
                content: message.content || 'Local generation failed.',
              }
            : message,
        ),
      );
      setToast({ id: createId('toast'), tone: 'error', message: toReadableError(error) });
    } finally {
      setGenerating(false);
    }
  }

  async function stopGeneration() {
    try {
      await zayaEngine.interrupt();
      setGenerating(false);
      setMessages((current) =>
        current.map((message) =>
          message.status === 'streaming' ? { ...message, status: 'complete' } : message,
        ),
      );
      setToast({ id: createId('toast'), tone: 'info', message: 'Generation stopped.' });
    } catch (error) {
      setToast({ id: createId('toast'), tone: 'error', message: toReadableError(error) });
    }
  }

  async function wipeAllLocalData() {
    try {
      await clearAllData();
      await zayaEngine.unload();
      setConversations([]);
      setMessages([]);
      setActiveConversationId('');
      setDraft('');
      setEngineState('idle');
      setProgressValue(0);
      setProgressText('Local data cleared.');
      setCachedModel(false);
      setSidebarTab('settings');
      setToast({ id: createId('toast'), tone: 'success', message: 'Everything local was cleared.' });
    } catch (error) {
      setToast({ id: createId('toast'), tone: 'error', message: toReadableError(error) });
    }
  }

  async function handleInstall() {
    const result = await promptInstall();
    if (result === 'accepted') {
      setToast({ id: createId('toast'), tone: 'success', message: 'Installed. Zaya now behaves like an app.' });
      return;
    }

    if (result === 'dismissed') {
      setToast({ id: createId('toast'), tone: 'info', message: 'Install was dismissed.' });
      return;
    }

    setToast({ id: createId('toast'), tone: 'info', message: 'Install prompt is not available here.' });
  }

  const composerPlaceholder = !support.supported
    ? 'This device still needs the right graphics support.'
    : cachedModel || engineState === 'ready'
      ? 'Message Zaya…'
      : 'Finish offline setup first…';

  return (
    <>
      <div className="app-shell">
        <Header
          engineState={engineState}
          cachedModel={cachedModel}
          onOpenSettings={() => openSidebarTab('settings')}
        />

        <div className="workspace">
          <div
            className={`panel-backdrop ${panelOpen ? 'is-visible' : ''}`}
            onClick={closeMobilePanel}
            aria-hidden={!panelOpen}
          />

          <aside className={`side-panel ${panelOpen ? 'side-panel--open' : ''}`} aria-label="Zaya sidebar">
            <div className="side-panel__header">
              <div className="tab-switcher" role="tablist" aria-label="Sidebar sections">
                <button
                  type="button"
                  className={`tab-switcher__button ${sidebarTab === 'chats' ? 'is-active' : ''}`}
                  role="tab"
                  aria-selected={sidebarTab === 'chats'}
                  onClick={() => setSidebarTab('chats')}
                >
                  Chats
                </button>
                <button
                  type="button"
                  className={`tab-switcher__button ${sidebarTab === 'settings' ? 'is-active' : ''}`}
                  role="tab"
                  aria-selected={sidebarTab === 'settings'}
                  onClick={() => setSidebarTab('settings')}
                >
                  Offline setup
                </button>
              </div>
              <button type="button" className="icon-button mobile-only" onClick={closeMobilePanel} aria-label="Close panel">
                ×
              </button>
            </div>

            <div className="side-panel__content">
              {sidebarTab === 'chats' ? (
                <ConversationList
                  conversations={conversations}
                  activeConversationId={activeConversationId}
                  onSelect={(id) => {
                    setActiveConversationId(id);
                    closeMobilePanel();
                  }}
                  onCreate={createConversation}
                  onDelete={removeConversation}
                />
              ) : (
                <SettingsSheet
                  selectedModelId={selectedModelId}
                  onSelectModel={setSelectedModelId}
                  onWarmupModel={warmupModel}
                  onDeleteCache={deleteModelCache}
                  onClearLocalData={wipeAllLocalData}
                  progressText={progressText}
                  progressValue={progressValue}
                  cachedModel={cachedModel}
                  busy={engineState === 'loading' || generating}
                  support={support}
                  engineState={engineState}
                  online={online}
                  isStandalone={isStandalone}
                  canPromptInstall={canPrompt}
                  showIosHint={showIosHint}
                  onInstall={handleInstall}
                />
              )}
            </div>
          </aside>

          <main className="chat-stage">
            <MessageList
              messages={messages}
              loading={generating}
              supported={support.supported}
              cachedModel={cachedModel}
              onOpenSettings={() => openSidebarTab('settings')}
              onCreateChat={createConversation}
            />
            <Composer
              value={draft}
              onChange={setDraft}
              onSend={sendMessage}
              onStop={stopGeneration}
              disabled={!support.supported || engineState === 'loading'}
              generating={generating}
              placeholder={composerPlaceholder}
            />
          </main>
        </div>
      </div>

      <Toast toast={toast} />
    </>
  );
}

function createTitleFromText(input: string): string {
  const title = input.replace(/\s+/g, ' ').trim().slice(0, 36);
  return title.length < input.trim().length ? `${title}…` : title;
}


function formatProgressText(rawText: string | undefined, progress: number): string {
  const text = rawText?.trim().toLowerCase() ?? '';

  if (progress >= 0.995) {
    return 'Offline chat is ready.';
  }

  if (text.includes('fetch') || text.includes('cache') || text.includes('param') || text.includes('weight') || text.includes('shader')) {
    return progress > 0.9 ? 'Finalizing offline setup…' : 'Downloading offline brain…';
  }

  if (text.includes('load') || text.includes('init') || text.includes('warm') || text.includes('prefill') || text.includes('create')) {
    return 'Preparing local brain…';
  }

  if (progress > 0) {
    return progress > 0.9 ? 'Finalizing offline setup…' : 'Setting up offline chat…';
  }

  return 'Preparing local brain…';
}
