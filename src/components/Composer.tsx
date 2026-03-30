import { useEffect, useRef } from 'react';

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
  disabled?: boolean;
  generating?: boolean;
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
    element.style.height = `${Math.min(element.scrollHeight, 96)}px`;
  }, [value]);

  return (
    <section className="composer-shell" aria-label="Message composer">
      <section className="composer">
        <label className="sr-only" htmlFor="zaya-composer">
          Message Zaya Pocket
        </label>

        <div className="composer__inner card">
          <div className="composer__field-row">
            <div className="composer__input-shell">
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

              <button type="button" className="composer__icon" aria-label="Record voice" disabled={disabled || generating}>
                ◉
              </button>
            </div>

            {generating ? (
              <button type="button" className="composer__send composer__send--stop" onClick={() => void onStop()} aria-label="Stop generation">
                ■
              </button>
            ) : (
              <button
                type="button"
                className="composer__send"
                onClick={() => void onSend()}
                disabled={disabled || !value.trim()}
                aria-label="Send message"
              >
                ➤
              </button>
            )}
          </div>
        </div>
      </section>
    </section>
  );
}
