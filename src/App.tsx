import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatCompletionMessageParam, InitProgressReport } from '@mlc-ai/web-llm';
import { Header } from '@/components/Header';
import { SettingsSheet } from '@/components/SettingsSheet';
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

function describeProgress(progress: InitProgressReport): string {
  const raw = String(progress.text ?? '').trim();
  const lowered = raw.toLowerCase();

  if (!raw) {
    return 'Preparing offline model…';
  }

  if (lowered.includes('keep this screen open')) {
    return 'Starting the first download… keep this screen open.';
  }

  if (lowered.includes('sit at 0%')) {
    return 'The first download can sit at 0% briefly on iPhone. Let it keep running.';
  }

  if (lowered.includes('offline model is ready')) {
    return 'Offline setup complete. You can start chatting now.';
  }

  if (lowered.includes('fetch') || lowered.includes('cache[') || lowered.includes('download')) {
    return 'Downloading offline model…';
  }

  if (lowered.includes('load') || lowered.includes('reload') || lowered.includes('initialize') || lowered.includes('prefill')) {
    return 'Loading offline model…';
  }

  if (lowered.includes('warm') || lowered.includes('ready')) {
    return 'Finishing offline setup…';
  }

  return raw;
}

function createTitleFromText(input: string): string {
  const title = input.replace(/\s+/g, ' ').trim().slice(0, 36);
  return title.length < input.trim().length ? `${title}…` : title;
}

export default function App() {
  const support = useMemo(() => getRuntimeSupport(), []);
  const online = useOnlineStatus();
  const wakeLockRef = useRef<{ release?: () => Promise<void> } | null>(null);

  const [engineState, setEngineState] = useState<EngineState>('idle');
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [activeConversationId, setActiveConversationId] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [selectedModelId, setSelectedModelId] = useState(DEFAULT_MODEL_ID);
  const [cachedModel, setCachedModel] = useState(false);
  const [progressValue, setProgressValue] = useState(0);
  const [progressText, setProgressText] = useState('Offline setup has not been started yet.');
  const [toast, setToast] = useState<ToastState | null>(null);
  const [generating, setGenerating] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const refreshCachedModel = useCallback(async (modelId = selectedModelId) => {
    try {
      const cached = await zayaEngine.isModelCached(modelId);
      setCachedModel(cached);
    } catch {
      setCachedModel(false);
    }
  }, [selectedModelId]);

  const releaseWakeLock = useCallback(async () => {
    try {
      await wakeLockRef.current?.release?.();
    } catch {
      // Ignore wake lock release failures.
    } finally {
      wakeLockRef.current = null;
    }
  }, []);

  const requestWakeLock = useCallback(async () => {
    try {
      const nav = navigator as Navigator & {
        wakeLock?: {
          request?: (type: 'screen') => Promise<{ release?: () => Promise<void> }>;
        };
      };

      if (!nav.wakeLock?.request) return;

      wakeLockRef.current = await nav.wakeLock.request('screen');
    } catch {
      // Ignore wake lock failures. The setup can still continue.
    }
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
      setBootstrapped(true);
      await refreshCachedModel(savedModelId);
    } catch (error) {
      setToast({ id: createId('toast'), tone: 'error', message: toReadableError(error) });
    }
  }, [refreshCachedModel]);

  useEffect(() => {
    void bootstrap();
    return () => {
      void releaseWakeLock();
      void zayaEngine.unload();
    };
  }, [bootstrap, releaseWakeLock]);

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
    const timer = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function handleProgress(progress: InitProgressReport) {
    const numeric = typeof progress.progress === 'number' ? progress.progress : 0;
    setProgressValue(Math.max(0, Math.min(1, numeric)));
    setProgressText(describeProgress(progress));
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

  async function warmupModel() {
    if (engineState === 'loading' || zayaEngine.isBooting()) {
      return;
    }

    if (!support.supported) {
      setToast({ id: createId('toast'), tone: 'error', message: 'This browser is missing the features needed for local AI.' });
      return;
    }

    if (!online && !cachedModel) {
      setToast({ id: createId('toast'), tone: 'error', message: 'Connect to the internet to download the offline model the first time.' });
      return;
    }

    try {
      setEngineState('loading');
      setProgressValue(0);
      setProgressText(cachedModel ? 'Loading downloaded model…' : 'Starting the first download… keep this screen open.');
      await requestWakeLock();
      await zayaEngine.boot(selectedModelId, handleProgress);
      setEngineState('ready');
      setProgressValue(1);
      setProgressText('Offline setup complete. You can start chatting now.');
      setCachedModel(true);
      await refreshCachedModel(selectedModelId);
      await ensureConversation();
      setSettingsOpen(false);
      setToast({ id: createId('toast'), tone: 'success', message: 'Offline chat is ready.' });
    } catch (error) {
      setEngineState('error');
      setProgressText('Offline setup failed. Try the download again.');
      setToast({ id: createId('toast'), tone: 'error', message: toReadableError(error) });
    } finally {
      await releaseWakeLock();
    }
  }

  async function deleteModelCache() {
    try {
      await zayaEngine.removeCachedModel(selectedModelId);
      setEngineState('idle');
      setProgressValue(0);
      setProgressText('Downloaded model was removed.');
      await refreshCachedModel();
      setToast({ id: createId('toast'), tone: 'success', message: 'Downloaded model removed.' });
    } catch (error) {
      setToast({ id: createId('toast'), tone: 'error', message: toReadableError(error) });
    }
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
    if (!userText || generating || !chatUnlocked) return;

    try {
      setGenerating(true);
      setDraft('');

      const conversation = await ensureConversation();

      if (!zayaEngine.isReady()) {
        await warmupModel();
      }

      if (!zayaEngine.isReady()) {
        throw new Error('Finish offline setup before sending a message.');
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
      setMessages((current) => current.map((message) => (message.status === 'streaming' ? { ...message, status: 'complete' } : message)));
    } catch (error) {
      setToast({ id: createId('toast'), tone: 'error', message: toReadableError(error) });
    }
  }

  async function wipeAllLocalData() {
    try {
      await clearAllData();
      await zayaEngine.unload();
      await releaseWakeLock();
      setConversations([]);
      setMessages([]);
      setActiveConversationId('');
      setDraft('');
      setEngineState('idle');
      setProgressValue(0);
      setProgressText('Offline setup has not been started yet.');
      setCachedModel(false);
      setSettingsOpen(false);
    } catch (error) {
      setToast({ id: createId('toast'), tone: 'error', message: toReadableError(error) });
    }
  }

  const chatUnlocked = support.supported && (cachedModel || engineState === 'ready');

  return (
    <>
      <div className="app-shell">
        <Header
          online={online}
          chatUnlocked={chatUnlocked}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <main className="chat-stage">
          <MessageList messages={messages} loading={generating} />
          <Composer
            value={draft}
            onChange={setDraft}
            onSend={sendMessage}
            onStop={stopGeneration}
            disabled={!chatUnlocked || engineState === 'loading'}
            generating={generating}
            placeholder={chatUnlocked ? 'Message Zaya…' : 'Open Offline setup to finish the first download…'}
          />
        </main>
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
        onClearAllData={wipeAllLocalData}
        supported={support.supported}
        online={online}
        engineState={engineState}
      />

      <Toast toast={toast} />
    </>
  );
}
