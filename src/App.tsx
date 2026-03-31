import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatCompletionMessageParam } from '@mlc-ai/web-llm';
import { Header } from '@/components/Header';
import { SettingsSheet } from '@/components/SettingsSheet';
import { MessageList } from '@/components/MessageList';
import { Composer } from '@/components/Composer';
import { Toast } from '@/components/Toast';
import { buildSystemPrompt } from '@/config/persona';
import { DEFAULT_MODEL_ID, MODEL_OPTIONS } from '@/constants/models';
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
import { isRuntimeDisposedError, toReadableError } from '@/lib/error';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { zayaEngine } from '@/services/engine';
import type {
  ChatMessage,
  ConversationRecord,
  EngineBootProgress,
  EngineState,
  PersistedSetupState,
  SetupPhase,
  SetupSessionRecord,
  ToastState,
} from '@/types/chat';
import './styles.css';

const ACTIVE_CONVERSATION_KEY = 'activeConversationId';
const SELECTED_MODEL_KEY = 'selectedModelId';
const SETUP_SESSION_STORAGE_KEY = 'zayaPocket.setupSessions.v1';
const DEFAULT_IDLE_TEXT = 'Offline setup has not been started yet.';
const DEFAULT_DOWNLOADED_TEXT = 'Downloaded model found. Load it to finish starting the local engine.';
const DEFAULT_READY_TEXT = 'Offline model is ready on this device.';

type SetupSessionMap = Record<string, SetupSessionRecord>;

const PHASE_PROGRESS: Record<SetupPhase, [number, number]> = {
  downloading: [0.02, 0.72],
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
  if (engineState === 'interrupted') return 'interrupted';
  if (engineState === 'downloaded') return 'downloaded';
  if (engineState === 'error') return 'needs attention';
  if (isSetupState(engineState)) return 'setting up';
  return 'setup needed';
}

