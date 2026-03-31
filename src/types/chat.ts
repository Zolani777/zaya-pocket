export type StoredRole = 'user' | 'assistant';
export type EngineState =
  | 'idle'
  | 'downloading'
  | 'verifying'
  | 'downloaded'
  | 'loading'
  | 'initializing'
  | 'ready'
  | 'generating'
  | 'failed'
  | 'interrupted';
export type MessageStatus = 'complete' | 'streaming' | 'error';
export type SetupPhase = Extract<EngineState, 'downloading' | 'verifying' | 'loading' | 'initializing' | 'ready'>;

export interface EngineBootProgress {
  phase: SetupPhase;
  progress: number;
  text: string;
  rawText?: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: StoredRole;
  content: string;
  createdAt: string;
  status: MessageStatus;
}

export interface ConversationRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  modelId: string;
  lastMessagePreview: string;
}

export interface SettingRecord<T = unknown> {
  key: string;
  value: T;
}

export interface ModelOption {
  id: string;
  name: string;
  sizeLabel: string;
  memoryLabel: string;
  description: string;
  recommended?: boolean;
  caution?: string;
}

export interface SetupSession {
  modelId: string;
  state: EngineState;
  progressValue: number;
  progressText: string;
  cachedModel: boolean;
  engineReady: boolean;
  updatedAt: string;
  lastError?: string;
  completedAt?: string;
}

export interface ToastState {
  id: string;
  tone: 'info' | 'success' | 'error';
  message: string;
}
