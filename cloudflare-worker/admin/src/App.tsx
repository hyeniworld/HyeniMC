import { useState } from 'preact/hooks';
import { useToast, Toasts } from './components/Toast';
import { ModsView } from './mods/ModsView';
import { PacksView } from './packs/PacksView';
import * as api from './api';

type Tab = 'mods' | 'packs';

export function App() {
  const [tab, setTab] = useState<Tab>('mods');
  const { toasts, push } = useToast();

  async function rebuild() {
    try { const r = await api.rebuildRegistry(); push(`레지스트리 재생성됨 (${r.count}개 모드)`); }
    catch (e: any) { push(e.message, 'err'); }
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>HyeniMC 관리</h1>
        <nav style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setTab('mods')} style={{ fontWeight: tab === 'mods' ? 700 : 400 }}>모드</button>
          <button onClick={() => setTab('packs')} style={{ fontWeight: tab === 'packs' ? 700 : 400 }}>혜니팩</button>
        </nav>
        <button style={{ marginLeft: 'auto' }} onClick={rebuild}>레지스트리 재생성</button>
      </header>
      {tab === 'mods' ? <ModsView onToast={push} /> : <PacksView onToast={push} />}
      <Toasts items={toasts} />
    </main>
  );
}
