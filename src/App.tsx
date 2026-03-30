import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatCompletionMessageParam } from '@mlc-ai/web-llm';
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
  saveSetting,
} from '@/lib/db';
import { toReadableError } from '@/lib/error';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { zayaEngine } from '@/services/engine';
import type {
  ChatMessage,
  ConversationRecord,
  EngineBootProgress,
  EngineState,
  SetupPhase,
  ToastState,
} from '@/types/chat';
import './styles.css';

const ACTIVE_CONVERSATION_KEY = 'activeConversationId';
const SELECTED_MODEL_KEY = 'selectedModelId';

const PHASE_PROGRESS: Record<SetupPhase, [number, number]> = {
  downloading: [0, 0.72],
  verifying: [0.72, 0.8],
  loading: [0.8, 0.9],
  initializing: [0.9, 0.98],
  ready: [1, 1],
};

function clampProgress(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function mapPhaseProgress(phase: SetupPhase, progress: number): number {
  const [start, end] = PHASE_PROGRESS[phase];
  if (phase === 'ready') return 1;
  return start + (end - start) * clampProgress(progress);
}

function isSetupState(state: EngineState): boolean {
  return state === 'downloading' || state === 'verifying' || state === 'loading' || state === 'initializing';
}

function isBusyState(state: EngineState): boolean {
  return isSetupState(state) || state === 'generating';
}

function getHeaderStatusLabel(engineState: EngineState, online: boolean, chatUnlocked: boolean): string {
  if (chatUnlocked) return 'ready';
  if (!online && engineState === 'idle') return 'offline';
  if (engineState === 'error') return 'needs attention';
  if (isSetupState(engineState)) return 'setting up';
  return 'setup needed';
}

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

  const [engineState, setEngineState] = useState<EngineState>('idle');
  const [engineReady, setEngineReady] = useState(false);
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

  const selectedModelIdRef = useRef(selectedModelId);
  const conversationsRef = useRef(conversations);
  const activeConversationIdRef = useRef(activeConversationId);
  const messagesRef = useRef(messages);
  const generatingRef = useRef(generating);
  const warmupPromiseRef = useRef<Promise<void> | null>(null);
  const warmupModelIdRef = useRef<string | null>(null);
  const autoLoadAttemptRef = useRef<string>('');

  useEffect(() => {
    selectedModelIdRef.current = selectedModelId;
  }, [selectedModelId]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    generatingRef.current = generating;
  }, [generating]);

  const refreshCachedModel = useCallback(async (modelId: string) => {
    try {
      const cached = await zayaEngine.isModelCached(modelId);
      if (selectedModelIdRef.current === modelId) {
        setCachedModel(cached);
      }
      return cached;
    } catch {
      if (selectedModelIdRef.current === modelId) {
        setCachedModel(false);
      }
      return false;
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

  const ensureConversation = useCallback(async (modelId: string): Promise<ConversationRecord> => {
    const existing = conversationsRef.current.find((item) => item.id === activeConversationIdRef.current);
    if (existing) return existing;

    const created = createConversationRecord(modelId);
    await saveConversation(created);
    setConversations((current) => [created, ...current]);
    setActiveConversationId(created.id);
    return created;
  }, []);

  const handleBootProgress = useCallback((progress: EngineBootProgress) => {
    setEngineReady(false);
    setEngineState(progress.phase);
    setProgressValue(mapPhaseProgress(progress.phase, progress.progress));
    setProgressText(progress.text);
  }, []);

  const warmupModel = useCallback(async (options: { auto?: boolean; modelId?: string } = {}) => {
    const targetModelId = options.modelId ?? selectedModelIdRef.current;

    if (warmupPromiseRef.current) {
      if (warmupModelIdRef.current === targetModelId) {
        return warmupPromiseRef.current;
      }
      throw new Error('Another offline setup is already running. Wait for it to finish.');
    }

    if (zayaEngine.isReady(targetModelId)) {
      setEngineReady(true);
      setEngineState((current) => (current === 'generating' ? current : 'ready'));
      setProgressValue(1);
      setProgressText('Offline model is ready on this device.');
      return;
    }

    const run = (async () => {
      if (!support.supported) {
        throw new Error('This browser is missing the features needed for local AI.');
      }

      const cached = await refreshCachedModel(targetModelId);

      if (!online && !cached) {
        setEngineReady(false);
        setEngineState('error');
        setProgressValue(0);
        setProgressText('You need an internet connection for the first offline model download.');
        throw new Error('Connect to the internet once to download the offline model.');
      }

      try {
        setEngineReady(false);
        setEngineState(cached ? 'loading' : 'downloading');
        setProgressValue(cached ? PHASE_PROGRESS.loading[0] : 0.02);
        setProgressText(cached ? 'Loading cached model…' : 'Downloading offline model…');

        await zayaEngine.boot(targetModelId, handleBootProgress);

        if (!zayaEngine.isReady(targetModelId)) {
          throw new Error('The offline model finished setup, but it is not ready yet.');
        }

        await refreshCachedModel(targetModelId);
        await ensureConversation(targetModelId);

        setEngineReady(true);
        setEngineState('ready');
        setProgressValue(1);
        setProgressText('Offline model is ready on this device.');
        autoLoadAttemptRef.current = targetModelId;

        if (!options.auto) {
          setSettingsOpen(false);
          setToast({ id: createId('toast'), tone: 'success', message: 'Offline setup finished.' });
        }
      } catch (error) {
        console.error('Zaya offline setup failed', error);
        setEngineReady(false);
        setEngineState('error');
        setProgressValue(0);
        setProgressText('Offline setup failed. Try again.');
        autoLoadAttemptRef.current = '';
        throw error;
      }
    })();

    warmupModelIdRef.current = targetModelId;
    warmupPromiseRef.current = run.finally(() => {
      warmupPromiseRef.current = null;
      warmupModelIdRef.current = null;
    });

    try {
      await warmupPromiseRef.current;
    } catch (error) {
      setToast({ id: createId('toast'), tone: 'error', message: toReadableError(error) });
      throw error;
    }
  }, [ensureConversation, handleBootProgress, online, refreshCachedModel, support.supported]);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const [savedModelId, savedConversationId, savedConversations] = await Promise.all([
          getSetting(SELECTED_MODEL_KEY, DEFAULT_MODEL_ID),
          getSetting(ACTIVE_CONVERSATION_KEY, ''),
          listConversations(),
        ]);

        if (cancelled) return;

        setSelectedModelId(savedModelId);
        setConversations(savedConversations);
        setActiveConversationId(savedConversationId || savedConversations[0]?.id || '');
        setEngineReady(zayaEngine.isReady(savedModelId));
        setEngineState(zayaEngine.isReady(savedModelId) ? 'ready' : 'idle');
        setBootstrapped(true);

        const cached = await refreshCachedModel(savedModelId);
        if (cancelled) return;

        if (zayaEngine.isReady(savedModelId)) {
          setEngineReady(true);
          setEngineState('ready');
          setProgressValue(1);
          setProgressText('Offline model is ready on this device.');
        } else if (cached) {
          setEngineReady(false);
          setEngineState('idle');
          setProgressValue(0);
          setProgressText('Downloaded model found. Loading is still required.');
        } else {
          setEngineReady(false);
          setEngineState('idle');
          setProgressValue(0);
          setProgressText('Offline setup has not been started yet.');
        }
      } catch (error) {
        if (cancelled) return;
        setToast({ id: createId('toast'), tone: 'error', message: toReadableError(error) });
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [refreshCachedModel]);

  useEffect(() => {
    return () => {
      void zayaEngine.unload();
    };
  }, []);

  useEffect(() => {
    if (!bootstrapped) return;

    void saveSetting(SELECTED_MODEL_KEY, selectedModelId);
    setEngineReady(zayaEngine.isReady(selectedModelId));
    autoLoadAttemptRef.current = '';

    let cancelled = false;
    void refreshCachedModel(selectedModelId).then((cached) => {
      if (cancelled || selectedModelIdRef.current !== selectedModelId) return;

      if (zayaEngine.isReady(selectedModelId)) {
        setEngineReady(true);
        setEngineState((current) => (current === 'generating' ? current : 'ready'));
        setProgressValue(1);
        setProgressText('Offline model is ready on this device.');
        return;
      }

      if (isBusyState(engineState)) return;

      setEngineReady(false);
      setEngineState('idle');
      setProgressValue(0);
      setProgressText(cached ? 'Downloaded model found. Loading is still required.' : 'Offline setup has not been started yet.');
    });

    return () => {
      cancelled = true;
    };
  }, [bootstrapped, refreshCachedModel, selectedModelId]);

  useEffect(() => {
    if (!activeConversationId) {
      setMessages([]);
      return;
    }

    void loadMessages(activeConversationId);
    void saveSetting(ACTIVE_CONVERSATION_KEY, activeConversationId);
  }, [activeConversationId, loadMessages]);

  useEffect(() => {
    if (!bootstrapped || !support.supported) return;
    if (engineReady || zayaEngine.isReady(selectedModelId)) return;
    if (!cachedModel) {
      autoLoadAttemptRef.current = '';
      return;
    }
    if (isBusyState(engineState) || warmupPromiseRef.current) return;
    if (autoLoadAttemptRef.current === selectedModelId) return;

    autoLoadAttemptRef.current = selectedModelId;
    void warmupModel({ auto: true, modelId: selectedModelId }).catch(() => {
      // toast handled inside warmupModel
    });
  }, [bootstrapped, cachedModel, engineReady, engineState, selectedModelId, support.supported, warmupModel]);

  useEffect(() => {
    if (!bootstrapped) return;

    const handleResume = () => {
      const modelId = selectedModelIdRef.current;
      const ready = zayaEngine.isReady(modelId);
      setEngineReady(ready);
      if (!ready && !generatingRef.current) {
        autoLoadAttemptRef.current = '';
      }
      void refreshCachedModel(modelId);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleResume();
      }
    };

    window.addEventListener('pageshow', handleResume);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('pageshow', handleResume);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [bootstrapped, refreshCachedModel]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function deleteModelCache() {
    try {
      await zayaEngine.removeCachedModel(selectedModelId);
      setEngineReady(false);
      setEngineState('idle');
      setProgressValue(0);
      setProgressText('Downloaded model was removed.');
      autoLoadAttemptRef.current = '';
      await refreshCachedModel(selectedModelId);
      setToast({ id: createId('toast'), tone: 'success', message: 'Downloaded model removed.' });
    } catch (error) {
      setToast({ id: createId('toast'), tone: 'error', message: toReadableError(error) });
    }
  }

  async function createConversation() {
    try {
      const created = createConversationRecord(selectedModelIdRef.current);
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
      setConversations((current) => {
        const remaining = current.filter((item) => item.id !== id);
        if (activeConversationIdRef.current === id) {
          setActiveConversationId(remaining[0]?.id ?? '');
          setMessages([]);
        }
        return remaining;
      });
    } catch (error) {
      setToast({ id: createId('toast'), tone: 'error', message: toReadableError(error) });
    }
  }

  async function sendMessage() {
    const userText = draft.trim();
    const modelId = selectedModelIdRef.current;

    if (!userText || generatingRef.current || !chatUnlocked) return;

    const assistantMessageId = createId('msg');
    const assistantCreatedAt = new Date().toISOString();
    let streamedContent = '';
    let assistantConversationId = activeConversationIdRef.current;

    const upsertAssistantMessage = (content: string, status: ChatMessage['status']) => {
      setMessages((current) => {
        const index = current.findIndex((message) => message.id === assistantMessageId);
        const nextMessage: ChatMessage = {
          id: assistantMessageId,
          conversationId: assistantConversationId,
          role: 'assistant',
          content,
          createdAt: assistantCreatedAt,
          status,
        };

        if (index === -1) {
          if (!content.trim() && status === 'streaming') return current;
          return [...current, nextMessage];
        }

        return current.map((message) => (message.id === assistantMessageId ? { ...nextMessage, conversationId: message.conversationId } : message));
      });
    };

    try {
      if (!zayaEngine.isReady(modelId)) {
        await warmupModel({ modelId });
      }

      if (!zayaEngine.isReady(modelId)) {
        throw new Error('The offline model is still loading. Wait a moment and try again.');
      }

      setGenerating(true);
      setEngineState('generating');
      setEngineReady(true);
      setDraft('');

      const conversation = await ensureConversation(modelId);
      assistantConversationId = conversation.id;
      const now = new Date().toISOString();
      const userMessage: ChatMessage = {
        id: createId('msg'),
        conversationId: conversation.id,
        role: 'user',
        content: userText,
        createdAt: now,
        status: 'complete',
      };

      setMessages((current) => [...current, userMessage]);
      await saveMessage(userMessage);

      const userConversationPatch: ConversationRecord = {
        ...conversation,
        title: conversation.title === 'New chat' ? createTitleFromText(userText) : conversation.title,
        updatedAt: now,
        modelId,
        lastMessagePreview: userText.slice(0, 80),
      };

      setConversations((current) => {
        const rest = current.filter((item) => item.id !== conversation.id);
        return [userConversationPatch, ...rest];
      });
      await saveConversation(userConversationPatch);

      const history = [...messagesRef.current, userMessage]
        .filter((message) => message.status !== 'error' && message.content.trim())
        .map((message) => ({ role: message.role, content: message.content } satisfies ChatCompletionMessageParam));

      const promptMessages: ChatCompletionMessageParam[] = [
        { role: 'system', content: buildSystemPrompt() },
        ...history,
      ];

      const finalText = await zayaEngine.streamReply(promptMessages, (token) => {
        streamedContent += token;
        upsertAssistantMessage(streamedContent, 'streaming');
      });

      const finalAssistant: ChatMessage = {
        id: assistantMessageId,
        conversationId: conversation.id,
        role: 'assistant',
        content: finalText,
        createdAt: assistantCreatedAt,
        status: 'complete',
      };

      upsertAssistantMessage(finalAssistant.content, finalAssistant.status);
      await saveMessage(finalAssistant);

      const conversationPatch: ConversationRecord = {
        ...userConversationPatch,
        updatedAt: new Date().toISOString(),
        lastMessagePreview: finalAssistant.content.slice(0, 80),
      };

      setConversations((current) => {
        const rest = current.filter((item) => item.id !== conversation.id);
        return [conversationPatch, ...rest];
      });
      await saveConversation(conversationPatch);

      setEngineState('ready');
      setEngineReady(true);
    } catch (error) {
      const readable = toReadableError(error);
      const ready = zayaEngine.isReady(modelId);
      setEngineReady(ready);
      setEngineState(ready ? 'ready' : 'error');

      if (streamedContent.trim()) {
        const failedAssistant: ChatMessage = {
          id: assistantMessageId,
          conversationId: assistantConversationId,
          role: 'assistant',
          content: streamedContent.trim(),
          createdAt: assistantCreatedAt,
          status: 'error',
        };
        upsertAssistantMessage(failedAssistant.content, failedAssistant.status);
        await saveMessage(failedAssistant);
      }

      setToast({ id: createId('toast'), tone: 'error', message: readable });
    } finally {
      setGenerating(false);
      if (zayaEngine.isReady(modelId)) {
        setEngineState('ready');
        setEngineReady(true);
      }
    }
  }

  async function stopGeneration() {
    try {
      await zayaEngine.interrupt();
      setGenerating(false);
      setEngineState(zayaEngine.isReady(selectedModelIdRef.current) ? 'ready' : 'error');
      setMessages((current) => current.filter((message) => !(message.status === 'streaming' && !message.content.trim())));
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
      setEngineReady(false);
      setEngineState('idle');
      setProgressValue(0);
      setProgressText('Offline setup has not been started yet.');
      setCachedModel(false);
      autoLoadAttemptRef.current = '';
      setSettingsOpen(false);
    } catch (error) {
      setToast({ id: createId('toast'), tone: 'error', message: toReadableError(error) });
    }
  }

  const chatUnlocked = support.supported && engineReady && (engineState === 'ready' || engineState === 'generating');
  const settingsBusy = isBusyState(engineState);
  const headerStatusLabel = getHeaderStatusLabel(engineState, online, chatUnlocked);

  return (
    <>
      <div className="app-shell">
        <Header
          online={online}
          chatUnlocked={chatUnlocked}
          statusLabel={headerStatusLabel}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <main className="chat-stage">
          <MessageList messages={messages} loading={generating} />
          <Composer
            value={draft}
            onChange={setDraft}
            onSend={sendMessage}
            onStop={stopGeneration}
            disabled={!chatUnlocked || generating}
            generating={generating}
            placeholder={chatUnlocked ? 'Message Zaya…' : 'Open Offline setup to finish the first download…'}
          />
        </main>
      </div>

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        canClose={!isSetupState(engineState)}
        selectedModelId={selectedModelId}
        onSelectModel={setSelectedModelId}
        onWarmup={warmupModel}
        onDeleteCache={deleteModelCache}
        progressText={progressText}
        progressValue={progressValue}
        cachedModel={cachedModel}
        engineReady={engineReady}
        busy={settingsBusy}
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

function createTitleFromText(input: string): string {
  const title = input.replace(/\s+/g, ' ').trim().slice(0, 36);
  return title.length < input.trim().length ? `${title}…` : title;
}
