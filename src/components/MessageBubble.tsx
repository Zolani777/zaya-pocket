import { formatClock } from '@/lib/date';
import type { ChatMessage } from '@/types/chat';

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  return (
    <article className={`message message--${message.role}`}>
      <div className="message__meta">
        <span>{message.role === 'assistant' ? 'Zaya' : 'You'}</span>
        <time>{formatClock(message.createdAt)}</time>
      </div>
      <div className="message__bubble">
        <p>{message.content || (message.status === 'streaming' ? '…' : '')}</p>
      </div>
      {message.status === 'error' ? <small className="message__error">Generation failed. Try again.</small> : null}
    </article>
  );
}
