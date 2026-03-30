import type { ToastState } from '@/types/chat';

interface ToastProps {
  toast: ToastState | null;
}

export function Toast({ toast }: ToastProps) {
  if (!toast) return null;

  return <div className={`toast toast--${toast.tone}`}>{toast.message}</div>;
}
