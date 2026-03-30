import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChatCompletionMessageParam, InitProgressReport } from '@mlc-ai/web-llm';
import { Header } from '@/components/Header';
import { MessageList } from '@/components/MessageList';
import { Composer } from '@/components/Composer';
import { Toast } from '@/components/Toast';
import { SettingsSheet } from '@/components/SettingsSheet';
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

function normalizeProgressText(text: string | undefined, cachedModel: boolean): string {
  if (!text) {
    return cachedModel ? 'Local model cached on this device.' : 'Offline chat has not been enabled yet.';
  }

  if (/fetching param cache/i.test(text) || /prefill/i.test(text) || /populate the cache/i.test(text)) {
    return 'Downloading the starter brain for this device…';
  }

  if (/loading local model/i.test(text) || /initializing/i.test(text)) {
    return 'Preparing the local model…';
  }

  return text;
}

export default function App() {
  const support = useMemo(() => getRuntimeSupport(), []);
  const online = useOnlineStatus();
  const { isStandalone } = usePwaInstall();

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
  const [settingsOpen, setSettingsOpen] = useState(false);

  const refreshCachedModel = useCallback(async (modelId = selectedModelId) => {
    try {
      const cached = await zayaEngine.isModelCached(modelId);
      setCachedModel(cached);
      setProgressText((current) => normalizeProgressText(current, cached));
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
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function handleProgress(progress: InitProgressReport) {
    const numeric = typeof progress.progress === 'number' ? progress.progress : 0;
    setProgressValue(Math.max(0, Math.min(1, numeric)));
    setProgressText(normalizeProgressText(progress.text, cachedModel));
  }

  async function warmupModel() {
    if (!support.supported) {
      setToast({ id: createId('toast'), tone: 'error', message: 'This browser cannot start local AI here yet.' });
      return;
    }

    try {
      setEngineState('loading');
      setProgressValue(0);
      setProgressText('Preparing the local model…');
      await zayaEngine.boot(selectedModelId, handleProgress);
      setEngineState('ready');
      await refreshCachedModel();
      setProgressText('Offline chat is ready on this device.');
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
      setProgressText('Offline chat has not been enabled yet.');
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
    setConversations((current) => [created, ...current]);
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
      setSettingsOpen(false);
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

      setMessages((current) => [...current, userMessage, assistantMessage]);
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
            message.id === assistantMessage.id ? { ...message, content: `${message.content}${token}` } : message,
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
            ? { ...message, status: 'error', content: message.content || 'Local generation failed.' }
            : message,
        ),
      );
      setToast({ id: createId('toast'), tone: 'error', message: toReadableError(error) });
    } finally {
      setGenerating(false);
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
      setProgressText('Offline chat has not been enabled yet.');
      setCachedModel(false);
      setSettingsOpen(false);
      setToast({ id: createId('toast'), tone: 'success', message: 'Everything local was cleared.' });
    } catch (error) {
      setToast({ id: createId('toast'), tone: 'error', message: toReadableError(error) });
    }
  }

  const chatUnlocked = support.supported && cachedModel && engineState !== 'loading';

  return (
    <>
      <div className="mobile-app-shell">
        <Header engineState={engineState} cachedModel={cachedModel} onOpenSettings={() => setSettingsOpen(true)} />

        <main className="mobile-stage">
          <MessageList
            messages={messages}
            loading={generating}
            chatUnlocked={chatUnlocked}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </main>

        <Composer
          value={draft}
          onChange={setDraft}
          onSend={sendMessage}
          disabled={!chatUnlocked || generating}
          lockedMessage={chatUnlocked ? undefined : 'Open Offline setup to finish the first download…'}
        />
      </div>

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        selectedModelId={selectedModelId}
        onSelectModel={setSelectedModelId}
        onWarmup={warmupModel}
        onDeleteCache={deleteModelCache}
        progressText={progressText}
        progressValue={progressValue}
        cachedModel={cachedModel}
        busy={engineState === 'loading' || generating}
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={setActiveConversationId}
        onCreateConversation={createConversation}
        onDeleteConversation={removeConversation}
        onClearLocalData={wipeAllLocalData}
        online={online}
        isStandalone={isStandalone}
        engineState={engineState}
      />

      <Toast toast={toast} />
    </>
  );
}

function createTitleFromText(input: string): string {
  const title = input.replace(/\s+/g, ' ').trim().slice(0, 36);
  return title.length < input.trim().length ? `${title}…` : title;
}
