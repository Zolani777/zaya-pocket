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
  SetupSession,
  ToastState,
} from '@/types/chat';
import './styles.css';

const ACTIVE_CONVERSATION_KEY = 'activeConversationId';
const SELECTED_MODEL_KEY = 'selectedModelId';
const SETUP_SESSIONS_STORAGE_KEY = 'zaya-pocket.setup-sessions.v1';
const IDLE_PROGRESS_TEXT = 'Offline setup has not been started yet.';
const DOWNLOADED_PROGRESS_TEXT = 'Download complete. Tap Load downloaded model to finish local setup.';

const PHASE_PROGRESS: Record<SetupPhase, [number, number]> = {
  downloading: [0, 0.72],
  verifying: [0.72, 0.8],
  loading: [0.8, 0.9],
  initializing: [0.9, 0.98],
  ready: [1, 1],
};

const DOWNLOADED_PROGRESS_VALUE = PHASE_PROGRESS.verifying[1];

type SetupSessionMap = Record<string, SetupSession>;

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

function nowIso(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseStoredSetupSession(value: unknown): SetupSession | null {
  if (!isRecord(value)) return null;
  if (typeof value.modelId !== 'string' || typeof value.state !== 'string' || typeof value.progressText !== 'string') {
    return null;
  }

  const cachedModel = value.cachedModel === true;
  const engineReady = value.engineReady === true;
  const progressValue = clampProgress(typeof value.progressValue === 'number' ? value.progressValue : 0);
  const updatedAt = typeof value.updatedAt === 'string' && value.updatedAt ? value.updatedAt : nowIso();
  const completedAt = typeof value.completedAt === 'string' && value.completedAt ? value.completedAt : undefined;
  const lastError = typeof value.lastError === 'string' && value.lastError ? value.lastError : undefined;

  return {
    modelId: value.modelId,
    state: value.state as EngineState,
    progressValue,
    progressText: value.progressText,
    cachedModel,
    engineReady,
    updatedAt,
    lastError,
    completedAt,
  };
}

function readSetupSessionMap(): SetupSessionMap {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(SETUP_SESSIONS_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return {};

    const entries = Object.entries(parsed)
      .map(([modelId, value]) => {
        const session = parseStoredSetupSession(value);
        if (!session || session.modelId !== modelId) return null;
        return [modelId, session] as const;
      })
      .filter((entry): entry is readonly [string, SetupSession] => Boolean(entry));

    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

function writeSetupSessionMap(map: SetupSessionMap): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(SETUP_SESSIONS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore persistence failures and keep runtime moving
  }
}

function readPersistedSetupSession(modelId: string): SetupSession | null {
  return readSetupSessionMap()[modelId] ?? null;
}

function writePersistedSetupSession(session: SetupSession): void {
  const map = readSetupSessionMap();
  map[session.modelId] = session;
  writeSetupSessionMap(map);
}

function clearPersistedSetupSessions(modelId?: string): void {
  if (!modelId) {
    writeSetupSessionMap({});
    return;
  }

  const map = readSetupSessionMap();
  delete map[modelId];
  writeSetupSessionMap(map);
}

function getInterruptedPhaseLabel(state: EngineState): string {
  if (state === 'downloading') return 'downloading the offline model';
  if (state === 'verifying') return 'verifying the downloaded files';
  if (state === 'loading') return 'loading the cached model';
  if (state === 'initializing') return 'initializing the local engine';
  return 'setting up the offline model';
}

function getInterruptedText(previousState: EngineState, cachedModel: boolean): string {
  const phase = getInterruptedPhaseLabel(previousState);
  return cachedModel
    ? `Setup was interrupted while ${phase}. The download is still on this device.`
    : `Setup was interrupted while ${phase}. Start the setup again.`;
}

function getFailedText(cachedModel: boolean): string {
  return cachedModel
    ? 'Loading the downloaded model failed. Try loading it again.'
    : 'Offline setup failed before the first download finished. Try again.';
}

function createSetupSession(
  modelId: string,
  state: EngineState,
  overrides: Partial<Omit<SetupSession, 'modelId' | 'state'>> = {},
): SetupSession {
  return {
    modelId,
    state,
    progressValue: 0,
    progressText: IDLE_PROGRESS_TEXT,
    cachedModel: false,
    engineReady: false,
    updatedAt: nowIso(),
    ...overrides,
  };
}

function createIdleSession(modelId: string): SetupSession {
  return createSetupSession(modelId, 'idle', {
    progressValue: 0,
    progressText: IDLE_PROGRESS_TEXT,
    cachedModel: false,
    engineReady: false,
    lastError: undefined,
    completedAt: undefined,
  });
}

function createDownloadedSession(modelId: string, previous: SetupSession | null): SetupSession {
  return createSetupSession(modelId, 'downloaded', {
    progressValue: Math.max(previous?.progressValue ?? 0, DOWNLOADED_PROGRESS_VALUE),
    progressText: DOWNLOADED_PROGRESS_TEXT,
    cachedModel: true,
    engineReady: false,
    lastError: previous?.lastError,
    completedAt: previous?.completedAt,
  });
}

function createReadySession(modelId: string, previous: SetupSession | null): SetupSession {
  return createSetupSession(modelId, 'ready', {
    progressValue: 1,
    progressText: 'Offline model is ready on this device.',
    cachedModel: true,
    engineReady: true,
    lastError: undefined,
    completedAt: nowIso(),
  });
}

function createFailedSession(modelId: string, cachedModel: boolean, lastError: string, previous: SetupSession | null): SetupSession {
  return createSetupSession(modelId, 'failed', {
    progressValue: cachedModel ? Math.max(previous?.progressValue ?? 0, DOWNLOADED_PROGRESS_VALUE) : previous?.progressValue ?? 0,
    progressText: getFailedText(cachedModel),
    cachedModel,
    engineReady: false,
    lastError,
    completedAt: previous?.completedAt,
  });
}

function createInterruptedSession(modelId: string, cachedModel: boolean, previous: SetupSession): SetupSession {
  return createSetupSession(modelId, 'interrupted', {
    progressValue: cachedModel ? Math.max(previous.progressValue, DOWNLOADED_PROGRESS_VALUE) : previous.progressValue,
    progressText: getInterruptedText(previous.state, cachedModel),
    cachedModel,
    engineReady: false,
    lastError: previous.lastError,
    completedAt: previous.completedAt,
  });
}

function reconcileSetupSession(args: {
  modelId: string;
  cachedModel: boolean;
  engineReady: boolean;
  storedSession: SetupSession | null;
}): SetupSession {
  const { modelId, cachedModel, engineReady, storedSession } = args;

  if (engineReady) {
    return createReadySession(modelId, storedSession);
  }

  if (storedSession && isSetupState(storedSession.state)) {
    const interrupted = createInterruptedSession(modelId, cachedModel, storedSession);
    writePersistedSetupSession(interrupted);
    return interrupted;
  }

  if (cachedModel) {
    if (storedSession?.state === 'interrupted') {
      return { ...storedSession, cachedModel: true, engineReady: false, progressValue: Math.max(storedSession.progressValue, DOWNLOADED_PROGRESS_VALUE), updatedAt: nowIso() };
    }

    if (storedSession?.state === 'failed') {
      return { ...storedSession, cachedModel: true, engineReady: false, progressValue: Math.max(storedSession.progressValue, DOWNLOADED_PROGRESS_VALUE), updatedAt: nowIso() };
    }

    return createDownloadedSession(modelId, storedSession);
  }

  if (storedSession?.state === 'interrupted') {
    return { ...storedSession, cachedModel: false, engineReady: false, updatedAt: nowIso() };
  }

  if (storedSession?.state === 'failed') {
    return { ...storedSession, cachedModel: false, engineReady: false, updatedAt: nowIso() };
  }

  return createIdleSession(modelId);
}

function getHeaderStatusLabel(engineState: EngineState, online: boolean, chatUnlocked: boolean): string {
  if (chatUnlocked) return 'ready';
  if (engineState === 'interrupted') return 'resume setup';
  if (engineState === 'failed') return 'needs attention';
  if (engineState === 'downloaded') return 'downloaded';
  if (!online && engineState === 'idle') return 'offline';
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
  const [progressText, setProgressText] = useState(IDLE_PROGRESS_TEXT);
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
  const setupSessionRef = useRef<SetupSession | null>(null);

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

  const checkModelCached = useCallback(async (modelId: string) => {
    try {
      return await zayaEngine.isModelCached(modelId);
    } catch {
      return false;
    }
  }, []);

  const applySetupSession = useCallback((session: SetupSession, options: { persist?: boolean } = {}) => {
    setupSessionRef.current = session;

    if (options.persist !== false) {
      writePersistedSetupSession(session);
    }

    if (selectedModelIdRef.current === session.modelId) {
      setEngineState(session.state);
      setEngineReady(session.engineReady);
      setCachedModel(session.cachedModel);
      setProgressValue(session.progressValue);
      setProgressText(session.progressText);
    }
  }, []);

  const reconcileCurrentModel = useCallback(async (modelId: string, options: { openSettingsOnProblem?: boolean } = {}) => {
    const engineReadyNow = zayaEngine.isReady(modelId);
    const cachedModelNow = await checkModelCached(modelId);
    const storedSession = readPersistedSetupSession(modelId);
    const reconciled = reconcileSetupSession({
      modelId,
      cachedModel: cachedModelNow,
      engineReady: engineReadyNow,
      storedSession,
    });

    applySetupSession(reconciled);

    if (options.openSettingsOnProblem && (reconciled.state === 'interrupted' || reconciled.state === 'failed')) {
      setSettingsOpen(true);
    }

    return reconciled;
  }, [applySetupSession, checkModelCached]);

  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      const stored = await listMessages(conversationId);
      messagesRef.current = stored;
      setMessages(stored);
    } catch (error) {
      setToast({ id: createId('toast'), tone: 'error', message: toReadableError(error) });
    }
  }, []);

  const ensureConversation = useCallback(async (modelId: string): Promise<ConversationRecord> => {
    const active = conversationsRef.current.find((item) => item.id === activeConversationIdRef.current);
    if (active && active.modelId === modelId) return active;

    const existingForModel = conversationsRef.current.find((item) => item.modelId === modelId);
    if (existingForModel) {
      if (activeConversationIdRef.current !== existingForModel.id) {
        activeConversationIdRef.current = existingForModel.id;
        setActiveConversationId(existingForModel.id);
        void loadMessages(existingForModel.id);
      }
      return existingForModel;
    }

    const created = createConversationRecord(modelId);
    await saveConversation(created);
    setConversations((current) => [created, ...current]);
    conversationsRef.current = [created, ...conversationsRef.current];
    activeConversationIdRef.current = created.id;
    setActiveConversationId(created.id);
    messagesRef.current = [];
    setMessages([]);
    return created;
  }, [loadMessages]);

  const handleBootProgress = useCallback((modelId: string, cachedAtStart: boolean, progress: EngineBootProgress) => {
    applySetupSession(createSetupSession(modelId, progress.phase, {
      progressValue: mapPhaseProgress(progress.phase, progress.progress),
      progressText: progress.text,
      cachedModel: cachedAtStart || progress.phase !== 'downloading',
      engineReady: false,
      completedAt: setupSessionRef.current?.modelId === modelId ? setupSessionRef.current.completedAt : undefined,
    }));
  }, [applySetupSession]);

  const warmupModel = useCallback(async (options: { auto?: boolean; modelId?: string } = {}) => {
    const targetModelId = options.modelId ?? selectedModelIdRef.current;

    if (warmupPromiseRef.current) {
      if (warmupModelIdRef.current === targetModelId) {
        return warmupPromiseRef.current;
      }
      throw new Error('Another offline setup is already running. Wait for it to finish.');
    }

    if (zayaEngine.isReady(targetModelId)) {
      applySetupSession(createReadySession(targetModelId, setupSessionRef.current));
      return;
    }

    const run = (async () => {
      if (!support.supported) {
        throw new Error('This browser is missing the features needed for local AI.');
      }

      const cachedAtStart = await checkModelCached(targetModelId);

      if (!online && !cachedAtStart) {
        const offlineFailure = createFailedSession(
          targetModelId,
          false,
          'Connect to the internet once to download the offline model.',
          setupSessionRef.current?.modelId === targetModelId ? setupSessionRef.current : null,
        );
        applySetupSession(offlineFailure);
        throw new Error('Connect to the internet once to download the offline model.');
      }

      try {
        const startingSession = createSetupSession(targetModelId, cachedAtStart ? 'loading' : 'downloading', {
          progressValue: cachedAtStart ? PHASE_PROGRESS.loading[0] : 0.02,
          progressText: cachedAtStart ? 'Loading cached model…' : 'Downloading offline model…',
          cachedModel: cachedAtStart,
          engineReady: false,
          completedAt: setupSessionRef.current?.modelId === targetModelId ? setupSessionRef.current.completedAt : undefined,
        });
        applySetupSession(startingSession);

        await zayaEngine.boot(targetModelId, (progress) => handleBootProgress(targetModelId, cachedAtStart, progress));

        if (!zayaEngine.isReady(targetModelId)) {
          throw new Error('The offline model finished setup, but it is not ready yet.');
        }

        await ensureConversation(targetModelId);
        const readySession = createReadySession(targetModelId, setupSessionRef.current?.modelId === targetModelId ? setupSessionRef.current : null);
        applySetupSession(readySession);
        autoLoadAttemptRef.current = targetModelId;

        if (!options.auto) {
          setSettingsOpen(false);
          setToast({ id: createId('toast'), tone: 'success', message: 'Offline setup finished.' });
        }
      } catch (error) {
        console.error('Zaya offline setup failed', error);
        autoLoadAttemptRef.current = '';
        const readable = toReadableError(error);
        const cachedAfterFailure = await checkModelCached(targetModelId);
        const failedSession = createFailedSession(
          targetModelId,
          cachedAfterFailure,
          readable,
          setupSessionRef.current?.modelId === targetModelId ? setupSessionRef.current : null,
        );
        applySetupSession(failedSession);
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
  }, [applySetupSession, checkModelCached, ensureConversation, handleBootProgress, online, support.supported]);

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

        selectedModelIdRef.current = savedModelId;
        conversationsRef.current = savedConversations;
        activeConversationIdRef.current = savedConversationId || savedConversations[0]?.id || '';

        setSelectedModelId(savedModelId);
        setConversations(savedConversations);
        setActiveConversationId(activeConversationIdRef.current);

        await reconcileCurrentModel(savedModelId, { openSettingsOnProblem: true });

        if (cancelled) return;
        setBootstrapped(true);
      } catch (error) {
        if (cancelled) return;
        setToast({ id: createId('toast'), tone: 'error', message: toReadableError(error) });
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [reconcileCurrentModel]);

  useEffect(() => {
    return () => {
      void zayaEngine.unload();
    };
  }, []);

  useEffect(() => {
    if (!activeConversationId) {
      messagesRef.current = [];
      setMessages([]);
      return;
    }

    void loadMessages(activeConversationId);
    void saveSetting(ACTIVE_CONVERSATION_KEY, activeConversationId);
  }, [activeConversationId, loadMessages]);

  useEffect(() => {
    if (!bootstrapped || !support.supported) return;
    if (warmupPromiseRef.current || generatingRef.current) return;
    if (engineReady || zayaEngine.isReady(selectedModelId)) return;

    const currentSession = setupSessionRef.current;
    if (!currentSession || currentSession.modelId !== selectedModelId) return;
    if (currentSession.state !== 'downloaded' || !currentSession.cachedModel || !currentSession.completedAt) return;
    if (autoLoadAttemptRef.current === selectedModelId) return;

    autoLoadAttemptRef.current = selectedModelId;
    void warmupModel({ auto: true, modelId: selectedModelId }).catch(() => {
      // toast handled inside warmupModel
    });
  }, [bootstrapped, engineReady, selectedModelId, support.supported, warmupModel]);

  useEffect(() => {
    if (!bootstrapped) return;

    const handleResume = () => {
      void reconcileCurrentModel(selectedModelIdRef.current, { openSettingsOnProblem: true });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleResume();
      }
    };

    window.addEventListener('pageshow', handleResume);
    window.addEventListener('focus', handleResume);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('pageshow', handleResume);
      window.removeEventListener('focus', handleResume);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [bootstrapped, reconcileCurrentModel]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function handleSelectModel(modelId: string) {
    if (modelId === selectedModelIdRef.current || isBusyState(engineState)) return;

    try {
      selectedModelIdRef.current = modelId;
      setSelectedModelId(modelId);
      await saveSetting(SELECTED_MODEL_KEY, modelId);
      autoLoadAttemptRef.current = '';

      if (zayaEngine.getActiveModelId() && zayaEngine.getActiveModelId() !== modelId) {
        await zayaEngine.unload();
      }

      await reconcileCurrentModel(modelId, { openSettingsOnProblem: true });
    } catch (error) {
      setToast({ id: createId('toast'), tone: 'error', message: toReadableError(error) });
    }
  }

  async function deleteModelCache() {
    const modelId = selectedModelIdRef.current;

    try {
      await zayaEngine.removeCachedModel(modelId);
      autoLoadAttemptRef.current = '';
      const idleSession = createIdleSession(modelId);
      applySetupSession(idleSession);
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
      conversationsRef.current = [created, ...conversationsRef.current];
      activeConversationIdRef.current = created.id;
      setActiveConversationId(created.id);
      messagesRef.current = [];
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
        conversationsRef.current = remaining;

        if (activeConversationIdRef.current === id) {
          activeConversationIdRef.current = remaining[0]?.id ?? '';
          setActiveConversationId(activeConversationIdRef.current);
          messagesRef.current = [];
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
    const assistantCreatedAt = nowIso();
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
          const nextMessages = [...current, nextMessage];
          messagesRef.current = nextMessages;
          return nextMessages;
        }

        const nextMessages = current.map((message) => (message.id === assistantMessageId ? { ...nextMessage, conversationId: message.conversationId } : message));
        messagesRef.current = nextMessages;
        return nextMessages;
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
      setDraft('');
      applySetupSession(createSetupSession(modelId, 'generating', {
        progressValue: 1,
        progressText: 'Offline model is ready on this device.',
        cachedModel: true,
        engineReady: true,
        completedAt: setupSessionRef.current?.modelId === modelId ? setupSessionRef.current.completedAt : nowIso(),
      }));

      const conversation = await ensureConversation(modelId);
      assistantConversationId = conversation.id;

      const existingConversationMessages = conversation.id === activeConversationIdRef.current
        ? messagesRef.current
        : await listMessages(conversation.id);

      if (activeConversationIdRef.current !== conversation.id) {
        activeConversationIdRef.current = conversation.id;
        setActiveConversationId(conversation.id);
      }

      const now = nowIso();
      const userMessage: ChatMessage = {
        id: createId('msg'),
        conversationId: conversation.id,
        role: 'user',
        content: userText,
        createdAt: now,
        status: 'complete',
      };

      const nextMessages = [...existingConversationMessages, userMessage];
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
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
        const nextConversations = [userConversationPatch, ...rest];
        conversationsRef.current = nextConversations;
        return nextConversations;
      });
      await saveConversation(userConversationPatch);

      const history = nextMessages
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
        updatedAt: nowIso(),
        lastMessagePreview: finalAssistant.content.slice(0, 80),
      };

      setConversations((current) => {
        const rest = current.filter((item) => item.id !== conversation.id);
        const nextConversations = [conversationPatch, ...rest];
        conversationsRef.current = nextConversations;
        return nextConversations;
      });
      await saveConversation(conversationPatch);

      applySetupSession(createReadySession(modelId, setupSessionRef.current?.modelId === modelId ? setupSessionRef.current : null));
    } catch (error) {
      const readable = toReadableError(error);
      const stillReady = zayaEngine.isReady(modelId);

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

      if (stillReady) {
        applySetupSession(createReadySession(modelId, setupSessionRef.current?.modelId === modelId ? setupSessionRef.current : null));
      } else {
        const cachedAfterFailure = await checkModelCached(modelId);
        applySetupSession(createFailedSession(
          modelId,
          cachedAfterFailure,
          readable,
          setupSessionRef.current?.modelId === modelId ? setupSessionRef.current : null,
        ));
      }

      setToast({ id: createId('toast'), tone: 'error', message: readable });
    } finally {
      setGenerating(false);
    }
  }

  async function stopGeneration() {
    try {
      await zayaEngine.interrupt();
      setGenerating(false);
      setMessages((current) => {
        const nextMessages = current.filter((message) => !(message.status === 'streaming' && !message.content.trim()));
        messagesRef.current = nextMessages;
        return nextMessages;
      });

      if (zayaEngine.isReady(selectedModelIdRef.current)) {
        applySetupSession(createReadySession(selectedModelIdRef.current, setupSessionRef.current));
      } else {
        await reconcileCurrentModel(selectedModelIdRef.current, { openSettingsOnProblem: true });
      }
    } catch (error) {
      setToast({ id: createId('toast'), tone: 'error', message: toReadableError(error) });
    }
  }

  async function wipeAllLocalData() {
    try {
      await clearAllData();
      await zayaEngine.unload();
      clearPersistedSetupSessions();
      setConversations([]);
      conversationsRef.current = [];
      setMessages([]);
      messagesRef.current = [];
      setActiveConversationId('');
      activeConversationIdRef.current = '';
      setDraft('');
      autoLoadAttemptRef.current = '';
      applySetupSession(createIdleSession(selectedModelIdRef.current));
      setSettingsOpen(false);
    } catch (error) {
      setToast({ id: createId('toast'), tone: 'error', message: toReadableError(error) });
    }
  }

  const chatUnlocked = support.supported && engineReady && zayaEngine.isReady(selectedModelId) && (engineState === 'ready' || engineState === 'generating');
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
        onSelectModel={handleSelectModel}
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
