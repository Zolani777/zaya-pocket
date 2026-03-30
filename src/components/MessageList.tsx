import { useAutoScroll } from '@/hooks/useAutoScroll';
import type { ChatMessage } from '@/types/chat';
import { MessageBubble } from '@/components/MessageBubble';

interface MessageListProps {
  messages: ChatMessage[];
  loading: boolean;
  chatUnlocked: boolean;
  onOpenSettings: () => void;
}

export function MessageList({ messages, loading, chatUnlocked, onOpenSettings }: MessageListProps) {
  const ref = useAutoScroll<HTMLDivElement>(messages);

  if (messages.length === 0) {
    return (
      <section className="chat-stage chat-stage--empty" aria-live="polite">
        <div className="chat-empty-anchor">
          {chatUnlocked ? (
            <p className="chat-empty-copy">Your local chat is ready. Start typing below.</p>
          ) : (
            <button type="button" className="chat-empty-action" onClick={onOpenSettings}>
              Open settings to finish offline setup
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section ref={ref} className="chat-stage" aria-live="polite">
      <div className="message-list">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {loading ? <p className="chat-hint">Zaya is generating locally…</p> : null}
      </div>
    </section>
  );
}
