import type { ComponentChildren } from 'preact';

export function Modal({ open, title, onClose, children }: {
  open: boolean; title: ComponentChildren; onClose: () => void; children: ComponentChildren;
}) {
  if (!open) return null;
  return (
    <div class="overlay" onClick={onClose}>
      <div class="dialog dialog-form" onClick={(e) => e.stopPropagation()}>
        <h3 class="dialog-title">{title}</h3>
        {children}
      </div>
    </div>
  );
}
