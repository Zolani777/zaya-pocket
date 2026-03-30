import { useAutoScroll } from '@/hooks/useAutoScroll';
import type { ChatMessage } from '@/types/chat';
import { MessageBubble } from '@/components/MessageBubble';

interface MessageListProps {
  messages: ChatMessage[];
  loading: boolean;
}

export function MessageList({ messages, loading }: MessageListProps) {
  const ref = useAutoScroll<HTMLDivElement>(messages);

  return (
    <section ref={ref} className={`chat-view ${messages.length === 0 ? 'chat-view--empty' : ''}`} aria-live="polite">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
      {loading ? <p className="chat-view__hint">Zaya is replying locally…</p> : null}
    </section>
  );
}
