import type { ChatMessage } from '@/types/chat';

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const fromUser = message.role === 'user';

  return (
    <article className={`message ${fromUser ? 'message--user' : 'message--assistant'}`}>
      <div className="message__bubble">
        <p>{message.content}</p>
      </div>
    </article>
  );
}
