import { useEffect, useRef } from 'react';

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
  disabled: boolean;
  generating: boolean;
}

export function Composer({ value, onChange, onSend, onStop, disabled, generating }: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;

    element.style.height = '0px';
    element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
  }, [value]);

  return (
    <section className="composer card">
      <label className="sr-only" htmlFor="zaya-composer">
        Message Zaya Pocket
      </label>
      <textarea
        id="zaya-composer"
        ref={textareaRef}
        value={value}
        rows={1}
        placeholder="Ask Zaya something real…"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void onSend();
          }
        }}
        disabled={disabled}
      />
      <div className="composer__actions">
        <p>Shift + Enter for a new line.</p>
        <div className="button-row">
          {generating ? (
            <button className="button button--ghost" onClick={() => void onStop()}>
              Stop
            </button>
          ) : null}
          <button className="button" onClick={() => void onSend()} disabled={disabled || !value.trim()}>
            Send
          </button>
        </div>
      </div>
    </section>
  );
}
