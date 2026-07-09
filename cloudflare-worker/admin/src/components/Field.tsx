import type { ComponentChildren } from 'preact';

export function Field({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <label style={{ display: 'grid', gap: 4, fontSize: 14 }}>
      <span style={{ color: '#555' }}>{label}</span>
      {children}
    </label>
  );
}
