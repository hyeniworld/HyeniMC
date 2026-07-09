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
    <main class="app">
      <header class="app-header">
        <h1 class="app-title">HyeniMC <span class="dot">관리</span></h1>
        <nav class="tabs">
          <button class={`tab ${tab === 'mods' ? 'is-active' : ''}`} onClick={() => setTab('mods')}>모드</button>
          <button class={`tab ${tab === 'packs' ? 'is-active' : ''}`} onClick={() => setTab('packs')}>혜니팩</button>
        </nav>
        <button class="btn spacer" onClick={rebuild}>레지스트리 재생성</button>
      </header>
      {tab === 'mods' ? <ModsView onToast={push} /> : <PacksView onToast={push} />}
      <Toasts items={toasts} />
    </main>
  );
}
