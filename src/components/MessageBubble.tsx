import { formatClock } from '@/lib/date';
import type { ChatMessage } from '@/types/chat';

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  return (
    <article className={`message message--${message.role}`}>
      {message.role === 'assistant' ? (
        <div className="message__avatar" aria-hidden="true">
          <img src="/icons/icon-192.png" alt="" />
        </div>
      ) : null}

      <div className="message__stack">
        <div className="message__bubble">
          <p>{message.content || (message.status === 'streaming' ? '…' : '')}</p>
        </div>
        <div className="message__meta">
          <span>{message.role === 'assistant' ? 'Zaya' : 'You'}</span>
          <time>{formatClock(message.createdAt)}</time>
        </div>
        {message.status === 'error' ? <small className="message__error">Generation failed. Try again.</small> : null}
      </div>
    </article>
  );
}
