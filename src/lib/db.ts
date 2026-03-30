import type { ChatMessage, ConversationRecord, SettingRecord } from '@/types/chat';

const DB_NAME = 'zaya-pocket-db';
const DB_VERSION = 1;
const CONVERSATIONS_STORE = 'conversations';
const MESSAGES_STORE = 'messages';
const SETTINGS_STORE = 'settings';

function wrapRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(CONVERSATIONS_STORE)) {
        const conversations = db.createObjectStore(CONVERSATIONS_STORE, { keyPath: 'id' });
        conversations.createIndex('byUpdatedAt', 'updatedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
        const messages = db.createObjectStore(MESSAGES_STORE, { keyPath: 'id' });
        messages.createIndex('byConversationId', 'conversationId', { unique: false });
        messages.createIndex('byCreatedAt', 'createdAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB.'));
  });
}

export async function listConversations(): Promise<ConversationRecord[]> {
  const db = await openDatabase();
  const transaction = db.transaction(CONVERSATIONS_STORE, 'readonly');
  const store = transaction.objectStore(CONVERSATIONS_STORE);
  const items = (await wrapRequest(store.getAll())) as ConversationRecord[];
  db.close();

  return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getConversation(id: string): Promise<ConversationRecord | undefined> {
  const db = await openDatabase();
  const transaction = db.transaction(CONVERSATIONS_STORE, 'readonly');
  const store = transaction.objectStore(CONVERSATIONS_STORE);
  const item = (await wrapRequest(store.get(id))) as ConversationRecord | undefined;
  db.close();
  return item;
}

export async function saveConversation(conversation: ConversationRecord): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(CONVERSATIONS_STORE, 'readwrite');
  transaction.objectStore(CONVERSATIONS_STORE).put(conversation);
  await waitForTransaction(transaction);
  db.close();
}

export async function listMessages(conversationId: string): Promise<ChatMessage[]> {
  const db = await openDatabase();
  const transaction = db.transaction(MESSAGES_STORE, 'readonly');
  const index = transaction.objectStore(MESSAGES_STORE).index('byConversationId');
  const items = (await wrapRequest(index.getAll(IDBKeyRange.only(conversationId)))) as ChatMessage[];
  db.close();

  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function saveMessage(message: ChatMessage): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(MESSAGES_STORE, 'readwrite');
  transaction.objectStore(MESSAGES_STORE).put(message);
  await waitForTransaction(transaction);
  db.close();
}

export async function saveMessages(messages: ChatMessage[]): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(MESSAGES_STORE, 'readwrite');
  const store = transaction.objectStore(MESSAGES_STORE);
  messages.forEach((message) => store.put(message));
  await waitForTransaction(transaction);
  db.close();
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction([CONVERSATIONS_STORE, MESSAGES_STORE], 'readwrite');
  transaction.objectStore(CONVERSATIONS_STORE).delete(id);

  const index = transaction.objectStore(MESSAGES_STORE).index('byConversationId');
  const messageIds = (await wrapRequest(index.getAllKeys(IDBKeyRange.only(id)))) as IDBValidKey[];
  const messageStore = transaction.objectStore(MESSAGES_STORE);
  messageIds.forEach((messageId) => messageStore.delete(messageId));

  await waitForTransaction(transaction);
  db.close();
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const db = await openDatabase();
  const transaction = db.transaction(SETTINGS_STORE, 'readonly');
  const store = transaction.objectStore(SETTINGS_STORE);
  const item = (await wrapRequest(store.get(key))) as SettingRecord<T> | undefined;
  db.close();
  return item?.value ?? fallback;
}

export async function saveSetting<T>(key: string, value: T): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(SETTINGS_STORE, 'readwrite');
  transaction.objectStore(SETTINGS_STORE).put({ key, value } satisfies SettingRecord<T>);
  await waitForTransaction(transaction);
  db.close();
}

export async function clearAllData(): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction([CONVERSATIONS_STORE, MESSAGES_STORE, SETTINGS_STORE], 'readwrite');
  transaction.objectStore(CONVERSATIONS_STORE).clear();
  transaction.objectStore(MESSAGES_STORE).clear();
  transaction.objectStore(SETTINGS_STORE).clear();
  await waitForTransaction(transaction);
  db.close();
}