function getComposerPlaceholder(engineState: EngineState, chatUnlocked: boolean): string {
  if (chatUnlocked) return 'Message Zaya…';
  if (engineState === 'downloaded') return 'Finish loading the downloaded model in Offline setup…';
  if (engineState === 'interrupted') return 'Offline setup was interrupted. Reopen settings and continue…';
  if (engineState === 'error') return 'Offline setup needs attention. Reopen settings to retry…';
  if (isSetupState(engineState)) return 'Offline setup is still running…';
  return 'Open Offline setup to finish the first download…';
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

function normalizeModelId(modelId: string): string {
  return MODEL_OPTIONS.some((model) => model.id === modelId) ? modelId : DEFAULT_MODEL_ID;
}

function isLocalStorageAvailable(): boolean {
  try {
    return typeof window !== 'undefined' && 'localStorage' in window;
  } catch {
    return false;
  }
}

function readSetupSessions(): SetupSessionMap {
  if (!isLocalStorageAvailable()) return {};

  try {
    const raw = window.localStorage.getItem(SETUP_SESSION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SetupSessionMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeSetupSessions(next: SetupSessionMap): void {
  if (!isLocalStorageAvailable()) return;

  try {
    window.localStorage.setItem(SETUP_SESSION_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore localStorage write failures on constrained browsers
  }
}

function readSetupSession(modelId: string): SetupSessionRecord | null {
  const normalizedModelId = normalizeModelId(modelId);
  return readSetupSessions()[normalizedModelId] ?? null;
}

function saveSetupSession(session: SetupSessionRecord): void {
  const sessions = readSetupSessions();
  sessions[session.modelId] = session;
  writeSetupSessions(sessions);
}

function clearSetupSession(modelId?: string): void {
  if (!isLocalStorageAvailable()) return;

  if (!modelId) {
    window.localStorage.removeItem(SETUP_SESSION_STORAGE_KEY);
    return;
  }

  const normalizedModelId = normalizeModelId(modelId);
  const sessions = readSetupSessions();
  delete sessions[normalizedModelId];
  writeSetupSessions(sessions);
}

function createSetupSession(input: {
  modelId: string;
  phase: PersistedSetupState;
  progressValue: number;
  progressText: string;
  cached: boolean;
  engineReady: boolean;
  completedSetup: boolean;
  errorMessage?: string | null;
}): SetupSessionRecord {
  return {
    modelId: normalizeModelId(input.modelId),
    phase: input.phase,
    progressValue: clampProgress(input.progressValue),
    progressText: input.progressText,
    cached: input.cached,
    engineReady: input.engineReady,
    completedSetup: input.completedSetup,
    updatedAt: new Date().toISOString(),
    errorMessage: input.errorMessage ?? null,
  };
}

function getInterruptedText(previousPhase: PersistedSetupState, cached: boolean): string {
  const phaseLabel: Record<PersistedSetupState, string> = {
    idle: 'starting the first download',
    downloading: 'downloading the offline model',
    verifying: 'verifying downloaded files',
    downloaded: 'preparing the downloaded model',
    loading: 'loading the cached model',
    initializing: 'initializing the local engine',
    ready: 'keeping the local engine ready',
    interrupted: 'resuming setup',
    error: 'recovering from a setup error',
  };

  const suffix = cached
    ? ' Downloaded files were found, so you can resume from settings.'
    : ' The download did not finish cleanly, so start setup again from settings.';

  return `Offline setup was interrupted while ${phaseLabel[previousPhase]}.${suffix}`;
}

function deriveRecoveredSession(modelId: string, cached: boolean, ready: boolean, previous: SetupSessionRecord | null): SetupSessionRecord {
  if (ready) {
    return createSetupSession({
      modelId,
      phase: 'ready',
      progressValue: 1,
      progressText: DEFAULT_READY_TEXT,
      cached: true,
      engineReady: true,
      completedSetup: true,
      errorMessage: null,
    });
  }

  if (previous) {
    switch (previous.phase) {
      case 'downloading':
      case 'verifying':
      case 'loading':
      case 'initializing':
        return createSetupSession({
          modelId,
          phase: 'interrupted',
          progressValue: previous.progressValue,
          progressText: getInterruptedText(previous.phase, cached),
          cached,
          engineReady: false,
          completedSetup: previous.completedSetup,
          errorMessage: previous.errorMessage ?? null,
        });
      case 'ready':
        return createSetupSession({
          modelId,
          phase: cached ? 'downloaded' : 'idle',
          progressValue: cached ? PHASE_PROGRESS.verifying[1] : 0,
          progressText: cached ? DEFAULT_DOWNLOADED_TEXT : DEFAULT_IDLE_TEXT,
          cached,
          engineReady: false,
          completedSetup: true,
          errorMessage: null,
        });
      case 'downloaded':
        return createSetupSession({
          modelId,
          phase: cached ? 'downloaded' : 'idle',
          progressValue: cached ? Math.max(previous.progressValue, PHASE_PROGRESS.verifying[1]) : 0,
          progressText: cached ? previous.progressText || DEFAULT_DOWNLOADED_TEXT : DEFAULT_IDLE_TEXT,
          cached,
          engineReady: false,
          completedSetup: previous.completedSetup,
          errorMessage: previous.errorMessage ?? null,
        });
      case 'interrupted':
        return createSetupSession({
          modelId,
          phase: 'interrupted',
          progressValue: previous.progressValue,
          progressText: previous.progressText || getInterruptedText('loading', cached),
          cached,
          engineReady: false,
          completedSetup: previous.completedSetup,
          errorMessage: previous.errorMessage ?? null,
        });
      case 'error':
        return createSetupSession({
          modelId,
          phase: 'error',
          progressValue: previous.progressValue,
          progressText: previous.progressText || 'Offline setup failed. Try again.',
          cached,
          engineReady: false,
          completedSetup: previous.completedSetup,
          errorMessage: previous.errorMessage ?? null,
        });
      case 'idle':
      default:
        break;
    }
  }

  if (cached) {
    return createSetupSession({
      modelId,
      phase: 'downloaded',
      progressValue: PHASE_PROGRESS.verifying[1],
      progressText: DEFAULT_DOWNLOADED_TEXT,
      cached: true,
      engineReady: false,
      completedSetup: previous?.completedSetup ?? false,
      errorMessage: null,
    });
  }

  return createSetupSession({
    modelId,
    phase: 'idle',
    progressValue: 0,
    progressText: DEFAULT_IDLE_TEXT,
    cached: false,
    engineReady: false,
    completedSetup: false,
    errorMessage: null,
  });
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
  const [progressText, setProgressText] = useState(DEFAULT_IDLE_TEXT);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [generating, setGenerating] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [setupSession, setSetupSession] = useState<SetupSessionRecord | null>(null);

  const selectedModelIdRef = useRef(selectedModelId);
  const conversationsRef = useRef(conversations);
  const activeConversationIdRef = useRef(activeConversationId);
  const messagesRef = useRef(messages);
  const generatingRef = useRef(generating);
  const cachedModelRef = useRef(cachedModel);
  const setupSessionRef = useRef<SetupSessionRecord | null>(setupSession);
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

  useEffect(() => {
    cachedModelRef.current = cachedModel;
  }, [cachedModel]);

  useEffect(() => {
    setupSessionRef.current = setupSession;
  }, [setupSession]);

  const persistSetupSession = useCallback((session: SetupSessionRecord | null) => {
    setupSessionRef.current = session;
    setSetupSession(session);
    if (!session) {
      clearSetupSession(selectedModelIdRef.current);
      return;
    }
    saveSetupSession(session);
  }, []);

  const refreshCachedModel = useCallback(async (modelId: string) => {
    try {
      return await zayaEngine.isModelCached(modelId);
    } catch {
      return false;
    }
  }, []);

  const applySessionToUi = useCallback((session: SetupSessionRecord) => {
    if (selectedModelIdRef.current !== session.modelId) return;
    setEngineState(session.phase === 'ready' && !session.engineReady ? 'downloaded' : session.phase);
    setEngineReady(session.engineReady);
    setProgressValue(clampProgress(session.progressValue));
    setProgressText(session.progressText);
    setCachedModel(session.cached);
  }, []);

  const reconcileModelState = useCallback(async (modelId: string): Promise<SetupSessionRecord> => {
    const currentSession = setupSessionRef.current;
    if (warmupPromiseRef.current && warmupModelIdRef.current === modelId && currentSession && currentSession.modelId === modelId) {
      return currentSession;
    }

    const cached = await refreshCachedModel(modelId);

    const sessionAfterCacheCheck = setupSessionRef.current;
    if (warmupPromiseRef.current && warmupModelIdRef.current === modelId && sessionAfterCacheCheck && sessionAfterCacheCheck.modelId === modelId) {
      return sessionAfterCacheCheck;
    }

    const ready = zayaEngine.isReady(modelId);
    const previous = readSetupSession(modelId);
    const recovered = deriveRecoveredSession(modelId, cached, ready, previous);
    persistSetupSession(recovered);
    applySessionToUi(recovered);
    return recovered;
  }, [applySessionToUi, persistSetupSession, refreshCachedModel]);

  const updateCurrentSession = useCallback((session: SetupSessionRecord) => {
    persistSetupSession(session);
    applySessionToUi(session);
  }, [applySessionToUi, persistSetupSession]);

  const markRuntimeForReload = useCallback((reasonText = 'Reloading cached model after app resume…') => {
    const modelId = selectedModelIdRef.current;
    const currentSession = setupSessionRef.current;
    const cached = currentSession?.cached ?? cachedModelRef.current;
    const completedSetup = currentSession?.completedSetup ?? false;
    const hadReadyRuntime = zayaEngine.isReady(modelId) || currentSession?.engineReady === true;

    if (!hadReadyRuntime && !completedSetup) {
      return;
    }

    zayaEngine.markStale();
    autoLoadAttemptRef.current = '';

    if (generatingRef.current) {
      setGenerating(false);
    }

    const nextSession = createSetupSession({
      modelId,
      phase: cached ? 'downloaded' : 'idle',
      progressValue: cached ? PHASE_PROGRESS.verifying[1] : 0,
      progressText: cached ? reasonText : DEFAULT_IDLE_TEXT,
      cached,
      engineReady: false,
      completedSetup,
      errorMessage: null,
    });

    updateCurrentSession(nextSession);
    setSettingsOpen(true);
  }, [updateCurrentSession]);

  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      const stored = await listMessages(conversationId);
      setMessages(stored);
    } catch (error) {
      setToast({ id: createId('toast'), tone: 'error', message: toReadableError(error) });
    }
  }, []);

  const ensureConversation = useCallback(async (modelId: string): Promise<ConversationRecord> => {
    const existing = conversationsRef.current.find(
      (item) => item.id === activeConversationIdRef.current && item.modelId === modelId,
    );
    if (existing) return existing;

    const created = createConversationRecord(modelId);
    await saveConversation(created);
    setConversations((current) => [created, ...current]);
    setActiveConversationId(created.id);
    setMessages([]);
    return created;
  }, []);

  const handleBootProgress = useCallback((modelId: string, progress: EngineBootProgress) => {
    const cached = progress.phase === 'loading' || progress.phase === 'initializing' || cachedModelRef.current;
    const nextSession = createSetupSession({
      modelId,
      phase: progress.phase,
      progressValue: mapPhaseProgress(progress.phase, progress.progress),
      progressText: progress.text,
      cached,
      engineReady: false,
      completedSetup: setupSessionRef.current?.completedSetup ?? false,
      errorMessage: null,
    });

    updateCurrentSession(nextSession);
  }, [updateCurrentSession]);

  const warmupModel = useCallback(async (options: { auto?: boolean; modelId?: string; silentError?: boolean } = {}) => {
    const targetModelId = normalizeModelId(options.modelId ?? selectedModelIdRef.current);

    if (warmupPromiseRef.current) {
      if (warmupModelIdRef.current === targetModelId) {
        return warmupPromiseRef.current;
      }
      throw new Error('Another offline setup is already running. Wait for it to finish.');
    }

    if (zayaEngine.isReady(targetModelId)) {
      const readySession = createSetupSession({
        modelId: targetModelId,
        phase: 'ready',
        progressValue: 1,
        progressText: DEFAULT_READY_TEXT,
        cached: true,
        engineReady: true,
        completedSetup: true,
        errorMessage: null,
      });
      updateCurrentSession(readySession);
      if (selectedModelIdRef.current === targetModelId) {
        setSettingsOpen(false);
      }
      return;
    }

    const run = (async () => {
      if (!support.supported) {
        throw new Error('This browser is missing the features needed for local AI.');
      }

      const cached = await refreshCachedModel(targetModelId);

      if (!online && !cached) {
        const offlineErrorSession = createSetupSession({
          modelId: targetModelId,
          phase: 'error',
          progressValue: 0,
          progressText: 'You need an internet connection for the first offline model download.',
          cached: false,
          engineReady: false,
          completedSetup: setupSessionRef.current?.completedSetup ?? false,
          errorMessage: 'Connect to the internet once to download the offline model.',
        });
        updateCurrentSession(offlineErrorSession);
        throw new Error('Connect to the internet once to download the offline model.');
      }

      const startingSession = createSetupSession({
        modelId: targetModelId,
        phase: cached ? 'loading' : 'downloading',
        progressValue: cached ? PHASE_PROGRESS.loading[0] : PHASE_PROGRESS.downloading[0],
        progressText: cached ? 'Loading cached model…' : 'Downloading offline model…',
        cached,
        engineReady: false,
        completedSetup: setupSessionRef.current?.completedSetup ?? false,
        errorMessage: null,
      });

      updateCurrentSession(startingSession);
      setSettingsOpen(true);

      try {
        await zayaEngine.boot(targetModelId, (progress) => handleBootProgress(targetModelId, progress));

        if (!zayaEngine.isReady(targetModelId)) {
          throw new Error('The offline model finished setup, but it is not ready yet.');
        }

        const cachedAfterBoot = await refreshCachedModel(targetModelId);
        await ensureConversation(targetModelId);

        const readySession = createSetupSession({
          modelId: targetModelId,
          phase: 'ready',
          progressValue: 1,
          progressText: DEFAULT_READY_TEXT,
          cached: cachedAfterBoot,
          engineReady: true,
          completedSetup: true,
          errorMessage: null,
        });

        updateCurrentSession(readySession);
        autoLoadAttemptRef.current = targetModelId;
        setSettingsOpen(false);

        if (!options.auto) {
          setToast({ id: createId('toast'), tone: 'success', message: 'Offline setup finished.' });
        }
      } catch (error) {
        console.error('Zaya offline setup failed', error);
        const readable = toReadableError(error);
        const cachedAfterFailure = await refreshCachedModel(targetModelId);
        const interrupted = cachedAfterFailure || isSetupState(setupSessionRef.current?.phase ?? 'idle');
        const failedSession = createSetupSession({
          modelId: targetModelId,
          phase: interrupted ? 'interrupted' : 'error',
          progressValue: cachedAfterFailure
            ? Math.max(setupSessionRef.current?.progressValue ?? PHASE_PROGRESS.verifying[1], PHASE_PROGRESS.verifying[1])
            : setupSessionRef.current?.progressValue ?? 0,
          progressText: interrupted
            ? getInterruptedText(setupSessionRef.current?.phase ?? 'loading', cachedAfterFailure)
            : 'Offline setup failed before the model became ready. Try again.',
          cached: cachedAfterFailure,
          engineReady: false,
          completedSetup: setupSessionRef.current?.completedSetup ?? false,
          errorMessage: readable,
        });

        updateCurrentSession(failedSession);
        autoLoadAttemptRef.current = '';
        setSettingsOpen(true);
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
      if (!options.silentError) {
        setToast({ id: createId('toast'), tone: 'error', message: toReadableError(error) });
      }
      throw error;
    }
  }, [ensureConversation, handleBootProgress, online, refreshCachedModel, support.supported, updateCurrentSession]);

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

        const normalizedModelId = normalizeModelId(savedModelId);
        setSelectedModelId(normalizedModelId);
        setConversations(savedConversations);
        setActiveConversationId(savedConversationId || savedConversations[0]?.id || '');

        const recovered = await reconcileModelState(normalizedModelId);
        if (cancelled) return;

        setSettingsOpen(!recovered.engineReady);
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
  }, [reconcileModelState]);

  useEffect(() => {
    return () => {
      void zayaEngine.unload();
    };
  }, []);

  useEffect(() => {
    if (!bootstrapped) return;

    void saveSetting(SELECTED_MODEL_KEY, selectedModelId);
    autoLoadAttemptRef.current = '';

    let cancelled = false;
    void reconcileModelState(selectedModelId).then((recovered) => {
      if (cancelled || selectedModelIdRef.current !== selectedModelId) return;
      if (!recovered.engineReady) {
        setSettingsOpen(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [bootstrapped, reconcileModelState, selectedModelId]);

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
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (engineReady || zayaEngine.isReady(selectedModelId)) return;
    if (!cachedModel) {
      autoLoadAttemptRef.current = '';
      return;
    }
    if (isBusyState(engineState) || warmupPromiseRef.current) return;
    if (autoLoadAttemptRef.current === selectedModelId) return;
    if (!setupSession?.completedSetup || setupSession.phase !== 'downloaded') return;

    autoLoadAttemptRef.current = selectedModelId;
    setSettingsOpen(true);
    void warmupModel({ auto: true, modelId: selectedModelId, silentError: true }).catch(() => {
      // errors already reflected in state reconciliation
    });
  }, [bootstrapped, cachedModel, engineReady, engineState, selectedModelId, setupSession, support.supported, warmupModel]);

  useEffect(() => {
    if (!bootstrapped) return;

    const handleResume = () => {
      const modelId = selectedModelIdRef.current;
      if (warmupPromiseRef.current && warmupModelIdRef.current === modelId) return;
      void reconcileModelState(modelId).then((recovered) => {
        if (!recovered.engineReady) {
          autoLoadAttemptRef.current = '';
          setSettingsOpen(true);
        }
      });
    };

    const handleHidden = () => {
      markRuntimeForReload();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        handleHidden();
        return;
      }

      if (document.visibilityState === 'visible') {
        handleResume();
      }
    };

    window.addEventListener('pageshow', handleResume);
    window.addEventListener('pagehide', handleHidden);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('pageshow', handleResume);
      window.removeEventListener('pagehide', handleHidden);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [bootstrapped, markRuntimeForReload, reconcileModelState]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!bootstrapped) return;
    if (!engineReady) {
      setSettingsOpen(true);
    }
  }, [bootstrapped, engineReady]);

  async function deleteModelCache() {
    try {
      await zayaEngine.removeCachedModel(selectedModelId);
      const idleSession = createSetupSession({
        modelId: selectedModelId,
        phase: 'idle',
        progressValue: 0,
        progressText: 'Downloaded model was removed.',
        cached: false,
        engineReady: false,
        completedSetup: false,
        errorMessage: null,
      });
      updateCurrentSession(idleSession);
      autoLoadAttemptRef.current = '';
      setSettingsOpen(true);
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
      if (engineReady) {
        setSettingsOpen(false);
      }
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
        await warmupModel({ modelId, silentError: true });
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

      let attemptedRuntimeRecovery = false;
      const finalText = await (async () => {
        while (true) {
          try {
            return await zayaEngine.streamReply(promptMessages, (token) => {
              streamedContent += token;
              upsertAssistantMessage(streamedContent, 'streaming');
            });
          } catch (error) {
            if (attemptedRuntimeRecovery || streamedContent.trim() || !isRuntimeDisposedError(error)) {
              throw error;
            }

            attemptedRuntimeRecovery = true;
            const cachedBeforeRetry = await refreshCachedModel(modelId);
            if (!cachedBeforeRetry) {
              throw error;
            }

            const recoverySession = createSetupSession({
              modelId,
              phase: 'downloaded',
              progressValue: PHASE_PROGRESS.verifying[1],
              progressText: 'Reloading cached model after app resume…',
              cached: true,
              engineReady: false,
              completedSetup: setupSessionRef.current?.completedSetup ?? true,
              errorMessage: null,
            });

            updateCurrentSession(recoverySession);
            autoLoadAttemptRef.current = '';
            setSettingsOpen(true);
            await warmupModel({ auto: true, modelId, silentError: true });
          }
        }
      })();

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

      const readySession = createSetupSession({
        modelId,
        phase: 'ready',
        progressValue: 1,
        progressText: DEFAULT_READY_TEXT,
        cached: true,
        engineReady: true,
        completedSetup: true,
        errorMessage: null,
      });
      updateCurrentSession(readySession);
    } catch (error) {
      const readable = toReadableError(error);
      const cached = await refreshCachedModel(modelId);
      const nextSession = createSetupSession({
        modelId,
        phase: zayaEngine.isReady(modelId) ? 'ready' : cached ? 'interrupted' : 'error',
        progressValue: cached ? PHASE_PROGRESS.verifying[1] : 0,
        progressText: cached ? getInterruptedText('initializing', true) : 'Offline setup failed before the model became ready. Try again.',
        cached,
        engineReady: zayaEngine.isReady(modelId),
        completedSetup: setupSessionRef.current?.completedSetup ?? false,
        errorMessage: readable,
      });
      updateCurrentSession(nextSession);

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
      setSettingsOpen(true);
    } finally {
      setGenerating(false);
      if (zayaEngine.isReady(modelId)) {
        const readySession = createSetupSession({
          modelId,
          phase: 'ready',
          progressValue: 1,
          progressText: DEFAULT_READY_TEXT,
          cached: true,
          engineReady: true,
          completedSetup: true,
          errorMessage: null,
        });
        updateCurrentSession(readySession);
      }
    }
  }

  async function stopGeneration() {
    try {
      await zayaEngine.interrupt();
      setGenerating(false);
      const cached = await refreshCachedModel(selectedModelIdRef.current);
      const recovered = createSetupSession({
        modelId: selectedModelIdRef.current,
        phase: zayaEngine.isReady(selectedModelIdRef.current) ? 'ready' : cached ? 'downloaded' : 'error',
        progressValue: zayaEngine.isReady(selectedModelIdRef.current) ? 1 : cached ? PHASE_PROGRESS.verifying[1] : 0,
        progressText: zayaEngine.isReady(selectedModelIdRef.current) ? DEFAULT_READY_TEXT : cached ? DEFAULT_DOWNLOADED_TEXT : 'Offline setup needs attention.',
        cached,
        engineReady: zayaEngine.isReady(selectedModelIdRef.current),
        completedSetup: setupSessionRef.current?.completedSetup ?? false,
        errorMessage: null,
      });
      updateCurrentSession(recovered);
      setMessages((current) => current.filter((message) => !(message.status === 'streaming' && !message.content.trim())));
    } catch (error) {
      setToast({ id: createId('toast'), tone: 'error', message: toReadableError(error) });
    }
  }

  async function wipeAllLocalData() {
    try {
      await clearAllData();
      await zayaEngine.unload();
      clearSetupSession();
      setConversations([]);
      setMessages([]);
      setActiveConversationId('');
      setDraft('');
      autoLoadAttemptRef.current = '';
      const idleSession = createSetupSession({
        modelId: selectedModelIdRef.current,
        phase: 'idle',
        progressValue: 0,
        progressText: DEFAULT_IDLE_TEXT,
        cached: false,
        engineReady: false,
        completedSetup: false,
        errorMessage: null,
      });
      updateCurrentSession(idleSession);
      setSettingsOpen(true);
    } catch (error) {
      setToast({ id: createId('toast'), tone: 'error', message: toReadableError(error) });
    }
  }

  const chatUnlocked = support.supported && engineReady && (engineState === 'ready' || engineState === 'generating');
  const settingsBusy = isBusyState(engineState);
  const headerStatusLabel = getHeaderStatusLabel(engineState, online, chatUnlocked);
  const composerPlaceholder = getComposerPlaceholder(engineState, chatUnlocked);

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
            placeholder={composerPlaceholder}
          />
        </main>
      </div>

      <SettingsSheet
        open={settingsOpen}
        onClose={() => {
          if (engineReady && !isSetupState(engineState)) {
            setSettingsOpen(false);
          }
        }}
        canClose={engineReady && !isSetupState(engineState)}
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
