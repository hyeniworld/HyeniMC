import { useEffect, useState } from 'preact/hooks';
import * as api from '../api';
import { ModVersions } from './ModVersions';
import { ModPublishForm } from './ModPublishForm';

interface Mod { id: string; name: string; latestVersion: string; category: string; }

export function ModsView({ onToast }: { onToast: (m: string, k?: 'ok' | 'err') => void }) {
  const [mods, setMods] = useState<Mod[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  async function load() {
    try { setMods((await api.listMods()).mods); }
    catch (e: any) { onToast(e.message, 'err'); }
  }
  useEffect(() => { load(); }, [refreshKey]);

  return (
    <div class="workspace">
      <aside class="rail">
        <h2 class="rail-title">모드</h2>
        <ul class="rail-list">
          {mods.map((m) => (
            <li key={m.id}>
              <button class={`rail-item ${m.id === selected ? 'is-active' : ''}`}
                onClick={() => setSelected(m.id)}>
                <span class="rail-name">{m.name}</span>
                <span class="rail-id">{m.id} · v{m.latestVersion}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div class="main">
        {selected
          ? <ModVersions modId={selected} onToast={onToast} onChanged={() => setRefreshKey((k) => k + 1)} />
          : <div class="panel"><p class="panel-placeholder">왼쪽에서 모드를 선택하세요.</p></div>}
        <ModPublishForm onToast={onToast} onPublished={() => setRefreshKey((k) => k + 1)} />
      </div>
    </div>
  );
}
