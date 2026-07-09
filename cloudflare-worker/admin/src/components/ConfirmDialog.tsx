export function ConfirmDialog({ open, message, onConfirm, onCancel }: {
  open: boolean; message: string; onConfirm: () => void; onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div class="overlay" onClick={onCancel}>
      <div class="dialog" onClick={(e) => e.stopPropagation()}>
        <p>{message}</p>
        <div class="dialog-actions">
          <button class="btn" onClick={onCancel}>취소</button>
          <button class="btn btn-danger" onClick={onConfirm}>확인</button>
        </div>
      </div>
    </div>
  );
}
