import { useEffect, useRef } from 'react';

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void | Promise<void>;
  disabled: boolean;
  lockedMessage?: string;
}

export function Composer({ value, onChange, onSend, disabled, lockedMessage }: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;

    element.style.height = '0px';
    element.style.height = `${Math.min(element.scrollHeight, 140)}px`;
  }, [value]);

  return (
    <section className="composer-shell" aria-label="Message composer">
      <div className="composer-bar">
        <label className="sr-only" htmlFor="zaya-composer">
          Message Zaya Pocket
        </label>
        <textarea
          id="zaya-composer"
          ref={textareaRef}
          value={value}
          rows={1}
          placeholder={lockedMessage ?? 'Message Zaya…'}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void onSend();
            }
          }}
          disabled={disabled}
        />

        <button
          type="button"
          className="composer-send"
          aria-label="Send message"
          onClick={() => void onSend()}
          disabled={disabled || !value.trim()}
        >
          ➤
        </button>
      </div>
    </section>
  );
}
