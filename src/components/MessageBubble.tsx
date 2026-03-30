import { formatClock } from '@/lib/date';
import type { ChatMessage } from '@/types/chat';

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isAssistant = message.role === 'assistant';

  return (
    <article className={`message-row ${isAssistant ? 'message-row--assistant' : 'message-row--user'}`}>
      <div className={`message-bubble ${isAssistant ? 'message-bubble--assistant' : 'message-bubble--user'}`}>
        <p>{message.content || (message.status === 'streaming' ? '…' : '')}</p>
      </div>
      <time className="message-time">{formatClock(message.createdAt)}</time>
      {message.status === 'error' ? <small className="message-error">Generation failed. Try again.</small> : null}
    </article>
  );
}
