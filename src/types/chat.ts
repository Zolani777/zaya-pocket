export type StoredRole = 'user' | 'assistant';
export type EngineState = 'idle' | 'loading' | 'ready' | 'error';
export type MessageStatus = 'complete' | 'streaming' | 'error';

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

export interface ToastState {
  id: string;
  tone: 'info' | 'success' | 'error';
  message: string;
}
