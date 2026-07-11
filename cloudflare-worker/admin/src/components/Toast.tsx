import { useState, useCallback } from 'preact/hooks';

export interface ToastItem { id: number; message: string; kind: 'ok' | 'err'; }

let toastSeq = 0;

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const push = useCallback((message: string, kind: 'ok' | 'err' = 'ok') => {
    const id = ++toastSeq;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return { toasts, push };
}

export function Toasts({ items }: { items: ToastItem[] }) {
  return (
    <div class="toasts">
      {items.map((t) => (
        <div class={`toast is-${t.kind}`} key={t.id}>{t.message}</div>
      ))}
    </div>
  );
}
