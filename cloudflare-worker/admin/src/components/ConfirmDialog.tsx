export function ConfirmDialog({ open, message, onConfirm, onCancel }: {
  open: boolean; message: string; onConfirm: () => void; onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)',
      display: 'grid', placeItems: 'center', zIndex: 60,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: '#fff', color: '#111', padding: 20, borderRadius: 8, maxWidth: 420,
      }}>
        <p style={{ whiteSpace: 'pre-line', marginTop: 0 }}>{message}</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel}>취소</button>
          <button onClick={onConfirm} style={{ background: '#c62828', color: '#fff' }}>확인</button>
        </div>
      </div>
    </div>
  );
}
