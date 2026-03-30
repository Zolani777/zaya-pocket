import { formatUpdatedAt } from '@/lib/date';
import type { ConversationRecord } from '@/types/chat';

interface ConversationListProps {
  conversations: ConversationRecord[];
  activeConversationId: string;
  onSelect: (id: string) => void;
  onCreate: () => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
}

export function ConversationList({
  conversations,
  activeConversationId,
  onSelect,
  onCreate,
  onDelete,
}: ConversationListProps) {
  return (
    <section className="card stack-lg">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Local memory</p>
          <h2>Conversations</h2>
        </div>
        <button className="button button--ghost" onClick={() => void onCreate()}>
          New chat
        </button>
      </div>

      <div className="conversation-list" role="list">
        {conversations.length === 0 ? (
          <p className="empty-copy">No local chats yet. Start one and it will stay on this device.</p>
        ) : (
          conversations.map((conversation) => {
            const active = conversation.id === activeConversationId;
            return (
              <article key={conversation.id} className={`conversation-item ${active ? 'conversation-item--active' : ''}`}>
                <button className="conversation-item__main" onClick={() => onSelect(conversation.id)}>
                  <strong>{conversation.title}</strong>
                  <span>{conversation.lastMessagePreview || 'No messages yet'}</span>
                  <small>{formatUpdatedAt(conversation.updatedAt)}</small>
                </button>
                <button
                  className="conversation-item__delete"
                  aria-label={`Delete ${conversation.title}`}
                  onClick={() => void onDelete(conversation.id)}
                >
                  ×
                </button>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
