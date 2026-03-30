import { useEffect, useRef } from 'react';

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
  disabled: boolean;
  generating: boolean;
  placeholder?: string;
}

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  disabled,
  generating,
  placeholder = 'Message Zaya…',
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;

    element.style.height = '0px';
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, [value]);

  return (
    <section className="composer" aria-label="Message composer">
      <label className="sr-only" htmlFor="zaya-composer">
        Message Zaya Pocket
      </label>
      <div className="composer__inner card">
        <textarea
          id="zaya-composer"
          ref={textareaRef}
          value={value}
          rows={1}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void onSend();
            }
          }}
          disabled={disabled}
        />
        <div className="composer__actions composer__actions--compact">
          {generating ? (
            <button type="button" className="button button--ghost" onClick={() => void onStop()}>
              Stop
            </button>
          ) : null}
          <button type="button" className="button" onClick={() => void onSend()} disabled={disabled || !value.trim()}>
            Send
          </button>
        </div>
      </div>
    </section>
  );
}
