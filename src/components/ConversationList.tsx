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
    <section className="panel-section stack-md">
      <div className="panel-header panel-header--tight">
        <div>
          <p className="eyebrow">Chats</p>
          <h2>Your conversations</h2>
        </div>
        <button className="button button--ghost" onClick={() => void onCreate()}>
          New
        </button>
      </div>

      <div className="conversation-list" role="list">
        {conversations.length === 0 ? (
          <div className="empty-card">
            <strong>No chats yet</strong>
            <p>Start a conversation and it stays on this device.</p>
          </div>
        ) : (
          conversations.map((conversation) => {
            const active = conversation.id === activeConversationId;
            return (
              <article key={conversation.id} className={`conversation-item ${active ? 'conversation-item--active' : ''}`}>
                <button type="button" className="conversation-item__main" onClick={() => onSelect(conversation.id)}>
                  <strong>{conversation.title}</strong>
                  <span>{conversation.lastMessagePreview || 'No messages yet'}</span>
                  <small>{formatUpdatedAt(conversation.updatedAt)}</small>
                </button>
                <button
                  type="button"
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
