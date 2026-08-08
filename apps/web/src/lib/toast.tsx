import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { isApiError } from '../api/client';
import './toast.css';

export type ToastTone = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastContextValue {
  toasts: Toast[];
  push: (message: string, tone?: ToastTone) => void;
  pushError: (error: unknown, fallback?: string) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const LIFETIME_MS = 5200;

export function describeError(error: unknown, fallback = 'Something went wrong'): string {
  if (isApiError(error)) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const id = nextId.current;
      nextId.current += 1;
      setToasts((prev) => [...prev, { id, tone, message }]);
      setTimeout(() => dismiss(id), LIFETIME_MS);
    },
    [dismiss],
  );

  const pushError = useCallback(
    (error: unknown, fallback?: string) => push(describeError(error, fallback), 'error'),
    [push],
  );

  const value = useMemo<ToastContextValue>(
    () => ({ toasts, push, pushError, dismiss }),
    [toasts, push, pushError, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.tone}`}>
            <span className="toast__message">{toast.message}</span>
            <button type="button" className="toast__close" onClick={() => dismiss(toast.id)} aria-label="Dismiss">
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside <ToastProvider>');
  return value;
}
