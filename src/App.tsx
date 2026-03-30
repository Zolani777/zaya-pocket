import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChatCompletionMessageParam, InitProgressReport } from '@mlc-ai/web-llm';
import { Header } from '@/components/Header';
import { InstallCard } from '@/components/InstallCard';
import { ModelPanel } from '@/components/ModelPanel';
import { ConversationList } from '@/components/ConversationList';
import { MessageList } from '@/components/MessageList';
import { Composer } from '@/components/Composer';
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
  const [progressText, setProgressText] = useState('Model not loaded yet.');
  const [toast, setToast] = useState<ToastState | null>(null);
  const [generating, setGenerating] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);

  const refreshCachedModel = useCallback(async (modelId = selectedModelId) => {
    try {
      const cached = await zayaEngine.isModelCached(modelId);
      setCachedModel(cached);
    } catch {
      setCachedModel(false);
    }
  }, [selectedModelId]);

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
      setBootstrapped(true);
      await refreshCachedModel(savedModelId);
      setToast({ id: createId('toast'), tone: 'success', message: 'Zaya Pocket is ready for local setup.' });
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

  useEffect(() => {
    const handleOfflineReady = () => {
      setToast({ id: createId('toast'), tone: 'success', message: 'Offline shell is cached.' });
    };

    window.addEventListener('zaya:offline-ready', handleOfflineReady);
    return () => window.removeEventListener('zaya:offline-ready', handleOfflineReady);
  }, []);


  function handleProgress(progress: InitProgressReport) {
    const numeric = typeof progress.progress === 'number' ? progress.progress : 0;
    setProgressValue(Math.max(0, Math.min(1, numeric)));
    setProgressText(progress.text || 'Loading local model…');
  }

  async function warmupModel() {
    if (!support.supported) {
      setToast({ id: createId('toast'), tone: 'error', message: 'This browser does not expose WebGPU + Worker + IndexedDB together.' });
      return;
    }

    try {
      setEngineState('loading');
      setProgressValue(0);
      setProgressText('Preparing local model…');
      await zayaEngine.boot(selectedModelId, handleProgress);
      setEngineState('ready');
      await refreshCachedModel();
      setToast({ id: createId('toast'), tone: 'success', message: 'Local model is loaded.' });
    } catch (error) {
      setEngineState('error');
      setProgressText('Model load failed.');
      setToast({ id: createId('toast'), tone: 'error', message: toReadableError(error) });
      throw error;
    }
  }

  async function deleteModelCache() {
    try {
      await zayaEngine.removeCachedModel(selectedModelId);
      setEngineState('idle');
      setProgressValue(0);
      setProgressText('Model cache removed.');
      await refreshCachedModel();
      setToast({ id: createId('toast'), tone: 'success', message: 'Cached model removed from this device.' });
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
      setToast({ id: createId('toast'), tone: 'success', message: 'Fresh local chat created.' });
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

      setToast({ id: createId('toast'), tone: 'success', message: 'Conversation deleted from local storage.' });
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

  const supportIssues = [
    !support.hasWebGpu ? 'WebGPU missing' : null,
    !support.hasWorker ? 'Workers missing' : null,
    !support.hasIndexedDb ? 'IndexedDB missing' : null,
  ].filter((issue): issue is string => Boolean(issue));

  return (
    <>
      <div className="app-shell">
        <Header engineState={engineState} online={online} cachedModel={cachedModel} />

        {!isStandalone ? (
          <InstallCard canPrompt={canPrompt} showIosHint={showIosHint} onInstall={handleInstall} />
        ) : null}

        {!support.supported ? (
          <section className="card warning-card">
            <p className="eyebrow">Runtime block</p>
            <h2>This browser is not ready for local inference</h2>
            <p>
              Zaya Pocket needs WebGPU, Web Workers, and IndexedDB together. Right now this runtime is missing:
            </p>
            <ul>
              {supportIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <main className="layout-grid">
          <aside className="layout-sidebar stack-lg">
            <ModelPanel
              selectedModelId={selectedModelId}
              onSelect={setSelectedModelId}
              onWarmup={warmupModel}
              onDeleteCache={deleteModelCache}
              progressText={progressText}
              progressValue={progressValue}
              cached={cachedModel}
              busy={engineState === 'loading' || generating}
            />

            <ConversationList
              conversations={conversations}
              activeConversationId={activeConversationId}
              onSelect={setActiveConversationId}
              onCreate={createConversation}
              onDelete={removeConversation}
            />

            <section className="card stack-md">
              <div>
                <p className="eyebrow">Ground rules</p>
                <h2>Local-first by default</h2>
                <p>
                  The app shell and your chat history stay on the device. The first model load still needs a download before fully offline use.
                </p>
              </div>
              <button className="button button--ghost" onClick={() => void wipeAllLocalData()}>
                Clear all local data
              </button>
            </section>
          </aside>

          <section className="layout-main stack-lg">
            <MessageList messages={messages} loading={generating} />
            <Composer
              value={draft}
              onChange={setDraft}
              onSend={sendMessage}
              onStop={stopGeneration}
              disabled={!support.supported || engineState === 'loading'}
              generating={generating}
            />
          </section>
        </main>
      </div>

      <Toast toast={toast} />
    </>
  );
}

function createTitleFromText(input: string): string {
  const title = input.replace(/\s+/g, ' ').trim().slice(0, 36);
  return title.length < input.trim().length ? `${title}…` : title;
}
