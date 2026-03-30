import { useAutoScroll } from '@/hooks/useAutoScroll';
import type { ChatMessage } from '@/types/chat';
import { MessageBubble } from '@/components/MessageBubble';

interface MessageListProps {
  messages: ChatMessage[];
  loading: boolean;
  supported: boolean;
  cachedModel: boolean;
  onOpenSettings: () => void;
  onCreateChat: () => void | Promise<void>;
}

export function MessageList({
  messages,
  loading,
  supported,
  cachedModel,
  onOpenSettings,
  onCreateChat,
}: MessageListProps) {
  const ref = useAutoScroll<HTMLDivElement>(messages);

  if (messages.length === 0) {
    return (
      <section className="chat chat--empty" aria-live="polite">
        <div className="chat-empty-state card">
          <img className="chat-empty-state__logo" src="/icons/icon-192.png" alt="Zaya Pocket" />
          <p className="eyebrow">Offline-first chat</p>
          <h2>Ready when you are</h2>
          <p>
            {supported
              ? cachedModel
                ? 'Start a new chat and your local history stays right here on the phone.'
                : 'Finish offline setup once, then Zaya can run without the network.'
              : 'This browser still needs the graphics support Zaya uses for offline chat.'}
          </p>
          <div className="button-row button-row--centered button-row--stacked-mobile">
            <button type="button" className="button" onClick={() => void onCreateChat()}>
              New chat
            </button>
            <button type="button" className="button button--ghost" onClick={onOpenSettings}>
              {supported ? 'Offline setup' : 'Device check'}
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section ref={ref} className="chat" aria-live="polite">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
      {loading ? <p className="chat__hint">Zaya is replying locally…</p> : null}
    </section>
  );
}
