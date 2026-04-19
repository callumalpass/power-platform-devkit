import { useEffect, useRef, useState } from 'react';

export type ToastItem = { id: number; message: string; isError: boolean; timestamp: number };
export type ToastLogItem = ToastItem;

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [log, setLog] = useState<ToastLogItem[]>([]);
  const timersRef = useRef<Map<number, number>>(new Map());

  function dismissToast(id: number) {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timersRef.current.delete(id);
    setToasts((current) => current.filter((item) => item.id !== id));
  }

  function pushToast(message: string, isError = false) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const item: ToastItem = { id, message, isError, timestamp: Date.now() };
    setToasts((current) => [...current, item]);
    setLog((current) => [item, ...current].slice(0, 50));
    const timer = window.setTimeout(() => {
      dismissToast(id);
    }, isError ? 5000 : 2500);
    timersRef.current.set(id, timer);
  }

  function clearLog() {
    setLog([]);
  }

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) window.clearTimeout(timer);
      timersRef.current.clear();
    };
  }, []);

  return { toasts, pushToast, dismissToast, log, clearLog };
}

export function ToastViewport(props: { toasts: ToastItem[]; dismissToast: (id: number) => void }) {
  return (
    <div className="toast-container" id="toasts">
      {props.toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.isError ? 'error' : 'ok'}`}>
          <span className="toast-message">{toast.message}</span>
          <button
            type="button"
            className="toast-dismiss"
            aria-label="Dismiss notification"
            onClick={() => props.dismissToast(toast.id)}
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
}
