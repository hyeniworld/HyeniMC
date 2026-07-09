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
    <div style={{ position: 'fixed', top: 12, right: 12, display: 'grid', gap: 8, zIndex: 50 }}>
      {items.map((t) => (
        <div key={t.id} style={{
          padding: '8px 14px', borderRadius: 6, color: '#fff',
          background: t.kind === 'ok' ? '#2e7d32' : '#c62828', maxWidth: 360,
        }}>{t.message}</div>
      ))}
    </div>
  );
}
