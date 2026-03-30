import { useAutoScroll } from '@/hooks/useAutoScroll';
import type { ChatMessage } from '@/types/chat';
import { MessageBubble } from '@/components/MessageBubble';

interface MessageListProps {
  messages: ChatMessage[];
  loading: boolean;
}

export function MessageList({ messages, loading }: MessageListProps) {
  const ref = useAutoScroll<HTMLDivElement>(messages);

  if (messages.length === 0) {
    return (
      <section className="chat card chat--empty">
        <div className="chat-empty-state">
          <img className="chat-empty-state__logo" src="/icons/icon-192.png" alt="Zaya Pocket" />
          <p className="eyebrow">Offline-first chat</p>
          <h2>Start a local conversation</h2>
          <p>
            Zaya runs on-device after the model is downloaded once. Your chats stay in local storage until you clear them.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section ref={ref} className="chat card" aria-live="polite">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
      {loading ? <p className="chat__hint">Zaya is generating locally…</p> : null}
    </section>
  );
}
